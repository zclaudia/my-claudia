import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create mock functions first
const mockStartThread = vi.fn();
const mockResumeThread = vi.fn();
const mockRunStreamed = vi.fn();
const mockCodexConstructor = vi.fn();

// Mock @openai/codex-sdk with a proper class
vi.mock('@openai/codex-sdk', () => {
  // Create a mock class
  class MockCodex {
    constructor(options: unknown) {
      mockCodexConstructor(options);
    }
    startThread = mockStartThread;
    resumeThread = mockResumeThread;
  }
  return { Codex: MockCodex };
});

// Mock fileStore
vi.mock('../../storage/fileStore.js', () => ({
  fileStore: {
    getFilePath: vi.fn().mockReturnValue('/path/to/file'),
  },
}));

describe('codex-sdk', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup default mock
    mockStartThread.mockReturnValue({
      runStreamed: mockRunStreamed,
    });
    mockResumeThread.mockReturnValue({
      runStreamed: mockRunStreamed,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('模式映射', () => {
    it('应该为 plan 模式设置只读策略', async () => {
      const { runCodex } = await import('../codex-sdk');

      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'thread.started', thread_id: 'test-1' };
        },
      };

      mockRunStreamed.mockResolvedValue({ events: mockEvents });

      const gen = runCodex('test', { cwd: '/test', mode: 'plan' }, vi.fn());
      await gen.next();

      expect(mockStartThread).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalPolicy: 'on-request',
          sandboxMode: 'read-only',
        })
      );
    });

    it('应该为 bypassPermissions 模式设置完全访问策略', async () => {
      const { runCodex } = await import('../codex-sdk');

      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'thread.started', thread_id: 'test-1' };
        },
      };

      mockRunStreamed.mockResolvedValue({ events: mockEvents });

      const gen = runCodex('test', { cwd: '/test', mode: 'bypassPermissions' }, vi.fn());
      await gen.next();

      expect(mockStartThread).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalPolicy: 'never',
          sandboxMode: 'danger-full-access',
        })
      );
    });

    it('应该为默认模式设置 on-request 工作区写策略', async () => {
      const { runCodex } = await import('../codex-sdk');

      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'thread.started', thread_id: 'test-1' };
        },
      };

      mockRunStreamed.mockResolvedValue({ events: mockEvents });

      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      await gen.next();

      expect(mockStartThread).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalPolicy: 'on-request',
          sandboxMode: 'workspace-write',
        })
      );
    });
  });

  describe('环境清理', () => {
    it('即使没有 options.env 也会过滤继承的 ANTHROPIC_MODEL', async () => {
      vi.resetModules();
      process.env.ANTHROPIC_MODEL = 'polluted-model';
      process.env.PATH = '/usr/bin';

      const { runCodex } = await import('../codex-sdk');

      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'thread.started', thread_id: 'test-1' };
        },
      };

      mockRunStreamed.mockResolvedValue({ events: mockEvents });

      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      await gen.next();

      expect(mockCodexConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          env: expect.objectContaining({
            PATH: '/usr/bin',
          }),
        })
      );
      expect(mockCodexConstructor.mock.calls[0]?.[0]?.env?.ANTHROPIC_MODEL).toBeUndefined();

      delete process.env.ANTHROPIC_MODEL;
    });
  });

  describe('事件映射', () => {
    it('应该正确映射 thread.started 事件', async () => {
      const { runCodex } = await import('../codex-sdk');

      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'thread.started', thread_id: 'thread-123' };
        },
      };

      mockRunStreamed.mockResolvedValue({ events: mockEvents });

      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const result = await gen.next();

      expect(result.value).toMatchObject({
        type: 'init',
        sessionId: 'thread-123',
      });
    });

    it('应该正确映射 turn.completed 事件', async () => {
      const { runCodex } = await import('../codex-sdk');

      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'turn.completed',
            usage: { input_tokens: 100, output_tokens: 50 },
          };
        },
      };

      mockRunStreamed.mockResolvedValue({ events: mockEvents });

      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const result = await gen.next();

      expect(result.value).toMatchObject({
        type: 'result',
        isComplete: true,
        usage: { inputTokens: 100, outputTokens: 50 },
      });
    });

    it('应该正确映射 error 事件', async () => {
      const { runCodex } = await import('../codex-sdk');

      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'error', message: 'Something went wrong' };
        },
      };

      mockRunStreamed.mockResolvedValue({ events: mockEvents });

      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const result = await gen.next();

      expect(result.value).toMatchObject({
        type: 'error',
        error: 'Something went wrong',
      });
    });

    it('应该正确映射 item.started (agent_message)', async () => {
      const { runCodex } = await import('../codex-sdk');

      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'item.started',
            item: { type: 'agent_message', text: 'Hello!' },
          };
        },
      };

      mockRunStreamed.mockResolvedValue({ events: mockEvents });

      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const result = await gen.next();

      expect(result.value).toMatchObject({
        type: 'assistant',
        content: 'Hello!',
      });
    });

    it('应该正确映射 item.started (command_execution)', async () => {
      const { runCodex } = await import('../codex-sdk');

      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'item.started',
            item: { type: 'command_execution', command: 'ls -la' },
          };
        },
      };

      mockRunStreamed.mockResolvedValue({ events: mockEvents });

      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const result = await gen.next();

      expect(result.value).toMatchObject({
        type: 'tool_use',
        toolName: 'Bash',
      });
    });

    it('应该正确映射 item.completed (command_execution)', async () => {
      const { runCodex } = await import('../codex-sdk');

      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'item.completed',
            item: {
              type: 'command_execution',
              command: 'ls',
              aggregated_output: 'file1\nfile2\n',
              status: 'completed',
            },
          };
        },
      };

      mockRunStreamed.mockResolvedValue({ events: mockEvents });

      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const result = await gen.next();

      expect(result.value).toMatchObject({
        type: 'tool_result',
        toolResult: 'file1\nfile2\n',
        isToolError: false,
      });
    });

    it('应该正确映射 item.completed (command_execution 失败)', async () => {
      const { runCodex } = await import('../codex-sdk');

      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'item.completed',
            item: {
              type: 'command_execution',
              command: 'exit 1',
              aggregated_output: 'Error',
              status: 'failed',
            },
          };
        },
      };

      mockRunStreamed.mockResolvedValue({ events: mockEvents });

      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const result = await gen.next();

      expect(result.value).toMatchObject({
        type: 'tool_result',
        isToolError: true,
      });
    });
  });

  describe('会话管理', () => {
    it('应该启动新会话', async () => {
      const { runCodex } = await import('../codex-sdk');

      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'thread.started', thread_id: 'new-thread' };
        },
      };

      mockRunStreamed.mockResolvedValue({ events: mockEvents });

      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      await gen.next();

      expect(mockStartThread).toHaveBeenCalled();
      expect(mockResumeThread).not.toHaveBeenCalled();
    });

    it('应该恢复现有会话', async () => {
      const { runCodex } = await import('../codex-sdk');

      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'thread.started', thread_id: 'existing-thread' };
        },
      };

      mockRunStreamed.mockResolvedValue({ events: mockEvents });

      const gen = runCodex('test', { cwd: '/test', sessionId: 'existing-thread' }, vi.fn());
      await gen.next();

      expect(mockResumeThread).toHaveBeenCalledWith(
        'existing-thread',
        expect.any(Object)
      );
      expect(mockStartThread).not.toHaveBeenCalled();
    });

    it('应该使用自定义 model', async () => {
      const { runCodex } = await import('../codex-sdk');

      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'thread.started', thread_id: 'test-1' };
        },
      };

      mockRunStreamed.mockResolvedValue({ events: mockEvents });

      const gen = runCodex('test', { cwd: '/test', model: 'codex-4' }, vi.fn());
      await gen.next();

      expect(mockStartThread).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'codex-4',
        })
      );
    });
  });

  describe('错误处理', () => {
    it('应该处理运行时错误', async () => {
      const { runCodex } = await import('../codex-sdk');

      mockRunStreamed.mockRejectedValue(new Error('Runtime error'));

      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const result = await gen.next();

      expect(result.value).toMatchObject({
        type: 'error',
        error: expect.stringContaining('Runtime error'),
      });
    });

    it('应该处理 turn.failed 事件', async () => {
      const { runCodex } = await import('../codex-sdk');

      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'turn.failed',
            error: { message: 'Turn failed' },
          };
        },
      };

      mockRunStreamed.mockResolvedValue({ events: mockEvents });

      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const result = await gen.next();

      expect(result.value).toMatchObject({
        type: 'error',
        error: expect.stringContaining('Turn failed'),
      });
    });
  });

  describe('边界情况', () => {
    it('应该正确处理多个连续事件', async () => {
      const { runCodex } = await import('../codex-sdk');

      const events = [
        { type: 'thread.started', thread_id: 'thread-1' },
        { type: 'item.started', item: { type: 'agent_message', text: 'Hello' } },
        { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } },
      ];

      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          for (const event of events) {
            yield event;
          }
        },
      };

      mockRunStreamed.mockResolvedValue({ events: mockEvents });

      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const messages: any[] = [];

      for await (const msg of gen) {
        messages.push(msg);
      }

      expect(messages.length).toBe(3);
      expect(messages[0].type).toBe('init');
      expect(messages[1].type).toBe('assistant');
      expect(messages[2].type).toBe('result');
    });

    it('应该正确处理空事件流', async () => {
      vi.useFakeTimers();
      const { runCodex } = await import('../codex-sdk');

      const createEmptyEvents = () => ({
        [Symbol.asyncIterator]: async function* () {
          // No events
        },
      });

      mockRunStreamed.mockImplementation(() => Promise.resolve({ events: createEmptyEvents() }));

      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const messages: any[] = [];

      // Collect messages while advancing timers for sleep() retries
      const collectPromise = (async () => {
        for await (const msg of gen) {
          messages.push(msg);
        }
      })();

      // Advance timers to skip all retry sleeps (1s + 2s + 4s)
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(5000);
      }

      await collectPromise;

      // After exhausting retries, code yields an error about no output
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('error');
      expect(messages[0].error).toContain('no output');

      vi.useRealTimers();
    });
  });

  describe('更多事件映射', () => {
    it('映射 item.started reasoning', async () => {
      const { runCodex } = await import('../codex-sdk');
      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'item.started', item: { type: 'reasoning', text: 'thinking...' } };
        },
      };
      mockRunStreamed.mockResolvedValue({ events: mockEvents });
      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const result = await gen.next();
      expect(result.value).toMatchObject({ type: 'assistant', content: '<think>thinking...</think>' });
    });

    it('映射 item.started file_change', async () => {
      const { runCodex } = await import('../codex-sdk');
      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'item.started', item: { id: 'fc-1', type: 'file_change', changes: 'diff' } };
        },
      };
      mockRunStreamed.mockResolvedValue({ events: mockEvents });
      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const result = await gen.next();
      expect(result.value).toMatchObject({ type: 'tool_use', toolName: 'Edit', toolUseId: 'fc-1' });
    });

    it('映射 item.started mcp_tool_call', async () => {
      const { runCodex } = await import('../codex-sdk');
      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'item.started', item: { id: 'mcp-1', type: 'mcp_tool_call', server: 'srv', tool: 'query', arguments: { q: 'test' } } };
        },
      };
      mockRunStreamed.mockResolvedValue({ events: mockEvents });
      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const result = await gen.next();
      expect(result.value).toMatchObject({ type: 'tool_use', toolName: 'mcp:srv:query' });
    });

    it('映射 item.started web_search', async () => {
      const { runCodex } = await import('../codex-sdk');
      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'item.started', item: { id: 'ws-1', type: 'web_search', query: 'vitest' } };
        },
      };
      mockRunStreamed.mockResolvedValue({ events: mockEvents });
      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const result = await gen.next();
      expect(result.value).toMatchObject({ type: 'tool_use', toolName: 'WebSearch', toolInput: { query: 'vitest' } });
    });

    it('映射 item.started todo_list', async () => {
      const { runCodex } = await import('../codex-sdk');
      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'item.started', item: { id: 'td-1', type: 'todo_list', items: ['a', 'b'] } };
        },
      };
      mockRunStreamed.mockResolvedValue({ events: mockEvents });
      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const result = await gen.next();
      expect(result.value).toMatchObject({ type: 'tool_use', toolName: 'TodoWrite' });
    });

    it('映射 item.started error', async () => {
      const { runCodex } = await import('../codex-sdk');
      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'item.started', item: { type: 'error', message: 'bad' } };
        },
      };
      mockRunStreamed.mockResolvedValue({ events: mockEvents });
      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const result = await gen.next();
      expect(result.value).toMatchObject({ type: 'error', error: 'bad' });
    });

    it('映射 item.completed file_change', async () => {
      const { runCodex } = await import('../codex-sdk');
      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'item.completed', item: { id: 'fc-1', type: 'file_change', status: 'completed' } };
        },
      };
      mockRunStreamed.mockResolvedValue({ events: mockEvents });
      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const result = await gen.next();
      expect(result.value).toMatchObject({ type: 'tool_result', toolName: 'Edit', toolResult: 'Applied', isToolError: false });
    });

    it('映射 item.completed file_change failed', async () => {
      const { runCodex } = await import('../codex-sdk');
      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'item.completed', item: { id: 'fc-1', type: 'file_change', status: 'failed' } };
        },
      };
      mockRunStreamed.mockResolvedValue({ events: mockEvents });
      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const result = await gen.next();
      expect(result.value).toMatchObject({ type: 'tool_result', toolResult: 'Failed', isToolError: true });
    });

    it('映射 item.completed mcp_tool_call', async () => {
      const { runCodex } = await import('../codex-sdk');
      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'item.completed', item: { id: 'mcp-1', type: 'mcp_tool_call', server: 'srv', tool: 'q', result: { content: 'data' }, status: 'completed' } };
        },
      };
      mockRunStreamed.mockResolvedValue({ events: mockEvents });
      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const result = await gen.next();
      expect(result.value).toMatchObject({ type: 'tool_result', toolName: 'mcp:srv:q' });
    });

    it('映射 item.completed mcp_tool_call failed', async () => {
      const { runCodex } = await import('../codex-sdk');
      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'item.completed', item: { id: 'mcp-1', type: 'mcp_tool_call', server: 'srv', tool: 'q', error: { message: 'err' }, status: 'failed' } };
        },
      };
      mockRunStreamed.mockResolvedValue({ events: mockEvents });
      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const result = await gen.next();
      expect(result.value).toMatchObject({ type: 'tool_result', isToolError: true });
    });

    it('映射 item.completed web_search', async () => {
      const { runCodex } = await import('../codex-sdk');
      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'item.completed', item: { id: 'ws-1', type: 'web_search', query: 'test' } };
        },
      };
      mockRunStreamed.mockResolvedValue({ events: mockEvents });
      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const result = await gen.next();
      expect(result.value).toMatchObject({ type: 'tool_result', toolName: 'WebSearch', toolResult: 'Search completed' });
    });

    it('映射 item.updated agent_message', async () => {
      const { runCodex } = await import('../codex-sdk');
      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'item.updated', item: { type: 'agent_message', text: 'streaming...' } };
        },
      };
      mockRunStreamed.mockResolvedValue({ events: mockEvents });
      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const result = await gen.next();
      expect(result.value).toMatchObject({ type: 'assistant', content: 'streaming...' });
    });

    it('映射 item.updated reasoning', async () => {
      const { runCodex } = await import('../codex-sdk');
      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'item.updated', item: { type: 'reasoning', text: 'thinking more...' } };
        },
      };
      mockRunStreamed.mockResolvedValue({ events: mockEvents });
      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const result = await gen.next();
      expect(result.value).toMatchObject({ type: 'assistant', content: '<think>thinking more...</think>' });
    });

    it('映射 item.completed agent_message', async () => {
      const { runCodex } = await import('../codex-sdk');
      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'item.completed', item: { type: 'agent_message', text: 'Done!' } };
        },
      };
      mockRunStreamed.mockResolvedValue({ events: mockEvents });
      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const result = await gen.next();
      expect(result.value).toMatchObject({ type: 'assistant', content: 'Done!' });
    });

    it('ignores unknown item types in item.started', async () => {
      const { runCodex } = await import('../codex-sdk');
      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'item.started', item: { type: 'unknown_type' } };
          yield { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } };
        },
      };
      mockRunStreamed.mockResolvedValue({ events: mockEvents });
      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const msgs: any[] = [];
      for await (const m of gen) msgs.push(m);
      // Should only get the turn.completed result, unknown item is skipped
      expect(msgs).toHaveLength(1);
      expect(msgs[0].type).toBe('result');
    });

    it('ignores turn.started event', async () => {
      const { runCodex } = await import('../codex-sdk');
      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'turn.started' };
          yield { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } };
        },
      };
      mockRunStreamed.mockResolvedValue({ events: mockEvents });
      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const msgs: any[] = [];
      for await (const m of gen) msgs.push(m);
      expect(msgs).toHaveLength(1);
      expect(msgs[0].type).toBe('result');
    });
  });

  describe('输入处理', () => {
    it('passes JSON input with attachments', async () => {
      const { runCodex } = await import('../codex-sdk');
      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'thread.started', thread_id: 'test-1' };
        },
      };
      mockRunStreamed.mockResolvedValue({ events: mockEvents });

      const input = JSON.stringify({
        text: 'Analyze this image',
        attachments: [{ type: 'image', fileId: 'file-1', mimeType: 'image/png', name: 'test.png' }],
      });

      const gen = runCodex(input, { cwd: '/test' }, vi.fn());
      await gen.next();

      // runStreamed should have been called with prepared input
      expect(mockRunStreamed).toHaveBeenCalled();
    });

    it('handles acceptEdits mode', async () => {
      const { runCodex } = await import('../codex-sdk');
      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'thread.started', thread_id: 'test-1' };
        },
      };
      mockRunStreamed.mockResolvedValue({ events: mockEvents });

      const gen = runCodex('test', { cwd: '/test', mode: 'acceptEdits' }, vi.fn());
      await gen.next();

      expect(mockStartThread).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalPolicy: 'on-failure',
          sandboxMode: 'workspace-write',
        })
      );
    });
  });

  describe('abortCodexSession', () => {
    it('does nothing for unknown session', async () => {
      const { abortCodexSession } = await import('../codex-sdk.js');
      // Should not throw
      await abortCodexSession('nonexistent-session');
    });
  });
});
