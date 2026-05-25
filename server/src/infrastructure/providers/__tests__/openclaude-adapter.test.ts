import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenClaudeAdapter } from '../openclaude-adapter.js';
import type { ClaudeMessage, PermissionDecision } from '../claude-sdk.js';

vi.mock('../claude-sdk.js', () => ({
  runClaude: vi.fn(),
}));

import { runClaude } from '../claude-sdk.js';

describe('OpenClaudeAdapter', () => {
  let adapter: OpenClaudeAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenClaudeAdapter();
  });

  it('registers as openclaude with an openclaude manifest', () => {
    expect(adapter.type).toBe('openclaude');
    expect(adapter.manifest.providerType).toBe('openclaude');
  });

  it('runs through the OpenClaude binary with OpenAI-compatible env defaults', async () => {
    const mockMessages: ClaudeMessage[] = [{ type: 'result', isComplete: true }];
    vi.mocked(runClaude).mockImplementation(async function* () {
      for (const msg of mockMessages) yield msg;
    });
    const permissionCallback = vi.fn<[], Promise<PermissionDecision>>().mockResolvedValue({ behavior: 'allow' });

    const messages: ClaudeMessage[] = [];
    for await (const msg of adapter.run('Hello', {
      cwd: '/project',
      env: { OPENAI_API_KEY: 'secret' },
      mode: 'plan',
      model: 'gpt-4o',
    }, permissionCallback)) {
      messages.push(msg);
    }

    expect(runClaude).toHaveBeenCalledWith('Hello', expect.objectContaining({
      cwd: '/project',
      cliPath: 'openclaude',
      env: {
        OPENAI_API_KEY: 'secret',
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_MODEL: 'gpt-4o',
      },
      permissionMode: 'plan',
      model: undefined,
      mcpProviderType: 'openclaude',
      abortController: expect.any(AbortController),
      queryHandle: expect.any(Object),
    }), permissionCallback);
    expect(messages).toEqual(mockMessages);
  });

  it('aborts and stops tasks after SDK assigns a session id', async () => {
    const stopTask = vi.fn().mockResolvedValue(undefined);
    vi.mocked(runClaude).mockImplementation(async function* (_input, options) {
      options.queryHandle!.stopTask = stopTask;
      options.onSessionId?.('openclaude-sdk-session');
      yield { type: 'init', sessionId: 'openclaude-sdk-session' };
      yield { type: 'result', isComplete: true };
    });
    const permissionCallback = vi.fn<[], Promise<PermissionDecision>>().mockResolvedValue({ behavior: 'allow' });

    for await (const _ of adapter.run('Hello', { cwd: '/project' }, permissionCallback)) {
      // consume
    }

    await adapter.stopTask?.('openclaude-sdk-session', 'task-1');
    await adapter.abort?.('openclaude-sdk-session', '/project');

    expect(stopTask).toHaveBeenCalledWith('task-1');
  });
});
