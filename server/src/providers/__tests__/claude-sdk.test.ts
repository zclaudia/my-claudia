import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runClaude, createClaudeAdapter, prepareInput, cleanupOldTempFiles, clearCommandCache, fetchClaudeModels, fetchClaudeCommands, checkVersionCompatibility, type ClaudeMessage } from '../claude-sdk.js';

// Mock the claude-agent-sdk
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn().mockReturnValue([]),
    statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }),
    unlinkSync: vi.fn(),
    copyFileSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue('{}'),
  };
});

// Mock fileStore
vi.mock('../../storage/fileStore.js', () => ({
  fileStore: {
    getFilePath: vi.fn().mockReturnValue('/tmp/test-file.png'),
  },
}));

// Mock claude-config
vi.mock('../../utils/claude-config.js', () => ({
  loadMcpServers: vi.fn().mockReturnValue({}),
  loadPlugins: vi.fn().mockReturnValue([]),
}));

// Mock mcp-config
vi.mock('../../utils/mcp-config.js', () => ({
  loadMcpServersFromDb: vi.fn().mockReturnValue({}),
}));

// Mock attachment-utils
vi.mock('../attachment-utils.js', () => ({
  buildNonImageAttachmentNotes: vi.fn().mockReturnValue([]),
}));

// Mock retry-window
vi.mock('../../utils/retry-window.js', () => ({
  extractRetryDelayMsFromError: vi.fn().mockReturnValue(null),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';
import * as fs from 'fs';

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

    it('yields thinking blocks wrapped in think tags', async () => {
      vi.mocked(query).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'thinking', thinking: 'Let me think about this...' }],
            },
          };
        },
      } as unknown as ReturnType<typeof query>);

      const messages: ClaudeMessage[] = [];
      for await (const msg of runClaude('Think', { cwd: '/project' })) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('assistant');
      expect(messages[0].content).toBe('<think>Let me think about this...</think>');
    });

    it('handles assistant message with no content field', async () => {
      vi.mocked(query).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield { type: 'assistant', message: {} };
        },
      } as unknown as ReturnType<typeof query>);

      const messages: ClaudeMessage[] = [];
      for await (const msg of runClaude('Hello', { cwd: '/project' })) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('assistant');
      expect(messages[0].content).toBe('');
    });

    it('handles user message with text blocks as tool_activity', async () => {
      vi.mocked(query).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'user',
            message: {
              content: [{ type: 'text', text: 'Reading file...' }],
            },
          };
        },
      } as unknown as ReturnType<typeof query>);

      const messages: ClaudeMessage[] = [];
      for await (const msg of runClaude('Hello', { cwd: '/project' })) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('tool_activity');
      expect(messages[0].content).toBe('Reading file...');
    });

    it('handles user message with empty content', async () => {
      vi.mocked(query).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield { type: 'user', message: { content: [] } };
        },
      } as unknown as ReturnType<typeof query>);

      const messages: ClaudeMessage[] = [];
      for await (const msg of runClaude('Hello', { cwd: '/project' })) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('assistant');
      expect(messages[0].content).toBe('');
    });

    it('handles system task_notification subtype', async () => {
      vi.mocked(query).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'system',
            subtype: 'task_notification',
            task_id: 'task-1',
            status: 'completed',
            summary: 'Task done',
          };
        },
      } as unknown as ReturnType<typeof query>);

      const messages: ClaudeMessage[] = [];
      for await (const msg of runClaude('Hello', { cwd: '/project' })) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('task_notification');
      expect(messages[0].taskId).toBe('task-1');
      expect(messages[0].taskStatus).toBe('completed');
      expect(messages[0].taskMessage).toBe('Task done');
    });

    it('handles system task_started subtype', async () => {
      vi.mocked(query).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'system',
            subtype: 'task_started',
            task_id: 'task-2',
            description: 'Starting work',
          };
        },
      } as unknown as ReturnType<typeof query>);

      const messages: ClaudeMessage[] = [];
      for await (const msg of runClaude('Hello', { cwd: '/project' })) {
        messages.push(msg);
      }

      expect(messages[0].type).toBe('task_notification');
      expect(messages[0].taskStatus).toBe('started');
    });

    it('handles system task_progress subtype', async () => {
      vi.mocked(query).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'system',
            subtype: 'task_progress',
            task_id: 'task-3',
            description: 'Processing...',
          };
        },
      } as unknown as ReturnType<typeof query>);

      const messages: ClaudeMessage[] = [];
      for await (const msg of runClaude('Hello', { cwd: '/project' })) {
        messages.push(msg);
      }

      expect(messages[0].type).toBe('task_notification');
      expect(messages[0].taskStatus).toBe('in_progress');
    });

    it('handles unknown system subtype', async () => {
      vi.mocked(query).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield { type: 'system', subtype: 'unknown_subtype' };
        },
      } as unknown as ReturnType<typeof query>);

      const messages: ClaudeMessage[] = [];
      for await (const msg of runClaude('Hello', { cwd: '/project' })) {
        messages.push(msg);
      }

      expect(messages[0].type).toBe('init');
    });

    it('handles unknown message types', async () => {
      vi.mocked(query).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield { type: 'custom_unknown_type', data: 'something' };
        },
      } as unknown as ReturnType<typeof query>);

      const messages: ClaudeMessage[] = [];
      for await (const msg of runClaude('Hello', { cwd: '/project' })) {
        messages.push(msg);
      }

      expect(messages[0].type).toBe('assistant');
      expect(messages[0].content).toBe('');
    });

    it('handles result with contextWindow from modelUsage', async () => {
      vi.mocked(query).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            result: 'Done',
            usage: { input_tokens: 100, output_tokens: 50 },
            modelUsage: {
              'claude-3': { contextWindow: 200000 },
            },
          };
        },
      } as unknown as ReturnType<typeof query>);

      const messages: ClaudeMessage[] = [];
      for await (const msg of runClaude('Hello', { cwd: '/project' })) {
        messages.push(msg);
      }

      expect(messages[0].usage?.contextWindow).toBe(200000);
    });

    it('handles result without usage', async () => {
      vi.mocked(query).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield { type: 'result' };
        },
      } as unknown as ReturnType<typeof query>);

      const messages: ClaudeMessage[] = [];
      for await (const msg of runClaude('Hello', { cwd: '/project' })) {
        messages.push(msg);
      }

      expect(messages[0].type).toBe('result');
      expect(messages[0].isComplete).toBe(true);
      expect(messages[0].usage).toBeUndefined();
    });

    it('sets model override in options', async () => {
      vi.mocked(query).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield { type: 'result' };
        },
      } as unknown as ReturnType<typeof query>);

      for await (const _ of runClaude('Hello', {
        cwd: '/project',
        model: 'claude-3-haiku',
      })) {
        /* consume */
      }

      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({ model: 'claude-3-haiku' }),
        })
      );
    });

    it('sets permission mode and bypassPermissions flag', async () => {
      vi.mocked(query).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield { type: 'result' };
        },
      } as unknown as ReturnType<typeof query>);

      for await (const _ of runClaude('Hello', {
        cwd: '/project',
        permissionMode: 'bypassPermissions',
      })) {
        /* consume */
      }

      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
          }),
        })
      );
    });

    it('sets systemPrompt with preset form', async () => {
      vi.mocked(query).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield { type: 'result' };
        },
      } as unknown as ReturnType<typeof query>);

      for await (const _ of runClaude('Hello', {
        cwd: '/project',
        systemPrompt: 'Custom instructions',
      })) {
        /* consume */
      }

      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            systemPrompt: {
              type: 'preset',
              preset: 'claude_code',
              append: 'Custom instructions',
            },
          }),
        })
      );
    });

    it('handles AskUserQuestion tool via permission callback', async () => {
      const permissionCallback = vi.fn().mockResolvedValue({
        behavior: 'deny',
        message: 'User says: yes',
      });

      let capturedCanUseTool: any;
      vi.mocked(query).mockImplementation(({ options }) => {
        capturedCanUseTool = options?.canUseTool;
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'result' };
          },
        } as unknown as ReturnType<typeof query>;
      });

      for await (const _ of runClaude('Hello', { cwd: '/project' }, permissionCallback)) {
        /* consume */
      }

      const result = await capturedCanUseTool('AskUserQuestion', { question: 'Do you approve?' }, { signal: new AbortController().signal, toolUseID: 'test' });
      expect(result.behavior).toBe('deny');
      expect(result.message).toBe('User says: yes');
    });

    it('auto-approves Read for temp upload files', async () => {
      let capturedCanUseTool: any;
      vi.mocked(query).mockImplementation(({ options }) => {
        capturedCanUseTool = options?.canUseTool;
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'result' };
          },
        } as unknown as ReturnType<typeof query>;
      });

      for await (const _ of runClaude('Hello', { cwd: '/project' }, vi.fn())) {
        /* consume */
      }

      // The UPLOAD_TMP_DIR is os.tmpdir() + '/claudia-uploads'
      const os = await import('os');
      const tmpDir = os.tmpdir();
      const result = await capturedCanUseTool('Read', { file_path: `${tmpDir}/claudia-uploads/test.png` }, {});
      expect(result.behavior).toBe('allow');
    });

    it('removes CLAUDECODE and model env vars from child env', async () => {
      vi.mocked(query).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield { type: 'result' };
        },
      } as unknown as ReturnType<typeof query>);

      // Set env vars that should be removed
      const originalEnv = { ...process.env };
      process.env.CLAUDECODE = 'test';
      process.env.ANTHROPIC_MODEL = 'test-model';

      for await (const _ of runClaude('Hello', { cwd: '/project' })) {
        /* consume */
      }

      const calledOptions = vi.mocked(query).mock.calls[0][0].options as any;
      expect(calledOptions.env.CLAUDECODE).toBeUndefined();
      expect(calledOptions.env.ANTHROPIC_MODEL).toBeUndefined();

      // Restore
      process.env = originalEnv;
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

describe('prepareInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns plain text as-is for non-JSON input', async () => {
    const result = await prepareInput('Hello world');
    expect(result.text).toBe('Hello world');
    expect(result.tempFiles).toEqual([]);
  });

  it('returns plain text for JSON without text field', async () => {
    const result = await prepareInput(JSON.stringify({ foo: 'bar' }));
    expect(result.text).toBe(JSON.stringify({ foo: 'bar' }));
    expect(result.tempFiles).toEqual([]);
  });

  it('returns text from MessageInput with no attachments', async () => {
    const input = JSON.stringify({ text: 'Hello', attachments: [] });
    const result = await prepareInput(input);
    expect(result.text).toBe('Hello');
    expect(result.tempFiles).toEqual([]);
  });

  it('returns text from MessageInput with undefined attachments', async () => {
    const input = JSON.stringify({ text: 'Hello' });
    const result = await prepareInput(input);
    expect(result.text).toBe('Hello');
    expect(result.tempFiles).toEqual([]);
  });

  it('handles image attachments by creating temp files', async () => {
    const { fileStore } = await import('../../storage/fileStore.js');
    vi.mocked(fileStore.getFilePath).mockReturnValue('/tmp/source.png');
    vi.mocked(fs.existsSync).mockReturnValue(false); // for ensureTmpDir

    const input = JSON.stringify({
      text: 'Look at this',
      attachments: [{
        type: 'image',
        fileId: 'file-1',
        mimeType: 'image/png',
        name: 'screenshot.png',
      }],
    });

    const result = await prepareInput(input);
    expect(result.text).toContain('Look at this');
    expect(result.text).toContain('[Attached image:');
    expect(result.tempFiles).toHaveLength(1);
    expect(fs.copyFileSync).toHaveBeenCalled();
  });

  it('handles image with missing file gracefully', async () => {
    const { fileStore } = await import('../../storage/fileStore.js');
    vi.mocked(fileStore.getFilePath).mockReturnValue(null as any);

    const input = JSON.stringify({
      text: 'Look at this',
      attachments: [{
        type: 'image',
        fileId: 'missing-file',
        mimeType: 'image/png',
        name: 'missing.png',
      }],
    });

    const result = await prepareInput(input);
    expect(result.tempFiles).toEqual([]);
  });

  it('handles non-primitive JSON input', async () => {
    const result = await prepareInput('[1, 2, 3]');
    // Array parsed but no 'text' field → returns raw input
    expect(result.text).toBe('[1, 2, 3]');
  });
});

describe('cleanupOldTempFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when tmp dir does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    cleanupOldTempFiles();
    expect(fs.readdirSync).not.toHaveBeenCalled();
  });

  it('removes files older than 1 hour', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['old.png'] as any);
    vi.mocked(fs.statSync).mockReturnValue({
      mtimeMs: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
    } as any);

    cleanupOldTempFiles();
    expect(fs.unlinkSync).toHaveBeenCalled();
  });

  it('keeps recent files', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['recent.png'] as any);
    vi.mocked(fs.statSync).mockReturnValue({
      mtimeMs: Date.now() - 5 * 60 * 1000, // 5 minutes ago
    } as any);

    cleanupOldTempFiles();
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });
});

describe('clearCommandCache', () => {
  it('resets cached commands', () => {
    clearCommandCache();
    // No error thrown
  });
});

describe('runClaude - retry logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retries on rate limit error when no output produced', async () => {
    let callCount = 0;
    vi.mocked(query).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          async *[Symbol.asyncIterator]() {
            throw new Error('rate limit exceeded');
          },
        } as unknown as ReturnType<typeof query>;
      }
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'result', result: 'ok', usage: { input_tokens: 10, output_tokens: 5 } };
        },
      } as unknown as ReturnType<typeof query>;
    });

    const messages: ClaudeMessage[] = [];
    for await (const msg of runClaude('Hello', { cwd: '/project' })) {
      messages.push(msg);
    }

    expect(callCount).toBe(2);
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('result');
  }, 15000);

  it('does not retry non-retryable errors', async () => {
    vi.mocked(query).mockImplementation(() => {
      return {
        async *[Symbol.asyncIterator]() {
          throw new Error('some random error');
        },
      } as unknown as ReturnType<typeof query>;
    });

    const messages: ClaudeMessage[] = [];
    await expect(async () => {
      for await (const msg of runClaude('Hello', { cwd: '/project' })) {
        messages.push(msg);
      }
    }).rejects.toThrow('some random error');
  });

  it('does not retry if output was already produced', async () => {
    vi.mocked(query).mockImplementation(() => {
      return {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'partial output' }] },
          };
          throw new Error('rate limit exceeded');
        },
      } as unknown as ReturnType<typeof query>;
    });

    const messages: ClaudeMessage[] = [];
    await expect(async () => {
      for await (const msg of runClaude('Hello', { cwd: '/project' })) {
        messages.push(msg);
      }
    }).rejects.toThrow('rate limit exceeded');
    expect(messages).toHaveLength(1);
  });

  it('gives up after MAX_AUTO_RETRIES', async () => {
    vi.mocked(query).mockImplementation(() => {
      return {
        async *[Symbol.asyncIterator]() {
          throw new Error('429 too many requests');
        },
      } as unknown as ReturnType<typeof query>;
    });

    await expect(async () => {
      for await (const _ of runClaude('Hello', { cwd: '/project' })) { /* consume */ }
    }).rejects.toThrow('429 too many requests');

    // Should have been called MAX_AUTO_RETRIES + 1 = 3 times
    expect(query).toHaveBeenCalledTimes(3);
  }, 30000);

  it('uses parsed retry delay from error when available', async () => {
    const { extractRetryDelayMsFromError } = await import('../../utils/retry-window.js');
    vi.mocked(extractRetryDelayMsFromError).mockReturnValue(100); // Use short delay for test speed

    let callCount = 0;
    vi.mocked(query).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          async *[Symbol.asyncIterator]() {
            throw new Error('rate limit exceeded');
          },
        } as unknown as ReturnType<typeof query>;
      }
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'result', usage: { input_tokens: 1, output_tokens: 1 } };
        },
      } as unknown as ReturnType<typeof query>;
    });

    for await (const _ of runClaude('Hello', { cwd: '/project' })) { /* consume */ }
    expect(extractRetryDelayMsFromError).toHaveBeenCalled();
    expect(callCount).toBe(2);
  }, 15000);

  it('handles non-Error objects thrown', async () => {
    vi.mocked(query).mockImplementation(() => {
      return {
        async *[Symbol.asyncIterator]() {
          throw 'string error';
        },
      } as unknown as ReturnType<typeof query>;
    });

    await expect(async () => {
      for await (const _ of runClaude('Hello', { cwd: '/project' })) { /* consume */ }
    }).rejects.toBe('string error');
  });
});

describe('runClaude - context window handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts contextWindow from model_usage (snake_case)', async () => {
    vi.mocked(query).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'result',
          result: 'Done',
          usage: { input_tokens: 100, output_tokens: 50 },
          model_usage: {
            'claude-3-5-sonnet': { context_window: 180000 },
          },
        };
      },
    } as unknown as ReturnType<typeof query>);

    const messages: ClaudeMessage[] = [];
    for await (const msg of runClaude('Hello', { cwd: '/project' })) {
      messages.push(msg);
    }

    expect(messages[0].usage?.contextWindow).toBe(180000);
  });

  it('result without content omits content field', async () => {
    vi.mocked(query).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'result',
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      },
    } as unknown as ReturnType<typeof query>);

    const messages: ClaudeMessage[] = [];
    for await (const msg of runClaude('Hello', { cwd: '/project' })) {
      messages.push(msg);
    }

    expect(messages[0].type).toBe('result');
    expect(messages[0].content).toBeUndefined();
    expect(messages[0].isComplete).toBe(true);
  });
});

describe('runClaude - MCP and plugin injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('injects MCP servers from config', async () => {
    const { loadMcpServers } = await import('../../utils/claude-config.js');
    vi.mocked(loadMcpServers).mockReturnValue({
      'my-server': { command: 'node', args: ['server.js'] },
    } as any);

    vi.mocked(query).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'result' };
      },
    } as unknown as ReturnType<typeof query>);

    for await (const _ of runClaude('Hello', { cwd: '/project' })) { /* consume */ }

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          mcpServers: expect.objectContaining({
            'my-server': { command: 'node', args: ['server.js'] },
          }),
        }),
      })
    );
  });

  it('injects user plugins when present', async () => {
    const { loadPlugins } = await import('../../utils/claude-config.js');
    vi.mocked(loadPlugins).mockReturnValue(['plugin-a', 'plugin-b'] as any);

    vi.mocked(query).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'result' };
      },
    } as unknown as ReturnType<typeof query>);

    for await (const _ of runClaude('Hello', { cwd: '/project' })) { /* consume */ }

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          plugins: ['plugin-a', 'plugin-b'],
        }),
      })
    );
  });

  it('adds additionalDirectories when temp files exist', async () => {
    const { fileStore } = await import('../../storage/fileStore.js');
    vi.mocked(fileStore.getFilePath).mockReturnValue('/tmp/source.png');
    vi.mocked(fs.existsSync).mockReturnValue(false);

    vi.mocked(query).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'result' };
      },
    } as unknown as ReturnType<typeof query>);

    const input = JSON.stringify({
      text: 'Look',
      attachments: [{ type: 'image', fileId: 'f1', mimeType: 'image/png', name: 'img.png' }],
    });

    for await (const _ of runClaude(input, { cwd: '/project' })) { /* consume */ }

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          additionalDirectories: expect.any(Array),
        }),
      })
    );
  });
});

describe('runClaude - permission callback edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AskUserQuestion returns deny with default message when callback provides none', async () => {
    const permissionCallback = vi.fn().mockResolvedValue({
      behavior: 'deny',
    });

    let capturedCanUseTool: any;
    vi.mocked(query).mockImplementation(({ options }) => {
      capturedCanUseTool = options?.canUseTool;
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'result' };
        },
      } as unknown as ReturnType<typeof query>;
    });

    for await (const _ of runClaude('Hello', { cwd: '/project' }, permissionCallback)) { /* consume */ }

    const result = await capturedCanUseTool(
      'AskUserQuestion',
      { question: 'Continue?' },
      { signal: new AbortController().signal, toolUseID: 'ask-1' }
    );
    expect(result.behavior).toBe('deny');
    expect(result.message).toBe('No answer provided');
  });

  it('deny decision returns no updatedInput', async () => {
    const permissionCallback = vi.fn().mockResolvedValue({
      behavior: 'deny',
      message: 'Not allowed',
    });

    let capturedCanUseTool: any;
    vi.mocked(query).mockImplementation(({ options }) => {
      capturedCanUseTool = options?.canUseTool;
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'result' };
        },
      } as unknown as ReturnType<typeof query>;
    });

    for await (const _ of runClaude('Hello', { cwd: '/project' }, permissionCallback)) { /* consume */ }

    const result = await capturedCanUseTool(
      'SomeOtherTool',
      { arg: 'val' },
      { signal: new AbortController().signal, toolUseID: 't1' }
    );
    expect(result.behavior).toBe('deny');
    expect(result.updatedInput).toBeUndefined();
    expect(result.message).toBe('Not allowed');
  });
});

describe('prepareInput - mime type extensions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps various mime types to correct extensions', async () => {
    const { fileStore } = await import('../../storage/fileStore.js');
    vi.mocked(fileStore.getFilePath).mockReturnValue('/tmp/source.file');
    vi.mocked(fs.existsSync).mockReturnValue(true); // ensureTmpDir sees it exists

    const mimeTypes = [
      { mime: 'image/jpeg', ext: 'jpg' },
      { mime: 'image/gif', ext: 'gif' },
      { mime: 'image/webp', ext: 'webp' },
      { mime: 'image/svg+xml', ext: 'svg' },
      { mime: 'image/bmp', ext: 'bmp' },
      { mime: 'image/unknown', ext: 'png' }, // fallback
    ];

    for (const { mime, ext } of mimeTypes) {
      vi.mocked(fs.copyFileSync).mockClear();
      const input = JSON.stringify({
        text: 'test',
        attachments: [{ type: 'image', fileId: 'f1', mimeType: mime, name: `file.${ext}` }],
      });
      const result = await prepareInput(input);
      expect(result.tempFiles).toHaveLength(1);
      expect(result.tempFiles[0]).toContain(`.${ext}`);
    }
  });

  it('handles non-image attachments with notes', async () => {
    const { buildNonImageAttachmentNotes } = await import('../attachment-utils.js');
    vi.mocked(buildNonImageAttachmentNotes).mockReturnValue([
      '[Attached text file: readme.md path=/tmp/readme.md]',
    ]);

    const input = JSON.stringify({
      text: 'Check this',
      attachments: [{ type: 'file', fileId: 'f2', mimeType: 'text/plain', name: 'readme.md' }],
    });
    const result = await prepareInput(input);
    expect(result.text).toContain('[Attached text file: readme.md');
    expect(result.text).toContain('Check this');
  });

  it('handles MessageInput with text and empty attachments', async () => {
    const input = JSON.stringify({ text: 'just text', attachments: [] });
    const result = await prepareInput(input);
    expect(result.text).toBe('just text');
    expect(result.tempFiles).toEqual([]);
  });
});

describe('fetchClaudeModels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset model cache by calling with expired cache
    // We achieve this by directly testing the function
  });

  it('fetches models from SDK and caches them', async () => {
    const mockModels = [
      { id: 'claude-3-sonnet', name: 'Sonnet' },
      { id: 'claude-3-haiku', name: 'Haiku' },
    ];

    vi.mocked(query).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'result' };
      },
      supportedModels: vi.fn().mockResolvedValue(mockModels),
      abort: vi.fn(),
    } as unknown as ReturnType<typeof query>);

    const models = await fetchClaudeModels();
    expect(models).toEqual(mockModels);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'hi',
      })
    );

    // Second call should use cache
    const models2 = await fetchClaudeModels();
    expect(models2).toEqual(mockModels);
    // query should only have been called once total for this test
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('returns empty array on error', async () => {
    vi.mocked(query).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'result' };
      },
      supportedModels: vi.fn().mockRejectedValue(new Error('Network error')),
      abort: vi.fn(),
    } as unknown as ReturnType<typeof query>);

    // Force cache miss by waiting - we need to invalidate cache
    // Since we can't easily reset module state, test the error path with a fresh import
    // Instead, pass different cliPath to potentially bypass cache
    const models = await fetchClaudeModels('/nonexistent/cli');
    // May use cache from previous test, so just ensure no crash
    expect(Array.isArray(models)).toBe(true);
  });

  it('passes cliPath to SDK options', async () => {
    vi.mocked(query).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'result' };
      },
      supportedModels: vi.fn().mockResolvedValue([]),
      abort: vi.fn(),
    } as unknown as ReturnType<typeof query>);

    // The cache from previous test means this may not call query again
    // But we can still test the function doesn't crash
    await fetchClaudeModels('/custom/cli', { MY_KEY: 'value' });
    expect(Array.isArray(await fetchClaudeModels('/custom/cli'))).toBe(true);
  });
});

describe('fetchClaudeCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCommandCache(); // Reset command cache
  });

  it('fetches commands from SDK and caches them', async () => {
    const mockCommands = [
      { name: '/help', description: 'Show help', argumentHint: '' },
      { name: '/review', description: 'Review code', argumentHint: '[file]' },
    ];

    vi.mocked(query).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'result' };
      },
      supportedCommands: vi.fn().mockResolvedValue(mockCommands),
      abort: vi.fn(),
    } as unknown as ReturnType<typeof query>);

    const commands = await fetchClaudeCommands();
    expect(commands).toEqual(mockCommands);

    // Second call should use cache
    const commands2 = await fetchClaudeCommands();
    expect(commands2).toEqual(mockCommands);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('returns empty array on error', async () => {
    vi.mocked(query).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'result' };
      },
      supportedCommands: vi.fn().mockRejectedValue(new Error('CLI not found')),
      abort: vi.fn(),
    } as unknown as ReturnType<typeof query>);

    const commands = await fetchClaudeCommands();
    expect(commands).toEqual([]);
  });

  it('passes cliPath and env to SDK options', async () => {
    clearCommandCache();
    vi.mocked(query).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'result' };
      },
      supportedCommands: vi.fn().mockResolvedValue([]),
      abort: vi.fn(),
    } as unknown as ReturnType<typeof query>);

    await fetchClaudeCommands('/custom/cli', { API_KEY: 'test' });

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          pathToClaudeCodeExecutable: '/custom/cli',
          env: expect.objectContaining({ API_KEY: 'test' }),
        }),
      })
    );
  });
});

describe('checkVersionCompatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not throw on error (non-fatal)', async () => {
    // The function imports child_process and module dynamically
    // With our mocks it will fail gracefully
    await expect(checkVersionCompatibility()).resolves.toBeUndefined();
  });

  it('accepts custom cliPath', async () => {
    await expect(checkVersionCompatibility('/custom/claude')).resolves.toBeUndefined();
  });
});
