import { appendFileSync, mkdirSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export type ProviderTraceLayer = 'provider_raw' | 'server_provider' | 'server_norm' | 'script_ws';

interface TraceMeta {
  provider?: string;
  cwd?: string;
  sessionId?: string;
  runId?: string;
  traceId?: string;
  script?: string;
}

interface TraceRecord {
  ts: number;
  isoTime: string;
  seq: number;
  layer: ProviderTraceLayer;
  event: string;
  summary?: string;
  provider?: string;
  cwd?: string;
  sessionId?: string;
  runId?: string;
  traceId: string;
  data?: unknown;
}

const TRACE_ENABLED = process.env.MY_CLAUDIA_PROVIDER_TRACE === '1';
const TRACE_DIR = process.env.MY_CLAUDIA_PROVIDER_TRACE_DIR
  || path.join('/tmp', 'my-claudia-provider-traces');
const MAX_PREVIEW_CHARS = 2000;

function truncateString(value: string, maxChars = MAX_PREVIEW_CHARS): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}... [truncated ${value.length - maxChars} chars]`;
}

function redactKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.includes('token')
    || normalized.includes('secret')
    || normalized.includes('password')
    || normalized.includes('authorization')
    || normalized.includes('cookie')
    || normalized.includes('credential')
    || normalized.includes('apikey')
    || normalized.includes('api_key');
}

function sanitize(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > 5) return '[max-depth]';
  if (typeof value === 'string') return truncateString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message),
      stack: value.stack ? truncateString(value.stack, 4000) : undefined,
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => sanitize(item, depth + 1));
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const entries = Object.entries(record).slice(0, 50);
    for (const [key, innerValue] of entries) {
      out[key] = redactKey(key) ? '[redacted]' : sanitize(innerValue, depth + 1);
    }
    return out;
  }
  return String(value);
}

function ensureTraceDir(): void {
  mkdirSync(TRACE_DIR, { recursive: true });
}

function buildTracePath(meta: TraceMeta): string {
  const day = new Date().toISOString().slice(0, 10);
  const provider = meta.provider || 'unknown';
  const id = meta.traceId || randomUUID().slice(0, 8);
  return path.join(TRACE_DIR, day, `${provider}-${id}.jsonl`);
}

export interface TraceRecorder {
  readonly enabled: boolean;
  readonly traceId: string;
  readonly filePath: string | null;
  setMeta(meta: Partial<TraceMeta>): void;
  log(layer: ProviderTraceLayer, event: string, data?: unknown, summary?: string): void;
}

export function createTraceRecorder(initialMeta: TraceMeta = {}): TraceRecorder {
  const meta: TraceMeta = {
    ...initialMeta,
    traceId: initialMeta.traceId || randomUUID().slice(0, 8),
  };
  const filePath = TRACE_ENABLED ? buildTracePath(meta) : null;
  let seq = 0;

  if (TRACE_ENABLED) {
    ensureTraceDir();
  }

  return {
    enabled: TRACE_ENABLED,
    traceId: meta.traceId!,
    filePath,
    setMeta(nextMeta: Partial<TraceMeta>) {
      Object.assign(meta, nextMeta);
    },
    log(layer: ProviderTraceLayer, event: string, data?: unknown, summary?: string) {
      if (!TRACE_ENABLED || !filePath) return;
      const record: TraceRecord = {
        ts: Date.now(),
        isoTime: new Date().toISOString(),
        seq: ++seq,
        layer,
        event,
        summary,
        provider: meta.provider,
        cwd: meta.cwd,
        sessionId: meta.sessionId,
        runId: meta.runId,
        traceId: meta.traceId!,
        data: sanitize(data),
      };
      ensureTraceDir();
      mkdirSync(path.dirname(filePath), { recursive: true });
      appendFileSync(filePath, `${JSON.stringify(record)}\n`);
    },
  };
}

export function summarizeServerMessage(message: { type: string; [key: string]: unknown }): string {
  switch (message.type) {
    case 'run_started':
      return `run_started session=${String(message.sessionId || '')}`;
    case 'system_info':
      return `system_info model=${String((message.systemInfo as { model?: string } | undefined)?.model || '')}`;
    case 'delta':
      return `delta chars=${String((message.content as string | undefined)?.length || 0)}`;
    case 'tool_use':
      return `tool_use ${String(message.toolName || '')}`;
    case 'tool_result':
      return `tool_result ${String(message.toolName || '')} error=${String(Boolean(message.isError))}`;
    case 'run_completed':
      return 'run_completed';
    case 'run_failed':
      return `run_failed ${String(message.error || '')}`;
    default:
      return message.type;
  }
}

export function summarizeProviderMessage(message: { type: string; [key: string]: unknown }): string {
  switch (message.type) {
    case 'init':
      return `init session=${String(message.sessionId || '')}`;
    case 'assistant':
      return `assistant chars=${String((message.content as string | undefined)?.length || 0)}`;
    case 'tool_use':
      return `tool_use ${String(message.toolName || '')}`;
    case 'tool_result':
      return `tool_result id=${String(message.toolUseId || '')} error=${String(Boolean(message.isToolError))}`;
    case 'result':
      return `result complete=${String(Boolean(message.isComplete))}`;
    case 'error':
      return `error ${String(message.error || '')}`;
    case 'task_notification':
      return `task_notification ${String(message.taskId || '')}`;
    default:
      return message.type;
  }
}
