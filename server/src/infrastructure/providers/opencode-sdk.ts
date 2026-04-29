import path from 'path';
import { appendFileSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import type { ClaudeMessage, SystemInfo, PermissionDecision, PermissionCallback } from './message-types.js';
import { fileStore } from '../storage/fileStore.js';
import { createTraceRecorder, type TraceRecorder, summarizeProviderMessage } from '../../utils/provider-trace.js';
import { parseMessageInput, prependNonImageNotes } from './provider-input.js';
import {
  openCodeServerManager,
  openCodeJsonRequest,
  injectMcpBridge,
  sessionServerMap,
  SESSION_MAP_STALE_MS,
  type OpenCodeServer,
  type OpenCodeServerWithBridge,
} from './opencode-server-manager.js';
import {
  createStreamState,
  rawSseStream,
  pollSessionMessages,
  mapOpenCodeEvent,
  emitAssistantFallbackFromSession,
  isLatestAssistantMessageCompleted,
  OPENCODE_SSE_PRIME_DELAY_MS,
  OPENCODE_SSE_FALLBACK_TIMEOUT_MS,
} from './opencode-stream.js';
import type {
  Agent as OpenCodeAgent,
  Event as OpenCodeEvent,
} from '@opencode-ai/sdk';

export { openCodeServerManager, isLatestAssistantMessageCompleted };
export type { ClaudeMessage, PermissionDecision, PermissionCallback };

// ── OpenCode prompt part types ─────────────────────────────────
type OCTextPart = { type: 'text'; text: string };
type OCFilePart = { type: 'file'; mime: string; url: string; filename?: string };
type OCPromptPart = OCTextPart | OCFilePart;

/**
 * Parse MessageInput for OpenCode: text stays as TextPartInput,
 * images become FilePartInput with data: URIs (sent inline to the model).
 */
function prepareOpenCodeInput(input: string): { text: string; fileParts: OCFilePart[] } {
  const parsed = parseMessageInput(input);
  if (!parsed) return { text: input, fileParts: [] };

  let text = prependNonImageNotes(parsed.text, parsed.attachments);
  if (parsed.attachments.length === 0) return { text, fileParts: [] };

  const fileParts: OCFilePart[] = [];
  for (const attachment of parsed.attachments) {
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

// ── Debug logging ─────────────────────────────────────────────

const OC_DEBUG_ENABLED = process.env.MY_CLAUDIA_OPENCODE_DEBUG === '1';
const OC_LOG_PATH = process.env.MY_CLAUDIA_DATA_DIR
  ? `${process.env.MY_CLAUDIA_DATA_DIR}/opencode-debug.log`
  : '/tmp/opencode-debug.log';
const OC_LOG_TMP = '/tmp/opencode-debug.log';
const OPENCODE_MCP_INJECTION_ENABLED = process.env.MY_CLAUDIA_OPENCODE_ENABLE_MCP !== '0';

function appendOpenCodeLog(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { appendFileSync(OC_LOG_PATH, line); } catch (e) { /* silently fail */ }
  if (OC_LOG_TMP !== OC_LOG_PATH) {
    try { appendFileSync(OC_LOG_TMP, line); } catch (e) { /* silently fail */ }
  }
}

export function ocLog(msg: string) {
  if (!OC_DEBUG_ENABLED) return;
  appendOpenCodeLog(msg);
  console.log(`[OpenCode] ${msg}`);
}

export function ocImportantLog(msg: string) {
  appendOpenCodeLog(msg);
  console.log(`[OpenCode] ${msg}`);
}

// ── Config & error helpers ────────────────────────────────────

function findLatestOpenCodeSocketError(): {
  providerId?: string;
  modelId?: string;
  path?: string;
} | null {
  const homeDir = process.env.HOME;
  if (!homeDir) return null;

  const logDir = path.join(homeDir, '.local', 'share', 'opencode', 'log');

  try {
    const candidates = readdirSync(logDir)
      .filter((name) => name.endsWith('.log'))
      .sort()
      .reverse()
      .slice(0, 3);

    const socketErrorPattern =
      /service=llm providerID=([^ ]+) modelID=([^ ]+).*?"code":"FailedToOpenSocket","path":"([^"]+)"/;

    for (const fileName of candidates) {
      const content = readFileSync(path.join(logDir, fileName), 'utf8');
      const lines = content.trim().split('\n').reverse();
      for (const line of lines) {
        const match = line.match(socketErrorPattern);
        if (!match) continue;
        return {
          providerId: match[1],
          modelId: match[2],
          path: match[3],
        };
      }
    }
  } catch {
    return null;
  }

  return null;
}

function getOpenCodeConfigPaths(): string[] {
  const homeDir = process.env.HOME;
  if (!homeDir) return [];

  return [
    path.join(homeDir, '.config', 'opencode', 'opencode.json'),
    path.join(homeDir, '.config', 'opencode', 'config.json'),
  ];
}

function loadOpenCodeConfigObject(): Record<string, unknown> | null {
  for (const configPath of getOpenCodeConfigPaths()) {
    try {
      const raw = readFileSync(configPath, 'utf8');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
  }

  return null;
}

function getOpenCodeLocalProviderBaseUrls(): string[] {
  const config = loadOpenCodeConfigObject();
  if (!config) return [];

  const provider = config.provider;
  if (!provider || typeof provider !== 'object') return [];

  const urls = new Set<string>();
  for (const providerConfig of Object.values(provider as Record<string, unknown>)) {
    if (!providerConfig || typeof providerConfig !== 'object') continue;
    const options = (providerConfig as { options?: unknown }).options;
    if (!options || typeof options !== 'object') continue;
    const baseURL = (options as { baseURL?: unknown }).baseURL;
    if (typeof baseURL === 'string' && baseURL.trim()) {
      urls.add(baseURL.trim());
    }
  }

  return [...urls];
}

async function probeOpenCodeProviderEndpoint(baseUrl: string): Promise<{ ok: boolean; detail: string }> {
  const probeUrl = new URL('models', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(probeUrl, {
      method: 'GET',
      signal: controller.signal,
    });
    return { ok: true, detail: `${probeUrl.toString()} -> HTTP ${response.status}` };
  } catch (error) {
    const details: string[] = [];
    if (error instanceof Error) {
      details.push(error.name);
      details.push(error.message);
      const errWithCause = error as Error & { cause?: unknown };
      if (errWithCause.cause) {
        if (errWithCause.cause instanceof Error) {
          details.push(`cause=${errWithCause.cause.name}:${errWithCause.cause.message}`);
        } else {
          details.push(`cause=${String(errWithCause.cause)}`);
        }
      }
    } else {
      details.push(String(error));
    }
    return {
      ok: false,
      detail: `${probeUrl.toString()} -> ${details.join(' | ')}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function enrichOpenCodeErrorMessage(errorMessage: string): string {
  const trimmed = errorMessage.trim();
  if (!trimmed) return 'OpenCode session error';

  const lower = trimmed.toLowerCase();
  const isSocketLike =
    lower.includes('was there a typo in the url or port') ||
    lower.includes('failedtoopensocket') ||
    lower.includes('no output generated. check the stream for errors.');

  if (!isSocketLike) return trimmed;

  const socketError = findLatestOpenCodeSocketError();
  if (!socketError?.path) return trimmed;

  const providerLabel = socketError.providerId && socketError.modelId
    ? `${socketError.providerId}/${socketError.modelId}`
    : socketError.providerId || socketError.modelId || 'unknown';

  return `OpenCode could not reach the configured model endpoint (${providerLabel} -> ${socketError.path}). Original error: ${trimmed}`;
}

if (OC_DEBUG_ENABLED) {
  ocLog('=== opencode-sdk.ts module loaded ===');
}

// ── Types ─────────────────────────────────────────────────────

export interface OpenCodeRunOptions {
  cwd: string;
  sessionId?: string;
  env?: Record<string, string>;
  cliPath?: string;
  model?: string;
  agent?: string;
  systemPrompt?: string;
  sessionTitle?: string;
  serverPort?: number;
  claudiaSessionId?: string;
}

// ============================================
// Run OpenCode
// ============================================

export async function* runOpenCode(
  input: string,
  options: OpenCodeRunOptions,
  onPermissionRequest?: PermissionCallback
): AsyncGenerator<ClaudeMessage, void, void> {
  let server: OpenCodeServer;
  let createdNewSession = false;
  const trace = createTraceRecorder({
    provider: 'opencode',
    cwd: options.cwd,
    sessionId: options.sessionId,
  });

  trace.log('provider_raw', 'run_started', {
    cwd: options.cwd,
    sessionId: options.sessionId,
    model: options.model,
    agent: options.agent,
    cliPath: options.cliPath,
  }, 'opencode run started');

  try {
    server = await openCodeServerManager.ensureServer(options.cwd, {
      cliPath: options.cliPath,
      env: options.env,
      sessionId: options.claudiaSessionId ?? options.sessionId,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    trace.log('provider_raw', 'ensure_server_failed', error, 'ensureServer failed');
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
  trace.log('provider_raw', 'server_ready', { baseUrl: server.baseUrl, cwd: server.cwd }, 'server ready');
  ocImportantLog(`Server baseUrl=${server.baseUrl} cwd=${server.cwd} cliPath=${options.cliPath}`);

  for (const providerBaseUrl of getOpenCodeLocalProviderBaseUrls()) {
    const probe = await probeOpenCodeProviderEndpoint(providerBaseUrl);
    const level = probe.ok ? 'log' : 'warn';
    console[level](`[OpenCode] Provider preflight ${probe.ok ? 'ok' : 'failed'}: ${probe.detail}`);
    ocImportantLog(`Provider preflight ${probe.ok ? 'ok' : 'failed'}: ${probe.detail}`);
  }

  if (options.serverPort && OPENCODE_MCP_INJECTION_ENABLED) {
    await injectMcpBridge(server, options);
  } else if (options.serverPort && !OPENCODE_MCP_INJECTION_ENABLED) {
    console.log('[OpenCode] Skipping MCP bridge injection (set MY_CLAUDIA_OPENCODE_ENABLE_MCP=0 only when you want it disabled)');
  }

  if (options.claudiaSessionId && (server as OpenCodeServerWithBridge).sessionIdFile) {
    try {
      writeFileSync((server as OpenCodeServerWithBridge).sessionIdFile!, options.claudiaSessionId);
    } catch { /* ignore */ }
  }

  // Create or resume session
  let sessionId = options.sessionId;
  if (sessionId) {
    const entry = sessionServerMap.get(sessionId);
    const isStale = entry && (Date.now() - entry.updatedAt > SESSION_MAP_STALE_MS);
    if (entry && entry.baseUrl === server.baseUrl && !isStale) {
      ocLog(`Resuming session ${sessionId} on same server ${server.baseUrl}`);
      entry.updatedAt = Date.now();
    } else {
      if (isStale) sessionServerMap.delete(sessionId);
      try {
        const getResult = await openCodeJsonRequest<Record<string, unknown>>(
          server,
          'GET',
          `/session/${encodeURIComponent(sessionId)}`,
        );
        if (getResult.ok && getResult.data) {
          ocLog(`Session ${sessionId} validated on server ${server.baseUrl} (was: ${entry?.baseUrl || 'unknown'})`);
          sessionServerMap.set(sessionId, { baseUrl: server.baseUrl, updatedAt: Date.now() });
          trace.log('provider_raw', 'session_validated', { sessionId, baseUrl: server.baseUrl }, 'session validated');
        } else {
          ocLog(`Session ${sessionId} not found (status=${getResult.status}), creating new`);
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
      const result = await openCodeJsonRequest<{ id: string }>(
        server,
        'POST',
        '/session',
        { body: options.sessionTitle ? { title: options.sessionTitle } : {} },
      );
      ocLog(`session.create: ok=${result.ok} status=${result.status} url=${result.url} error=${result.error || 'none'} data.id=${result.data?.id}`);
      if (!result.ok || !result.data) {
        trace.log('provider_raw', 'session_create_failed', { error: result.error, status: result.status, url: result.url }, 'session create failed');
        yield { type: 'error', error: `Failed to create session: ${result.error || 'no data'}` };
        return;
      }
      sessionId = result.data.id;
      createdNewSession = true;
      sessionServerMap.set(sessionId, { baseUrl: server.baseUrl, updatedAt: Date.now() });
      trace.setMeta({ sessionId });
      trace.log('provider_raw', 'session_created', { sessionId, baseUrl: server.baseUrl }, 'session created');
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
    const [healthRes, agentsResult, providersResult] = await Promise.all([
      fetch(`${server.baseUrl}/global/health`).catch(() => null),
      client.app.agents({ query: { directory: server.cwd } }).catch(() => null),
      client.provider.list({ query: { directory: server.cwd } }).catch(() => null),
    ]);

    if (healthRes?.ok) {
      const health = await healthRes.json() as { version?: string };
      if (health.version) {
        systemInfo.claudeCodeVersion = `OpenCode ${health.version}`;
      }
    }

    const agents: OpenCodeAgent[] = (agentsResult?.data as OpenCodeAgent[]) || [];
    if (agents.length > 0) {
      systemInfo.agents = agents.map(a => a.name || 'unknown');
    }

    interface OpenCodeProviderInfo { id: string; models?: Record<string, { name?: string }>; }
    const providerResult = providersResult?.data as { all?: OpenCodeProviderInfo[] } | undefined;
    const providerData: OpenCodeProviderInfo[] = providerResult?.all || [];

    if (!options.model) {
      const activeAgent = options.agent
        ? agents.find(a => a.name === options.agent) || agents[0]
        : agents[0];
      const agentModel = activeAgent?.model;
      if (agentModel?.providerID && agentModel?.modelID) {
        const provider = providerData.find((p) => p.id === agentModel.providerID);
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
  trace.setMeta({ sessionId });
  trace.log('provider_raw', 'mapped_message', {
    type: 'init',
    sessionId,
    systemInfo,
  }, 'init');

  // Parse input
  const { text: promptText, fileParts } = prepareOpenCodeInput(input);

  let effectivePrompt = promptText;
  if (options.systemPrompt && createdNewSession) {
    effectivePrompt = `[System Context]\n${options.systemPrompt}\n\n${promptText}`;
  }

  try {
    // Connect SSE event stream
    ocLog(`Connecting raw SSE stream to ${server.baseUrl}/event`);
    const sseAbort = new AbortController();
    let sseStream: AsyncGenerator<any>;
    let firstSseResult: IteratorResult<any> | undefined;
    try {
      sseStream = rawSseStream(server.baseUrl, options.cwd, sseAbort.signal);
      const firstEventPromise = sseStream.next();
      await new Promise(r => setTimeout(r, OPENCODE_SSE_PRIME_DELAY_MS));
      ocLog(`SSE stream connected, awaiting first event...`);
      firstSseResult = await firstEventPromise;
      trace.log('provider_raw', 'sse_first_event', firstSseResult.value, `first sse ${String(firstSseResult.value?.type || 'unknown')}`);
      ocLog(`SSE first event: done=${firstSseResult.done} type=${firstSseResult.value?.type || 'n/a'}`);
    } catch (error) {
      ocLog(`SSE connection failed: ${error}`);
      yield { type: 'error', error: `Failed to connect event stream: ${error}` };
      return;
    }
    ocLog(`SSE stream ready, sending prompt`);

    // Build prompt body
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
      const slashIndex = options.model.indexOf('/');
      if (slashIndex !== -1) {
        promptBody.model = {
          providerID: options.model.slice(0, slashIndex),
          modelID: options.model.slice(slashIndex + 1),
        };
      }
    }

    if (options.agent && options.agent !== 'default') {
      promptBody.agent = options.agent;
    }

    ocLog(`Sending prompt to session ${sessionId}: ${JSON.stringify(promptBody).slice(0, 200)}`);
    try {
      const sendResult = await openCodeJsonRequest<void>(
        server,
        'POST',
        `/session/${encodeURIComponent(sessionId)}/prompt_async`,
        {
          body: promptBody,
          expectedStatus: 204,
        },
      );
      ocLog(`promptAsync result: ok=${sendResult.ok} status=${sendResult.status} url=${sendResult.url} error=${sendResult.error || 'none'}`);
      if (!sendResult.ok) {
        console.error(`[OpenCode] promptAsync error:`, sendResult.error);
        yield {
          type: 'error',
          error: enrichOpenCodeErrorMessage(
            `Failed to send message: ${sendResult.error || `HTTP ${sendResult.status}`}`,
          ),
        };
        return;
      }
    } catch (error) {
      ocLog(`promptAsync exception: ${error}`);
      yield {
        type: 'error',
        error: enrichOpenCodeErrorMessage(`Failed to send message: ${error}`),
      };
      return;
    }

    // Process SSE events with polling fallback
    const SSE_FALLBACK_TIMEOUT = OPENCODE_SSE_FALLBACK_TIMEOUT_MS;
    ocLog(`Processing SSE events for session ${sessionId} (fallback after ${SSE_FALLBACK_TIMEOUT}ms)...`);
    const streamState = createStreamState();
    let receivedSessionEvent = false;
    const sseStartTime = Date.now();

    // Process first SSE event from priming
    if (firstSseResult && !firstSseResult.done && firstSseResult.value) {
      const firstEvent = firstSseResult.value;
      trace.log('provider_raw', 'sse_event', firstEvent, `sse ${String(firstEvent.type || 'unknown')}`);
      const firstProps = firstEvent.properties || {};
      const firstSid = firstProps.sessionID || firstProps.part?.sessionID;
      if (firstSid === sessionId) {
        receivedSessionEvent = true;
        ocLog(`First SSE event matched session: type=${firstEvent.type}`);
      }
      const firstMessages = mapOpenCodeEvent(firstEvent, sessionId, streamState, server, trace, onPermissionRequest);
      for await (const msg of firstMessages) {
        trace.log('provider_raw', 'mapped_message', msg, summarizeProviderMessage(msg as { type: string; [key: string]: unknown }));
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
        const elapsed = Date.now() - sseStartTime;
        const remainingMs = receivedSessionEvent
          ? 120_000
          : Math.max(0, SSE_FALLBACK_TIMEOUT - elapsed);

        if (remainingMs <= 0 && !receivedSessionEvent) {
          ocLog(`SSE fallback triggered: no session events after ${elapsed}ms`);
          break;
        }

        const nextEvent = sseStream.next();
        const timeout = new Promise<'timeout'>(r => setTimeout(() => r('timeout'), remainingMs));
        const raceResult = await Promise.race([nextEvent, timeout]);

        if (raceResult === 'timeout') {
          if (!receivedSessionEvent) {
            ocLog(`SSE timeout: no session events in ${Date.now() - sseStartTime}ms, switching to polling`);
            break;
          }
          ocLog('SSE: per-event timeout (120s), assuming stream dead');
          break;
        }

        if (raceResult.done) {
          ocLog('SSE stream ended');
          break;
        }

        const event = raceResult.value as { type?: string; properties?: Record<string, unknown> };
        trace.log('provider_raw', 'sse_event', event, `sse ${String(event.type || 'unknown')}`);
        eventIdx++;
        const _et = event.type || '';
        const _ep = (event.properties || {}) as Record<string, unknown> & { sessionID?: string; part?: Record<string, unknown>; field?: string; delta?: string };
        const _eSid = _ep.sessionID || _ep.part?.sessionID;

        if (_eSid === sessionId) {
          receivedSessionEvent = true;
          ocLog(`SSE[${eventIdx}] type=${_et} field=${_ep.field || '-'} delta=${(_ep.delta || '').slice(0, 30)} partType=${_ep.part?.type || '-'}`);
        } else if (_et === 'session.status' || _et === 'session.idle' || _et === 'session.error' || _et === 'session.completed') {
          ocLog(`SSE[${eventIdx}] type=${_et} otherSID=${_eSid || 'none'} (ours=${sessionId})`);
        }

        const messages = mapOpenCodeEvent(event as OpenCodeEvent, sessionId, streamState, server, trace, onPermissionRequest);
        for await (const msg of messages) {
          trace.log('provider_raw', 'mapped_message', msg, summarizeProviderMessage(msg as { type: string; [key: string]: unknown }));
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
      sseAbort.abort();

      ocLog('Switching to polling fallback via session.messages() API');
      trace.log('provider_raw', 'switch_to_polling', { sessionId }, 'switch to polling fallback');
      yield* pollSessionMessages(
        client, sessionId, streamState, server, onPermissionRequest
      );
      return;
    }

    // SSE ended normally
    if (!streamState.hasAnyAssistantOutput) {
      yield* emitAssistantFallbackFromSession(server, sessionId, streamState);
    }
    if (streamState.lastField === 'reasoning') {
      yield { type: 'assistant', content: '</think>\n\n' };
    }
    ocLog('SSE stream finished without explicit result, yielding completion');
    sseAbort.abort();
    const completion = { type: 'result', isComplete: true } as ClaudeMessage;
    trace.log('provider_raw', 'mapped_message', completion, summarizeProviderMessage(completion as { type: string; [key: string]: unknown }));
    yield completion;
  } finally {
    trace.log('provider_raw', 'run_finished', { sessionId, createdNewSession }, 'opencode run finished');
  }
}

/**
 * Abort a running OpenCode session.
 */
export async function abortOpenCodeSession(cwd: string, sessionId: string): Promise<void> {
  const server = openCodeServerManager.getServer(cwd);
  if (!server) return;

  try {
    await openCodeJsonRequest<void>(
      server,
      'POST',
      `/session/${encodeURIComponent(sessionId)}/abort`,
      { body: {} },
    );
    console.log(`[OpenCode] Aborted session ${sessionId}`);
  } catch (error) {
    console.error(`[OpenCode] Failed to abort session:`, error);
  }
}
