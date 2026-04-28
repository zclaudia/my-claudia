import { spawn, type ChildProcess } from 'child_process';
import { createInterface, type Interface as ReadlineInterface } from 'readline';
import { EventEmitter } from 'events';
import { appendFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, readFileSync, realpathSync } from 'fs';
import { join, extname } from 'path';
import type { PermissionRequest } from '@my-claudia/shared/interaction/permissions';

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
import { parseMessageInput, prependNonImageNotes } from './provider-input.js';
import { sanitizeInheritedProviderEnv } from '../../utils/startup-env.js';
import { buildMcpBridgeEntry } from '../../utils/mcp-bridge-launch.js';
import { loadMcpServersFromDb } from '../../utils/mcp-config.js';
import { getGlobalProcessSupervisor } from '../services/process-supervisor.js';

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
//
// NOTE: `sandbox_permissions` via `-c` has no effect in app-server mode
// (sandbox is always workspaceWrite). Instead, we control behavior through
// `approval_policy`:
//   - "never"      → auto-approve all operations within sandbox (bypass mode)
//   - "on-request" → send approval requests to the client (default/supervised)
//
// For plan mode, we keep "on-request" and our handleServerRequest always
// declines approvals, effectively making it read-only.

function mapModeToConfigArgs(mode?: string): string[] {
  const args: string[] = [];
  switch (mode) {
    case 'plan':
      // Keep on-request; our approval handler will decline all writes
      args.push('-c', 'approval_policy="on-request"');
      break;
    case 'bypassPermissions':
      // Skip all approval prompts — auto-approve everything
      args.push('-c', 'approval_policy="never"');
      break;
    case 'acceptEdits':
    case 'default':
    default:
      // Standard mode: approval requests forwarded to user
      args.push('-c', 'approval_policy="on-request"');
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
  const parsed = parseMessageInput(rawInput);
  if (!parsed) return [{ type: 'text', text: rawInput }];

  let text = prependNonImageNotes(parsed.text, parsed.attachments);
  const blocks: AppServerInputBlock[] = [];

  for (const attachment of parsed.attachments) {
    if (attachment.type === 'image') {
      const filePath = fileStore.getFilePath(attachment.fileId);
      if (filePath) {
        try {
          const base64Data = readFileSync(filePath, { encoding: 'base64' });
          const ext = extname(filePath).toLowerCase().replace('.', '');
          const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
            : ext === 'png' ? 'image/png'
            : ext === 'gif' ? 'image/gif'
            : ext === 'webp' ? 'image/webp'
            : 'image/png';
          blocks.push({ type: 'image', url: `data:${mimeType};base64,${base64Data}` });
          debugLog(`[Codex AppServer] Attached image: ${attachment.name} → base64 (${base64Data.length} chars)`);
        } catch (err) {
          debugLog(`[Codex AppServer] WARN: Could not read image ${filePath}: ${err}`);
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
  /** Current mode — used to auto-accept file changes in acceptEdits mode */
  currentMode: string | undefined;

  private processCwd: string | undefined;
  private ownerSessionId: string | undefined;

  /** Last activity timestamp for idle cleanup */
  lastActivity: number = Date.now();

  /** Number of in-flight turns; active clients must not be reaped */
  activeTurns = 0;

  constructor(cliPath: string | undefined, env: Record<string, string>, extraArgs: string[] = [], options?: { processCwd?: string; ownerSessionId?: string }) {
    this.cliPath = cliPath || 'codex';
    this.env = env;
    this.extraArgs = extraArgs;
    this.processCwd = options?.processCwd;
    this.ownerSessionId = options?.ownerSessionId;
  }

  // ── Process lifecycle ──

  async ensureRunning(): Promise<void> {
    if (this.process && !this.process.killed) return;

    const args = ['app-server', '--listen', 'stdio://', ...this.extraArgs];
    debugLog(`[Codex AppServer] Spawning: ${this.cliPath} ${args.join(' ')}`);

    this.process = spawn(this.cliPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.env,
      cwd: this.processCwd,
    });
    getGlobalProcessSupervisor()?.observeChildProcess({
      source: 'provider_run',
      command: this.cliPath,
      args,
      cwd: this.processCwd,
      owner: {
        sessionId: this.ownerSessionId,
      },
      tags: ['provider:codex', 'app-server'],
    }, this.process);

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

  /**
   * Update extraArgs (e.g., sandbox mode changed).
   * If args differ, kill the running process so ensureRunning() respawns with new args.
   */
  updateExtraArgs(newArgs: string[]): void {
    const oldStr = JSON.stringify(this.extraArgs);
    const newStr = JSON.stringify(newArgs);
    if (oldStr !== newStr) {
      debugLog(`[Codex AppServer] ExtraArgs changed, restarting process: ${oldStr} → ${newStr}`);
      this.extraArgs = newArgs;
      this.destroy();
    }
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
      ).catch((err) => {
        console.error(`[Codex AppServer] Unhandled error in server request handler (${msg.method}):`, err);
        // Respond with error to unblock the Codex process
        this.sendResponse(msg.id as number, { error: { code: -1, message: String(err) } });
      });
    } else if (hasMethod) {
      // Notification
      this.emitter.emit('notification', msg.method, msg.params || {});
    }
  }

  private async handleServerRequest(id: number, method: string, params?: Record<string, unknown>): Promise<void> {
    debugLog(`[Codex AppServer] Server request: ${method}`);
    this.lastActivity = Date.now();

    // ── Approval requests ──
    // Codex app-server protocol methods:
    //   item/commandExecution/requestApproval → { decision: "accept"|"decline"|... }
    //   item/fileChange/requestApproval       → { decision: "accept"|"decline"|... }
    //   item/permissions/requestApproval      → { permissions: {...}, scope: "session"|"turn" }
    if (method.includes('requestApproval') || method.includes('Approval') || method.includes('approval')) {
      debugLog(`[Codex AppServer] Approval request: method=${method} params=${JSON.stringify(params).slice(0, 500)}`);

      // Handle permissions requests separately (different response schema)
      if (method === 'item/permissions/requestApproval') {
        await this.handlePermissionsApproval(id, params);
        return;
      }

      // In acceptEdits mode: auto-accept file changes, only prompt for commands
      if (this.currentMode === 'acceptEdits' && method === 'item/fileChange/requestApproval') {
        debugLog(`[Codex AppServer] Auto-accepting file change in acceptEdits mode`);
        this.sendResponse(id, { decision: 'accept' });
        return;
      }

      // In plan mode: decline all write operations
      if (this.currentMode === 'plan') {
        debugLog(`[Codex AppServer] Declining in plan mode: ${method}`);
        this.sendResponse(id, { decision: 'decline' });
        return;
      }

      // Command execution / file change approvals — forward to user
      if (this.permissionCallback) {
        try {
          const permissionRequest = this.mapApprovalToPermissionRequest(method, params);
          const decision = await this.permissionCallback(permissionRequest);
          const approved = decision.behavior === 'allow';
          debugLog(`[Codex AppServer] Approval decision: ${approved} (behavior=${decision.behavior})`);
          // Codex expects { decision: "accept" | "decline" }, NOT { approved: bool }
          this.sendResponse(id, { decision: approved ? 'accept' : 'decline' });
        } catch (error) {
          debugLog(`[Codex AppServer] ERROR: Permission callback error: ${error}`);
          this.sendResponse(id, { decision: 'decline' });
        }
      } else {
        debugLog(`[Codex AppServer] WARN: No permission callback, declining: ${method}`);
        this.sendResponse(id, { decision: 'decline' });
      }
      return;
    }

    // ── Dynamic tool call (item/tool/call) ──
    // Codex delegates a tool invocation to the client.
    // Response: { success: bool, contentItems: [{ type: "inputText", text: "..." }] }
    if (method === 'item/tool/call') {
      debugLog(`[Codex AppServer] Dynamic tool call: tool=${params?.tool} callId=${params?.callId}`);
      this.sendResponse(id, {
        success: false,
        contentItems: [{ type: 'inputText', text: 'Dynamic tool calls are not supported by this client.' }],
      });
      return;
    }

    // ── User input request (item/tool/requestUserInput) ──
    // Codex asks the user to fill out a form/answer questions.
    // Response: { answers: { [questionId]: { answers: string[] } } }
    if (method === 'item/tool/requestUserInput') {
      debugLog(`[Codex AppServer] User input request: ${JSON.stringify(params).slice(0, 300)}`);
      // Return empty answers so Codex can continue instead of hanging
      this.sendResponse(id, { answers: {} });
      return;
    }

    // ── MCP server elicitation (mcpServer/elicitation/request) ──
    // An MCP server is requesting user input (form or URL).
    // Response: { action: "accept"|"decline"|"cancel", content?: ... }
    if (method === 'mcpServer/elicitation/request') {
      debugLog(`[Codex AppServer] MCP elicitation: server=${params?.serverName} mode=${params?.mode}`);
      this.sendResponse(id, { action: 'decline' });
      return;
    }

    // Unknown server request — log and respond with empty result to avoid hanging
    debugLog(`[Codex AppServer] WARN: Unhandled server request: ${method}`);
    this.sendResponse(id, {});
  }

  /**
   * Handle item/permissions/requestApproval — Codex asks for additional sandbox permissions
   * (e.g., write to a path outside workspace, enable network access).
   * Response schema: { permissions: { fileSystem?: { write: [...] }, network?: { enabled: bool } }, scope: "session"|"turn" }
   */
  private async handlePermissionsApproval(id: number, params?: Record<string, unknown>): Promise<void> {
    const requestedPermissions = params?.permissions as {
      fileSystem?: { read?: string[] | null; write?: string[] | null };
      network?: { enabled?: boolean | null };
    } | undefined;

    if (this.permissionCallback) {
      try {
        const detail = requestedPermissions
          ? JSON.stringify(requestedPermissions)
          : params?.reason as string || 'Additional permissions requested';
        const permissionRequest: PermissionRequest = {
          toolName: 'Permissions',
          toolInput: requestedPermissions || {},
          detail,
          requestId: `codex-${Date.now()}`,
          timeoutSeconds: 0,
        };
        const decision = await this.permissionCallback(permissionRequest);
        const approved = decision.behavior === 'allow';
        debugLog(`[Codex AppServer] Permissions approval: ${approved}`);

        if (approved && requestedPermissions) {
          // Grant exactly what was requested
          this.sendResponse(id, {
            permissions: {
              fileSystem: requestedPermissions.fileSystem || undefined,
              network: requestedPermissions.network || undefined,
            },
            scope: 'session',
          });
        } else {
          // Deny: grant empty permissions
          this.sendResponse(id, {
            permissions: {},
            scope: 'turn',
          });
        }
      } catch (error) {
        debugLog(`[Codex AppServer] ERROR: Permissions callback error: ${error}`);
        this.sendResponse(id, { permissions: {}, scope: 'turn' });
      }
    } else {
      debugLog(`[Codex AppServer] WARN: No permission callback, denying permissions`);
      this.sendResponse(id, { permissions: {}, scope: 'turn' });
    }
  }

  private mapApprovalToPermissionRequest(method: string, params?: Record<string, unknown>): PermissionRequest {
    const command = params?.command as string || '';
    let toolName = 'Unknown';
    let toolInput: Record<string, unknown> = {};
    let detail = '';

    if (method === 'item/commandExecution/requestApproval') {
      toolName = 'Bash';
      toolInput = { command };
      detail = command || JSON.stringify(params?.commandActions || []).slice(0, 300);
    } else if (method === 'item/fileChange/requestApproval') {
      toolName = 'Edit';
      const reason = params?.reason as string || '';
      const grantRoot = params?.grantRoot as string || '';
      toolInput = { grantRoot, reason };
      detail = reason || grantRoot || `File change (item: ${params?.itemId || 'unknown'})`;
    } else {
      // Legacy/fallback matching
      const lowerMethod = method.toLowerCase();
      if (lowerMethod.includes('commandexecution') || lowerMethod.includes('execcommand')) {
        toolName = 'Bash';
        toolInput = { command };
        detail = command;
      } else if (lowerMethod.includes('filechange') || lowerMethod.includes('applypatch')) {
        toolName = 'Edit';
        detail = params?.reason as string || JSON.stringify(params || {}).slice(0, 200);
      } else {
        detail = command || JSON.stringify(params || {}).slice(0, 200);
      }
    }

    return {
      toolName,
      toolInput,
      detail,
      requestId: `codex-${Date.now()}`,
      timeoutSeconds: 0,
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

  /** Extract error message from Codex notification params */
  private extractErrorMessage(params: Record<string, unknown>, fallback: string): string {
    const turn = params.turn as { error?: { message?: string } } | undefined;
    return turn?.error?.message
      || (params.error as { message?: string } | undefined)?.message
      || (params.message as string | undefined)
      || fallback;
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
        // Check turn.status — Codex may send turn/completed with status="failed"
        const turn = params.turn as { status?: string; error?: { message?: string }; } | undefined;
        const turnStatus = turn?.status || (params as { status?: string }).status;

        if (turnStatus === 'failed') {
          const errorMsg = this.extractErrorMessage(params, 'Turn completed with failed status');
          enqueue({ type: 'msg', msg: { type: 'error', error: `Codex error: ${errorMsg}` } });
          enqueue({ type: 'done' });
        } else {
          // Normal completion
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
        }
      } else if (method === 'turn/failed') {
        const errorMsg = this.extractErrorMessage(params, 'Turn failed');
        enqueue({ type: 'msg', msg: { type: 'error', error: `Codex error: ${errorMsg}` } });
        enqueue({ type: 'done' });
      } else if (method === 'error') {
        const errorMsg = this.extractErrorMessage(params, 'Unknown Codex error');
        enqueue({ type: 'msg', msg: { type: 'error', error: `Codex error: ${errorMsg}` } });
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
      // Keep permissionCallback alive — Codex may send approval requests
      // between turns (e.g., deferred file-change approvals). The callback
      // will be overwritten by the next runTurn call.
    }
  }

  // ── Notification → ClaudeMessage mapping ──

  /** Track whether we are inside a reasoning block to avoid wrapping every delta */
  private inReasoningBlock = false;

  private mapNotification(method: string, params: Record<string, unknown>): ClaudeMessage[] {
    switch (method) {
      case 'item/agentMessage/delta': {
        const delta = params.delta as string;
        if (delta) {
          return [{ type: 'assistant', content: delta }];
        }
        return [];
      }

      // ── Reasoning: open/close <think> once per block, not per delta ──
      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta': {
        const delta = (params.delta || params.text || '') as string;
        if (!delta) return [];
        const msgs: ClaudeMessage[] = [];
        if (!this.inReasoningBlock) {
          msgs.push({ type: 'assistant', content: '<think>' });
          this.inReasoningBlock = true;
        }
        msgs.push({ type: 'assistant', content: delta });
        return msgs;
      }

      case 'item/started': {
        const item = params.item as AppServerItem;
        if (!item) return [];
        // Close reasoning block when a non-reasoning item starts
        if (item.type !== 'reasoning') {
          return [...this.closeReasoningBlock(), ...this.mapItemStarted(item)];
        }
        return [];
      }

      case 'item/completed': {
        const item = params.item as AppServerItem;
        if (!item) return [];
        // Close reasoning block if reasoning item completes
        if (item.type === 'reasoning') {
          return this.closeReasoningBlock();
        }
        return this.mapItemCompleted(item);
      }

      case 'item/commandExecution/outputDelta': {
        const delta = params.delta as string;
        if (delta) {
          return [{ type: 'tool_activity', content: delta }];
        }
        return [];
      }

      // File change incremental diff output
      case 'item/fileChange/outputDelta': {
        const delta = params.delta as string;
        if (delta) {
          return [{ type: 'tool_activity', content: delta }];
        }
        return [];
      }

      // MCP tool call progress
      case 'item/mcpToolCall/progress': {
        const progress = params.progress as string | undefined;
        if (progress) {
          return [{ type: 'tool_activity', content: progress }];
        }
        return [];
      }

      // Plan deltas (plan mode incremental output)
      case 'item/plan/delta': {
        const delta = (params.delta || '') as string;
        if (delta) {
          return [{ type: 'assistant', content: delta }];
        }
        return [];
      }

      default:
        return [];
    }
  }

  private closeReasoningBlock(): ClaudeMessage[] {
    if (this.inReasoningBlock) {
      this.inReasoningBlock = false;
      return [{ type: 'assistant', content: '</think>' }];
    }
    return [];
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

      case 'fileChange': {
        // Extract file changes from the item when available
        const fileChanges = item.fileChanges as Record<string, { type: string; content?: string; unified_diff?: string }> | undefined;
        let changesSummary = '';
        if (fileChanges) {
          changesSummary = Object.entries(fileChanges).map(([path, change]) => {
            if (change.unified_diff) return `${path}:\n${change.unified_diff}`;
            if (change.type === 'add') return `${path}: (new file)`;
            if (change.type === 'delete') return `${path}: (deleted)`;
            return path;
          }).join('\n');
        }
        return [{
          type: 'tool_use',
          toolUseId: item.id,
          toolName: 'Edit',
          toolInput: { changes: changesSummary },
        }];
      }

      case 'mcpToolCall': {
        let toolInput: Record<string, unknown> = {};
        if (item.arguments) {
          try {
            toolInput = typeof item.arguments === 'string'
              ? JSON.parse(item.arguments)
              : item.arguments;
          } catch {
            debugLog(`[Codex AppServer] WARN: Failed to parse mcpToolCall arguments: ${String(item.arguments).slice(0, 200)}`);
            toolInput = { _raw: String(item.arguments) };
          }
        }
        return [{
          type: 'tool_use',
          toolUseId: item.id,
          toolName: item.namespace ? `mcp:${item.namespace}:${item.name}` : item.name || 'Unknown',
          toolInput,
        }];
      }

      case 'webSearch':
        return [{
          type: 'tool_use',
          toolUseId: item.id,
          toolName: 'WebSearch',
          toolInput: { query: item.query || item.queries?.[0] || '' },
        }];

      default:
        debugLog(`[Codex AppServer] Unhandled item/started type: ${item.type} (id=${item.id})`);
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
          toolResult: item.output || item.aggregatedOutput || '',
          isToolError: item.status === 'failed',
        }];

      case 'fileChange': {
        // Include file paths and diff summary in the result
        const fileChanges = item.fileChanges as Record<string, { type: string; unified_diff?: string }> | undefined;
        let resultText = item.status === 'completed' ? 'Applied' : 'Failed';
        if (fileChanges && item.status === 'completed') {
          const paths = Object.keys(fileChanges);
          resultText = `Applied changes to: ${paths.join(', ')}`;
        }
        return [{
          type: 'tool_result',
          toolUseId: item.id,
          toolName: 'Edit',
          toolResult: resultText,
          isToolError: item.status === 'failed',
        }];
      }

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

      case 'webSearch': {
        // Capture actual search output instead of static text
        const output = item.output
          ? (typeof item.output === 'string' ? item.output : JSON.stringify(item.output))
          : 'Search completed';
        return [{
          type: 'tool_result',
          toolUseId: item.id,
          toolName: 'WebSearch',
          toolResult: output,
        }];
      }

      default:
        debugLog(`[Codex AppServer] Unhandled item/completed type: ${item.type} (id=${item.id})`);
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
    client = new CodexAppServerClient(options.cliPath, env, extraArgs, {
      processCwd: configDir,
      ownerSessionId: options.claudiaSessionId ?? options.sessionId,
    });
    appServerClients.set(key, client);
  } else {
    // If sandbox/model args changed (e.g., mode switched from plan to default),
    // kill the old process so it restarts with the correct sandbox permissions.
    client.updateExtraArgs(extraArgs);
  }
  return client;
}

// ── Main run function ────────────────────────────────────────

/** Errors that indicate a corrupted/unrecoverable session (e.g., bad history with invalid image URLs) */
const SESSION_RECOVERY_PATTERNS = [
  /invalid.*image_url/i,
  /invalid.*url/i,
  /systemError/i,
  /session.*corrupt/i,
  /thread.*not.*found/i,
  /invalid.*input/i,
];

function isRecoverableSessionError(error: string): boolean {
  return SESSION_RECOVERY_PATTERNS.some(p => p.test(error));
}

export async function* runCodexAppServer(
  input: string,
  options: CodexAppServerOptions,
  onPermission: PermissionCallback,
): AsyncGenerator<ClaudeMessage, void, void> {
  const client = getOrCreateAppServerClient(options);
  client.currentMode = options.mode;

  // Start or resume thread
  let threadId: string;
  let isResumed = false;
  debugLog(`[Codex AppServer] runCodexAppServer: sessionId=${options.sessionId || 'NEW'}, cwd=${options.cwd}`);
  if (options.sessionId) {
    try {
      debugLog(`[Codex AppServer] Resuming thread: ${options.sessionId}`);
      await client.resumeThread(options.sessionId);
      threadId = options.sessionId;
      isResumed = true;
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

  // Run the turn. For resumed sessions, buffer only the initial few messages
  // to detect recoverable session errors (e.g., corrupted history with invalid
  // image URLs). Once the first assistant/tool message arrives without error,
  // flush the buffer and switch to streaming mode.
  let encounteredError: string | null = null;
  const buffered: ClaudeMessage[] = [];
  let streamingMode = !isResumed; // New sessions stream immediately

  for await (const msg of client.runTurn(threadId, inputBlocks, onPermission, {
    model: options.model,
    systemPrompt: options.systemPrompt,
  })) {
    if (msg.type === 'error' && !streamingMode && isRecoverableSessionError(msg.error || '')) {
      encounteredError = msg.error || 'Unknown session error';
      break;
    }

    if (streamingMode) {
      yield msg;
      if (msg.type === 'result' && (msg as { isComplete?: boolean }).isComplete) {
        return;
      }
    } else {
      // Buffering phase: accumulate until we see a non-init, non-error message
      buffered.push(msg);
      const isContentMsg = msg.type === 'assistant' || msg.type === 'tool_use' || msg.type === 'tool_result' || msg.type === 'tool_activity';
      if (isContentMsg || (msg.type === 'result' && (msg as { isComplete?: boolean }).isComplete)) {
        // Session is healthy — flush buffer and switch to streaming
        streamingMode = true;
        for (const m of buffered) yield m;
        buffered.length = 0;
        if (msg.type === 'result' && (msg as { isComplete?: boolean }).isComplete) {
          return;
        }
      }
    }
  }

  // If buffered messages remain (turn ended during buffer phase), flush them
  if (!encounteredError && buffered.length > 0) {
    for (const m of buffered) yield m;
  }

  // If we broke out due to a recoverable error on a resumed session, retry once with a new thread
  if (encounteredError && isResumed) {
    console.warn(`[Codex AppServer] Recovered from broken session ${threadId}: ${encounteredError}. Starting fresh thread.`);
    yield { type: 'assistant', content: `[Session recovery: previous thread failed (${encounteredError}), starting fresh]` } as ClaudeMessage;

    const freshThreadId = await client.startThread(options.cwd);
    debugLog(`[Codex AppServer] Recovery: new threadId=${freshThreadId}`);

    // Re-prepare input (inputBlocks may have been mutated by systemPrompt prepend)
    inputBlocks = prepareAppServerInput(input);

    yield* client.runTurn(freshThreadId, inputBlocks, onPermission, {
      model: options.model,
      systemPrompt: options.systemPrompt,
    });
  }
}

// ── Abort ────────────────────────────────────────────────────

const activeThreadIds = new Map<string, { client: CodexAppServerClient; threadId: string }>();

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
