import { describe, it, expect, beforeEach } from 'vitest';

// Define types matching the import.ts module
interface ClaudeMessage {
  type: 'user' | 'assistant' | 'summary' | 'file-history-snapshot';
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  message?: {
    role: 'user' | 'assistant' | 'system';
    content: string | Array<{ type: string; text?: string; thinking?: string; [key: string]: any }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  summary?: string;
}

interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: any;
  createdAt: number;
}

// Copy the actual implementation from import.ts for unit testing
function convertMessage(
  claudeMsg: ClaudeMessage,
  targetSessionId: string
): Omit<Message, 'id'> & { id: string } {
  const { uuid, timestamp, message } = claudeMsg;

  if (!uuid || !timestamp || !message) {
    throw new Error('Invalid Claude message format');
  }

  // Process content
  let content: string;
  if (typeof message.content === 'string') {
    content = message.content;
  } else if (Array.isArray(message.content)) {
    // Merge text blocks, ignore thinking
    content = message.content
      .filter(block => block.type === 'text' && block.text)
      .map(block => block.text)
      .join('\n');
  } else {
    content = '';
  }

  // Extract metadata
  const metadata: any = {};

  if (message.usage) {
    metadata.usage = {
      inputTokens: message.usage.input_tokens || 0,
      outputTokens: message.usage.output_tokens || 0
    };
  }

  // Extract tool calls
  if (Array.isArray(message.content)) {
    const toolBlocks = message.content.filter(
      b => b.type === 'tool_use' || b.type === 'tool_result'
    );
    if (toolBlocks.length > 0) {
      metadata.toolCalls = extractToolCalls(toolBlocks);
    }
  }

  return {
    id: uuid,
    sessionId: targetSessionId,
    role: message.role,
    content,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    createdAt: new Date(timestamp).getTime()
  };
}

function extractToolCalls(toolBlocks: any[]): any[] {
  const toolCalls: any[] = [];
  const toolUseMap = new Map<string, any>();

  for (const block of toolBlocks) {
    if (block.type === 'tool_use') {
      toolUseMap.set(block.id || block.name, {
        name: block.name,
        input: block.input
      });
    } else if (block.type === 'tool_result') {
      const toolUse = toolUseMap.get(block.tool_use_id || block.id);
      if (toolUse) {
        toolCalls.push({
          name: toolUse.name,
          input: toolUse.input,
          output: block.content || block.result
        });
      }
    }
  }

  // Add tool uses without results
  for (const [id, toolUse] of toolUseMap.entries()) {
    if (!toolCalls.find(tc => tc.name === toolUse.name && tc.input === toolUse.input)) {
      toolCalls.push(toolUse);
    }
  }

  return toolCalls;
}

describe('Data Conversion Functions', () => {
  const targetSessionId = 'test-session-123';
  const baseTimestamp = '2026-01-27T10:00:00.000Z';
  const baseUuid = 'msg-uuid-123';

  describe('convertMessage() - string content', () => {
    it('should convert message with string content', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'user',
        uuid: baseUuid,
        timestamp: baseTimestamp,
        message: {
          role: 'user',
          content: 'Hello, how are you?'
        }
      };

      const result = convertMessage(claudeMsg, targetSessionId);

      expect(result.id).toBe(baseUuid);
      expect(result.sessionId).toBe(targetSessionId);
      expect(result.role).toBe('user');
      expect(result.content).toBe('Hello, how are you?');
      expect(result.createdAt).toBe(new Date(baseTimestamp).getTime());
    });

    it('should handle empty string content', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'user',
        uuid: baseUuid,
        timestamp: baseTimestamp,
        message: {
          role: 'user',
          content: ''
        }
      };

      const result = convertMessage(claudeMsg, targetSessionId);

      expect(result.content).toBe('');
      expect(result.metadata).toBeUndefined();
    });

    it('should handle multi-line string content', () => {
      const multiLineContent = 'Line 1\nLine 2\nLine 3';
      const claudeMsg: ClaudeMessage = {
        type: 'user',
        uuid: baseUuid,
        timestamp: baseTimestamp,
        message: {
          role: 'user',
          content: multiLineContent
        }
      };

      const result = convertMessage(claudeMsg, targetSessionId);

      expect(result.content).toBe(multiLineContent);
    });

    it('should handle string content with special characters', () => {
      const specialContent = 'Content with "quotes", \'apostrophes\', and <tags>';
      const claudeMsg: ClaudeMessage = {
        type: 'user',
        uuid: baseUuid,
        timestamp: baseTimestamp,
        message: {
          role: 'user',
          content: specialContent
        }
      };

      const result = convertMessage(claudeMsg, targetSessionId);

      expect(result.content).toBe(specialContent);
    });
  });

  describe('convertMessage() - array content', () => {
    it('should convert message with single text block', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'assistant',
        uuid: baseUuid,
        timestamp: baseTimestamp,
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Response text' }
          ]
        }
      };

      const result = convertMessage(claudeMsg, targetSessionId);

      expect(result.content).toBe('Response text');
    });

    it('should merge multiple text blocks with newlines', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'assistant',
        uuid: baseUuid,
        timestamp: baseTimestamp,
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'First block' },
            { type: 'text', text: 'Second block' },
            { type: 'text', text: 'Third block' }
          ]
        }
      };

      const result = convertMessage(claudeMsg, targetSessionId);

      expect(result.content).toBe('First block\nSecond block\nThird block');
    });

    it('should filter out non-text blocks', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'assistant',
        uuid: baseUuid,
        timestamp: baseTimestamp,
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Visible text' },
            { type: 'thinking', thinking: 'Internal thought' },
            { type: 'text', text: 'More visible text' }
          ]
        }
      };

      const result = convertMessage(claudeMsg, targetSessionId);

      expect(result.content).toBe('Visible text\nMore visible text');
      expect(result.content).not.toContain('Internal thought');
    });

    it('should filter out text blocks without text property', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'assistant',
        uuid: baseUuid,
        timestamp: baseTimestamp,
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Valid text' },
            { type: 'text' }, // Missing text property
            { type: 'text', text: 'Another valid text' }
          ]
        }
      };

      const result = convertMessage(claudeMsg, targetSessionId);

      expect(result.content).toBe('Valid text\nAnother valid text');
    });

    it('should return empty string for array with no text blocks', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'assistant',
        uuid: baseUuid,
        timestamp: baseTimestamp,
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Only thinking' },
            { type: 'tool_use', name: 'some_tool' }
          ]
        }
      };

      const result = convertMessage(claudeMsg, targetSessionId);

      expect(result.content).toBe('');
    });

    it('should handle empty array content', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'assistant',
        uuid: baseUuid,
        timestamp: baseTimestamp,
        message: {
          role: 'assistant',
          content: []
        }
      };

      const result = convertMessage(claudeMsg, targetSessionId);

      expect(result.content).toBe('');
    });
  });

  describe('convertMessage() - thinking blocks', () => {
    it('should ignore thinking blocks in content extraction', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'assistant',
        uuid: baseUuid,
        timestamp: baseTimestamp,
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Let me think about this...' },
            { type: 'text', text: 'Here is my response' }
          ]
        }
      };

      const result = convertMessage(claudeMsg, targetSessionId);

      expect(result.content).toBe('Here is my response');
      expect(result.content).not.toContain('Let me think');
    });

    it('should handle multiple thinking blocks', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'assistant',
        uuid: baseUuid,
        timestamp: baseTimestamp,
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'First thought' },
            { type: 'text', text: 'Response part 1' },
            { type: 'thinking', thinking: 'Second thought' },
            { type: 'text', text: 'Response part 2' }
          ]
        }
      };

      const result = convertMessage(claudeMsg, targetSessionId);

      expect(result.content).toBe('Response part 1\nResponse part 2');
      expect(result.content).not.toContain('thought');
    });

    it('should handle message with only thinking blocks', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'assistant',
        uuid: baseUuid,
        timestamp: baseTimestamp,
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Only internal thoughts' }
          ]
        }
      };

      const result = convertMessage(claudeMsg, targetSessionId);

      expect(result.content).toBe('');
    });
  });

  describe('convertMessage() - metadata preservation', () => {
    it('should preserve usage tokens in metadata', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'assistant',
        uuid: baseUuid,
        timestamp: baseTimestamp,
        message: {
          role: 'assistant',
          content: 'Response with usage',
          usage: {
            input_tokens: 100,
            output_tokens: 50
          }
        }
      };

      const result = convertMessage(claudeMsg, targetSessionId);

      expect(result.metadata).toBeDefined();
      expect(result.metadata.usage).toEqual({
        inputTokens: 100,
        outputTokens: 50
      });
    });

    it('should handle missing input_tokens', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'assistant',
        uuid: baseUuid,
        timestamp: baseTimestamp,
        message: {
          role: 'assistant',
          content: 'Response',
          usage: {
            output_tokens: 30
          }
        }
      };

      const result = convertMessage(claudeMsg, targetSessionId);

      expect(result.metadata.usage).toEqual({
        inputTokens: 0,
        outputTokens: 30
      });
    });

    it('should handle missing output_tokens', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'assistant',
        uuid: baseUuid,
        timestamp: baseTimestamp,
        message: {
          role: 'assistant',
          content: 'Response',
          usage: {
            input_tokens: 50
          }
        }
      };

      const result = convertMessage(claudeMsg, targetSessionId);

      expect(result.metadata.usage).toEqual({
        inputTokens: 50,
        outputTokens: 0
      });
    });

    it('should handle zero token values', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'assistant',
        uuid: baseUuid,
        timestamp: baseTimestamp,
        message: {
          role: 'assistant',
          content: 'Response',
          usage: {
            input_tokens: 0,
            output_tokens: 0
          }
        }
      };

      const result = convertMessage(claudeMsg, targetSessionId);

      expect(result.metadata.usage).toEqual({
        inputTokens: 0,
        outputTokens: 0
      });
    });

    it('should not include metadata if no usage or tool calls', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'user',
        uuid: baseUuid,
        timestamp: baseTimestamp,
        message: {
          role: 'user',
          content: 'Simple message'
        }
      };

      const result = convertMessage(claudeMsg, targetSessionId);

      expect(result.metadata).toBeUndefined();
    });
  });

  describe('convertMessage() - validation', () => {
    it('should throw error if uuid is missing', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'user',
        timestamp: baseTimestamp,
        message: {
          role: 'user',
          content: 'Message without uuid'
        }
      };

      expect(() => convertMessage(claudeMsg, targetSessionId)).toThrow('Invalid Claude message format');
    });

    it('should throw error if timestamp is missing', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'user',
        uuid: baseUuid,
        message: {
          role: 'user',
          content: 'Message without timestamp'
        }
      };

      expect(() => convertMessage(claudeMsg, targetSessionId)).toThrow('Invalid Claude message format');
    });

    it('should throw error if message is missing', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'user',
        uuid: baseUuid,
        timestamp: baseTimestamp
      };

      expect(() => convertMessage(claudeMsg, targetSessionId)).toThrow('Invalid Claude message format');
    });

    it('should handle various timestamp formats', () => {
      const timestamps = [
        '2026-01-27T10:00:00.000Z',
        '2026-01-27T10:00:00Z',
        '2026-01-27T10:00:00.123Z',
        '2026-12-31T23:59:59.999Z'
      ];

      timestamps.forEach(timestamp => {
        const claudeMsg: ClaudeMessage = {
          type: 'user',
          uuid: baseUuid,
          timestamp,
          message: {
            role: 'user',
            content: 'Test'
          }
        };

        const result = convertMessage(claudeMsg, targetSessionId);
        expect(result.createdAt).toBe(new Date(timestamp).getTime());
      });
    });
  });

  describe('extractToolCalls()', () => {
    it('should extract single tool use with result', () => {
      const toolBlocks = [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'read_file',
          input: { path: '/path/to/file.txt' }
        },
        {
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: 'File contents here'
        }
      ];

      const result = extractToolCalls(toolBlocks);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'read_file',
        input: { path: '/path/to/file.txt' },
        output: 'File contents here'
      });
    });

    it('should extract multiple tool uses with results', () => {
      const toolBlocks = [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'read_file',
          input: { path: 'file1.txt' }
        },
        {
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: 'Content 1'
        },
        {
          type: 'tool_use',
          id: 'tool-2',
          name: 'write_file',
          input: { path: 'file2.txt', content: 'data' }
        },
        {
          type: 'tool_result',
          tool_use_id: 'tool-2',
          content: 'Success'
        }
      ];

      const result = extractToolCalls(toolBlocks);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('read_file');
      expect(result[1].name).toBe('write_file');
    });

    it('should include tool use without result', () => {
      const toolBlocks = [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'some_tool',
          input: { param: 'value' }
        }
      ];

      const result = extractToolCalls(toolBlocks);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'some_tool',
        input: { param: 'value' }
      });
      expect(result[0].output).toBeUndefined();
    });

    it('should handle tool use with name as ID', () => {
      const toolBlocks = [
        {
          type: 'tool_use',
          name: 'tool_name',
          input: { data: 'test' }
        },
        {
          type: 'tool_result',
          id: 'tool_name',
          content: 'Result'
        }
      ];

      const result = extractToolCalls(toolBlocks);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('tool_name');
      expect(result[0].output).toBe('Result');
    });

    it('should handle tool result with result property instead of content', () => {
      const toolBlocks = [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'api_call',
          input: { endpoint: '/test' }
        },
        {
          type: 'tool_result',
          tool_use_id: 'tool-1',
          result: { status: 'success', data: 'response' }
        }
      ];

      const result = extractToolCalls(toolBlocks);

      expect(result).toHaveLength(1);
      expect(result[0].output).toEqual({ status: 'success', data: 'response' });
    });

    it('should handle orphaned tool results', () => {
      const toolBlocks = [
        {
          type: 'tool_result',
          tool_use_id: 'non-existent',
          content: 'Orphaned result'
        }
      ];

      const result = extractToolCalls(toolBlocks);

      expect(result).toHaveLength(0);
    });

    it('should handle mixed order of tool uses and results', () => {
      const toolBlocks = [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'first_tool',
          input: { a: 1 }
        },
        {
          type: 'tool_use',
          id: 'tool-2',
          name: 'second_tool',
          input: { b: 2 }
        },
        {
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: 'First result'
        },
        {
          type: 'tool_result',
          tool_use_id: 'tool-2',
          content: 'Second result'
        }
      ];

      const result = extractToolCalls(toolBlocks);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('first_tool');
      expect(result[0].output).toBe('First result');
      expect(result[1].name).toBe('second_tool');
      expect(result[1].output).toBe('Second result');
    });

    it('should handle empty tool blocks array', () => {
      const result = extractToolCalls([]);

      expect(result).toHaveLength(0);
    });

    it('should handle complex tool inputs and outputs', () => {
      const toolBlocks = [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'complex_tool',
          input: {
            nested: {
              object: {
                with: ['array', 'values']
              }
            },
            number: 42,
            boolean: true
          }
        },
        {
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: {
            status: 'completed',
            results: [1, 2, 3],
            metadata: { processed: true }
          }
        }
      ];

      const result = extractToolCalls(toolBlocks);

      expect(result).toHaveLength(1);
      expect(result[0].input).toEqual({
        nested: {
          object: {
            with: ['array', 'values']
          }
        },
        number: 42,
        boolean: true
      });
      expect(result[0].output).toEqual({
        status: 'completed',
        results: [1, 2, 3],
        metadata: { processed: true }
      });
    });

    it('should not duplicate tool uses that have results', () => {
      const toolBlocks = [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'some_tool',
          input: { param: 'value' }
        },
        {
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: 'Result'
        }
      ];

      const result = extractToolCalls(toolBlocks);

      // Should only have one entry (with result), not two
      expect(result).toHaveLength(1);
      expect(result[0].output).toBe('Result');
    });

    it('should preserve multiple tool uses without results', () => {
      const toolBlocks = [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'tool_a',
          input: { a: 1 }
        },
        {
          type: 'tool_use',
          id: 'tool-2',
          name: 'tool_b',
          input: { b: 2 }
        }
      ];

      const result = extractToolCalls(toolBlocks);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('tool_a');
      expect(result[0].output).toBeUndefined();
      expect(result[1].name).toBe('tool_b');
      expect(result[1].output).toBeUndefined();
    });
  });

  describe('convertMessage() - integration with tool calls', () => {
    it('should include tool calls in metadata when present', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'assistant',
        uuid: baseUuid,
        timestamp: baseTimestamp,
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Using a tool' },
            { type: 'tool_use', id: 'tool-1', name: 'test_tool', input: { param: 'value' } },
            { type: 'tool_result', tool_use_id: 'tool-1', content: 'Tool output' }
          ]
        }
      };

      const result = convertMessage(claudeMsg, targetSessionId);

      expect(result.metadata).toBeDefined();
      expect(result.metadata.toolCalls).toHaveLength(1);
      expect(result.metadata.toolCalls[0]).toEqual({
        name: 'test_tool',
        input: { param: 'value' },
        output: 'Tool output'
      });
    });

    it('should include both usage and tool calls in metadata', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'assistant',
        uuid: baseUuid,
        timestamp: baseTimestamp,
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Using a tool' },
            { type: 'tool_use', id: 'tool-1', name: 'test_tool', input: {} },
            { type: 'tool_result', tool_use_id: 'tool-1', content: 'Result' }
          ],
          usage: {
            input_tokens: 100,
            output_tokens: 50
          }
        }
      };

      const result = convertMessage(claudeMsg, targetSessionId);

      expect(result.metadata).toBeDefined();
      expect(result.metadata.usage).toEqual({
        inputTokens: 100,
        outputTokens: 50
      });
      expect(result.metadata.toolCalls).toHaveLength(1);
    });

    it('should not include tool calls if array content has no tool blocks', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'assistant',
        uuid: baseUuid,
        timestamp: baseTimestamp,
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Just text' }
          ]
        }
      };

      const result = convertMessage(claudeMsg, targetSessionId);

      expect(result.metadata).toBeUndefined();
    });

    it('should handle string content without tool calls', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'assistant',
        uuid: baseUuid,
        timestamp: baseTimestamp,
        message: {
          role: 'assistant',
          content: 'String content has no tool calls',
          usage: {
            input_tokens: 10,
            output_tokens: 5
          }
        }
      };

      const result = convertMessage(claudeMsg, targetSessionId);

      expect(result.metadata).toBeDefined();
      expect(result.metadata.usage).toBeDefined();
      expect(result.metadata.toolCalls).toBeUndefined();
    });
  });

  describe('convertMessage() - role handling', () => {
    it('should preserve user role', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'user',
        uuid: baseUuid,
        timestamp: baseTimestamp,
        message: {
          role: 'user',
          content: 'User message'
        }
      };

      const result = convertMessage(claudeMsg, targetSessionId);
      expect(result.role).toBe('user');
    });

    it('should preserve assistant role', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'assistant',
        uuid: baseUuid,
        timestamp: baseTimestamp,
        message: {
          role: 'assistant',
          content: 'Assistant message'
        }
      };

      const result = convertMessage(claudeMsg, targetSessionId);
      expect(result.role).toBe('assistant');
    });

    it('should preserve system role', () => {
      const claudeMsg: ClaudeMessage = {
        type: 'user',
        uuid: baseUuid,
        timestamp: baseTimestamp,
        message: {
          role: 'system',
          content: 'System message'
        }
      };

      const result = convertMessage(claudeMsg, targetSessionId);
      expect(result.role).toBe('system');
    });
  });
});
