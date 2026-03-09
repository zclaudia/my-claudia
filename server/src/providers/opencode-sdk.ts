import { spawn, type ChildProcess } from 'child_process';
import { appendFileSync, readFileSync } from 'fs';
import type { PermissionRequest, MessageInput } from '@my-claudia/shared';
import type { ClaudeMessage, SystemInfo, PermissionDecision, PermissionCallback } from './claude-sdk.js';
import { fileStore } from '../storage/fileStore.js';
import { buildNonImageAttachmentNotes } from './attachment-utils.js';

// ── OpenCode prompt part types ─────────────────────────────────
type OCTextPart = { type: 'text'; text: string };
type OCFilePart = { type: 'file'; mime: string; url: string; filename?: string };
type OCPromptPart = OCTextPart | OCFilePart;

/**
 * Parse MessageInput for OpenCode: text stays as TextPartInput,
 * images become FilePartInput with data: URIs (sent inline to the model).
 */
function prepareOpenCodeInput(input: string): { text: string; fileParts: OCFilePart[] } {
  let messageInput: MessageInput;
  try {
    messageInput = JSON.parse(input);
    if (typeof messageInput !== 'object' || !('text' in messageInput)) {
      return { text: input, fileParts: [] };
    }
  } catch {
    return { text: input, fileParts: [] };
  }

  let text = messageInput.text || input;
  if (!messageInput.attachments || messageInput.attachments.length === 0) {
    return { text, fileParts: [] };
  }
  const nonImageNotes = buildNonImageAttachmentNotes(messageInput.attachments);
  if (nonImageNotes.length > 0) {
    text = `${nonImageNotes.join('\n\n')}\n\n${text}`;
  }

  const fileParts: OCFilePart[] = [];
  for (const attachment of messageInput.attachments) {
    if (attachment.type === 'image') {
      const filePath = fileStore.getFilePath(attachment.fileId);
      if (filePath) {
        const data = readFileSync(filePath);
        const base64 = data.toString('base64');
        const dataUri = `data:${attachment.mimeType};base64,${base64}`;
        fileParts.push({
          type: 'file',
          mime: attachment.mimeType,
          url: dataUri,
          filename: attachment.name,
        });
        console.log(`[OpenCode] Prepared inline image ${attachment.name} (${data.length} bytes)`);
      } else {
        console.warn(`[OpenCode] Could not locate image ${attachment.fileId}, skipping`);
      }
    }
  }

  return { text, fileParts };
}

// Temporary debug logger to trace SSE issues
const OC_LOG_PATH = process.env.MY_CLAUDIA_DATA_DIR
  ? `${process.env.MY_CLAUDIA_DATA_DIR}/opencode-debug.log`
  : '/tmp/opencode-debug.log';
// Always also write to /tmp for easy access from dev tools
const OC_LOG_TMP = '/tmp/opencode-debug.log';
function ocLog(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { appendFileSync(OC_LOG_PATH, line); } catch (e) { /* silently fail */ }
  if (OC_LOG_TMP !== OC_LOG_PATH) {
    try { appendFileSync(OC_LOG_TMP, line); } catch (e) { /* silently fail */ }
  }
  console.log(`[OpenCode] ${msg}`);
}
// Write a startup marker so we know the module was loaded
ocLog('=== opencode-sdk.ts module loaded ===');
import {
  createOpencodeClient,
  type OpencodeClient,
  type Event as OpenCodeEvent,
  type Part as OpenCodePart,
  type ToolPart,
  type Agent as OpenCodeAgent,
  type Permission as OpenCodePermission,
  type SessionStatus,
} from '@opencode-ai/sdk';

export { type ClaudeMessage, type PermissionDecision, type PermissionCallback };

export interface OpenCodeRunOptions {
  cwd: string;
  sessionId?: string;   // OpenCode session ID for resume
  env?: Record<string, string>;
  cliPath?: string;     // Custom path to opencode binary
  model?: string;       // Model override (e.g. 'anthropic/claude-sonnet-4-5-20250929')
  agent?: string;       // Agent/mode to use (e.g. 'sisyphus', 'plan')
  systemPrompt?: string; // Prepended as system context to first message in new sessions
}

// ============================================
// Session-to-server tracking
// Maps sdk_session_id → server baseUrl as a cache so we can skip session.get()
// validation when the session was created on the same server instance.
// After app restart this map is empty; we then validate via session.get()
// before reusing old sessions (OpenCode persists sessions across server restarts).
// ============================================
const sessionServerMap = new Map<string, string>();

// ============================================
// OpenCode Server Manager
// Manages persistent `opencode serve` processes
// ============================================

interface OpenCodeServer {
  process: ChildProcess;
  port: number;
  baseUrl: string;
  cwd: string;
  ready: boolean;
  client: OpencodeClient;
}

class OpenCodeServerManager {
  private servers = new Map<string, OpenCodeServer>();
  private starting = new Map<string, Promise<OpenCodeServer>>();

  /**
   * Ensure an opencode server is running for the given cwd.
   * Reuses existing server if one is already running.
   */
  async ensureServer(cwd: string, options: { cliPath?: string; env?: Record<string, string> }): Promise<OpenCodeServer> {
    // Return existing server if running
    const existing = this.servers.get(cwd);
    if (existing && existing.ready) {
      // Verify it's still alive (no SDK health endpoint, use manual fetch)
      try {
        const response = await fetch(`${existing.baseUrl}/global/health`);
        if (response.ok) return existing;
      } catch {
        // Server died, clean up and restart
        this.servers.delete(cwd);
      }
    }

    // If already starting, wait for it
    const startingPromise = this.starting.get(cwd);
    if (startingPromise) return startingPromise;

    // Start new server
    const promise = this.startServer(cwd, options);
    this.starting.set(cwd, promise);
    try {
      const server = await promise;
      return server;
    } finally {
      this.starting.delete(cwd);
    }
  }

  private async startServer(cwd: string, options: { cliPath?: string; env?: Record<string, string> }): Promise<OpenCodeServer> {
    const cliPath = options.cliPath || 'opencode';
    // Pick a random port in ephemeral range
    const port = 10000 + Math.floor(Math.random() * 50000);
    const baseUrl = `http://127.0.0.1:${port}`;

    console.log(`[OpenCode] Starting server on port ${port} for ${cwd}`);

    const childEnv = { ...process.env, ...(options.env || {}) };

    const child = spawn(cliPath, ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
      cwd,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Log stderr for debugging
    child.stderr?.on('data', (chunk: Buffer) => {
      console.log(`[OpenCode:${port}] stderr:`, chunk.toString().trim());
    });

    // Wait for server to be ready (poll health endpoint)
    await this.waitForReady(baseUrl, 30000);

    // Create SDK client for this server
    const client = createOpencodeClient({
      baseUrl,
      directory: cwd,
    });

    const server: OpenCodeServer = {
      process: child,
      port,
      baseUrl,
      cwd,
      ready: true,
      client,
    };

    child.on('exit', (code) => {
      console.log(`[OpenCode:${port}] Process exited with code ${code}`);
      server.ready = false;
      this.servers.delete(cwd);
    });

    child.on('error', (err) => {
      console.error(`[OpenCode:${port}] Process error:`, err.message);
      server.ready = false;
      this.servers.delete(cwd);
    });

    this.servers.set(cwd, server);
    console.log(`[OpenCode] Server ready on ${baseUrl}`);
    return server;
  }

  private async waitForReady(baseUrl: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const response = await fetch(`${baseUrl}/global/health`);
        if (response.ok) return;
      } catch {
        // Not ready yet
      }
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`OpenCode server failed to start within ${timeoutMs}ms`);
  }

  async stopServer(cwd: string): Promise<void> {
    const server = this.servers.get(cwd);
    if (server) {
      console.log(`[OpenCode] Stopping server on port ${server.port}`);
      server.process.kill('SIGTERM');
      server.ready = false;
      this.servers.delete(cwd);
    }
  }

  async stopAll(): Promise<void> {
    for (const [cwd] of this.servers) {
      await this.stopServer(cwd);
    }
  }

  getServer(cwd: string): OpenCodeServer | undefined {
    return this.servers.get(cwd);
  }
}

// Singleton instance
export const openCodeServerManager = new OpenCodeServerManager();

// ============================================
// Think-tag streaming filter
// ============================================

/**
 * Filters out `<think>...</think>` blocks from streaming text.
 * Models like GLM use these for chain-of-thought reasoning that
 * shouldn't be shown to the user.
 *
 * Call `push(delta)` for each text chunk; it returns the text to emit
 * (may be empty if inside a think block or buffering a potential tag).
 * Call `flush()` at the end to emit any remaining buffered text.
 */
class ThinkTagFilter {
  private inside = false;   // true while inside <think>...</think>
  private buf = '';          // partial-tag buffer
  private trimNext = false;  // trim leading whitespace after </think>

  push(delta: string): string {
    let out = '';
    for (const ch of delta) {
      if (this.inside) {
        this.buf += ch;
        if (this.buf.endsWith('</think>')) {
          this.inside = false;
          this.trimNext = true;
          this.buf = '';
        }
      } else if (this.trimNext && (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t')) {
        // Skip leading whitespace after </think>
        continue;
      } else if (this.buf.length > 0 || ch === '<') {
        this.trimNext = false;
        // Buffering a potential opening tag
        this.buf += ch;
        if (this.buf === '<think>') {
          this.inside = true;
          this.buf = '';
        } else if (!'<think>'.startsWith(this.buf)) {
          // Not a <think> prefix — flush buffer as normal text
          out += this.buf;
          this.buf = '';
        }
      } else {
        this.trimNext = false;
        out += ch;
      }
    }
    return out;
  }

  flush(): string {
    const rest = this.buf;
    this.buf = '';
    this.inside = false;
    return rest;
  }
}

// ============================================
// Raw SSE stream reader (bypasses SDK SSE parser)
// ============================================

/**
 * Connect to the OpenCode SSE event stream using Node.js http module.
 * We bypass both the SDK's SSE client and `fetch` because the Web Streams
 * API used by `fetch` can buffer/stall SSE chunks in the sidecar Node.js
 * environment. The raw `http.get` gives us immediate `data` events.
 */
async function* rawSseStream(baseUrl: string, directory: string, signal?: AbortSignal): AsyncGenerator<any> {
  const url = new URL('/event', baseUrl);
  const httpModule = url.protocol === 'https:' ? await import('https') : await import('http');

  // Use a push-based queue so http 'data' events are never lost
  const queue: any[] = [];
  let resolve: (() => void) | null = null;
  let done = false;
  let error: Error | null = null;

  const push = (item: any) => {
    queue.push(item);
    if (resolve) { resolve(); resolve = null; }
  };

  const waitForData = () => new Promise<void>(r => {
    if (queue.length > 0 || done) { r(); return; }
    resolve = r;
  });

  // Include x-opencode-directory header (same as SDK sends on all requests)
  const headers: Record<string, string> = {
    'Accept': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'x-opencode-directory': encodeURIComponent(directory),
  };
  ocLog(`SSE headers: ${JSON.stringify(headers)}`);

  const req = httpModule.get(url, { headers }, (res) => {
    if (res.statusCode !== 200) {
      error = new Error(`SSE connection failed: ${res.statusCode}`);
      done = true;
      if (resolve) { resolve(); resolve = null; }
      return;
    }

    let buffer = '';
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      buffer += chunk;
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        const dataLines: string[] = [];
        for (const line of part.split('\n')) {
          if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
          }
        }
        if (dataLines.length) {
          try {
            const parsed = JSON.parse(dataLines.join('\n'));
            ocLog(`RAW SSE: keys=${Object.keys(parsed).join(',')} type=${parsed.type || 'NONE'} hasPayload=${!!parsed.payload}`);
            // Log error details for session.error events
            if (parsed.type === 'session.error') {
              ocLog(`SESSION ERROR: ${JSON.stringify(parsed.properties || parsed).slice(0, 500)}`);
            }
            push(parsed);
          } catch {
            // skip unparsable
          }
        }
      }
    });

    res.on('end', () => {
      done = true;
      if (resolve) { resolve(); resolve = null; }
    });

    res.on('error', (e: Error) => {
      error = e;
      done = true;
      if (resolve) { resolve(); resolve = null; }
    });
  });

  req.on('error', (e: Error) => {
    error = e;
    done = true;
    if (resolve) { resolve(); resolve = null; }
  });

  if (signal) {
    signal.addEventListener('abort', () => {
      req.destroy();
      done = true;
      if (resolve) { resolve(); resolve = null; }
    });
  }

  try {
    while (true) {
      await waitForData();
      if (error) throw error;
      while (queue.length > 0) {
        yield queue.shift();
      }
      if (done) break;
    }
  } finally {
    req.destroy();
  }
}

// ============================================
// Streaming state for part-boundary tracking
// ============================================

interface StreamState {
  /** Last field type seen ('text' | 'reasoning' | null) */
  lastField: string | null;
  /** Last partIndex seen for text deltas (for detecting part boundaries) */
  lastTextPartId: string;
  /** Whether this run has emitted any visible assistant output */
  hasAnyAssistantOutput: boolean;
}

function createStreamState(): StreamState {
  return { lastField: null, lastTextPartId: '', hasAnyAssistantOutput: false };
}

/**
 * Some OpenCode agent flows only expose final assistant text via session.messages(),
 * not via message.part.* delta events. If nothing has been streamed yet, fetch once
 * at end-of-turn and emit the latest assistant text as a fallback.
 */
async function* emitAssistantFallbackFromSession(
  server: OpenCodeServer,
  sessionId: string,
  streamState: StreamState,
): AsyncGenerator<ClaudeMessage> {
  if (streamState.hasAnyAssistantOutput) return;

  try {
    const res = await server.client.session.messages({ path: { id: sessionId } });
    const messages = Array.isArray(res.data) ? (res.data as any[]) : [];
    const latestAssistant = [...messages].reverse().find((m) => m?.info?.role === 'assistant');
    if (!latestAssistant) return;

    const parts: any[] = Array.isArray(latestAssistant.parts) ? latestAssistant.parts : [];
    let textOut = '';
    for (const part of parts) {
      if (part?.type === 'reasoning' && typeof part?.text === 'string' && part.text.trim()) {
        textOut += `<think>${part.text}</think>\n\n`;
      } else if (part?.type === 'text' && typeof part?.text === 'string') {
        textOut += part.text;
      }
    }

    const normalized = textOut.trim();
    if (normalized) {
      ocLog(`Fallback emitted assistant text from session.messages() for session ${sessionId} (${normalized.length} chars)`);
      streamState.hasAnyAssistantOutput = true;
      yield { type: 'assistant', content: normalized };
    }
  } catch (err) {
    ocLog(`Fallback session.messages() read failed for ${sessionId}: ${err}`);
  }
}

// ============================================
// Polling fallback for session messages
// ============================================

/**
 * Poll session messages via REST API when SSE fails.
 * Diffs text/reasoning parts to produce streaming deltas.
 * Detects tool use/results and session completion.
 */
async function* pollSessionMessages(
  client: OpencodeClient,
  sessionId: string,
  streamState: StreamState,
  server: OpenCodeServer,
  onPermissionRequest?: PermissionCallback
): AsyncGenerator<ClaudeMessage> {
  const POLL_INTERVAL = 300;       // ms between polls
  const MAX_POLL_TIME = 10 * 60_000; // 10 minutes
  const startTime = Date.now();

  // Track emitted content to produce deltas
  const textContent = new Map<string, string>();   // partId -> last known text
  const emittedToolUse = new Set<string>();         // partIds with emitted tool_use
  const emittedToolResult = new Set<string>();      // partIds with emitted tool_result
  let lastKnownMessageCount = 0;
  let pollCount = 0;

  while (Date.now() - startTime < MAX_POLL_TIME) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
    pollCount++;

    // On first poll, also do a raw fetch to compare with SDK client
    if (pollCount === 1) {
      try {
        const rawUrl = `${server.baseUrl}/session/${sessionId}/message`;
        const rawResp = await fetch(rawUrl, {
          headers: { 'x-opencode-directory': encodeURIComponent(server.cwd) },
        });
        const rawBody = await rawResp.text();
        ocLog(`Poll[1] RAW FETCH: url=${rawUrl} status=${rawResp.status} bodyLen=${rawBody.length} body=${rawBody.slice(0, 300)}`);
      } catch (e) {
        ocLog(`Poll[1] RAW FETCH error: ${e}`);
      }
    }

    let messagesData: any[];
    try {
      const result = await client.session.messages({
        path: { id: sessionId },
      });
      if (pollCount <= 3) {
        ocLog(`Poll[${pollCount}] SDK: error=${JSON.stringify(result.error) || 'none'} dataType=${typeof result.data} isArray=${Array.isArray(result.data)} response.status=${result.response?.status} response.url=${result.response?.url}`);
      }
      if (result.error || !result.data) {
        if (pollCount <= 3) {
          ocLog(`Poll[${pollCount}] no data: ${JSON.stringify(result.error) || 'empty'}`);
        }
        continue;
      }
      messagesData = result.data as any[];
    } catch (err) {
      ocLog(`Poll[${pollCount}] fetch error: ${err}`);
      continue;
    }

    if (pollCount <= 3 || pollCount % 10 === 0) {
      ocLog(`Poll[${pollCount}] ${messagesData.length} messages`);
    }

    // Find assistant messages (there may be multiple in agentic flows)
    let sessionCompleted = false;

    for (const msg of messagesData) {
      if (msg.info?.role !== 'assistant') continue;

      const parts: any[] = msg.parts || [];
      for (const part of parts) {
        const partId = part.id;
        if (!partId) continue;

        if (pollCount <= 3) {
          ocLog(`Poll part: type=${part.type} id=${partId} keys=${Object.keys(part).join(',')}`);
        }

        switch (part.type) {
          case 'text': {
            const content: string = part.text || '';
            const prev = textContent.get(partId) || '';
            if (content.length > prev.length) {
              const delta = content.slice(prev.length);
              // Handle field transitions
              if (streamState.lastField === 'reasoning') {
                yield { type: 'assistant', content: '</think>\n\n' };
              }
              if (streamState.lastTextPartId && partId !== streamState.lastTextPartId) {
                yield { type: 'assistant', content: '\n\n' };
              }
              streamState.lastTextPartId = partId;
              streamState.lastField = 'text';
              streamState.hasAnyAssistantOutput = true;
              yield { type: 'assistant', content: delta };
            }
            textContent.set(partId, content);
            break;
          }

          case 'reasoning': {
            const content: string = part.text || '';
            const prev = textContent.get(partId) || '';
            if (content.length > prev.length) {
              const delta = content.slice(prev.length);
              if (streamState.lastField !== 'reasoning') {
                yield { type: 'assistant', content: '<think>' };
              }
              streamState.lastField = 'reasoning';
              streamState.hasAnyAssistantOutput = true;
              yield { type: 'assistant', content: delta };
            }
            textContent.set(partId, content);
            break;
          }

          case 'tool': {
            const toolId = part.callID || partId;
            const state = part.state;

            // Emit tool_use when first seen
            if (!emittedToolUse.has(partId) && state) {
              yield {
                type: 'tool_use',
                toolUseId: toolId,
                toolName: part.tool || 'unknown',
                toolInput: state.input,
              };
              emittedToolUse.add(partId);
            }

            // Emit tool_result when completed/error
            if (!emittedToolResult.has(partId) && state &&
                (state.status === 'completed' || state.status === 'error')) {
              yield {
                type: 'tool_result',
                toolUseId: toolId,
                toolResult: state.output || state.error || '',
                isToolError: state.status === 'error',
              };
              emittedToolResult.add(partId);
            }
            break;
          }
        }
      }

      // Check if this assistant message is completed
      if (msg.info?.time?.completed || msg.info?.finish) {
        sessionCompleted = true;
      }
    }

    // Also check for pending permissions by fetching session status
    // (permissions show as tool parts in pending state waiting for approval)
    // TODO: Implement permission detection via polling if needed

    if (sessionCompleted) {
      if (!streamState.hasAnyAssistantOutput) {
        yield* emitAssistantFallbackFromSession(server, sessionId, streamState);
      }
      // Close any open think block
      if (streamState.lastField === 'reasoning') {
        yield { type: 'assistant', content: '</think>\n\n' };
        streamState.lastField = null;
      }
      ocLog(`Poll: session completed after ${pollCount} polls (${Date.now() - startTime}ms)`);
      yield { type: 'result', isComplete: true };
      return;
    }
  }

  // Timeout
  ocLog(`Poll: timeout after ${MAX_POLL_TIME}ms`);
  if (streamState.lastField === 'reasoning') {
    yield { type: 'assistant', content: '</think>\n\n' };
  }
  yield { type: 'error', error: 'Session did not complete within 10 minutes' };
}

// ============================================
// Run OpenCode
// ============================================

/**
 * Run OpenCode with the given input and options.
 * Manages the opencode serve process, creates/resumes sessions,
 * sends messages, and streams SSE events as ClaudeMessage objects.
 */
export async function* runOpenCode(
  input: string,
  options: OpenCodeRunOptions,
  onPermissionRequest?: PermissionCallback
): AsyncGenerator<ClaudeMessage, void, void> {
  let server: OpenCodeServer;

  try {
    server = await openCodeServerManager.ensureServer(options.cwd, {
      cliPath: options.cliPath,
      env: options.env,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.includes('ENOENT') || errMsg.includes('not found')) {
      yield {
        type: 'error',
        error: 'opencode CLI not found. Install it with: npm install -g opencode',
      };
    } else {
      yield {
        type: 'error',
        error: `Failed to start opencode server: ${errMsg}`,
      };
    }
    return;
  }

  const { client } = server;
  ocLog(`Server baseUrl=${server.baseUrl} cwd=${server.cwd}`);

  // Create or resume session
  // OpenCode persists sessions in its config directory across server restarts.
  // We try to resume old sessions on new servers (e.g. after app restart).
  // If the session no longer exists, we fall back to creating a new one.
  let sessionId = options.sessionId;
  if (sessionId) {
    const knownServer = sessionServerMap.get(sessionId);
    if (knownServer && knownServer === server.baseUrl) {
      // Session was created on this exact server instance — safe to reuse without validation
      ocLog(`Resuming session ${sessionId} on same server ${server.baseUrl}`);
    } else {
      // Unknown origin (app restarted, map empty) or different server port.
      // Validate the session still exists on the (possibly new) server.
      try {
        const getResult = await client.session.get({ path: { id: sessionId } });
        if (getResult.data && !getResult.error) {
          ocLog(`Session ${sessionId} validated on server ${server.baseUrl} (was: ${knownServer || 'unknown'})`);
          sessionServerMap.set(sessionId, server.baseUrl);
        } else {
          ocLog(`Session ${sessionId} not found (status=${getResult.response?.status}), creating new`);
          sessionId = undefined;
        }
      } catch (err) {
        ocLog(`Session ${sessionId} validation failed: ${err}, creating new`);
        sessionId = undefined;
      }
    }
  }
  if (!sessionId) {
    try {
      const result = await client.session.create({});
      ocLog(`session.create: error=${JSON.stringify(result.error) || 'none'} data.id=${result.data?.id} response.status=${result.response?.status} response.url=${result.response?.url}`);
      if (result.error || !result.data) {
        yield { type: 'error', error: `Failed to create session: ${result.error || 'no data'}` };
        return;
      }
      sessionId = result.data.id;
      sessionServerMap.set(sessionId, server.baseUrl);
      ocLog(`Created new session: ${sessionId} on server ${server.baseUrl}`);
    } catch (error) {
      yield { type: 'error', error: `Failed to create session: ${error}` };
      return;
    }
  }

  // Fetch rich system info from OpenCode serve API
  const systemInfo: SystemInfo = {
    model: options.model,
    cwd: options.cwd,
  };

  try {
    // Fetch version, agents, and provider info in parallel
    const [healthRes, agentsResult, providersResult] = await Promise.all([
      fetch(`${server.baseUrl}/global/health`).catch(() => null),
      client.app.agents({}).catch(() => null),
      client.provider.list({}).catch(() => null),
    ]);

    // Version from health endpoint (no SDK method available)
    if (healthRes?.ok) {
      const health = await healthRes.json() as { version?: string };
      if (health.version) {
        systemInfo.claudeCodeVersion = `OpenCode ${health.version}`;
      }
    }

    // Parse agents
    const agents: OpenCodeAgent[] = (agentsResult?.data as OpenCodeAgent[]) || [];
    if (agents.length > 0) {
      systemInfo.agents = agents.map(a => a.name || 'unknown');
    }

    // Parse provider data
    const providerData = (providersResult?.data as any)?.all || [];

    // Derive model name when no explicit model is set
    if (!options.model) {
      const activeAgent = options.agent
        ? agents.find(a => a.name === options.agent) || agents[0]
        : agents[0];
      const agentModel = activeAgent?.model;
      if (agentModel?.providerID && agentModel?.modelID) {
        const provider = providerData.find((p: any) => p.id === agentModel.providerID);
        const modelInfo = provider?.models?.[agentModel.modelID];
        systemInfo.model = modelInfo?.name || `${agentModel.providerID}/${agentModel.modelID}`;
      }
    }
  } catch (error) {
    console.log('[OpenCode] Failed to fetch system info (non-fatal):', error);
  }

  yield {
    type: 'init',
    sessionId,
    systemInfo,
  };

  // Parse input: extract text and inline images as FilePartInput data URIs
  const { text: promptText, fileParts } = prepareOpenCodeInput(input);

  // Prepend system context to first message in new sessions (OpenCode has no native system prompt API)
  let effectivePrompt = promptText;
  if (options.systemPrompt && !options.sessionId) {
    effectivePrompt = `[System Context]\n${options.systemPrompt}\n\n${promptText}`;
  }

  try {
    // Connect global SSE event stream via SDK
    // IMPORTANT: The SDK's SSE client uses an async generator that only starts
    // the fetch() call on the first .next() invocation. We must prime the stream
    // (trigger the connection) BEFORE sending the prompt, otherwise we miss events
    // if the model responds before the SSE connection is established.
    // Connect SSE event stream directly via raw fetch (bypasses SDK SSE parser
    // which can stall due to TextDecoderStream buffering in Node.js)
    ocLog(`Connecting raw SSE stream to ${server.baseUrl}/event`);
    const sseAbort = new AbortController();
    let sseStream: AsyncGenerator<any>;
    let firstSseResult: IteratorResult<any> | undefined;
    try {
      sseStream = rawSseStream(server.baseUrl, options.cwd, sseAbort.signal);
      // Prime: trigger the fetch by requesting the first value
      // (async generator bodies don't execute until the first .next() call)
      const firstEventPromise = sseStream.next();
      await new Promise(r => setTimeout(r, 100));
      ocLog(`SSE stream connected, awaiting first event...`);
      firstSseResult = await firstEventPromise;
      ocLog(`SSE first event: done=${firstSseResult.done} type=${firstSseResult.value?.type || 'n/a'}`);
    } catch (error) {
      ocLog(`SSE connection failed: ${error}`);
      yield { type: 'error', error: `Failed to connect event stream: ${error}` };
      return;
    }
    ocLog(`SSE stream ready, sending prompt`);

    // Build prompt body with text + inline image parts
    const promptParts: OCPromptPart[] = [{ type: 'text', text: effectivePrompt }];
    if (fileParts.length > 0) {
      promptParts.push(...fileParts);
      ocLog(`Including ${fileParts.length} inline image(s) in prompt`);
    }
    const promptBody: {
      parts: OCPromptPart[];
      model?: { providerID: string; modelID: string };
      agent?: string;
    } = {
      parts: promptParts,
    };

    if (options.model) {
      // OpenCode model format: "providerID/modelID" (e.g. "anthropic/claude-sonnet-4-5-20250929")
      const slashIndex = options.model.indexOf('/');
      if (slashIndex !== -1) {
        promptBody.model = {
          providerID: options.model.slice(0, slashIndex),
          modelID: options.model.slice(slashIndex + 1),
        };
      }
    }

    // Only send agent if it's a specific named agent (e.g. "sisyphus", "plan").
    // OpenCode silently fails when agent="default" — it accepts the prompt (204)
    // but never processes it. Omitting the field uses the default agent correctly.
    if (options.agent && options.agent !== 'default') {
      promptBody.agent = options.agent;
    }

    ocLog(`Sending prompt to session ${sessionId}: ${JSON.stringify(promptBody).slice(0, 200)}`);
    try {
      const sendResult = await client.session.promptAsync({
        path: { id: sessionId },
        body: promptBody,
      });
      ocLog(`promptAsync result: error=${JSON.stringify(sendResult.error) || 'none'} response.status=${sendResult.response?.status} response.url=${sendResult.response?.url}`);
      if (sendResult.error) {
        console.error(`[OpenCode] promptAsync error:`, sendResult.error);
        yield { type: 'error', error: `Failed to send message: ${JSON.stringify(sendResult.error)}` };
        return;
      }
    } catch (error) {
      ocLog(`promptAsync exception: ${error}`);
      yield { type: 'error', error: `Failed to send message: ${error}` };
      return;
    }

    // Process SSE events with polling fallback.
    // SSE has proven unreliable in the Tauri sidecar environment — the connection
    // establishes (server.connected arrives) but subsequent session events often
    // don't. If no session events arrive within SSE_FALLBACK_TIMEOUT, we switch
    // to polling session.messages() for content delivery.
    const SSE_FALLBACK_TIMEOUT = 5000; // 5 seconds
    ocLog(`Processing SSE events for session ${sessionId} (fallback after ${SSE_FALLBACK_TIMEOUT}ms)...`);
    const streamState = createStreamState();
    let receivedSessionEvent = false;
    const sseStartTime = Date.now();

    // Process the first SSE event that was consumed during priming
    // (usually server.connected, but could be a session event if server responds fast)
    if (firstSseResult && !firstSseResult.done && firstSseResult.value) {
      const firstEvent = firstSseResult.value;
      const firstProps = firstEvent.properties || {};
      const firstSid = firstProps.sessionID || firstProps.part?.sessionID;
      if (firstSid === sessionId) {
        receivedSessionEvent = true;
        ocLog(`First SSE event matched session: type=${firstEvent.type}`);
      }
      const firstMessages = mapOpenCodeEvent(firstEvent, sessionId, streamState, server, onPermissionRequest);
      for await (const msg of firstMessages) {
        yield msg;
        if (msg.type === 'result' || msg.type === 'error') {
          sseAbort.abort();
          return;
        }
      }
    }

    try {
      let eventIdx = 0;
      while (true) {
        // Calculate remaining SSE window before fallback
        const elapsed = Date.now() - sseStartTime;
        const remainingMs = receivedSessionEvent
          ? 120_000 // Once SSE is working, use a long timeout per-event
          : Math.max(0, SSE_FALLBACK_TIMEOUT - elapsed);

        if (remainingMs <= 0 && !receivedSessionEvent) {
          ocLog(`SSE fallback triggered: no session events after ${elapsed}ms`);
          break; // Fall through to polling
        }

        // Race next SSE event against timeout
        const nextEvent = sseStream.next();
        const timeout = new Promise<'timeout'>(r => setTimeout(() => r('timeout'), remainingMs));
        const raceResult = await Promise.race([nextEvent, timeout]);

        if (raceResult === 'timeout') {
          if (!receivedSessionEvent) {
            ocLog(`SSE timeout: no session events in ${Date.now() - sseStartTime}ms, switching to polling`);
            break;
          }
          // This shouldn't happen when receivedSessionEvent is true (120s timeout)
          ocLog('SSE: per-event timeout (120s), assuming stream dead');
          break;
        }

        if (raceResult.done) {
          ocLog('SSE stream ended');
          break;
        }

        const event = raceResult.value;
        eventIdx++;
        const _et = (event as any).type as string;
        const _ep = (event as any).properties || {};
        const _eSid = _ep.sessionID || _ep.part?.sessionID;

        if (_eSid === sessionId) {
          receivedSessionEvent = true;
          ocLog(`SSE[${eventIdx}] type=${_et} field=${_ep.field || '-'} delta=${(_ep.delta || '').slice(0, 30)} partType=${_ep.part?.type || '-'}`);
        } else if (_et === 'session.status' || _et === 'session.idle' || _et === 'session.error' || _et === 'session.completed') {
          ocLog(`SSE[${eventIdx}] type=${_et} otherSID=${_eSid || 'none'} (ours=${sessionId})`);
        }

        const messages = mapOpenCodeEvent(event, sessionId, streamState, server, onPermissionRequest);
        for await (const msg of messages) {
          yield msg;
          if (msg.type === 'result' || msg.type === 'error') {
            if (streamState.lastField === 'reasoning') {
              yield { type: 'assistant', content: '</think>\n\n' };
              streamState.lastField = null;
            }
            sseAbort.abort();
            return;
          }
        }
      }
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') {
        ocLog(`SSE stream error: ${error}`);
      }
    }

    // --- Polling fallback ---
    if (!receivedSessionEvent) {
      sseAbort.abort(); // Stop SSE

      ocLog('Switching to polling fallback via session.messages() API');
      yield* pollSessionMessages(
        client, sessionId, streamState, server, onPermissionRequest
      );
      return;
    }

    // SSE ended normally (stream closed after receiving events)
    if (!streamState.hasAnyAssistantOutput) {
      yield* emitAssistantFallbackFromSession(server, sessionId, streamState);
    }
    if (streamState.lastField === 'reasoning') {
      yield { type: 'assistant', content: '</think>\n\n' };
    }
    ocLog('SSE stream finished without explicit result, yielding completion');
    sseAbort.abort();
    yield { type: 'result', isComplete: true };
  } finally {
    // No temp files needed — images are sent inline as data: URIs
  }
}

/**
 * Map an OpenCode SDK Event to ClaudeMessage objects.
 *
 * The SDK provides typed events from the SSE stream.
 * Events are global (not per-session), so we filter by sessionId.
 */
async function* mapOpenCodeEvent(
  event: OpenCodeEvent,
  sessionId: string,
  streamState: StreamState,
  server: OpenCodeServer,
  onPermissionRequest?: PermissionCallback
): AsyncGenerator<ClaudeMessage> {
  const eventType = event.type;
  const props = (event as any).properties || {};

  // Extract session ID from various event shapes to filter
  const eventSessionId =
    props.sessionID ||
    props.part?.sessionID ||
    props.info?.id ||
    props.info?.sessionID;

  // Skip events not for our session (except global events)
  if (eventSessionId && eventSessionId !== sessionId) {
    return;
  }

  switch (eventType) {
    case 'message.part.updated': {
      const part: OpenCodePart | undefined = props.part;
      const delta: string | undefined = props.delta;
      if (!part) break;

      switch (part.type) {
        case 'text': {
          if (delta) {
            // Close any open think block when switching from reasoning to text
            if (streamState.lastField === 'reasoning') {
              yield { type: 'assistant', content: '</think>\n\n' };
            }
            // Insert separator between different text parts
            if (streamState.lastTextPartId && part.id !== streamState.lastTextPartId) {
              yield { type: 'assistant', content: '\n\n' };
            }
            streamState.lastTextPartId = part.id;
            streamState.lastField = 'text';
            streamState.hasAnyAssistantOutput = true;
            yield { type: 'assistant', content: delta };
          }
          break;
        }

        case 'reasoning': {
          if (delta) {
            // Open think block when switching to reasoning
            if (streamState.lastField !== 'reasoning') {
              yield { type: 'assistant', content: '<think>' };
            }
            streamState.lastField = 'reasoning';
            streamState.hasAnyAssistantOutput = true;
            yield { type: 'assistant', content: delta };
          }
          break;
        }

        case 'tool': {
          const toolPart = part as ToolPart;
          const toolName = toolPart.tool || 'unknown';
          const toolUseId = toolPart.callID || toolPart.id;
          const state = toolPart.state;

          if (state.status === 'pending' || state.status === 'running') {
            yield {
              type: 'tool_use',
              toolUseId,
              toolName,
              toolInput: state.input,
            };
          } else if (state.status === 'completed') {
            yield {
              type: 'tool_result',
              toolUseId,
              toolResult: state.output || '',
              isToolError: false,
            };
          } else if (state.status === 'error') {
            yield {
              type: 'tool_result',
              toolUseId,
              toolResult: state.error || 'Tool execution failed',
              isToolError: true,
            };
          }
          break;
        }

        // Reasoning handled via delta above; skip step-start, step-finish, etc.
        default:
          break;
      }
      break;
    }

    case 'session.status': {
      // Log all session.status events to understand OpenCode status transitions
      ocLog(`session.status: sessionID=${props.sessionID} ours=${sessionId} status=${JSON.stringify(props.status || props).slice(0, 200)}`);
      if (props.sessionID !== sessionId) break;
      const status: SessionStatus | undefined = props.status;

      if (status?.type === 'idle') {
        if (!streamState.hasAnyAssistantOutput) {
          yield* emitAssistantFallbackFromSession(server, sessionId, streamState);
        }
        yield {
          type: 'result',
          isComplete: true,
        };
      }
      break;
    }

    case 'session.idle': {
      if (props.sessionID !== sessionId) break;
      if (!streamState.hasAnyAssistantOutput) {
        yield* emitAssistantFallbackFromSession(server, sessionId, streamState);
      }
      yield {
        type: 'result',
        isComplete: true,
      };
      break;
    }

    case 'session.error': {
      if (props.sessionID && props.sessionID !== sessionId) break;
      const error = props.error;
      const errorMessage = error?.data?.message || error?.name || 'OpenCode session error';
      yield {
        type: 'error',
        error: errorMessage,
      };
      break;
    }

    case 'permission.updated': {
      if (onPermissionRequest) {
        const permission: OpenCodePermission = props;
        if (permission.sessionID !== sessionId) break;

        const decision = await onPermissionRequest({
          requestId: permission.id,
          toolName: permission.type || 'unknown',
          toolInput: permission.metadata,
          detail: permission.title || permission.type,
          timeoutSeconds: 0,
        });

        console.log(`[OpenCode] Permission ${decision.behavior} for ${permission.type}`);

        // Respond to permission request via SDK
        try {
          const response = decision.behavior === 'allow' ? 'once' : 'reject';
          await server.client.postSessionIdPermissionsPermissionId({
            path: { id: sessionId, permissionID: permission.id },
            body: { response: response as 'once' | 'always' | 'reject' },
          });
        } catch (err) {
          console.error(`[OpenCode] Failed to respond to permission:`, err);
        }
      }
      break;
    }

    default: {
      // Handle message.part.delta (not in SDK type union, but emitted by newer OpenCode servers)
      const t = eventType as string;
      if (t === 'message.part.delta') {
        const delta: string | undefined = props.delta;
        const field: string | undefined = props.field;
        if (delta && props.sessionID === sessionId) {
          if (field === 'text') {
            // Close any open think block when switching from reasoning to text
            if (streamState.lastField === 'reasoning') {
              yield { type: 'assistant', content: '</think>\n\n' };
            }
            // Track part transitions for text separators
            if (streamState.lastTextPartId && props.partID !== streamState.lastTextPartId) {
              yield { type: 'assistant', content: '\n\n' };
            }
            streamState.lastTextPartId = props.partID;
            streamState.lastField = 'text';
            streamState.hasAnyAssistantOutput = true;
            yield { type: 'assistant', content: delta };
          } else if (field === 'reasoning') {
            if (streamState.lastField !== 'reasoning') {
              yield { type: 'assistant', content: '<think>' };
            }
            streamState.lastField = 'reasoning';
            streamState.hasAnyAssistantOutput = true;
            yield { type: 'assistant', content: delta };
          }
        }
        break;
      }

      // Log unhandled event types for debugging
      if (t && t !== 'server.connected' && t !== 'session.diff'
          && t !== 'server.heartbeat' && t !== 'lsp.updated'
          && t !== 'lsp.client.diagnostics' && t !== 'message.updated'
          && t !== 'session.updated' && t !== 'tui.toast.show') {
        console.log(`[OpenCode] Unhandled SSE event: ${t} (session=${eventSessionId || 'global'}) | ${JSON.stringify(props).slice(0, 200)}`);
      }
      break;
    }
  }
}

/**
 * Abort a running OpenCode session.
 */
export async function abortOpenCodeSession(cwd: string, sessionId: string): Promise<void> {
  const server = openCodeServerManager.getServer(cwd);
  if (!server) return;

  try {
    await server.client.session.abort({
      path: { id: sessionId },
    });
    console.log(`[OpenCode] Aborted session ${sessionId}`);
  } catch (error) {
    console.error(`[OpenCode] Failed to abort session:`, error);
  }
}
