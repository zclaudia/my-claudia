import type { PermissionRequest } from '@my-claudia/shared/interaction/permissions';
import type { ClaudeMessage, PermissionCallback } from './types.js';
import { ACPJsonRpcClient } from './acp/json-rpc-client.js';
import {
  mapACPPromptResult,
  mapACPSessionUpdate,
} from './acp/message-mapper.js';
import type {
  ACPInitializeResult,
  ACPPermissionRequestParams,
  ACPPromptResult,
  ACPSessionNewResult,
  ACPSessionUpdateParams,
  JsonRpcNotification,
  JsonRpcRequest,
} from './acp/types.js';

interface ACPRunOptions {
  cwd: string;
  sessionId?: string;
  cliPath?: string;
  env?: Record<string, string>;
  clientFactory?: (options: { command: string; cwd: string; env?: Record<string, string> }) => ACPJsonRpcClient;
}

class AsyncMessageQueue {
  private readonly values: ClaudeMessage[] = [];
  private readonly waiters: Array<(value: IteratorResult<ClaudeMessage>) => void> = [];
  private closed = false;
  private error: Error | undefined;

  push(messages: ClaudeMessage | ClaudeMessage[]): void {
    const values = Array.isArray(messages) ? messages : [messages];
    for (const message of values) {
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter({ value: message, done: false });
      } else {
        this.values.push(message);
      }
    }
  }

  fail(error: Error): void {
    this.error = error;
    this.close();
  }

  close(): void {
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ value: undefined, done: true });
    }
  }

  async next(): Promise<IteratorResult<ClaudeMessage>> {
    if (this.values.length > 0) {
      return { value: this.values.shift()!, done: false };
    }
    if (this.error) throw this.error;
    if (this.closed) return { value: undefined, done: true };
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

const activeClients = new Map<string, ACPJsonRpcClient>();

function permissionRequestFromACP(params: ACPPermissionRequestParams, requestId: string | number): PermissionRequest {
  const toolCall = params.toolCall ?? {};
  return {
    requestId: String(requestId),
    toolName: toolCall.title ?? toolCall.kind ?? 'ACP Tool',
    toolInput: toolCall.rawInput ?? {},
    detail: toolCall.title ?? toolCall.kind ?? 'ACP permission request',
    timeoutSeconds: 0,
  };
}

function optionIdForDecision(params: ACPPermissionRequestParams, allow: boolean): string {
  const options = params.options ?? [];
  const preferredKinds = allow
    ? ['allow_once', 'allow_always']
    : ['reject_once', 'reject_always'];
  return options.find(option => preferredKinds.includes(option.kind ?? ''))?.optionId
    ?? options[allow ? 0 : options.length - 1]?.optionId
    ?? (allow ? 'allow-once' : 'reject-once');
}

export async function abortACPSession(sessionId: string): Promise<void> {
  const client = activeClients.get(sessionId);
  if (!client) return;
  client.notify('session/cancel', { sessionId });
  client.close();
  activeClients.delete(sessionId);
}

export async function* runACP(
  input: string,
  options: ACPRunOptions,
  onPermission: PermissionCallback,
): AsyncGenerator<ClaudeMessage, void, void> {
  if (!options.cliPath) {
    yield { type: 'error', error: 'ACP provider requires cliPath' };
    return;
  }

  const client = options.clientFactory?.({
    command: options.cliPath,
    cwd: options.cwd,
    env: options.env,
  }) ?? new ACPJsonRpcClient({
    command: options.cliPath,
    cwd: options.cwd,
    env: options.env,
  });

  const queue = new AsyncMessageQueue();
  let acpSessionId: string | undefined;

  client.on('notification', (message: JsonRpcNotification<ACPSessionUpdateParams>) => {
    if (message.method === 'session/update') {
      queue.push(mapACPSessionUpdate(message.params ?? {}));
    }
  });

  client.on('request', (message: JsonRpcRequest<ACPPermissionRequestParams>) => {
    if (message.method !== 'session/request_permission') {
      client.respondError(message.id, -32601, `Unsupported ACP client method: ${message.method}`);
      return;
    }

    void onPermission(permissionRequestFromACP(message.params ?? {}, message.id))
      .then((decision) => {
        const allow = decision.behavior === 'allow';
        client.respond(message.id, {
          outcome: {
            outcome: 'selected',
            optionId: optionIdForDecision(message.params ?? {}, allow),
          },
        });
      })
      .catch((error) => {
        client.respondError(message.id, -32000, error instanceof Error ? error.message : String(error));
      });
  });

  client.on('protocolError', (error) => queue.fail(error instanceof Error ? error : new Error(String(error))));
  client.on('exit', () => queue.close());

  try {
    const initialized = await client.request<ACPInitializeResult>('initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
    });

    if (options.sessionId && initialized.agentCapabilities?.sessionCapabilities?.resume) {
      await client.request('session/resume', {
        sessionId: options.sessionId,
        cwd: options.cwd,
        mcpServers: [],
      });
      acpSessionId = options.sessionId;
    } else if (options.sessionId && initialized.agentCapabilities?.loadSession) {
      await client.request('session/load', {
        sessionId: options.sessionId,
        cwd: options.cwd,
        mcpServers: [],
      });
      acpSessionId = options.sessionId;
    } else {
      const created = await client.request<ACPSessionNewResult>('session/new', {
        cwd: options.cwd,
        mcpServers: [],
      });
      acpSessionId = created.sessionId;
    }

    activeClients.set(acpSessionId, client);
    queue.push({ type: 'init', sessionId: acpSessionId });

    const prompt = client.request<ACPPromptResult>('session/prompt', {
      sessionId: acpSessionId,
      prompt: [{ type: 'text', text: input }],
    }).then((result) => {
      queue.push(mapACPPromptResult(result));
      queue.close();
    }).catch((error) => {
      queue.push({ type: 'error', error: error instanceof Error ? error.message : String(error) });
      queue.close();
    });

    while (true) {
      const next = await queue.next();
      if (next.done) break;
      yield next.value;
    }

    await prompt;
  } finally {
    if (acpSessionId) activeClients.delete(acpSessionId);
    client.close();
  }
}
