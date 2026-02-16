import { describe, it, expect } from 'vitest';
import { convertOpenCodeMessage } from '../import-opencode.js';

// Helper to create OpenCodePartRow-like objects
function makePart(id: string, messageId: string, data: any) {
  return {
    id,
    message_id: messageId,
    session_id: 'sess-1',
    time_created: Date.now(),
    time_updated: Date.now(),
    data: JSON.stringify(data)
  };
}

describe('convertOpenCodeMessage', () => {
  describe('user messages with text parts', () => {
    it('should extract text content from a single text part', () => {
      const msgData = { role: 'user' as const, time: 1700000000000 };
      const parts = [
        makePart('p1', 'msg-1', { type: 'text', text: 'Hello world' })
      ];

      const result = convertOpenCodeMessage('msg-1', msgData, parts);

      expect(result).not.toBeNull();
      expect(result!.role).toBe('user');
      expect(result!.content).toBe('Hello world');
      expect(result!.createdAt).toBe(1700000000000);
    });

    it('should concatenate multiple text parts with newline', () => {
      const msgData = { role: 'user' as const, time: 1700000000000 };
      const parts = [
        makePart('p1', 'msg-1', { type: 'text', text: 'First line' }),
        makePart('p2', 'msg-1', { type: 'text', text: 'Second line' })
      ];

      const result = convertOpenCodeMessage('msg-1', msgData, parts);

      expect(result!.content).toBe('First line\nSecond line');
    });

    it('should filter out synthetic text parts', () => {
      const msgData = { role: 'user' as const, time: 1700000000000 };
      const parts = [
        makePart('p1', 'msg-1', { type: 'text', text: 'Real content' }),
        makePart('p2', 'msg-1', { type: 'text', text: 'Synthetic content', synthetic: true })
      ];

      const result = convertOpenCodeMessage('msg-1', msgData, parts);

      expect(result!.content).toBe('Real content');
    });

    it('should filter out ignored text parts', () => {
      const msgData = { role: 'user' as const, time: 1700000000000 };
      const parts = [
        makePart('p1', 'msg-1', { type: 'text', text: 'Visible content' }),
        makePart('p2', 'msg-1', { type: 'text', text: 'Ignored content', ignored: true })
      ];

      const result = convertOpenCodeMessage('msg-1', msgData, parts);

      expect(result!.content).toBe('Visible content');
    });
  });

  describe('assistant messages with text and reasoning', () => {
    it('should exclude reasoning parts from content', () => {
      const msgData = {
        role: 'assistant' as const,
        time: { created: 1700000000000 },
        tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 0, write: 0 } }
      };
      const parts = [
        makePart('p1', 'msg-1', { type: 'reasoning', text: 'Let me think...' }),
        makePart('p2', 'msg-1', { type: 'text', text: 'Here is the answer' })
      ];

      const result = convertOpenCodeMessage('msg-1', msgData, parts);

      expect(result!.content).toBe('Here is the answer');
      // Reasoning should NOT appear in content
      expect(result!.content).not.toContain('Let me think');
    });

    it('should extract usage from assistant message data', () => {
      const msgData = {
        role: 'assistant' as const,
        time: { created: 1700000000000 },
        tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 20, write: 5 } }
      };
      const parts = [
        makePart('p1', 'msg-1', { type: 'text', text: 'Response' })
      ];

      const result = convertOpenCodeMessage('msg-1', msgData, parts);

      expect(result!.metadata).toBeDefined();
      expect(result!.metadata!.usage).toEqual({
        inputTokens: 120, // 100 + 20 cache read
        outputTokens: 50
      });
    });

    it('should use assistant time.created as timestamp', () => {
      const msgData = {
        role: 'assistant' as const,
        time: { created: 1700000500000, completed: 1700000600000 }
      };
      const parts = [
        makePart('p1', 'msg-1', { type: 'text', text: 'Response' })
      ];

      const result = convertOpenCodeMessage('msg-1', msgData, parts);

      expect(result!.createdAt).toBe(1700000500000);
    });
  });

  describe('tool parts extraction', () => {
    it('should extract tool calls with completed status', () => {
      const msgData = {
        role: 'assistant' as const,
        time: { created: 1700000000000 }
      };
      const parts = [
        makePart('p1', 'msg-1', { type: 'text', text: 'Let me read that file' }),
        makePart('p2', 'msg-1', {
          type: 'tool',
          callID: 'call-1',
          tool: 'read_file',
          state: {
            status: 'completed',
            input: { path: 'src/index.ts' },
            output: 'export default {}'
          }
        })
      ];

      const result = convertOpenCodeMessage('msg-1', msgData, parts);

      expect(result!.metadata!.toolCalls).toHaveLength(1);
      expect(result!.metadata!.toolCalls![0]).toEqual({
        name: 'read_file',
        input: { path: 'src/index.ts' },
        output: 'export default {}',
        isError: false
      });
    });

    it('should mark error tool calls with isError', () => {
      const msgData = {
        role: 'assistant' as const,
        time: { created: 1700000000000 }
      };
      const parts = [
        makePart('p1', 'msg-1', {
          type: 'tool',
          callID: 'call-1',
          tool: 'bash',
          state: {
            status: 'error',
            input: { command: 'rm -rf /' },
            error: 'Permission denied'
          }
        })
      ];

      const result = convertOpenCodeMessage('msg-1', msgData, parts);

      expect(result!.metadata!.toolCalls![0].isError).toBe(true);
    });

    it('should extract multiple tool calls', () => {
      const msgData = {
        role: 'assistant' as const,
        time: { created: 1700000000000 }
      };
      const parts = [
        makePart('p1', 'msg-1', {
          type: 'tool',
          callID: 'call-1',
          tool: 'read_file',
          state: { status: 'completed', input: { path: 'a.ts' }, output: 'content A' }
        }),
        makePart('p2', 'msg-1', {
          type: 'tool',
          callID: 'call-2',
          tool: 'write_file',
          state: { status: 'completed', input: { path: 'b.ts', content: 'new' }, output: 'ok' }
        })
      ];

      const result = convertOpenCodeMessage('msg-1', msgData, parts);

      expect(result!.metadata!.toolCalls).toHaveLength(2);
      expect(result!.metadata!.toolCalls![0].name).toBe('read_file');
      expect(result!.metadata!.toolCalls![1].name).toBe('write_file');
    });
  });

  describe('edge cases', () => {
    it('should return null for empty parts', () => {
      const msgData = { role: 'user' as const, time: 1700000000000 };

      const result = convertOpenCodeMessage('msg-1', msgData, []);

      expect(result).toBeNull();
    });

    it('should return null when all text parts are synthetic/ignored', () => {
      const msgData = { role: 'user' as const, time: 1700000000000 };
      const parts = [
        makePart('p1', 'msg-1', { type: 'text', text: 'ignored', synthetic: true }),
        makePart('p2', 'msg-1', { type: 'text', text: 'also ignored', ignored: true })
      ];

      const result = convertOpenCodeMessage('msg-1', msgData, parts);

      expect(result).toBeNull();
    });

    it('should handle malformed part data gracefully', () => {
      const msgData = { role: 'user' as const, time: 1700000000000 };
      const parts = [
        {
          id: 'p1',
          message_id: 'msg-1',
          session_id: 'sess-1',
          time_created: Date.now(),
          time_updated: Date.now(),
          data: 'not valid json'
        },
        makePart('p2', 'msg-1', { type: 'text', text: 'Valid content' })
      ];

      const result = convertOpenCodeMessage('msg-1', msgData, parts);

      expect(result).not.toBeNull();
      expect(result!.content).toBe('Valid content');
    });

    it('should return message with only tool calls (no text content)', () => {
      const msgData = {
        role: 'assistant' as const,
        time: { created: 1700000000000 }
      };
      const parts = [
        makePart('p1', 'msg-1', {
          type: 'tool',
          callID: 'call-1',
          tool: 'bash',
          state: { status: 'completed', input: { command: 'ls' }, output: 'file1\nfile2' }
        })
      ];

      const result = convertOpenCodeMessage('msg-1', msgData, parts);

      expect(result).not.toBeNull();
      expect(result!.content).toBe('');
      expect(result!.metadata!.toolCalls).toHaveLength(1);
    });

    it('should not include metadata when no usage and no tool calls', () => {
      const msgData = { role: 'user' as const, time: 1700000000000 };
      const parts = [
        makePart('p1', 'msg-1', { type: 'text', text: 'Simple message' })
      ];

      const result = convertOpenCodeMessage('msg-1', msgData, parts);

      expect(result!.metadata).toBeUndefined();
    });

    it('should skip non-text, non-tool part types', () => {
      const msgData = {
        role: 'assistant' as const,
        time: { created: 1700000000000 }
      };
      const parts = [
        makePart('p1', 'msg-1', { type: 'text', text: 'Answer' }),
        makePart('p2', 'msg-1', { type: 'step-start', snapshot: 'abc' }),
        makePart('p3', 'msg-1', { type: 'step-finish', cost: 0.01, tokens: { input: 10, output: 5 } }),
        makePart('p4', 'msg-1', { type: 'subtask', prompt: 'sub', description: 'desc' }),
        makePart('p5', 'msg-1', { type: 'file', mime: 'image/png', url: 'data:...' })
      ];

      const result = convertOpenCodeMessage('msg-1', msgData, parts);

      expect(result!.content).toBe('Answer');
      // Should not have tool calls from non-tool parts
      expect(result!.metadata).toBeUndefined();
    });

    it('should handle assistant message without tokens', () => {
      const msgData = {
        role: 'assistant' as const,
        time: { created: 1700000000000 }
      };
      const parts = [
        makePart('p1', 'msg-1', { type: 'text', text: 'Response without usage' })
      ];

      const result = convertOpenCodeMessage('msg-1', msgData, parts);

      expect(result!.content).toBe('Response without usage');
      expect(result!.metadata).toBeUndefined();
    });

    it('should handle tool with error in state field', () => {
      const msgData = {
        role: 'assistant' as const,
        time: { created: 1700000000000 }
      };
      const parts = [
        makePart('p1', 'msg-1', {
          type: 'tool',
          callID: 'call-1',
          tool: 'bash',
          state: {
            status: 'completed',
            input: { command: 'bad command' },
            output: 'Error output',
            error: 'Command failed'
          }
        })
      ];

      const result = convertOpenCodeMessage('msg-1', msgData, parts);

      expect(result!.metadata!.toolCalls![0].isError).toBe(true);
    });
  });
});
