import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { runACP } from '../acp-sdk.js';
import type { JsonRpcNotification, JsonRpcRequest } from '../acp/types.js';

class FakeACPClient extends EventEmitter {
  requests: Array<{ method: string; params: unknown }> = [];
  responses: Array<{ id: string | number; result: unknown }> = [];
  errors: Array<{ id: string | number; code: number; message: string }> = [];
  closed = false;

  async request(method: string, params?: unknown): Promise<unknown> {
    this.requests.push({ method, params });

    if (method === 'initialize') {
      return {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: { resume: {} },
        },
      };
    }

    if (method === 'session/new') {
      return { sessionId: 'new-acp-session' };
    }

    if (method === 'session/resume' || method === 'session/load') {
      return {};
    }

    if (method === 'session/prompt') {
      this.emit('notification', {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'new-acp-session',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Hello' },
          },
        },
      } satisfies JsonRpcNotification);

      this.emit('request', {
        jsonrpc: '2.0',
        id: 99,
        method: 'session/request_permission',
        params: {
          sessionId: 'new-acp-session',
          toolCall: {
            toolCallId: 'tool-1',
            title: 'Run command',
            kind: 'execute',
            rawInput: { command: 'pnpm test' },
          },
          options: [
            { optionId: 'allow-once', kind: 'allow_once' },
            { optionId: 'reject-once', kind: 'reject_once' },
          ],
        },
      } satisfies JsonRpcRequest);

      return { stopReason: 'end_turn' };
    }

    throw new Error(`Unexpected request ${method}`);
  }

  notify(): void {
    // no-op
  }

  respond(id: string | number, result: unknown): void {
    this.responses.push({ id, result });
  }

  respondError(id: string | number, code: number, message: string): void {
    this.errors.push({ id, code, message });
  }

  close(): void {
    this.closed = true;
  }
}

describe('runACP', () => {
  it('returns a clear error when cliPath is missing', async () => {
    const messages = [];

    for await (const message of runACP('Hello', { cwd: '/project' }, vi.fn())) {
      messages.push(message);
    }

    expect(messages).toEqual([{ type: 'error', error: 'ACP provider requires cliPath' }]);
  });

  it('initializes, prompts, streams updates, and bridges permission requests', async () => {
    const fake = new FakeACPClient();
    const onPermission = vi.fn().mockResolvedValue({ behavior: 'allow' });
    const messages = [];

    for await (const message of runACP('Hello', {
      cwd: '/project',
      cliPath: '/bin/acp-agent',
      clientFactory: () => fake as never,
    }, onPermission)) {
      messages.push(message);
    }

    expect(fake.requests.map(request => request.method)).toEqual([
      'initialize',
      'session/new',
      'session/prompt',
    ]);
    expect(messages).toEqual([
      { type: 'init', sessionId: 'new-acp-session' },
      { type: 'assistant', content: 'Hello' },
      { type: 'result', content: 'end_turn', isComplete: true },
    ]);
    expect(onPermission).toHaveBeenCalledWith(expect.objectContaining({
      requestId: '99',
      toolName: 'Run command',
      toolInput: { command: 'pnpm test' },
    }));
    expect(fake.responses).toEqual([{
      id: 99,
      result: {
        outcome: {
          outcome: 'selected',
          optionId: 'allow-once',
        },
      },
    }]);
    expect(fake.closed).toBe(true);
  });

  it('uses session/resume when the ACP agent supports it', async () => {
    const fake = new FakeACPClient();

    for await (const _ of runACP('Hello', {
      cwd: '/project',
      sessionId: 'existing-session',
      cliPath: '/bin/acp-agent',
      clientFactory: () => fake as never,
    }, vi.fn().mockResolvedValue({ behavior: 'allow' }))) {
      // consume
    }

    expect(fake.requests.find(request => request.method === 'session/resume')?.params).toEqual({
      sessionId: 'existing-session',
      cwd: '/project',
      mcpServers: [],
    });
    expect(fake.requests.some(request => request.method === 'session/new')).toBe(false);
  });
});
