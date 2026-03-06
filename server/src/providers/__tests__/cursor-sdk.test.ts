import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { runCursor, abortCursorSession } from '../cursor-sdk';
import type { ClaudeMessage } from '../claude-sdk';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

describe('cursor-sdk', () => {
  let mockProcess: EventEmitter & { stdout: Readable; stderr: Readable; kill: any };
  let stdout: Readable;
  let stderr: Readable;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock streams
    stdout = new Readable({ read() {} });
    stderr = new Readable({ read() {} });

    // Create mock process
    mockProcess = Object.assign(new EventEmitter(), {
      stdout,
      stderr,
      kill: vi.fn(),
    });

    vi.mocked(spawn).mockReturnValue(mockProcess as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('extractToolCall (via mapCursorEvent)', () => {
    it('应该正确提取 editToolCall', async () => {
      const toolCallEvent = {
        type: 'tool_call',
        subtype: 'started',
        call_id: 'call-1',
        tool_call: {
          editToolCall: {
            args: { file: '/path/to/file.ts', content: 'new content' },
          },
        },
      };

      const generator = runCursor('test', { cwd: '/test' }, vi.fn());
      const promise = generator.next();

      // Send the event
      stdout.push(JSON.stringify(toolCallEvent) + '\n');
      stdout.push(null);

      const result = await promise;
      const msg = result.value as ClaudeMessage;

      expect(msg.type).toBe('tool_use');
      if (msg.type === 'tool_use') {
        expect(msg.toolName).toBe('Edit');
        expect(msg.toolInput).toEqual({ file: '/path/to/file.ts', content: 'new content' });
      }
    });

    it('应该正确提取 shellToolCall', async () => {
      const toolCallEvent = {
        type: 'tool_call',
        subtype: 'started',
        call_id: 'call-2',
        tool_call: {
          shellToolCall: {
            args: { command: 'ls -la' },
          },
        },
      };

      const generator = runCursor('test', { cwd: '/test' }, vi.fn());
      const promise = generator.next();

      stdout.push(JSON.stringify(toolCallEvent) + '\n');
      stdout.push(null);

      const result = await promise;
      const msg = result.value as ClaudeMessage;

      expect(msg.type).toBe('tool_use');
      if (msg.type === 'tool_use') {
        expect(msg.toolName).toBe('Bash');
        expect(msg.toolInput).toEqual({ command: 'ls -la' });
      }
    });

    it('应该正确提取工具调用结果 (success)', async () => {
      const toolCallEvent = {
        type: 'tool_call',
        subtype: 'completed',
        call_id: 'call-3',
        tool_call: {
          shellToolCall: {
            args: { command: 'echo test' },
            result: {
              success: {
                stdout: 'test\n',
                exitCode: 0,
              },
            },
          },
        },
      };

      const generator = runCursor('test', { cwd: '/test' }, vi.fn());
      const promise = generator.next();

      stdout.push(JSON.stringify(toolCallEvent) + '\n');
      stdout.push(null);

      const result = await promise;
      const msg = result.value as ClaudeMessage;

      expect(msg.type).toBe('tool_result');
      if (msg.type === 'tool_result') {
        expect(msg.toolResult).toBe('test\n');
      }
    });

    it('应该正确提取工具调用结果 (rejected)', async () => {
      const toolCallEvent = {
        type: 'tool_call',
        subtype: 'completed',
        call_id: 'call-4',
        tool_call: {
          shellToolCall: {
            args: { command: 'rm -rf /' },
            result: {
              rejected: {
                reason: 'Dangerous command',
              },
            },
          },
        },
      };

      const generator = runCursor('test', { cwd: '/test' }, vi.fn());
      const promise = generator.next();

      stdout.push(JSON.stringify(toolCallEvent) + '\n');
      stdout.push(null);

      const result = await promise;
      const msg = result.value as ClaudeMessage;

      expect(msg.type).toBe('tool_result');
      if (msg.type === 'tool_result') {
        expect(msg.toolResult).toContain('Rejected');
        expect(msg.toolResult).toContain('Dangerous command');
      }
    });

    it('应该正确提取工具调用结果 (error)', async () => {
      const toolCallEvent = {
        type: 'tool_call',
        subtype: 'completed',
        call_id: 'call-5',
        tool_call: {
          readToolCall: {
            args: { file: '/nonexistent' },
            result: {
              error: 'File not found',
            },
          },
        },
      };

      const generator = runCursor('test', { cwd: '/test' }, vi.fn());
      const promise = generator.next();

      stdout.push(JSON.stringify(toolCallEvent) + '\n');
      stdout.push(null);

      const result = await promise;
      const msg = result.value as ClaudeMessage;

      expect(msg.type).toBe('tool_result');
      if (msg.type === 'tool_result') {
        expect(msg.toolResult).toContain('File not found');
      }
    });
  });

  describe('prepareCursorInput (via runCursor)', () => {
    it('应该正确处理纯文本输入', async () => {
      const initEvent = {
        type: 'system',
        subtype: 'init',
        session_id: 'sess-1',
        model: 'claude-3-5-sonnet',
      };

      const generator = runCursor('Hello, world!', { cwd: '/test' }, vi.fn());
      const promise = generator.next();

      stdout.push(JSON.stringify(initEvent) + '\n');
      stdout.push(null);

      await promise;

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['Hello, world!']),
        expect.any(Object)
      );
    });

    it('应该正确处理 MessageInput 格式', async () => {
      const messageInput = JSON.stringify({
        text: 'Test message',
        attachments: [],
      });

      const initEvent = {
        type: 'system',
        subtype: 'init',
        session_id: 'sess-2',
        model: 'claude-3-5-sonnet',
      };

      const generator = runCursor(messageInput, { cwd: '/test' }, vi.fn());
      const promise = generator.next();

      stdout.push(JSON.stringify(initEvent) + '\n');
      stdout.push(null);

      await promise;

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['Test message']),
        expect.any(Object)
      );
    });

    it('应该警告不支持的图片附件', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const messageInput = JSON.stringify({
        text: 'Check this image',
        attachments: [
          { type: 'image', data: 'base64data' },
        ],
      });

      const initEvent = {
        type: 'system',
        subtype: 'init',
        session_id: 'sess-3',
      };

      const generator = runCursor(messageInput, { cwd: '/test' }, vi.fn());
      const promise = generator.next();

      stdout.push(JSON.stringify(initEvent) + '\n');
      stdout.push(null);

      await promise;

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('image attachment(s) not yet supported')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('mapCursorEvent', () => {
    it('应该正确处理 system init 事件', async () => {
      const initEvent = {
        type: 'system',
        subtype: 'init',
        session_id: 'session-123',
        model: 'claude-3-5-sonnet',
        cwd: '/project',
        apiKeySource: 'anthropic',
      };

      const generator = runCursor('test', { cwd: '/test' }, vi.fn());
      const promise = generator.next();

      stdout.push(JSON.stringify(initEvent) + '\n');
      stdout.push(null);

      const result = await promise;
      const msg = result.value as ClaudeMessage;

      expect(msg.type).toBe('init');
      if (msg.type === 'init') {
        expect(msg.sessionId).toBe('session-123');
        expect(msg.systemInfo?.model).toBe('claude-3-5-sonnet');
        expect(msg.systemInfo?.cwd).toBe('/project');
        expect(msg.systemInfo?.apiKeySource).toBe('anthropic');
      }
    });

    it('应该正确处理 thinking delta 事件', async () => {
      const thinkingEvent = {
        type: 'thinking',
        subtype: 'delta',
        text: 'Let me think...',
      };

      const generator = runCursor('test', { cwd: '/test' }, vi.fn());
      const promise = generator.next();

      stdout.push(JSON.stringify(thinkingEvent) + '\n');
      stdout.push(null);

      const result = await promise;
      const msg = result.value as ClaudeMessage;

      expect(msg.type).toBe('assistant');
      if (msg.type === 'assistant') {
        expect(msg.content).toContain('Let me think...');
      }
    });

    it('应该正确处理 thinking completed 事件', async () => {
      const thinkingDelta = {
        type: 'thinking',
        subtype: 'delta',
        text: 'Thinking...',
      };

      const thinkingCompleted = {
        type: 'thinking',
        subtype: 'completed',
      };

      const generator = runCursor('test', { cwd: '/test' }, vi.fn());

      // First event
      const promise1 = generator.next();
      stdout.push(JSON.stringify(thinkingDelta) + '\n');
      await promise1;

      // Second event
      const promise2 = generator.next();
      stdout.push(JSON.stringify(thinkingCompleted) + '\n');
      stdout.push(null);

      const result = await promise2;
      const msg = result.value as ClaudeMessage;

      expect(msg.type).toBe('assistant');
      if (msg.type === 'assistant') {
        expect(msg.content).toContain('>');
      }
    });

    it('应该正确处理 assistant 事件', async () => {
      const assistantEvent = {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Hello!' },
          ],
        },
      };

      const generator = runCursor('test', { cwd: '/test' }, vi.fn());
      const promise = generator.next();

      stdout.push(JSON.stringify(assistantEvent) + '\n');
      stdout.push(null);

      const result = await promise;
      const msg = result.value as ClaudeMessage;

      expect(msg.type).toBe('assistant');
      if (msg.type === 'assistant') {
        expect(msg.content).toBe('Hello!');
      }
    });

    it('应该正确处理 result 事件 (成功)', async () => {
      const resultEvent = {
        type: 'result',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
        },
      };

      const generator = runCursor('test', { cwd: '/test' }, vi.fn());
      const promise = generator.next();

      stdout.push(JSON.stringify(resultEvent) + '\n');
      stdout.push(null);

      const result = await promise;
      const msg = result.value as ClaudeMessage;

      expect(msg.type).toBe('result');
      if (msg.type === 'result') {
        expect(msg.isComplete).toBe(true);
        expect(msg.usage?.inputTokens).toBe(100);
        expect(msg.usage?.outputTokens).toBe(50);
      }
    });

    it('应该正确处理 result 事件 (错误)', async () => {
      const resultEvent = {
        type: 'result',
        subtype: 'error',
        result: 'Something went wrong',
      };

      const generator = runCursor('test', { cwd: '/test' }, vi.fn());
      const promise = generator.next();

      stdout.push(JSON.stringify(resultEvent) + '\n');
      stdout.push(null);

      const result = await promise;
      const msg = result.value as ClaudeMessage;

      expect(msg.type).toBe('error');
      if (msg.type === 'error') {
        expect(msg.error).toContain('Something went wrong');
      }
    });
  });

  describe('命令构建', () => {
    it('应该添加 --mode=plan 选项', async () => {
      const initEvent = {
        type: 'system',
        subtype: 'init',
        session_id: 'sess-1',
      };

      const generator = runCursor('test', { cwd: '/test', mode: 'plan' }, vi.fn());
      const promise = generator.next();

      stdout.push(JSON.stringify(initEvent) + '\n');
      stdout.push(null);

      await promise;

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['--mode=plan']),
        expect.any(Object)
      );
    });

    it('应该添加 --mode=ask 选项', async () => {
      const initEvent = {
        type: 'system',
        subtype: 'init',
        session_id: 'sess-1',
      };

      const generator = runCursor('test', { cwd: '/test', mode: 'ask' }, vi.fn());
      const promise = generator.next();

      stdout.push(JSON.stringify(initEvent) + '\n');
      stdout.push(null);

      await promise;

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['--mode=ask']),
        expect.any(Object)
      );
    });

    it('应该为默认模式添加 --yolo 选项', async () => {
      const initEvent = {
        type: 'system',
        subtype: 'init',
        session_id: 'sess-1',
      };

      const generator = runCursor('test', { cwd: '/test' }, vi.fn());
      const promise = generator.next();

      stdout.push(JSON.stringify(initEvent) + '\n');
      stdout.push(null);

      await promise;

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['--yolo']),
        expect.any(Object)
      );
    });

    it('应该添加 --model 选项', async () => {
      const initEvent = {
        type: 'system',
        subtype: 'init',
        session_id: 'sess-1',
      };

      const generator = runCursor(
        'test',
        { cwd: '/test', model: 'claude-3-opus' },
        vi.fn()
      );
      const promise = generator.next();

      stdout.push(JSON.stringify(initEvent) + '\n');
      stdout.push(null);

      await promise;

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['--model', 'claude-3-opus']),
        expect.any(Object)
      );
    });

    it('应该添加 --resume 选项恢复会话', async () => {
      const initEvent = {
        type: 'system',
        subtype: 'init',
        session_id: 'sess-1',
      };

      const generator = runCursor(
        'test',
        { cwd: '/test', sessionId: 'previous-session-id' },
        vi.fn()
      );
      const promise = generator.next();

      stdout.push(JSON.stringify(initEvent) + '\n');
      stdout.push(null);

      await promise;

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['--resume', 'previous-session-id']),
        expect.any(Object)
      );
    });

    it('应该使用自定义 cliPath', async () => {
      const initEvent = {
        type: 'system',
        subtype: 'init',
        session_id: 'sess-1',
      };

      const generator = runCursor(
        'test',
        { cwd: '/test', cliPath: '/custom/cursor-agent' },
        vi.fn()
      );
      const promise = generator.next();

      stdout.push(JSON.stringify(initEvent) + '\n');
      stdout.push(null);

      await promise;

      expect(spawn).toHaveBeenCalledWith(
        '/custom/cursor-agent',
        expect.any(Array),
        expect.any(Object)
      );
    });

    it('应该合并环境变量', async () => {
      const initEvent = {
        type: 'system',
        subtype: 'init',
        session_id: 'sess-1',
      };

      const customEnv = { CUSTOM_VAR: 'value' };
      const generator = runCursor(
        'test',
        { cwd: '/test', env: customEnv },
        vi.fn()
      );
      const promise = generator.next();

      stdout.push(JSON.stringify(initEvent) + '\n');
      stdout.push(null);

      await promise;

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining(customEnv),
        })
      );
    });
  });

  describe('错误处理', () => {
    it('应该处理 spawn ENOENT 错误', async () => {
      const generator = runCursor('test', { cwd: '/test' }, vi.fn());
      const promise = generator.next();

      // Simulate spawn error
      const error = new Error('spawn error') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockProcess.emit('error', error);

      // Close stdout to end the generator
      stdout.push(null);

      const result = await promise;
      const msg = result.value as ClaudeMessage;

      expect(msg.type).toBe('error');
      if (msg.type === 'error') {
        expect(msg.error).toContain('cursor-agent not found');
      }
    });

    it('应该处理其他 spawn 错误', async () => {
      const generator = runCursor('test', { cwd: '/test' }, vi.fn());
      const promise = generator.next();

      const error = new Error('Permission denied');
      mockProcess.emit('error', error);

      stdout.push(null);

      const result = await promise;
      const msg = result.value as ClaudeMessage;

      expect(msg.type).toBe('error');
      if (msg.type === 'error') {
        expect(msg.error).toContain('Permission denied');
      }
    });

    it('应该处理无效的 JSON 行', async () => {
      const generator = runCursor('test', { cwd: '/test' }, vi.fn());
      const promise = generator.next();

      // Send invalid JSON followed by valid event
      stdout.push('invalid json\n');
      stdout.push(JSON.stringify({ type: 'system', subtype: 'init', session_id: '1' }) + '\n');
      stdout.push(null);

      // Should not throw, just skip invalid line
      const result = await promise;
      expect(result.value).toBeDefined();
    });
  });

  describe('abortCursorSession', () => {
    it('应该终止活跃的会话', async () => {
      const sessionId = 'session-to-abort';

      const initEvent = {
        type: 'system',
        subtype: 'init',
        session_id: sessionId,
      };

      const generator = runCursor(
        'test',
        { cwd: '/test', sessionId },
        vi.fn()
      );

      const promise = generator.next();
      stdout.push(JSON.stringify(initEvent) + '\n');
      await promise;

      // Abort the session
      await abortCursorSession(sessionId);

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('应该处理不存在的会话', async () => {
      // Should not throw
      await expect(abortCursorSession('nonexistent-session')).resolves.not.toThrow();
    });
  });

  describe('边界情况', () => {
    it('应该处理空行', async () => {
      const generator = runCursor('test', { cwd: '/test' }, vi.fn());
      const promise = generator.next();

      stdout.push('\n');
      stdout.push('   \n');
      stdout.push(JSON.stringify({ type: 'system', subtype: 'init', session_id: '1' }) + '\n');
      stdout.push(null);

      const result = await promise;
      expect(result.value).toBeDefined();
    });

    it('应该处理多个连续的工具调用', async () => {
      const events = [
        {
          type: 'tool_call',
          subtype: 'started',
          call_id: 'call-1',
          tool_call: { readToolCall: { args: { file: '/file1' } } },
        },
        {
          type: 'tool_call',
          subtype: 'completed',
          call_id: 'call-1',
          tool_call: { readToolCall: { args: { file: '/file1' }, result: 'content1' } },
        },
        {
          type: 'tool_call',
          subtype: 'started',
          call_id: 'call-2',
          tool_call: { editToolCall: { args: { file: '/file2' } } },
        },
        {
          type: 'tool_call',
          subtype: 'completed',
          call_id: 'call-2',
          tool_call: { editToolCall: { args: { file: '/file2' }, result: 'done' } },
        },
      ];

      const generator = runCursor('test', { cwd: '/test' }, vi.fn());
      const messages: ClaudeMessage[] = [];

      for (const event of events) {
        setTimeout(() => {
          stdout.push(JSON.stringify(event) + '\n');
        }, 10);
      }

      setTimeout(() => stdout.push(null), 50);

      for await (const msg of generator) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(4);
      expect(messages[0].type).toBe('tool_use');
      expect(messages[1].type).toBe('tool_result');
      expect(messages[2].type).toBe('tool_use');
      expect(messages[3].type).toBe('tool_result');
    });
  });
});
