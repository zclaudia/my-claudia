import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeAdapter } from '../claude-adapter.js';
import type { ClaudeMessage, PermissionDecision } from '../claude-sdk.js';

// Mock the claude-sdk module
vi.mock('../claude-sdk.js', () => ({
  runClaude: vi.fn(),
}));

import { runClaude } from '../claude-sdk.js';

describe('ClaudeAdapter', () => {
  let adapter: ClaudeAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ClaudeAdapter();
  });

  describe('type', () => {
    it('returns "claude"', () => {
      expect(adapter.type).toBe('claude');
    });
  });

  describe('run', () => {
    it('delegates to runClaude with correct options', async () => {
      const mockMessages: ClaudeMessage[] = [
        { type: 'init', sessionId: 'test-session' },
        { type: 'result', isComplete: true },
      ];

      vi.mocked(runClaude).mockImplementation(async function* () {
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
        cliPath: '/custom/claude',
        env: { API_KEY: 'secret' },
        mode: 'auto',
        model: 'claude-3-sonnet',
        systemPrompt: 'Custom system prompt',
      };

      const messages: ClaudeMessage[] = [];
      for await (const msg of adapter.run('Hello', options, permissionCallback)) {
        messages.push(msg);
      }

      expect(runClaude).toHaveBeenCalledWith('Hello', {
        cwd: '/project',
        sessionId: 'resume-session-123',
        cliPath: '/custom/claude',
        env: { API_KEY: 'secret' },
        permissionMode: 'auto',
        model: 'claude-3-sonnet',
        systemPrompt: 'Custom system prompt',
      }, permissionCallback);

      expect(messages).toHaveLength(2);
      expect(messages[0].type).toBe('init');
      expect(messages[1].type).toBe('result');
    });

    it('uses "default" as fallback permission mode', async () => {
      vi.mocked(runClaude).mockImplementation(async function* () {
        yield { type: 'result', isComplete: true };
      });

      const permissionCallback = vi.fn<[], Promise<PermissionDecision>>().mockResolvedValue({
        behavior: 'allow',
      });

      const options = {
        cwd: '/project',
        // no mode specified
      };

      for await (const _ of adapter.run('Hello', options, permissionCallback)) {
        // consume
      }

      expect(runClaude).toHaveBeenCalledWith('Hello', expect.objectContaining({
        permissionMode: 'default',
      }), permissionCallback);
    });

    it('passes permission callback through to runClaude', async () => {
      const permissionCallback = vi.fn<[], Promise<PermissionDecision>>().mockResolvedValue({
        behavior: 'allow',
      });

      vi.mocked(runClaude).mockImplementation(async function* () {
        yield { type: 'result', isComplete: true };
      });

      for await (const _ of adapter.run('Hello', { cwd: '/project' }, permissionCallback)) {
        // consume
      }

      // Verify the callback was passed (not called directly, but passed through)
      expect(runClaude).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        permissionCallback
      );
    });

    it('yields all message types from runClaude', async () => {
      const mockMessages: ClaudeMessage[] = [
        { type: 'init', sessionId: 'session-1', systemInfo: { model: 'claude-3-sonnet' } },
        { type: 'assistant', content: 'Hello!' },
        { type: 'tool_use', toolUseId: 'tool-1', toolName: 'Read', toolInput: { path: '/file.ts' } },
        { type: 'tool_result', toolUseId: 'tool-1', toolResult: 'content', isToolError: false },
        { type: 'result', isComplete: true, content: 'Done', usage: { inputTokens: 100, outputTokens: 50 } },
      ];

      vi.mocked(runClaude).mockImplementation(async function* () {
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
});
