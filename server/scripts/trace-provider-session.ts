import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { WebSocket } from 'ws';
import type { ProviderConfig, RunStartMessage, ServerMessage, Session } from '@my-claudia/shared';

interface Args {
  api: string;
  token?: string;
  projectId: string;
  providerType?: string;
  providerId?: string;
  sessionId?: string;
  sessionName?: string;
  cwd?: string;
  prompt?: string;
  promptFile?: string;
  out: string;
  model?: string;
  mode?: string;
  timeoutMs: number;
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = { api: 'http://127.0.0.1:3001', timeoutMs: 120000 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2) as keyof Args;
    if (name === 'timeoutMs') {
      args.timeoutMs = Number(value);
    } else {
      (args as Record<string, unknown>)[name] = value;
    }
    i += 1;
  }
  if (!args.projectId) throw new Error('--projectId is required');
  if (!args.out) throw new Error('--out is required');
  if (!args.prompt && !args.promptFile) throw new Error('one of --prompt or --promptFile is required');
  return args as Args;
}

function buildHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchJson<T>(api: string, pathname: string, init: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${api}${pathname}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...buildHeaders(token),
      ...(init.headers || {}),
    },
  });
  const body = await response.json() as { success?: boolean; data?: T; error?: { message?: string } };
  if (!response.ok || body.success === false || body.data === undefined) {
    throw new Error(body.error?.message || `HTTP ${response.status}`);
  }
  return body.data;
}

async function resolveProviderId(api: string, providerType: string, token?: string): Promise<string> {
  const providers = await fetchJson<ProviderConfig[]>(api, '/api/providers', { method: 'GET' }, token);
  const match = providers.find((provider) => provider.type === providerType);
  if (!match) throw new Error(`No provider found for type "${providerType}"`);
  return match.id;
}

async function ensureSession(args: Args, providerId: string | undefined): Promise<Session> {
  if (args.sessionId) {
    return fetchJson<Session>(args.api, `/api/sessions/${args.sessionId}`, { method: 'GET' }, args.token);
  }
  return fetchJson<Session>(args.api, '/api/sessions', {
    method: 'POST',
    body: JSON.stringify({
      projectId: args.projectId,
      providerId,
      name: args.sessionName || `trace-${args.providerType || providerId || 'provider'}`,
      workingDirectory: args.cwd,
    }),
  }, args.token);
}

function toWsUrl(api: string): string {
  return api.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';
}

function writeJsonl(outPath: string, records: unknown[]): void {
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
}

function summarize(messages: ServerMessage[]) {
  const counts = new Map<string, number>();
  const toolUses = new Set<string>();
  const toolResults = new Set<string>();
  let runId: string | undefined;
  let sessionId: string | undefined;
  for (const message of messages) {
    counts.set(message.type, (counts.get(message.type) || 0) + 1);
    if ('runId' in message && typeof message.runId === 'string') runId = message.runId;
    if ('sessionId' in message && typeof message.sessionId === 'string') sessionId = message.sessionId;
    if (message.type === 'tool_use') toolUses.add(message.toolUseId);
    if (message.type === 'tool_result') toolResults.add(message.toolUseId);
  }
  return {
    runId,
    sessionId,
    totalMessages: messages.length,
    counts: Object.fromEntries(counts.entries()),
    toolUseCount: toolUses.size,
    toolResultCount: toolResults.size,
    unmatchedToolUses: [...toolUses].filter((id) => !toolResults.has(id)),
    hasSystemInfo: messages.some((message) => message.type === 'system_info'),
    terminalEvent: messages.findLast((message) => message.type === 'run_completed' || message.type === 'run_failed')?.type || null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const providerId = args.providerId || (args.providerType ? await resolveProviderId(args.api, args.providerType, args.token) : undefined);
  const session = await ensureSession(args, providerId);
  const prompt = args.promptFile ? readFileSync(args.promptFile, 'utf8') : args.prompt!;
  const wsUrl = toWsUrl(args.api);
  const events: Array<{ ts: number; message: ServerMessage }> = [];

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out after ${args.timeoutMs}ms`));
    }, args.timeoutMs);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth' }));
    });

    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as ServerMessage;
      events.push({ ts: Date.now(), message });
      if (message.type === 'auth_result') {
        const runStart: RunStartMessage = {
          type: 'run_start',
          clientRequestId: `trace_${Date.now()}`,
          sessionId: session.id,
          input: prompt,
          providerId,
          workingDirectory: args.cwd,
          ...(args.model ? { model: args.model } : {}),
          ...(args.mode ? { mode: args.mode } : {}),
        };
        ws.send(JSON.stringify(runStart));
      }
      if (message.type === 'run_completed' || message.type === 'run_failed') {
        clearTimeout(timeout);
        ws.close();
        resolve();
      }
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    ws.on('close', () => {
      clearTimeout(timeout);
    });
  });

  const wsTracePath = args.out.endsWith('.jsonl') ? args.out : `${args.out}.jsonl`;
  const summaryPath = wsTracePath.replace(/\.jsonl$/, '.summary.json');
  writeJsonl(wsTracePath, events.map((event, index) => ({
    seq: index + 1,
    ts: event.ts,
    isoTime: new Date(event.ts).toISOString(),
    layer: 'script_ws',
    event: event.message.type,
    message: event.message,
  })));
  writeFileSync(summaryPath, `${JSON.stringify({
    api: args.api,
    providerId,
    providerType: args.providerType,
    sessionId: session.id,
    cwd: args.cwd || session.workingDirectory || null,
    summary: summarize(events.map((event) => event.message)),
  }, null, 2)}\n`, 'utf8');

  console.log(`WS trace written to ${wsTracePath}`);
  console.log(`Summary written to ${summaryPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
