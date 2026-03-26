import { spawn, type ChildProcess } from 'child_process';
import { createInterface, type Interface as ReadlineInterface } from 'readline';
import { EventEmitter } from 'events';
import { appendFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, readFileSync, realpathSync } from 'fs';
import { join } from 'path';
import type { MessageInput, PermissionRequest } from '@my-claudia/shared';

// File-based debug log (stdout is captured by Tauri)
const DEBUG_LOG = '/tmp/codex-app-server-debug.log';
function debugLog(msg: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  try { appendFileSync(DEBUG_LOG, line); } catch { /* ignore */ }
  console.log(msg);
}
import type Database from 'better-sqlite3';
import type { ClaudeMessage, SystemInfo, PermissionDecision, PermissionCallback } from './claude-sdk.js';
import { fileStore } from '../storage/fileStore.js';
import { buildNonImageAttachmentNotes } from './attachment-utils.js';
import { sanitizeInheritedProviderEnv } from '../utils/startup-env.js';
import { buildMcpBridgeEntry } from '../utils/mcp-bridge-launch.js';
import { loadMcpServersFromDb } from '../utils/mcp-config.js';

// ── Types ─────────────────────────────────────────────────────

export interface CodexAppServerOptions {
  cwd: string;
  sessionId?: string;       // Our session ID (maps to threadId)
  cliPath?: string;
  env?: Record<string, string>;
  model?: string;
  mode?: string;
  systemPrompt?: string;
  serverPort?: number;
  claudiaSessionId?: string;
  db?: Database.Database;
}

interface JsonRpcRequest {
  id: number;
  method: string;
  params: unknown;
}

interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface JsonRpcNotification {
  method: string;
  params?: Record<string, unknown>;
}

// App Server item types (from protocol)
interface AppServerItem {
  id?: string;
  type: string;
  text?: string;
  command?: string;
  status?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

// ── Mode → sandbox/approval config args ──────────────────────

function mapModeToConfigArgs(mode?: string): string[] {
  const args: string[] = [];
  switch (mode) {
    case 'plan':
      args.push('-c', 'sandbox_permissions=["read-only"]');
      break;
    case 'bypassPermissions':
      args.push('-c', 'sandbox_permissions=["full-access"]');
      break;
    case 'acceptEdits':
      // Default workspace-write with auto-approve on failure
      break;
    case 'default':
    default:
      break;
  }
  return args;
}

// ── Input preparation ────────────────────────────────────────

interface AppServerInputBlock {
  type: 'text' | 'image';
  text?: string;
  url?: string;
}

function prepareAppServerInput(rawInput: string): AppServerInputBlock[] {
  let messageInput: MessageInput;
  try {
    messageInput = JSON.parse(rawInput);
    if (typeof messageInput !== 'object' || !('text' in messageInput)) {
      return [{ type: 'text', text: rawInput }];
    }
  } catch {
    return [{ type: 'text', text: rawInput }];
  }

  let text = messageInput.text || rawInput;
  const blocks: AppServerInputBlock[] = [];

  if (messageInput.attachments && messageInput.attachments.length > 0) {
    const nonImageNotes = buildNonImageAttachmentNotes(messageInput.attachments);
    if (nonImageNotes.length > 0) {
      text = `${nonImageNotes.join('\n\n')}\n\n${text}`;
    }

    for (const attachment of messageInput.attachments) {
      if (attachment.type === 'image') {
        const filePath = fileStore.getFilePath(attachment.fileId);
        if (filePath) {
          blocks.push({ type: 'image', url: `file://${filePath}` });
          debugLog(`[Codex AppServer] Attached image: ${attachment.name} → ${filePath}`);
        }
      }
    }
  }

  blocks.unshift({ type: 'text', text });
  return blocks;
}

// ── MCP config via stable app data cwd ───────────────────────
// The `-c` flag with JSON values hangs app-server, overriding CODEX_HOME
// breaks multi-login, and writing to the project dir pollutes repos.
//
// Solution: use a stable directory under our app data dir as the
// app-server process cwd, with `.codex/config.toml` containing MCP
// servers.  Codex loads project-level config from cwd, while auth +
// user settings still come from the global CODEX_HOME.  The real
// project cwd is passed via `thread/start { cwd }` separately.
//
// Benefits:
// - All codex sessions share one process + one config dir
// - MCP changes are picked up on next run (or via config/mcpServer/reload)
// - Session rollout files persist → thread/resume works after restart
// - CODEX_HOME is untouched → multi-login works
// - No temp dir cleanup needed

import { homedir } from 'os';

function getCodexConfigDir(): string {
  const dataDir = process.env.MY_CLAUDIA_DATA_DIR
    ? join(process.env.MY_CLAUDIA_DATA_DIR)
    : join(homedir(), '.my-claudia');
  return join(dataDir, 'codex-config');
}

function mcpServersToToml(mcpServers: Record<string, unknown>): string {
  return Object.entries(mcpServers).sort(([a], [b]) => a.localeCompare(b)).map(([name, config]) => {
    const cfg = config as Record<string, unknown>;
    const lines: string[] = [`[mcp_servers.${name}]`];
    if (cfg.command) lines.push(`command = ${JSON.stringify(cfg.command)}`);
    if (cfg.args && Array.isArray(cfg.args)) {
      lines.push(`args = ${JSON.stringify(cfg.args)}`);
    }
    if (cfg.env && typeof cfg.env === 'object') {
      lines.push(`[mcp_servers.${name}.env]`);
      for (const [k, v] of Object.entries(cfg.env as Record<string, string>).sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`${k} = ${JSON.stringify(v)}`);
      }
    }
    if (cfg.url) lines.push(`url = ${JSON.stringify(cfg.url)}`);
    return lines.join('\n');
  }).join('\n\n');
}

function buildMcpConfigToml(options: CodexAppServerOptions): string {
  const mcpServers: Record<string, unknown> = {};
  if (options.db) {
    Object.assign(mcpServers, loadMcpServersFromDb(options.db, 'codex'));
  }
  if (options.serverPort) {
    // No sessionId in bridge config — bridge inherits CLAUDIA_SESSION_ID
    // from the per-session app-server parent process env
    const bridgeEntry = buildMcpBridgeEntry(options.serverPort);
    if (bridgeEntry) {
      mcpServers['claudia-plugins'] = bridgeEntry;
    }
  }

  return Object.keys(mcpServers).length > 0 ? mcpServersToToml(mcpServers) : '';
}

function upsertTrustedProjectConfig(existing: string, projectPath: string): string {
  const header = `[projects.${JSON.stringify(projectPath)}]`;
  const sectionPattern = new RegExp(`(^|\\n)${header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\n(?:[^\\[][^\\n]*\\n?)*)?`, 'm');

  if (!sectionPattern.test(existing)) {
    const trimmed = existing.trimEnd();
    return `${trimmed ? `${trimmed}\n\n` : ''}${header}\ntrust_level = "trusted"\n`;
  }

  return existing.replace(sectionPattern, (match) => {
    if (/^\s*trust_level\s*=.*$/m.test(match)) {
      return match.replace(/^\s*trust_level\s*=.*$/m, 'trust_level = "trusted"');
    }
    return `${match.trimEnd()}\ntrust_level = "trusted"\n`;
  });
}

function ensureCodexProjectTrusted(configDir: string): void {
  const userCodexConfigPath = join(homedir(), '.codex', 'config.toml');
  const trustPaths = new Set<string>([configDir]);

  try {
    trustPaths.add(realpathSync(configDir));
  } catch {
    // Best effort only; fall back to the original path.
  }

  let existing = '';
  if (existsSync(userCodexConfigPath)) {
    try {
      existing = readFileSync(userCodexConfigPath, 'utf-8');
    } catch (error) {
      debugLog(`[Codex AppServer] WARN: Failed to read user Codex config: ${error}`);
      return;
    }
  } else {
    mkdirSync(join(homedir(), '.codex'), { recursive: true });
  }

  let next = existing;
  for (const trustPath of trustPaths) {
    next = upsertTrustedProjectConfig(next, trustPath);
  }

  if (next !== existing) {
    try {
      writeFileSync(userCodexConfigPath, next, 'utf-8');
      debugLog(`[Codex AppServer] Trusted project for config loading: ${Array.from(trustPaths).join(', ')}`);
    } catch (error) {
      debugLog(`[Codex AppServer] WARN: Failed to update user Codex trust config: ${error}`);
    }
  }
}

/**
 * Write MCP config to the stable codex config dir.
 * Session ID is passed via parent process env (CLAUDIA_SESSION_ID),
 * not via config — bridge child processes inherit it automatically.
 */
/** Last written config content — skip redundant writes */
let lastWrittenConfig = '';

function writeMcpConfig(options: CodexAppServerOptions): { configDir: string; configSignature: string } {
  const configDir = getCodexConfigDir();
  mkdirSync(configDir, { recursive: true });
  ensureCodexProjectTrusted(configDir);
  const configToml = buildMcpConfigToml(options);

  // Only write when config content actually changed
  if (configToml !== lastWrittenConfig) {
    const codexDir = join(configDir, '.codex');
    mkdirSync(codexDir, { recursive: true });
    const configPath = join(codexDir, 'config.toml');

    if (configToml) {
      writeFileSync(configPath, configToml, 'utf-8');
      debugLog(`[Codex AppServer] Wrote MCP config: ${configPath}`);
    } else if (existsSync(configPath)) {
      unlinkSync(configPath);
      debugLog(`[Codex AppServer] Removed MCP config: ${configPath}`);
    }
    lastWrittenConfig = configToml;
  }

  return { configDir, configSignature: configToml };
}

// ── App Server Client ────────────────────────────────────────

export class CodexAppServerClient {
  private process: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private emitter = new EventEmitter();
  private initialized = false;
  private cliPath: string;
  private env: Record<string, string>;
  private extraArgs: string[];
  // Active permission callback (set during runTurn)
  private permissionCallback: PermissionCallback | null = null;

  private processCwd: string | undefined;

  /** Last activity timestamp for idle cleanup */
  lastActivity: number = Date.now();

  /** Number of in-flight turns; active clients must not be reaped */
  activeTurns = 0;

  constructor(cliPath: string | undefined, env: Record<string, string>, extraArgs: string[] = [], options?: { processCwd?: string }) {
    this.cliPath = cliPath || 'codex';
    this.env = env;
    this.extraArgs = extraArgs;
    this.processCwd = options?.processCwd;
  }

  // ── Process lifecycle ──

  async ensureRunning(): Promise<void> {
    if (this.process && !this.process.killed) return;

    const args = ['app-server', '--listen', 'stdio://', '--session-source', 'custom', ...this.extraArgs];
    debugLog(`[Codex AppServer] Spawning: ${this.cliPath} ${args.join(' ')}`);

    this.process = spawn(this.cliPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.env,
      cwd: this.processCwd,
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) debugLog(`[Codex AppServer stderr] ${text}`);
    });

    this.process.on('exit', (code, signal) => {
      debugLog(`[Codex AppServer] Process exited: code=${code}, signal=${signal}`);
      this.process = null;
      this.initialized = false;
      // Reject all pending requests
      for (const [id, { reject }] of this.pendingRequests) {
        reject(new Error(`Codex app-server process exited (code=${code})`));
        this.pendingRequests.delete(id);
      }
      this.emitter.emit('exit', code);
    });

    this.readline = createInterface({ input: this.process.stdout!, crlfDelay: Infinity });
    this.readline.on('line', (line) => this.handleLine(line));

    // Initialize handshake
    debugLog('[Codex AppServer] Sending initialize...');
    try {
      const initResult = await this.sendRequest('initialize', {
        clientInfo: { name: 'my-claudia', version: '1.0.0' },
      });
      this.initialized = true;
      debugLog(`[Codex AppServer] Initialized: ${JSON.stringify(initResult).slice(0, 200)}`);
    } catch (err) {
      debugLog(`[Codex AppServer] Initialize failed: ${err}`);
      throw err;
    }
  }

  destroy(): void {
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
    }
    this.readline?.close();
    this.process = null;
    this.initialized = false;
  }

  // ── JSON-RPC transport ──

  private send(msg: Record<string, unknown>): void {
    if (!this.process?.stdin?.writable) {
      throw new Error('Codex app-server process not running');
    }
    this.process.stdin.write(JSON.stringify(msg) + '\n');
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.send({ id, method, params });
    });
  }

  private sendResponse(id: number, result: unknown): void {
    this.send({ id, result });
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    this.lastActivity = Date.now();

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      debugLog(`[Codex AppServer] WARN: Failed to parse: ${line.slice(0, 200)}`);
      return;
    }

    const method = msg.method as string | undefined;
    // Log all messages except high-frequency deltas
    if (method !== 'item/agentMessage/delta' && method !== 'item/reasoning/textDelta') {
      debugLog(`[Codex AppServer] ← ${method || 'response'}: ${JSON.stringify(msg).slice(0, 300)}`);
    }

    const hasId = 'id' in msg;
    const hasMethod = 'method' in msg;

    if (hasId && !hasMethod) {
      // Response to our request
      const resp = msg as unknown as JsonRpcResponse;
      const pending = this.pendingRequests.get(resp.id);
      if (pending) {
        this.pendingRequests.delete(resp.id);
        if (resp.error) {
          pending.reject(new Error(`JSON-RPC error ${resp.error.code}: ${resp.error.message}`));
        } else {
          pending.resolve(resp.result);
        }
      }
    } else if (hasId && hasMethod) {
      // Server request (needs our response)
      this.handleServerRequest(
        msg.id as number,
        msg.method as string,
        msg.params as Record<string, unknown> | undefined,
      );
    } else if (hasMethod) {
      // Notification
      this.emitter.emit('notification', msg.method, msg.params || {});
    }
  }

  private async handleServerRequest(id: number, method: string, params?: Record<string, unknown>): Promise<void> {
    debugLog(`[Codex AppServer] Server request: ${method}`);
    this.lastActivity = Date.now();

    // Map approval requests to our permission callback
    if (method.includes('Approval') || method.includes('approval')) {
      if (this.permissionCallback) {
        try {
          const permissionRequest = this.mapApprovalToPermissionRequest(method, params);
          const decision = await this.permissionCallback(permissionRequest);
          this.sendResponse(id, { approved: decision.behavior === 'allow' });
        } catch (error) {
          debugLog(`[Codex AppServer] ERROR: Permission callback error: ${error}`);
          this.sendResponse(id, { approved: false });
        }
      } else {
        // No callback, auto-deny
        debugLog(`[Codex AppServer] WARN: No permission callback, denying: ${method}`);
        this.sendResponse(id, { approved: false });
      }
      return;
    }

    // Unknown server request — respond with empty result
    this.sendResponse(id, {});
  }

  private mapApprovalToPermissionRequest(method: string, params?: Record<string, unknown>): PermissionRequest {
    // Map App Server approval methods to our PermissionRequest format
    const command = params?.command as string || '';
    let toolName = 'Unknown';
    let toolInput: Record<string, unknown> = {};

    if (method.includes('commandExecution') || method.includes('ExecCommand')) {
      toolName = 'Bash';
      toolInput = { command };
    } else if (method.includes('fileChange') || method.includes('ApplyPatch')) {
      toolName = 'Edit';
      toolInput = { changes: params?.patch || params?.changes || '' };
    }

    return {
      toolName,
      toolInput,
      requestId: `codex-${Date.now()}`,
    } as PermissionRequest;
  }

  // ── Thread & turn operations ──

  async startThread(cwd: string): Promise<string> {
    await this.ensureRunning();
    const result = await this.sendRequest('thread/start', { cwd }) as Record<string, unknown>;
    const thread = result?.thread as Record<string, unknown>;
    const threadId = (thread?.id as string) || (result?.threadId as string);
    if (!threadId) throw new Error(`thread/start did not return a threadId: ${JSON.stringify(result)}`);
    debugLog(`[Codex AppServer] Thread started: ${threadId}`);
    return threadId;
  }

  async resumeThread(threadId: string): Promise<void> {
    await this.ensureRunning();
    await this.sendRequest('thread/resume', { threadId });
    debugLog(`[Codex AppServer] Thread resumed: ${threadId}`);
  }

  async interruptTurn(threadId: string): Promise<void> {
    try {
      await this.sendRequest('turn/interrupt', { threadId });
    } catch (error) {
      debugLog(`[Codex AppServer] WARN: turn/interrupt failed: ${error}`);
    }
  }

  // ── Core: run a turn and yield ClaudeMessage ──

  async *runTurn(
    threadId: string,
    input: AppServerInputBlock[],
    onPermission: PermissionCallback,
    options?: { model?: string; systemPrompt?: string },
  ): AsyncGenerator<ClaudeMessage, void, void> {
    this.lastActivity = Date.now();
    this.activeTurns += 1;
    this.permissionCallback = onPermission;

    // Yield init message
    yield {
      type: 'init',
      sessionId: threadId,
      systemInfo: {
        cwd: '',
        apiKeySource: 'codex-app-server',
        model: options?.model || '',
        mcpServers: [],
        tools: [],
      } as SystemInfo,
    };

    // Start the turn
    const turnParams: Record<string, unknown> = {
      threadId,
      input,
    };
    if (options?.model) {
      turnParams.model = options.model;
    }

    // Use a promise-based event queue to bridge notifications → async generator
    type QueueItem = { type: 'msg'; msg: ClaudeMessage } | { type: 'done' } | { type: 'error'; error: Error };
    const queue: QueueItem[] = [];
    let resolve: (() => void) | null = null;

    const enqueue = (item: QueueItem) => {
      queue.push(item);
      if (resolve) {
        resolve();
        resolve = null;
      }
    };

    const waitForItem = (): Promise<void> => {
      if (queue.length > 0) return Promise.resolve();
      return new Promise<void>((r) => { resolve = r; });
    };

    // Listen for notifications
    const onNotification = (method: string, params: Record<string, unknown>) => {
      const msgs = this.mapNotification(method, params);
      for (const msg of msgs) {
        enqueue({ type: 'msg', msg });
      }

      if (method === 'turn/completed') {
        // Extract usage from turn/completed params
        const usage = params.usage as { input_tokens?: number; output_tokens?: number } | undefined;
        enqueue({
          type: 'msg',
          msg: {
            type: 'result',
            isComplete: true,
            usage: usage ? {
              inputTokens: usage.input_tokens || 0,
              outputTokens: usage.output_tokens || 0,
            } : undefined,
          },
        });
        enqueue({ type: 'done' });
      } else if (method === 'turn/failed') {
        enqueue({ type: 'msg', msg: { type: 'error', error: `Turn failed` } });
        enqueue({ type: 'done' });
      }
    };

    const onExit = () => {
      enqueue({ type: 'error', error: new Error('Codex app-server process exited') });
    };

    this.emitter.on('notification', onNotification);
    this.emitter.on('exit', onExit);

    try {
      // Fire turn/start (don't await — responses come as notifications)
      debugLog(`[Codex AppServer] Sending turn/start for thread: ${threadId}`);
      this.sendRequest('turn/start', turnParams).catch((err) => {
        enqueue({ type: 'error', error: err instanceof Error ? err : new Error(String(err)) });
      });

      // Yield messages from the queue
      while (true) {
        await waitForItem();
        while (queue.length > 0) {
          const item = queue.shift()!;
          if (item.type === 'done') return;
          if (item.type === 'error') throw item.error;
          yield item.msg;
        }
      }
    } finally {
      this.lastActivity = Date.now();
      this.activeTurns = Math.max(0, this.activeTurns - 1);
      this.emitter.off('notification', onNotification);
      this.emitter.off('exit', onExit);
      this.permissionCallback = null;
    }
  }

  // ── Notification → ClaudeMessage mapping ──

  private mapNotification(method: string, params: Record<string, unknown>): ClaudeMessage[] {
    switch (method) {
      case 'item/agentMessage/delta': {
        const delta = params.delta as string;
        if (delta) {
          return [{ type: 'assistant', content: delta }];
        }
        return [];
      }

      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta': {
        const delta = (params.delta || params.text || '') as string;
        if (delta) {
          return [{ type: 'assistant', content: `<think>${delta}</think>` }];
        }
        return [];
      }

      case 'item/started': {
        const item = params.item as AppServerItem;
        if (!item) return [];
        return this.mapItemStarted(item);
      }

      case 'item/completed': {
        const item = params.item as AppServerItem;
        if (!item) return [];
        return this.mapItemCompleted(item);
      }

      case 'item/commandExecution/outputDelta': {
        const delta = params.delta as string;
        if (delta) {
          return [{ type: 'tool_activity', content: delta }];
        }
        return [];
      }

      default:
        return [];
    }
  }

  private mapItemStarted(item: AppServerItem): ClaudeMessage[] {
    switch (item.type) {
      case 'commandExecution':
        return [{
          type: 'tool_use',
          toolUseId: item.id,
          toolName: 'Bash',
          toolInput: { command: item.command || item.action || '' },
        }];

      case 'fileChange':
        return [{
          type: 'tool_use',
          toolUseId: item.id,
          toolName: 'Edit',
          toolInput: { changes: '' },
        }];

      case 'mcpToolCall':
        return [{
          type: 'tool_use',
          toolUseId: item.id,
          toolName: item.namespace ? `mcp:${item.namespace}:${item.name}` : item.name || 'Unknown',
          toolInput: item.arguments ? JSON.parse(item.arguments) : {},
        }];

      case 'webSearch':
        return [{
          type: 'tool_use',
          toolUseId: item.id,
          toolName: 'WebSearch',
          toolInput: { query: item.query || item.queries?.[0] || '' },
        }];

      default:
        return [];
    }
  }

  private mapItemCompleted(item: AppServerItem): ClaudeMessage[] {
    switch (item.type) {
      case 'commandExecution':
        return [{
          type: 'tool_result',
          toolUseId: item.id,
          toolName: 'Bash',
          toolResult: item.output || '',
          isToolError: item.status === 'failed',
        }];

      case 'fileChange':
        return [{
          type: 'tool_result',
          toolUseId: item.id,
          toolName: 'Edit',
          toolResult: item.status === 'completed' ? 'Applied' : 'Failed',
          isToolError: item.status === 'failed',
        }];

      case 'mcpToolCall': {
        const resultText = item.output
          ? (typeof item.output === 'string' ? item.output : JSON.stringify(item.output))
          : '';
        return [{
          type: 'tool_result',
          toolUseId: item.id,
          toolName: item.namespace ? `mcp:${item.namespace}:${item.name}` : item.name || 'Unknown',
          toolResult: resultText,
          isToolError: item.status === 'failed',
        }];
      }

      case 'webSearch':
        return [{
          type: 'tool_result',
          toolUseId: item.id,
          toolName: 'WebSearch',
          toolResult: 'Search completed',
        }];

      default:
        return [];
    }
  }
}

// ── Client cache ─────────────────────────────────────────────

const appServerClients = new Map<string, CodexAppServerClient>();

function buildEnv(options: CodexAppServerOptions): Record<string, string> {
  const mergedEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) mergedEnv[key] = value;
  }
  sanitizeInheritedProviderEnv(mergedEnv);
  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      mergedEnv[key] = value;
    }
  }
  // Per-session process: inject session ID into env so MCP bridge
  // child processes inherit it automatically
  if (options.claudiaSessionId) {
    mergedEnv.CLAUDIA_SESSION_ID = options.claudiaSessionId;
  }
  return mergedEnv;
}

export function getCacheKey(options: CodexAppServerOptions, env: Record<string, string>, configSignature = ''): string {
  // env already contains CLAUDIA_SESSION_ID (injected by buildEnv),
  // so envSignature naturally differentiates per-session processes
  const envSignature = JSON.stringify(
    Object.keys(env).sort().map((key) => [key, env[key]])
  );
  return `${options.cliPath || '__default__'}::${configSignature}::${envSignature}`;
}

export function getOrCreateAppServerClient(options: CodexAppServerOptions): CodexAppServerClient {
  const env = buildEnv(options);
  const modeArgs = mapModeToConfigArgs(options.mode);
  const modelArgs = options.model ? ['-c', `model="${options.model}"`] : [];
  const extraArgs = [...modeArgs, ...modelArgs];
  const { configDir, configSignature } = writeMcpConfig(options);
  const key = getCacheKey(options, env, configSignature);
  let client = appServerClients.get(key);
  if (!client) {
    client = new CodexAppServerClient(options.cliPath, env, extraArgs, { processCwd: configDir });
    appServerClients.set(key, client);
  }
  return client;
}

// ── Main run function ────────────────────────────────────────

export async function* runCodexAppServer(
  input: string,
  options: CodexAppServerOptions,
  onPermission: PermissionCallback,
): AsyncGenerator<ClaudeMessage, void, void> {
  const client = getOrCreateAppServerClient(options);

  // Start or resume thread
  let threadId: string;
  debugLog(`[Codex AppServer] runCodexAppServer: sessionId=${options.sessionId || 'NEW'}, cwd=${options.cwd}`);
  if (options.sessionId) {
    try {
      debugLog(`[Codex AppServer] Resuming thread: ${options.sessionId}`);
      await client.resumeThread(options.sessionId);
      threadId = options.sessionId;
    } catch (err) {
      debugLog(`[Codex AppServer] WARN: Resume failed, starting fresh: ${err}`);
      threadId = await client.startThread(options.cwd);
    }
  } else {
    threadId = await client.startThread(options.cwd);
  }
  debugLog(`[Codex AppServer] Using threadId: ${threadId}`);

  // Prepare input
  let inputBlocks = prepareAppServerInput(input);

  // Prepend system prompt for new sessions
  if (options.systemPrompt && !options.sessionId) {
    const systemContext = `[System Context]\n${options.systemPrompt}`;
    const firstText = inputBlocks.find(b => b.type === 'text');
    if (firstText && firstText.text) {
      firstText.text = `${systemContext}\n\n${firstText.text}`;
    } else {
      inputBlocks = [{ type: 'text', text: systemContext }, ...inputBlocks];
    }
  }

  yield* client.runTurn(threadId, inputBlocks, onPermission, {
    model: options.model,
    systemPrompt: options.systemPrompt,
  });
}

// ── Abort ────────────────────────────────────────────────────

const activeThreadIds = new Map<string, { client: CodexAppServerClient; threadId: string }>();

export function trackActiveThread(sessionId: string, client: CodexAppServerClient, threadId: string): void {
  activeThreadIds.set(sessionId, { client, threadId });
}

export function untrackActiveThread(sessionId: string): void {
  activeThreadIds.delete(sessionId);
}

export async function abortCodexAppServer(sessionId: string): Promise<void> {
  const entry = activeThreadIds.get(sessionId);
  if (entry) {
    await entry.client.interruptTurn(entry.threadId);
    activeThreadIds.delete(sessionId);
  }
}

// ── Idle cleanup ─────────────────────────────────────────────

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;    // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // scan every 5 minutes

/** Destroy all app-server processes (called on server shutdown) */
export function runIdleCleanup(now = Date.now()): void {
  for (const [key, client] of appServerClients) {
    if (client.activeTurns > 0) continue;
    if (now - client.lastActivity > IDLE_TIMEOUT_MS) {
      debugLog(`[Codex AppServer] Idle cleanup: ${key}`);
      client.destroy();
      appServerClients.delete(key);
    }
  }
}

const cleanupTimer = setInterval(() => {
  runIdleCleanup();
}, CLEANUP_INTERVAL_MS);
cleanupTimer.unref(); // don't prevent Node.js from exiting

export function destroyAllAppServerClients(): void {
  for (const [key, client] of appServerClients) {
    debugLog(`[Codex AppServer] Shutdown cleanup: ${key}`);
    client.destroy();
  }
  appServerClients.clear();
  clearInterval(cleanupTimer);
}

export function resetAppServerClientsForTests(): void {
  appServerClients.clear();
}
