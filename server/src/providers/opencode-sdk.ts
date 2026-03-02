import { spawn, type ChildProcess } from 'child_process';
import type { PermissionRequest } from '@my-claudia/shared';
import type { ClaudeMessage, SystemInfo, PermissionDecision, PermissionCallback } from './claude-sdk.js';
import { prepareInput } from './claude-sdk.js';
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
// Streaming state for part-boundary tracking
// ============================================

interface StreamState {
  /** Last field type seen ('text' | 'reasoning' | null) */
  lastField: string | null;
  /** Last partIndex seen for text deltas (for detecting part boundaries) */
  lastTextPartId: string;
}

function createStreamState(): StreamState {
  return { lastField: null, lastTextPartId: '' };
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

  // Create or resume session
  let sessionId = options.sessionId;
  if (!sessionId) {
    try {
      const result = await client.session.create({});
      if (result.error || !result.data) {
        yield { type: 'error', error: `Failed to create session: ${result.error || 'no data'}` };
        return;
      }
      sessionId = result.data.id;
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

  // Connect global SSE event stream via SDK
  console.log(`[OpenCode] Connecting SSE stream via SDK`);
  let sseResult: { stream: AsyncGenerator<OpenCodeEvent> };
  try {
    sseResult = await client.event.subscribe({}) as { stream: AsyncGenerator<OpenCodeEvent> };
    console.log(`[OpenCode] SSE stream connected`);
  } catch (error) {
    console.error(`[OpenCode] SSE connection failed:`, error);
    yield { type: 'error', error: `Failed to connect event stream: ${error}` };
    return;
  }

  // Parse input: extract text and save image attachments to temp files
  const { text: promptText, tempFiles } = await prepareInput(input);

  // Prepend system context to first message in new sessions (OpenCode has no native system prompt API)
  let effectivePrompt = promptText;
  if (options.systemPrompt && !options.sessionId) {
    effectivePrompt = `[System Context]\n${options.systemPrompt}\n\n${promptText}`;
  }

  try {
    // Build prompt body
    const promptBody: {
      parts: Array<{ type: 'text'; text: string }>;
      model?: { providerID: string; modelID: string };
      agent?: string;
    } = {
      parts: [{ type: 'text', text: effectivePrompt }],
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

    if (options.agent) {
      promptBody.agent = options.agent;
    }

    console.log(`[OpenCode] Sending prompt to session ${sessionId}:`, JSON.stringify(promptBody).slice(0, 200));
    try {
      const sendResult = await client.session.promptAsync({
        path: { id: sessionId },
        body: promptBody,
      });
      if (sendResult.error) {
        console.error(`[OpenCode] promptAsync error:`, sendResult.error);
        yield { type: 'error', error: `Failed to send message: ${JSON.stringify(sendResult.error)}` };
        return;
      }
    } catch (error) {
      console.error(`[OpenCode] promptAsync failed:`, error);
      yield { type: 'error', error: `Failed to send message: ${error}` };
      return;
    }

    // Process SSE events (filter by our sessionId since it's a global stream)
    console.log(`[OpenCode] Processing SSE events for session ${sessionId}...`);
    const streamState = createStreamState();
    try {
      for await (const event of sseResult.stream) {
        const messages = mapOpenCodeEvent(event, sessionId, streamState, server, onPermissionRequest);
        for await (const msg of messages) {
          yield msg;
          if (msg.type === 'result' || msg.type === 'error') {
            // Close any open think block before finishing
            if (streamState.lastField === 'reasoning') {
              yield { type: 'assistant', content: '</think>\n\n' };
              streamState.lastField = null;
            }
            return;
          }
        }
      }
    } catch (error) {
      console.log('[OpenCode] SSE stream ended:', error);
    }

    // Close any open think block
    if (streamState.lastField === 'reasoning') {
      yield { type: 'assistant', content: '</think>\n\n' };
    }

    console.log('[OpenCode] SSE stream finished without explicit result, yielding completion');
    yield {
      type: 'result',
      isComplete: true,
    };
  } finally {
    // Temp files are cleaned up lazily (files older than 1h) to ensure
    // the model's tools can still read them after the run completes.
    if (tempFiles.length > 0) {
      console.log(`[OpenCode] ${tempFiles.length} temp file(s) will be cleaned up lazily`);
    }
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

  // Diagnostic: log session-related events
  if (eventSessionId === sessionId) {
    const preview = JSON.stringify(props).slice(0, 300);
    console.log(`[OpenCode] SSE event: ${eventType} | ${preview}`);
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
      if (props.sessionID !== sessionId) break;
      const status: SessionStatus | undefined = props.status;

      if (status?.type === 'idle') {
        yield {
          type: 'result',
          isComplete: true,
        };
      }
      break;
    }

    case 'session.idle': {
      if (props.sessionID !== sessionId) break;
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
      // Log unhandled event types for debugging (cast to string since TS narrows the union)
      const t = eventType as string;
      if (t && t !== 'server.connected' && t !== 'session.diff'
          && t !== 'server.heartbeat' && t !== 'lsp.updated'
          && t !== 'lsp.client.diagnostics' && t !== 'message.updated') {
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
