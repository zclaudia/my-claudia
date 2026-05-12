import type {
  Event as OpenCodeEvent,
  Part as OpenCodePart,
  ToolPart,
  Permission as OpenCodePermission,
  SessionStatus,
} from '@opencode-ai/sdk';
import type { ClaudeMessage, PermissionCallback } from './message-types.js';
import type { OpenCodeServer } from './opencode-server-manager.js';
import { openCodeJsonRequest } from './opencode-server-manager.js';
import type { TraceRecorder } from '../../utils/provider-trace.js';
import { enrichOpenCodeErrorMessage, ocLog, ocImportantLog } from './opencode-sdk.js';
import type { ToolEffect } from '@my-claudia/shared/core/message';
import { fileChangeEffectFromInput, makeShellEffect } from './tool-effects.js';

// ============================================
// Test-aware timers
// ============================================

function isVitestProcess(): boolean {
  return process.argv.some((arg) => arg.includes('vitest'))
    || process.env.VITEST_POOL_ID !== undefined
    || process.env.VITEST_WORKER_ID !== undefined;
}

const FAST_TEST_TIMERS = isVitestProcess();
export const OPENCODE_SSE_PRIME_DELAY_MS = FAST_TEST_TIMERS ? 0 : 100;
export const OPENCODE_SSE_FALLBACK_TIMEOUT_MS = FAST_TEST_TIMERS ? 50 : 5000;
export const OPENCODE_POLL_INTERVAL_MS = FAST_TEST_TIMERS ? 10 : 300;

function deriveOpenCodeToolEffect(toolName: string, input: unknown): ToolEffect | undefined {
  const normalized = toolName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized.includes('write') || normalized.includes('edit') || normalized.includes('patch')) {
    return fileChangeEffectFromInput(input, normalized.includes('write') ? 'add' : 'modify');
  }
  if (normalized.includes('command') || normalized.includes('bash') || normalized.includes('shell')) {
    const record = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    return makeShellEffect(typeof record.command === 'string' ? record.command : undefined);
  }
  return undefined;
}

// ============================================
// Think-tag streaming filter
// ============================================

export class ThinkTagFilter {
  private inside = false;
  private buf = '';
  private trimNext = false;

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
        continue;
      } else if (this.buf.length > 0 || ch === '<') {
        this.trimNext = false;
        this.buf += ch;
        if (this.buf === '<think>') {
          this.inside = true;
          this.buf = '';
        } else if (!'<think>'.startsWith(this.buf)) {
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

export interface StreamState {
  lastField: string | null;
  lastTextPartId: string;
  hasAnyAssistantOutput: boolean;
  emittedToolUse: Set<string>;
  emittedToolResult: Set<string>;
}

export function createStreamState(): StreamState {
  return {
    lastField: null,
    lastTextPartId: '',
    hasAnyAssistantOutput: false,
    emittedToolUse: new Set<string>(),
    emittedToolResult: new Set<string>(),
  };
}

export function isLatestAssistantMessageCompleted(messages: any[]): boolean {
  const assistants = messages.filter((m) => m?.info?.role === 'assistant');
  const latest = assistants[assistants.length - 1];
  return Boolean(latest?.info?.time?.completed || latest?.info?.finish);
}

// ============================================
// Fallback: emit assistant text from session messages
// ============================================

export async function* emitAssistantFallbackFromSession(
  server: OpenCodeServer,
  sessionId: string,
  streamState: StreamState,
): AsyncGenerator<ClaudeMessage> {
  if (streamState.hasAnyAssistantOutput) return;

  try {
    const res = await openCodeJsonRequest<any[]>(
      server,
      'GET',
      `/session/${encodeURIComponent(sessionId)}/message`,
    );
    const messages = Array.isArray(res.data) ? res.data : [];
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
// Raw SSE stream reader
// ============================================

export async function* rawSseStream(baseUrl: string, directory: string, signal?: AbortSignal): AsyncGenerator<any> {
  const url = new URL('/event', baseUrl);
  const httpModule = url.protocol === 'https:' ? await import('https') : await import('http');

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
// Polling fallback for session messages
// ============================================

export async function* pollSessionMessages(
  _client: unknown,
  sessionId: string,
  streamState: StreamState,
  server: OpenCodeServer,
  onPermissionRequest?: PermissionCallback
): AsyncGenerator<ClaudeMessage> {
  const POLL_INTERVAL = OPENCODE_POLL_INTERVAL_MS;
  const MAX_POLL_TIME = 10 * 60_000;
  const startTime = Date.now();

  const textContent = new Map<string, string>();
  const emittedToolUse = new Set<string>();
  const emittedToolResult = new Set<string>();
  let lastKnownMessageCount = 0;
  let pollCount = 0;

  while (Date.now() - startTime < MAX_POLL_TIME) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
    pollCount++;

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
      const result = await openCodeJsonRequest<any[]>(
        server,
        'GET',
        `/session/${encodeURIComponent(sessionId)}/message`,
      );
      if (pollCount <= 3) {
        ocLog(`Poll[${pollCount}] RAW: ok=${result.ok} status=${result.status} url=${result.url} dataType=${typeof result.data} isArray=${Array.isArray(result.data)} error=${result.error || 'none'}`);
      }
      if (!result.ok || !result.data) {
        if (pollCount <= 3) {
          ocLog(`Poll[${pollCount}] no data: ${result.error || 'empty'}`);
        }
        continue;
      }
      messagesData = result.data;
    } catch (err) {
      ocLog(`Poll[${pollCount}] fetch error: ${err}`);
      continue;
    }

    if (pollCount <= 3 || pollCount % 10 === 0) {
      ocLog(`Poll[${pollCount}] ${messagesData.length} messages`);
    }

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

            if (!emittedToolUse.has(partId) && state) {
              yield {
                type: 'tool_use',
                toolUseId: toolId,
                toolName: part.tool || 'unknown',
                toolInput: state.input,
                toolEffect: deriveOpenCodeToolEffect(part.tool || 'unknown', state.input),
              };
              emittedToolUse.add(partId);
            }

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
    }

    const sessionCompleted = isLatestAssistantMessageCompleted(messagesData);

    if (sessionCompleted) {
      if (!streamState.hasAnyAssistantOutput) {
        yield* emitAssistantFallbackFromSession(server, sessionId, streamState);
      }
      if (streamState.lastField === 'reasoning') {
        yield { type: 'assistant', content: '</think>\n\n' };
        streamState.lastField = null;
      }
      ocLog(`Poll: session completed after ${pollCount} polls (${Date.now() - startTime}ms)`);
      yield { type: 'result', isComplete: true };
      return;
    }
  }

  ocLog(`Poll: timeout after ${MAX_POLL_TIME}ms`);
  if (streamState.lastField === 'reasoning') {
    yield { type: 'assistant', content: '</think>\n\n' };
  }
  yield { type: 'error', error: 'Session did not complete within 10 minutes' };
}

// ============================================
// SSE Event → ClaudeMessage mapper
// ============================================

export async function* mapOpenCodeEvent(
  event: OpenCodeEvent,
  sessionId: string,
  streamState: StreamState,
  server: OpenCodeServer,
  trace: TraceRecorder,
  onPermissionRequest?: PermissionCallback
): AsyncGenerator<ClaudeMessage> {
  const eventType = event.type;
  const props = ((event as { properties?: Record<string, unknown> }).properties || {}) as Record<string, unknown> & { sessionID?: string; part?: Record<string, unknown>; info?: Record<string, unknown>; field?: string; delta?: string; partID?: string };

  const eventSessionId =
    props.sessionID ||
    props.part?.sessionID ||
    props.info?.id ||
    props.info?.sessionID;

  if (eventSessionId && eventSessionId !== sessionId) {
    trace.log('provider_raw', 'sse_event_skipped', { eventType, eventSessionId, sessionId }, 'event skipped for other session');
    return;
  }

  switch (eventType) {
    case 'message.part.updated': {
      const part = props.part as unknown as OpenCodePart | undefined;
      const delta: string | undefined = props.delta;
      if (!part) break;

      switch (part.type) {
        case 'text': {
          if (delta) {
            if (streamState.lastField === 'reasoning') {
              yield { type: 'assistant', content: '</think>\n\n' };
            }
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
          if (!state) break;
          const dedupeKey = `${toolUseId}:${toolName}`;

          if ((state.status === 'pending' || state.status === 'running') && !streamState.emittedToolUse.has(dedupeKey)) {
            yield {
              type: 'tool_use',
              toolUseId,
              toolName,
              toolInput: state.input,
              toolEffect: deriveOpenCodeToolEffect(toolName, state.input),
            };
            streamState.emittedToolUse.add(dedupeKey);
          } else if (state.status === 'completed' && !streamState.emittedToolResult.has(dedupeKey)) {
            yield {
              type: 'tool_result',
              toolUseId,
              toolResult: state.output || '',
              isToolError: false,
            };
            streamState.emittedToolResult.add(dedupeKey);
          } else if (state.status === 'error' && !streamState.emittedToolResult.has(dedupeKey)) {
            yield {
              type: 'tool_result',
              toolUseId,
              toolResult: state.error || 'Tool execution failed',
              isToolError: true,
            };
            streamState.emittedToolResult.add(dedupeKey);
          }
          break;
        }

        default:
          break;
      }
      break;
    }

    case 'session.status': {
      ocLog(`session.status: sessionID=${props.sessionID} ours=${sessionId} status=${JSON.stringify(props.status || props).slice(0, 200)}`);
      if (props.sessionID !== sessionId) break;
      const status = props.status as SessionStatus | undefined;

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
      const error = props.error as { data?: { message?: string }; name?: string } | undefined;
      const errorMessage = enrichOpenCodeErrorMessage(
        error?.data?.message || error?.name || 'OpenCode session error',
      );
      yield {
        type: 'error',
        error: errorMessage,
      };
      break;
    }

    case 'permission.updated': {
      if (onPermissionRequest) {
        const permission = props as unknown as OpenCodePermission;
        if (permission.sessionID !== sessionId) break;

        const decision = await onPermissionRequest({
          requestId: permission.id,
          toolName: permission.type || 'unknown',
          toolInput: permission.metadata,
          detail: permission.title || permission.type,
          timeoutSeconds: 0,
        });

        console.log(`[OpenCode] Permission ${decision.behavior} for ${permission.type}`);

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
      const t = eventType as string;
      if (t === 'message.part.delta') {
        const delta: string | undefined = props.delta;
        const field: string | undefined = props.field;
        if (delta && props.sessionID === sessionId) {
          if (field === 'text') {
            if (streamState.lastField === 'reasoning') {
              yield { type: 'assistant', content: '</think>\n\n' };
            }
            if (streamState.lastTextPartId && props.partID !== streamState.lastTextPartId) {
              yield { type: 'assistant', content: '\n\n' };
            }
            streamState.lastTextPartId = props.partID as string;
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
