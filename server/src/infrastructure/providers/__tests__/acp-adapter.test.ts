import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACPProviderAdapter } from '../acp-adapter.js';
import type { ClaudeMessage, PermissionDecision } from '../types.js';

vi.mock('../acp-sdk.js', () => ({
  runACP: vi.fn(),
  abortACPSession: vi.fn(),
}));

import { abortACPSession, runACP } from '../acp-sdk.js';

describe('ACPProviderAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes ACP provider metadata', () => {
    const adapter = new ACPProviderAdapter();

    expect(adapter.type).toBe('acp');
    expect(adapter.manifest.providerType).toBe('acp');
    expect(adapter.policy).toEqual({});
    expect(adapter.normalizer?.normalizeToolUse).toBeTypeOf('function');
  });

  it('delegates runs to runACP', async () => {
    const adapter = new ACPProviderAdapter();
    const messages: ClaudeMessage[] = [
      { type: 'init', sessionId: 'acp-session' },
      { type: 'result', isComplete: true },
    ];
    vi.mocked(runACP).mockImplementation(async function* () {
      yield* messages;
    });
    const onPermission = vi.fn<[], Promise<PermissionDecision>>().mockResolvedValue({ behavior: 'allow' });

    const received: ClaudeMessage[] = [];
    for await (const message of adapter.run('Hello', {
      cwd: '/project',
      sessionId: 'resume-session',
      cliPath: '/usr/local/bin/acp-agent',
      env: { ACP_ENV: '1' },
    }, onPermission)) {
      received.push(message);
    }

    expect(runACP).toHaveBeenCalledWith('Hello', {
      cwd: '/project',
      sessionId: 'resume-session',
      cliPath: '/usr/local/bin/acp-agent',
      env: { ACP_ENV: '1' },
    }, onPermission);
    expect(received).toEqual(messages);
  });

  it('delegates abort to abortACPSession', async () => {
    const adapter = new ACPProviderAdapter();
    vi.mocked(abortACPSession).mockResolvedValue(undefined);

    await adapter.abort('acp-session');

    expect(abortACPSession).toHaveBeenCalledWith('acp-session');
  });
});
