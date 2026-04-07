import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KimiAdapter } from '../kimi-adapter.js';

// Mock kimi-sdk
vi.mock('../kimi-sdk.js', () => ({
  runKimi: vi.fn(async function* () {
    yield { type: 'result', isComplete: true };
  }),
  abortKimiSession: vi.fn().mockResolvedValue(undefined),
}));

import { runKimi, abortKimiSession } from '../kimi-sdk.js';

describe('KimiAdapter', () => {
  let adapter: KimiAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new KimiAdapter();
  });

  it('has type "kimi"', () => {
    expect(adapter.type).toBe('kimi');
  });

  describe('run', () => {
    it('delegates to runKimi with mapped options', async () => {
      const onPermission = vi.fn();
      const gen = adapter.run('Hello', {
        cwd: '/project',
        sessionId: 'session-1',
        cliPath: '/usr/bin/kimi',
        env: { KEY: 'val' },
        model: 'moonshot-v1',
        mode: 'default',
        systemPrompt: 'Be helpful',
      }, onPermission);

      for await (const _ of gen) { /* consume */ }

      expect(runKimi).toHaveBeenCalledWith('Hello', {
        cwd: '/project',
        sessionId: 'session-1',
        cliPath: '/usr/bin/kimi',
        env: { KEY: 'val' },
        model: 'moonshot-v1',
        mode: 'default',
        systemPrompt: 'Be helpful',
        thinking: false,
      }, onPermission);
    });

    it('sets thinking=true when model includes "thinking"', async () => {
      const gen = adapter.run('Hello', {
        cwd: '/project',
        model: 'moonshot-thinking-v1',
      }, vi.fn());

      for await (const _ of gen) { /* consume */ }

      expect(runKimi).toHaveBeenCalledWith('Hello', expect.objectContaining({
        thinking: true,
      }), expect.any(Function));
    });

    it('sets thinking=false when model does not include "thinking"', async () => {
      const gen = adapter.run('Hello', {
        cwd: '/project',
        model: 'moonshot-v1',
      }, vi.fn());

      for await (const _ of gen) { /* consume */ }

      expect(runKimi).toHaveBeenCalledWith('Hello', expect.objectContaining({
        thinking: false,
      }), expect.any(Function));
    });

    it('is an async generator', () => {
      const gen = adapter.run('Hello', { cwd: '/project' }, vi.fn());
      expect(gen[Symbol.asyncIterator]).toBeDefined();
    });
  });

  describe('abort', () => {
    it('delegates to abortKimiSession', async () => {
      await adapter.abort('session-1');
      expect(abortKimiSession).toHaveBeenCalledWith('session-1');
    });
  });

  describe('getRunState', () => {
    it('returns provider state object', () => {
      const state = adapter.getRunState({ cwd: '/my-project' });
      expect(state).toEqual({
        providerCwd: '/my-project',
        providerType: 'kimi',
      });
    });
  });
});
