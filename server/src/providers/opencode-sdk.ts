import { spawn, type ChildProcess } from 'child_process';
import type { PermissionRequest } from '@my-claudia/shared';
import type { ClaudeMessage, SystemInfo, PermissionDecision, PermissionCallback } from './claude-sdk.js';
import { prepareInput, cleanupTempFiles } from './claude-sdk.js';

export { type ClaudeMessage, type PermissionDecision, type PermissionCallback };

export interface OpenCodeRunOptions {
  cwd: string;
  sessionId?: string;   // OpenCode session ID for resume
  env?: Record<string, string>;
  cliPath?: string;     // Custom path to opencode binary
  model?: string;       // Model override (e.g. 'anthropic/claude-sonnet-4-5-20250929')
  agent?: string;       // Agent/mode to use (e.g. 'sisyphus', 'plan')
}

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
      // Verify it's still alive
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

    const server: OpenCodeServer = {
      process: child,
      port,
      baseUrl,
      cwd,
      ready: false,
    };

    // Log stderr for debugging
    child.stderr?.on('data', (chunk: Buffer) => {
      console.log(`[OpenCode:${port}] stderr:`, chunk.toString().trim());
    });

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

    // Wait for server to be ready (poll health endpoint)
    await this.waitForReady(baseUrl, 30000);
    server.ready = true;
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
// SSE Event Parsing
// ============================================

interface SSEEvent {
  event: string;
  data: string;
}

/**
 * Parse an SSE stream from a fetch Response into an async iterable of events.
 */
async function* parseSSEStream(response: Response): AsyncGenerator<SSEEvent> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete events (separated by double newline)
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        if (!part.trim()) continue;

        let event = '';
        let data = '';

        for (const line of part.split('\n')) {
          if (line.startsWith('event: ')) {
            event = line.slice(7);
          } else if (line.startsWith('data: ')) {
            data += (data ? '\n' : '') + line.slice(6);
          } else if (line.startsWith('data:')) {
            data += (data ? '\n' : '') + line.slice(5);
          }
        }

        if (event || data) {
          yield { event, data };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
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

  const baseUrl = server.baseUrl;

  // Create or resume session
  // OpenCode now requires session IDs to start with "ses" prefix
  let sessionId = options.sessionId;
  if (sessionId && !sessionId.startsWith('ses')) {
    console.log(`[OpenCode] Ignoring legacy session ID (no 'ses' prefix): ${sessionId}`);
    sessionId = undefined;
  }
  if (!sessionId) {
    try {
      const response = await fetch(`${baseUrl}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        yield { type: 'error', error: `Failed to create session: ${response.statusText}` };
        return;
      }
      const session = await response.json() as { id: string };
      sessionId = session.id;
      console.log(`[OpenCode] Created session: ${sessionId}`);
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
    const [healthRes, agentRes, providerRes] = await Promise.all([
      fetch(`${baseUrl}/global/health`).catch(() => null),
      fetch(`${baseUrl}/agent`).catch(() => null),
      fetch(`${baseUrl}/provider`).catch(() => null),
    ]);

    // Version from health endpoint
    if (healthRes?.ok) {
      const health = await healthRes.json() as { version?: string };
      if (health.version) {
        systemInfo.claudeCodeVersion = `OpenCode ${health.version}`;
      }
    }

    // Parse agents and provider data
    type AgentInfo = { name?: string; model?: { providerID?: string; modelID?: string } };
    let agents: AgentInfo[] = [];
    if (agentRes?.ok) {
      agents = await agentRes.json() as AgentInfo[];
      if (Array.isArray(agents) && agents.length > 0) {
        systemInfo.agents = agents.map(a => a.name || 'unknown');
      }
    }

    // Parse provider data: { all: [{ id, name, models: { [modelId]: { name, ... } } }] }
    type ProviderModel = { id?: string; name?: string; providerID?: string };
    type ProviderInfo = { id: string; name: string; models: Record<string, ProviderModel> };
    let providerData: ProviderInfo[] = [];
    if (providerRes?.ok) {
      const raw = await providerRes.json() as { all?: ProviderInfo[] };
      providerData = raw.all || [];
    }

    // Derive model name when no explicit model is set
    if (!options.model) {
      // Get model config from the active agent (first agent = default, or match options.agent)
      const activeAgent = options.agent
        ? agents.find(a => a.name === options.agent) || agents[0]
        : agents[0];
      const agentModel = activeAgent?.model;
      if (agentModel?.providerID && agentModel?.modelID) {
        // Look up display name from provider data
        const provider = providerData.find(p => p.id === agentModel.providerID);
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

  // Connect global SSE event stream (OpenCode uses a single global /event endpoint)
  console.log(`[OpenCode] Connecting SSE stream: ${baseUrl}/event`);
  let sseResponse: Response;
  try {
    sseResponse = await fetch(`${baseUrl}/event`);
    console.log(`[OpenCode] SSE connected: status=${sseResponse.status}, hasBody=${!!sseResponse.body}`);
    if (!sseResponse.ok || !sseResponse.body) {
      yield { type: 'error', error: `Failed to connect event stream: ${sseResponse.statusText}` };
      return;
    }
  } catch (error) {
    console.error(`[OpenCode] SSE connection failed:`, error);
    yield { type: 'error', error: `Failed to connect event stream: ${error}` };
    return;
  }

  // Parse input: extract text and save image attachments to temp files
  const { text: promptText, tempFiles } = await prepareInput(input);

  try {
    // Send message asynchronously
    const messageBody: Record<string, unknown> = {
      parts: [{ type: 'text', text: promptText }],
    };

    if (options.model) {
      // OpenCode model format: "providerID/modelID" (e.g. "anthropic/claude-sonnet-4-5-20250929")
      const slashIndex = options.model.indexOf('/');
      if (slashIndex !== -1) {
        messageBody.model = {
          providerID: options.model.slice(0, slashIndex),
          modelID: options.model.slice(slashIndex + 1),
        };
      }
    }

    // Include agent if specified (maps UI mode to OpenCode agent)
    if (options.agent) {
      messageBody.agentID = options.agent;
    }

    console.log(`[OpenCode] Sending prompt to session ${sessionId}:`, JSON.stringify(messageBody).slice(0, 200));
    try {
      const sendResponse = await fetch(`${baseUrl}/session/${sessionId}/prompt_async`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messageBody),
      });
      console.log(`[OpenCode] prompt_async response: status=${sendResponse.status} ${sendResponse.statusText}`);
      if (!sendResponse.ok) {
        const errorBody = await sendResponse.text().catch(() => '');
        console.error(`[OpenCode] prompt_async error body:`, errorBody);
        yield { type: 'error', error: `Failed to send message: ${sendResponse.statusText} - ${errorBody}` };
        return;
      }
    } catch (error) {
      console.error(`[OpenCode] prompt_async failed:`, error);
      yield { type: 'error', error: `Failed to send message: ${error}` };
      return;
    }

    // Process SSE events (filter by our sessionId since it's a global stream)
    console.log(`[OpenCode] Processing SSE events for session ${sessionId}...`);
    const thinkFilter = new ThinkTagFilter();
    try {
      for await (const sseEvent of parseSSEStream(sseResponse)) {
        const messages = mapOpenCodeEvent(sseEvent.data, sessionId, onPermissionRequest);
        for await (const msg of messages) {
          // Filter <think>...</think> from assistant text
          if (msg.type === 'assistant' && msg.content) {
            const filtered = thinkFilter.push(msg.content);
            if (filtered) {
              yield { ...msg, content: filtered };
            }
            continue;
          }
          // Flush any buffered text before result/error
          if (msg.type === 'result' || msg.type === 'error') {
            const rest = thinkFilter.flush();
            if (rest) {
              yield { type: 'assistant', content: rest };
            }
          }
          yield msg;
          if (msg.type === 'result' || msg.type === 'error') {
            return;
          }
        }
      }
    } catch (error) {
      console.log('[OpenCode] SSE stream ended:', error);
    }

    console.log('[OpenCode] SSE stream finished without explicit result, yielding completion');
    yield {
      type: 'result',
      isComplete: true,
    };
  } finally {
    // Clean up temp files after run completes (or fails)
    if (tempFiles.length > 0) {
      cleanupTempFiles(tempFiles);
      console.log(`[OpenCode] Cleaned up ${tempFiles.length} temp file(s)`);
    }
  }
}

/**
 * Map an OpenCode SSE event to ClaudeMessage objects.
 *
 * OpenCode's /event SSE stream uses only `data:` lines (no `event:` field).
 * The event type is at `data.type` and payload at `data.properties`.
 * Events are global (not per-session), so we filter by sessionId.
 */
async function* mapOpenCodeEvent(
  rawData: string,
  sessionId: string,
  onPermissionRequest?: PermissionCallback
): AsyncGenerator<ClaudeMessage> {
  let data: any;
  try {
    data = rawData ? JSON.parse(rawData) : {};
  } catch {
    return;
  }

  const eventType: string = data.type || '';
  const props = data.properties || {};

  // Extract session ID from various event shapes to filter
  const eventSessionId =
    props.sessionID ||
    props.part?.sessionID ||
    props.info?.id ||
    props.info?.sessionID;

  // Skip events not for our session (except global events like server.connected)
  if (eventSessionId && eventSessionId !== sessionId) {
    return;
  }

  switch (eventType) {
    case 'message.part.delta': {
      // Streaming delta — the primary way OpenCode sends incremental text
      const delta: string | undefined = props.delta;
      const field: string | undefined = props.field;
      if (delta && field === 'text') {
        yield { type: 'assistant', content: delta };
      }
      break;
    }

    case 'message.part.updated': {
      const part = props.part;
      if (!part) break;

      switch (part.type) {
        case 'text': {
          // Full text update — only use as fallback if we haven't seen deltas
          // (deltas via message.part.delta are preferred for streaming)
          break;
        }

        case 'tool-call': {
          // Tool invocation part
          const toolName = part.toolName || part.name || 'unknown';
          const toolUseId = part.id || crypto.randomUUID();
          // When tool call is first seen (has name but no result yet)
          if (part.state === 'pending' || part.state === 'running') {
            yield {
              type: 'tool_use',
              toolUseId,
              toolName,
              toolInput: part.input,
            };
          }
          break;
        }

        case 'tool-result': {
          // Tool result part
          const toolUseId = part.toolCallID || part.id || '';
          yield {
            type: 'tool_result',
            toolUseId,
            toolResult: part.result || part.text || '',
            isToolError: part.isError || false,
          };
          break;
        }

        // Skip reasoning, step-start, step-finish, and other part types
        default:
          break;
      }
      break;
    }

    case 'session.status': {
      const status = props.status;
      // Filter by session ID explicitly
      if (props.sessionID !== sessionId) break;

      if (status?.type === 'idle') {
        yield {
          type: 'result',
          isComplete: true,
        };
      } else if (status?.type === 'error') {
        yield {
          type: 'error',
          error: status.error || 'OpenCode session error',
        };
      }
      break;
    }

    case 'permission.asked': {
      if (onPermissionRequest) {
        const requestId = props.id || crypto.randomUUID();
        const toolName = props.toolName || props.tool || 'unknown';
        const toolInput = props.input || props.args;

        const decision = await onPermissionRequest({
          requestId,
          toolName,
          toolInput,
          detail: typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput, null, 2),
          timeoutSeconds: 0,
        });

        console.log(`[OpenCode] Permission ${decision.behavior} for ${toolName}`);
      }
      break;
    }

    // Silently ignore: server.connected, message.updated, session.updated, session.diff, etc.
    default:
      break;
  }
}

/**
 * Abort a running OpenCode session.
 */
export async function abortOpenCodeSession(cwd: string, sessionId: string): Promise<void> {
  const server = openCodeServerManager.getServer(cwd);
  if (!server) return;

  try {
    await fetch(`${server.baseUrl}/session/${sessionId}/abort`, {
      method: 'POST',
    });
    console.log(`[OpenCode] Aborted session ${sessionId}`);
  } catch (error) {
    console.error(`[OpenCode] Failed to abort session:`, error);
  }
}
