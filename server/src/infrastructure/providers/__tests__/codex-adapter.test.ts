import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodexAdapter } from '../codex-adapter.js';
import type { ClaudeMessage, PermissionDecision } from '../claude-sdk.js';

// Mock the codex-sdk module
vi.mock('../codex-sdk.js', () => ({
  runCodex: vi.fn(),
  abortCodexSession: vi.fn(),
}));

import { runCodex, abortCodexSession } from '../codex-sdk.js';

describe('CodexAdapter', () => {
  let adapter: CodexAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new CodexAdapter();
  });

  describe('type', () => {
    it('returns "codex"', () => {
      expect(adapter.type).toBe('codex');
    });
  });

  describe('run', () => {
    it('delegates to runCodex with correct options', async () => {
      const mockMessages: ClaudeMessage[] = [
        { type: 'init', sessionId: 'test-session' },
        { type: 'result', isComplete: true },
      ];

      vi.mocked(runCodex).mockImplementation(async function* () {
        for (const msg of mockMessages) {
          yield msg;
        }
      });

      const permissionCallback = vi.fn<[], Promise<PermissionDecision>>().mockResolvedValue({
        behavior: 'allow',
      });

      const options = {
        cwd: '/project',
        sessionId: 'resume-session-123',
        cliPath: '/custom/codex',
        env: { OPENAI_API_KEY: 'secret' },
        mode: 'full-auto',
        model: 'o4-mini',
        systemPrompt: 'Custom system prompt',
      };

      const messages: ClaudeMessage[] = [];
      for await (const msg of adapter.run('Hello', options, permissionCallback)) {
        messages.push(msg);
      }

      expect(runCodex).toHaveBeenCalledWith('Hello', {
        cwd: '/project',
        sessionId: 'resume-session-123',
        cliPath: '/custom/codex',
        env: { OPENAI_API_KEY: 'secret' },
        mode: 'full-auto',
        model: 'o4-mini',
        systemPrompt: 'Custom system prompt',
      }, permissionCallback);

      expect(messages).toHaveLength(2);
    });

    it('passes permission callback through to runCodex', async () => {
      const permissionCallback = vi.fn<[], Promise<PermissionDecision>>().mockResolvedValue({
        behavior: 'allow',
      });

      vi.mocked(runCodex).mockImplementation(async function* () {
        yield { type: 'result', isComplete: true };
      });

      for await (const _ of adapter.run('Hello', { cwd: '/project' }, permissionCallback)) {
        // consume
      }

      expect(runCodex).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        permissionCallback
      );
    });

    it('yields all message types from runCodex', async () => {
      const mockMessages: ClaudeMessage[] = [
        { type: 'init', sessionId: 'session-1' },
        { type: 'assistant', content: 'Hello!' },
        { type: 'tool_use', toolUseId: 'tool-1', toolName: 'Write', toolInput: { path: '/file.ts' } },
        { type: 'tool_result', toolUseId: 'tool-1', toolResult: 'written', isToolError: false },
        { type: 'result', isComplete: true },
      ];

      vi.mocked(runCodex).mockImplementation(async function* () {
        for (const msg of mockMessages) {
          yield msg;
        }
      });

      const permissionCallback = vi.fn<[], Promise<PermissionDecision>>().mockResolvedValue({
        behavior: 'allow',
      });

      const messages: ClaudeMessage[] = [];
      for await (const msg of adapter.run('Test', { cwd: '/project' }, permissionCallback)) {
        messages.push(msg);
      }

      expect(messages).toEqual(mockMessages);
    });
  });

  describe('abort', () => {
    it('calls abortCodexSession with session ID', async () => {
      vi.mocked(abortCodexSession).mockResolvedValue(undefined);

      await adapter.abort('session-to-abort');

      expect(abortCodexSession).toHaveBeenCalledWith('session-to-abort');
    });

    it('propagates abort errors', async () => {
      const error = new Error('Abort failed');
      vi.mocked(abortCodexSession).mockRejectedValue(error);

      await expect(adapter.abort('session-to-abort')).rejects.toThrow('Abort failed');
    });
  });
});
