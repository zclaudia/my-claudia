import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CursorAdapter } from '../cursor-adapter.js';
import type { ClaudeMessage, PermissionDecision } from '../claude-sdk.js';

// Mock the cursor-sdk module
vi.mock('../cursor-sdk.js', () => ({
  runCursor: vi.fn(),
  abortCursorSession: vi.fn(),
}));

import { runCursor, abortCursorSession } from '../cursor-sdk.js';

describe('CursorAdapter', () => {
  let adapter: CursorAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new CursorAdapter();
  });

  describe('type', () => {
    it('returns "cursor"', () => {
      expect(adapter.type).toBe('cursor');
    });
  });

  describe('run', () => {
    it('delegates to runCursor with correct options', async () => {
      const mockMessages: ClaudeMessage[] = [
        { type: 'init', sessionId: 'test-session' },
        { type: 'result', isComplete: true },
      ];

      vi.mocked(runCursor).mockImplementation(async function* () {
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
        cliPath: '/custom/cursor',
        env: { CURSOR_API_KEY: 'secret' },
        mode: 'agent',
        model: 'claude-3.5-sonnet',
        systemPrompt: 'Custom system prompt',
      };

      const messages: ClaudeMessage[] = [];
      for await (const msg of adapter.run('Hello', options, permissionCallback)) {
        messages.push(msg);
      }

      expect(runCursor).toHaveBeenCalledWith('Hello', {
        cwd: '/project',
        sessionId: 'resume-session-123',
        cliPath: '/custom/cursor',
        env: { CURSOR_API_KEY: 'secret' },
        mode: 'agent',
        model: 'claude-3.5-sonnet',
        systemPrompt: 'Custom system prompt',
      }, permissionCallback);

      expect(messages).toHaveLength(2);
    });

    it('passes permission callback through to runCursor', async () => {
      const permissionCallback = vi.fn<[], Promise<PermissionDecision>>().mockResolvedValue({
        behavior: 'allow',
      });

      vi.mocked(runCursor).mockImplementation(async function* () {
        yield { type: 'result', isComplete: true };
      });

      for await (const _ of adapter.run('Hello', { cwd: '/project' }, permissionCallback)) {
        // consume
      }

      expect(runCursor).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        permissionCallback
      );
    });

    it('yields all message types from runCursor', async () => {
      const mockMessages: ClaudeMessage[] = [
        { type: 'init', sessionId: 'session-1' },
        { type: 'assistant', content: 'Hello!' },
        { type: 'tool_use', toolUseId: 'tool-1', toolName: 'Edit', toolInput: { path: '/file.ts' } },
        { type: 'tool_result', toolUseId: 'tool-1', toolResult: 'edited', isToolError: false },
        { type: 'result', isComplete: true },
      ];

      vi.mocked(runCursor).mockImplementation(async function* () {
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
    it('calls abortCursorSession with session ID', async () => {
      vi.mocked(abortCursorSession).mockResolvedValue(undefined);

      await adapter.abort('session-to-abort');

      expect(abortCursorSession).toHaveBeenCalledWith('session-to-abort');
    });

    it('propagates abort errors', async () => {
      const error = new Error('Abort failed');
      vi.mocked(abortCursorSession).mockRejectedValue(error);

      await expect(adapter.abort('session-to-abort')).rejects.toThrow('Abort failed');
    });
  });
});
