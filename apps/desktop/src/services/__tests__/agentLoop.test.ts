import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../clientAI', () => ({
  getClientAIConfig: vi.fn(),
  streamChatCompletion: vi.fn(),
}));

vi.mock('../agentTools', () => ({
  AGENT_TOOLS: [{ type: 'function', function: { name: 'list_backends', description: 'Test', parameters: {} } }],
  executeToolCall: vi.fn(),
}));

vi.mock('../agentStorage', () => ({
  loadMessages: vi.fn(),
  saveMessages: vi.fn(),
  clearMessages: vi.fn(),
}));

vi.mock('../agentContext', () => ({
  buildAgentContext: vi.fn(() => '## Connected Backends\n\nTest context'),
}));

import {
  initAgentLoop,
  getMessages,
  isAgentRunning,
  cancelAgentLoop,
  clearConversation,
  sendMessage,
  type AgentLoopCallbacks,
} from '../agentLoop';

import { getClientAIConfig, streamChatCompletion } from '../clientAI';
import { executeToolCall } from '../agentTools';
import { loadMessages, saveMessages, clearMessages } from '../agentStorage';

const mockGetConfig = getClientAIConfig as ReturnType<typeof vi.fn>;
const mockStream = streamChatCompletion as ReturnType<typeof vi.fn>;
const mockExecuteTool = executeToolCall as ReturnType<typeof vi.fn>;
const mockLoadMessages = loadMessages as ReturnType<typeof vi.fn>;
const mockSaveMessages = saveMessages as ReturnType<typeof vi.fn>;
const mockClearMessages = clearMessages as ReturnType<typeof vi.fn>;

function makeCallbacks(): AgentLoopCallbacks & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {
    onDelta: [],
    onAssistantStart: [],
    onToolCallStart: [],
    onToolCallResult: [],
    onComplete: [],
    onError: [],
  };
  return {
    calls,
    onDelta: (...args: unknown[]) => calls.onDelta.push(args),
    onAssistantStart: (...args: unknown[]) => calls.onAssistantStart.push(args),
    onToolCallStart: (...args: unknown[]) => calls.onToolCallStart.push(args),
    onToolCallResult: (...args: unknown[]) => calls.onToolCallResult.push(args),
    onComplete: (...args: unknown[]) => calls.onComplete.push(args),
    onError: (...args: unknown[]) => calls.onError.push(args),
  };
}

// Helper: create an async generator from events
async function* fakeStream(events: Array<{ type: string; content?: string; toolCall?: unknown; error?: string }>) {
  for (const event of events) {
    yield event;
  }
}

describe('agentLoop', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockLoadMessages.mockResolvedValue([]);
    mockSaveMessages.mockResolvedValue(undefined);
    mockClearMessages.mockResolvedValue(undefined);
    // Reset internal state by clearing conversation
    await clearConversation();
  });

  describe('initAgentLoop', () => {
    it('loads messages from storage', async () => {
      const savedMessages = [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ];
      mockLoadMessages.mockResolvedValue(savedMessages);

      const result = await initAgentLoop();

      expect(mockLoadMessages).toHaveBeenCalled();
      expect(result).toEqual(savedMessages);
    });
  });

  describe('getMessages', () => {
    it('returns current conversation messages', async () => {
      mockLoadMessages.mockResolvedValue([{ role: 'user', content: 'test' }]);
      await initAgentLoop();

      expect(getMessages()).toEqual([{ role: 'user', content: 'test' }]);
    });
  });

  describe('isAgentRunning', () => {
    it('returns false initially', () => {
      expect(isAgentRunning()).toBe(false);
    });
  });

  describe('sendMessage', () => {
    it('errors when config is missing', async () => {
      mockGetConfig.mockReturnValue(null);
      const cb = makeCallbacks();

      await sendMessage('hello', cb);

      expect(cb.calls.onError).toHaveLength(1);
      expect(cb.calls.onError[0][0]).toContain('not configured');
    });

    it('errors when already running', async () => {
      mockGetConfig.mockReturnValue({ apiEndpoint: 'http://test', apiKey: 'key', model: 'model' });
      // Make the stream never resolve to keep isRunning = true
      mockStream.mockReturnValue(fakeStream([
        { type: 'delta', content: 'wait...' },
      ]));

      // Start first message (will hang until stream completes, but the async generator
      // finishes immediately with our fake stream, so we need a different approach)
      // Instead, let's start a send that takes time
      let resolveStream: () => void;
      const slowStream = async function* () {
        await new Promise<void>(r => { resolveStream = r; });
        yield { type: 'done' as const };
      };
      mockStream.mockReturnValue(slowStream());

      const cb1 = makeCallbacks();
      const promise1 = sendMessage('first', cb1);

      // Try second message while first is running
      const cb2 = makeCallbacks();
      await sendMessage('second', cb2);

      expect(cb2.calls.onError).toHaveLength(1);
      expect(cb2.calls.onError[0][0]).toContain('already running');

      // Cleanup: resolve the first stream
      resolveStream!();
      await promise1;
    });

    it('streams content deltas and completes', async () => {
      mockGetConfig.mockReturnValue({ apiEndpoint: 'http://test', apiKey: 'key', model: 'model' });
      mockStream.mockReturnValue(fakeStream([
        { type: 'delta', content: 'Hello' },
        { type: 'delta', content: ' world' },
        { type: 'done' },
      ]));

      const cb = makeCallbacks();
      await sendMessage('hi', cb);

      expect(cb.calls.onAssistantStart).toHaveLength(1);
      expect(cb.calls.onDelta).toHaveLength(2);
      expect(cb.calls.onDelta[0][0]).toBe('Hello');
      expect(cb.calls.onDelta[1][0]).toBe(' world');
      expect(cb.calls.onComplete).toHaveLength(1);
      expect(cb.calls.onComplete[0][0]).toBe('Hello world');

      // Should persist messages
      expect(mockSaveMessages).toHaveBeenCalled();
    });

    it('adds user and assistant messages to conversation', async () => {
      mockGetConfig.mockReturnValue({ apiEndpoint: 'http://test', apiKey: 'key', model: 'model' });
      mockStream.mockReturnValue(fakeStream([
        { type: 'delta', content: 'Response' },
        { type: 'done' },
      ]));

      await sendMessage('User input', makeCallbacks());

      const msgs = getMessages();
      expect(msgs).toHaveLength(2);
      expect(msgs[0]).toEqual({ role: 'user', content: 'User input' });
      expect(msgs[1]).toEqual({ role: 'assistant', content: 'Response' });
    });

    it('executes tool calls and loops', async () => {
      mockGetConfig.mockReturnValue({ apiEndpoint: 'http://test', apiKey: 'key', model: 'model' });

      let callCount = 0;
      mockStream.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First iteration: return tool call
          return fakeStream([
            { type: 'tool_call', toolCall: { id: 'tc-1', type: 'function', function: { name: 'list_backends', arguments: '{}' } } },
            { type: 'done' },
          ]);
        }
        // Second iteration: return final content
        return fakeStream([
          { type: 'delta', content: 'Here are the backends.' },
          { type: 'done' },
        ]);
      });

      mockExecuteTool.mockResolvedValue('{"backends":[]}');

      const cb = makeCallbacks();
      await sendMessage('list backends', cb);

      expect(cb.calls.onToolCallStart).toHaveLength(1);
      expect(cb.calls.onToolCallStart[0][0]).toBe('list_backends');
      expect(cb.calls.onToolCallResult).toHaveLength(1);
      expect(cb.calls.onComplete).toHaveLength(1);
      expect(cb.calls.onComplete[0][0]).toBe('Here are the backends.');

      // Conversation should include user, assistant (with tool_calls), tool result, and final assistant
      const msgs = getMessages();
      expect(msgs[0].role).toBe('user');
      expect(msgs[1].role).toBe('assistant');
      expect(msgs[1].tool_calls).toHaveLength(1);
      expect(msgs[2].role).toBe('tool');
      expect(msgs[3].role).toBe('assistant');
      expect(msgs[3].content).toBe('Here are the backends.');
    });

    it('handles stream error events', async () => {
      mockGetConfig.mockReturnValue({ apiEndpoint: 'http://test', apiKey: 'key', model: 'model' });
      mockStream.mockReturnValue(fakeStream([
        { type: 'error', error: 'Rate limit exceeded' },
      ]));

      const cb = makeCallbacks();
      await sendMessage('hi', cb);

      expect(cb.calls.onError).toHaveLength(1);
      expect(cb.calls.onError[0][0]).toBe('Rate limit exceeded');
    });

    it('isRunning resets after completion', async () => {
      mockGetConfig.mockReturnValue({ apiEndpoint: 'http://test', apiKey: 'key', model: 'model' });
      mockStream.mockReturnValue(fakeStream([
        { type: 'delta', content: 'done' },
        { type: 'done' },
      ]));

      await sendMessage('hi', makeCallbacks());

      expect(isAgentRunning()).toBe(false);
    });

    it('isRunning resets after error', async () => {
      mockGetConfig.mockReturnValue({ apiEndpoint: 'http://test', apiKey: 'key', model: 'model' });
      mockStream.mockReturnValue(fakeStream([
        { type: 'error', error: 'fail' },
      ]));

      await sendMessage('hi', makeCallbacks());

      expect(isAgentRunning()).toBe(false);
    });
  });

  describe('clearConversation', () => {
    it('clears messages and storage', async () => {
      mockGetConfig.mockReturnValue({ apiEndpoint: 'http://test', apiKey: 'key', model: 'model' });
      mockStream.mockReturnValue(fakeStream([
        { type: 'delta', content: 'hi' },
        { type: 'done' },
      ]));

      await sendMessage('test', makeCallbacks());
      expect(getMessages().length).toBeGreaterThan(0);

      await clearConversation();

      expect(getMessages()).toEqual([]);
      expect(mockClearMessages).toHaveBeenCalled();
    });
  });

  describe('cancelAgentLoop', () => {
    it('can be called safely when not running', () => {
      expect(() => cancelAgentLoop()).not.toThrow();
      expect(isAgentRunning()).toBe(false);
    });
  });
});
