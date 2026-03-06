import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create mock functions first
const mockStartThread = vi.fn();
const mockResumeThread = vi.fn();
const mockRunStreamed = vi.fn();

// Mock @openai/codex-sdk with a proper class
vi.mock('@openai/codex-sdk', () => {
  // Create a mock class
  class MockCodex {
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

    it('应该为默认模式设置工作区写策略', async () => {
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
          approvalPolicy: 'on-failure',
          sandboxMode: 'workspace-write',
        })
      );
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
      const { runCodex } = await import('../codex-sdk');

      const mockEvents = {
        [Symbol.asyncIterator]: async function* () {
          // No events
        },
      };

      mockRunStreamed.mockResolvedValue({ events: mockEvents });

      const gen = runCodex('test', { cwd: '/test' }, vi.fn());
      const messages: any[] = [];

      for await (const msg of gen) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(0);
    });
  });
});
