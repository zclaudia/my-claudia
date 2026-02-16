import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runClaude, createClaudeAdapter, type ClaudeMessage } from '../claude-sdk.js';

// Mock the claude-agent-sdk
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';

describe('claude-sdk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runClaude', () => {
    it('yields init message with session ID on start', async () => {
      vi.mocked(query).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'system',
            subtype: 'init',
            session_id: 'test-session-123',
            model: 'claude-3-sonnet',
            cwd: '/project',
            tools: ['Read', 'Write', 'Bash'],
          };
        }
      } as unknown as ReturnType<typeof query>);

      const generator = runClaude('Hello', { cwd: '/project' });
      const messages: ClaudeMessage[] = [];

      for await (const msg of generator) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('init');
      expect(messages[0].sessionId).toBe('test-session-123');
      expect(messages[0].systemInfo?.model).toBe('claude-3-sonnet');
      expect(messages[0].systemInfo?.tools).toEqual(['Read', 'Write', 'Bash']);
    });

    it('yields assistant message with text content', async () => {
      vi.mocked(query).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Hello, how can I help?' }]
            }
          };
        }
      } as unknown as ReturnType<typeof query>);

      const generator = runClaude('Hello', { cwd: '/project' });
      const messages: ClaudeMessage[] = [];

      for await (const msg of generator) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('assistant');
      expect(messages[0].content).toBe('Hello, how can I help?');
    });

    it('yields tool_use messages for tool calls', async () => {
      vi.mocked(query).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{
                type: 'tool_use',
                id: 'tool-123',
                name: 'Read',
                input: { path: '/project/file.ts' }
              }]
            }
          };
        }
      } as unknown as ReturnType<typeof query>);

      const generator = runClaude('Read file.ts', { cwd: '/project' });
      const messages: ClaudeMessage[] = [];

      for await (const msg of generator) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('tool_use');
      expect(messages[0].toolUseId).toBe('tool-123');
      expect(messages[0].toolName).toBe('Read');
      expect(messages[0].toolInput).toEqual({ path: '/project/file.ts' });
    });

    it('yields tool_result messages', async () => {
      vi.mocked(query).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'user',
            message: {
              content: [{
                type: 'tool_result',
                tool_use_id: 'tool-123',
                content: 'File content here',
                is_error: false
              }]
            }
          };
        }
      } as unknown as ReturnType<typeof query>);

      const generator = runClaude('Read file.ts', { cwd: '/project' });
      const messages: ClaudeMessage[] = [];

      for await (const msg of generator) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('tool_result');
      expect(messages[0].toolUseId).toBe('tool-123');
      expect(messages[0].toolResult).toBe('File content here');
      expect(messages[0].isToolError).toBe(false);
    });

    it('yields result message on completion', async () => {
      vi.mocked(query).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            result: 'Task completed successfully',
            usage: { input_tokens: 100, output_tokens: 50 }
          };
        }
      } as unknown as ReturnType<typeof query>);

      const generator = runClaude('Do something', { cwd: '/project' });
      const messages: ClaudeMessage[] = [];

      for await (const msg of generator) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('result');
      expect(messages[0].isComplete).toBe(true);
      expect(messages[0].content).toBe('Task completed successfully');
      expect(messages[0].usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    });

    it('calls permission callback for non-whitelisted tools', async () => {
      const permissionCallback = vi.fn().mockResolvedValue({
        behavior: 'allow',
        updatedInput: { command: 'ls' }
      });

      let capturedCanUseTool: ((name: string, input: unknown, ctx: unknown) => Promise<unknown>) | null = null;

      vi.mocked(query).mockImplementation(({ options }) => {
        capturedCanUseTool = options?.canUseTool as typeof capturedCanUseTool;
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'result', usage: { input_tokens: 10, output_tokens: 5 } };
          }
        } as unknown as ReturnType<typeof query>;
      });

      const generator = runClaude('Run ls', { cwd: '/project' }, permissionCallback);
      for await (const _ of generator) { /* consume */ }

      // Simulate SDK calling canUseTool
      expect(capturedCanUseTool).toBeDefined();
      if (capturedCanUseTool) {
        const result = await capturedCanUseTool('Bash', { command: 'ls' }, {});
        expect(result).toEqual({
          behavior: 'allow',
          updatedInput: { command: 'ls' },
          message: undefined
        });
      }
    });

    it('automatically allows whitelisted tools', async () => {
      let capturedCanUseTool: ((name: string, input: unknown, ctx: unknown) => Promise<unknown>) | null = null;

      vi.mocked(query).mockImplementation(({ options }) => {
        capturedCanUseTool = options?.canUseTool as typeof capturedCanUseTool;
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'result' };
          }
        } as unknown as ReturnType<typeof query>;
      });

      const permissionCallback = vi.fn();
      const generator = runClaude(
        'Read file',
        { cwd: '/project', allowedTools: ['Read', 'Glob'] },
        permissionCallback
      );
      for await (const _ of generator) { /* consume */ }

      if (capturedCanUseTool) {
        const result = await capturedCanUseTool('Read', { path: '/file.ts' }, {});
        expect(result).toEqual({
          behavior: 'allow',
          updatedInput: { path: '/file.ts' }
        });
        // Permission callback should NOT be called for whitelisted tools
        expect(permissionCallback).not.toHaveBeenCalled();
      }
    });

    it('automatically denies blacklisted tools', async () => {
      let capturedCanUseTool: ((name: string, input: unknown, ctx: unknown) => Promise<unknown>) | null = null;

      vi.mocked(query).mockImplementation(({ options }) => {
        capturedCanUseTool = options?.canUseTool as typeof capturedCanUseTool;
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'result' };
          }
        } as unknown as ReturnType<typeof query>;
      });

      const permissionCallback = vi.fn();
      const generator = runClaude(
        'Run bash',
        { cwd: '/project', disallowedTools: ['Bash', 'Write'] },
        permissionCallback
      );
      for await (const _ of generator) { /* consume */ }

      if (capturedCanUseTool) {
        const result = await capturedCanUseTool('Bash', { command: 'rm -rf /' }, {});
        expect(result).toEqual({
          behavior: 'deny',
          message: 'Tool is disallowed'
        });
        // Permission callback should NOT be called for blacklisted tools
        expect(permissionCallback).not.toHaveBeenCalled();
      }
    });

    it('passes through cwd, sessionId, cliPath, env options', async () => {
      vi.mocked(query).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield { type: 'result' };
        }
      } as unknown as ReturnType<typeof query>);

      const generator = runClaude('Hello', {
        cwd: '/my-project',
        sessionId: 'resume-session-123',
        cliPath: '/custom/claude',
        env: { API_KEY: 'secret' },
      });
      for await (const _ of generator) { /* consume */ }

      expect(query).toHaveBeenCalledWith({
        prompt: 'Hello',
        options: expect.objectContaining({
          cwd: '/my-project',
          resume: 'resume-session-123',
          pathToClaudeCodeExecutable: '/custom/claude',
          env: expect.objectContaining({ API_KEY: 'secret' }),
        })
      });
    });

    it('handles mixed content blocks in assistant message', async () => {
      vi.mocked(query).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'Let me read the file' },
                { type: 'tool_use', id: 'tool-1', name: 'Read', input: { path: '/file.ts' } }
              ]
            }
          };
        }
      } as unknown as ReturnType<typeof query>);

      const generator = runClaude('Read file', { cwd: '/project' });
      const messages: ClaudeMessage[] = [];

      for await (const msg of generator) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(2);
      expect(messages[0].type).toBe('assistant');
      expect(messages[0].content).toBe('Let me read the file');
      expect(messages[1].type).toBe('tool_use');
      expect(messages[1].toolName).toBe('Read');
    });

    it('handles empty content blocks gracefully', async () => {
      vi.mocked(query).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: { content: [] }
          };
        }
      } as unknown as ReturnType<typeof query>);

      const generator = runClaude('Hello', { cwd: '/project' });
      const messages: ClaudeMessage[] = [];

      for await (const msg of generator) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('assistant');
      expect(messages[0].content).toBe('');
    });
  });

  describe('createClaudeAdapter', () => {
    it('creates adapter with provider config', async () => {
      vi.mocked(query).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield { type: 'result' };
        }
      } as unknown as ReturnType<typeof query>);

      const adapter = createClaudeAdapter({
        id: 'provider-1',
        name: 'My Provider',
        type: 'claude',
        cliPath: '/custom/claude-cli',
        env: { ANTHROPIC_API_KEY: 'test-key' },
        isDefault: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const generator = adapter.run('Hello', '/project');
      for await (const _ of generator) { /* consume */ }

      expect(query).toHaveBeenCalledWith({
        prompt: 'Hello',
        options: expect.objectContaining({
          cwd: '/project',
          pathToClaudeCodeExecutable: '/custom/claude-cli',
          env: expect.objectContaining({ ANTHROPIC_API_KEY: 'test-key' }),
        })
      });
    });

    it('passes sessionId for resume', async () => {
      vi.mocked(query).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield { type: 'result' };
        }
      } as unknown as ReturnType<typeof query>);

      const adapter = createClaudeAdapter({
        id: 'provider-1',
        name: 'My Provider',
        type: 'claude',
        isDefault: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const generator = adapter.run('Hello', '/project', 'session-to-resume');
      for await (const _ of generator) { /* consume */ }

      expect(query).toHaveBeenCalledWith({
        prompt: 'Hello',
        options: expect.objectContaining({
          cwd: '/project',
          resume: 'session-to-resume',
        })
      });
    });
  });
});
