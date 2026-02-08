import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './chatStore';
import type { Message } from '@my-claudia/shared';

describe('chatStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useChatStore.setState({
      messages: {},
      pagination: {},
      isLoading: false,
      currentRunId: null,
      activeToolCalls: {},
      toolCallsHistory: [],
      sessionUsage: {},
      modelOverride: '',
    });
  });

  const createMessage = (overrides: Partial<Message> = {}): Message => ({
    id: 'msg-1',
    sessionId: 'session-1',
    role: 'user',
    content: 'Test message',
    createdAt: Date.now(),
    ...overrides,
  });

  describe('setMessages', () => {
    it('sets messages for a session', () => {
      const messages = [createMessage()];
      useChatStore.getState().setMessages('session-1', messages);

      expect(useChatStore.getState().messages['session-1']).toEqual(messages);
    });

    it('replaces existing messages', () => {
      const oldMessages = [createMessage({ id: 'old' })];
      const newMessages = [createMessage({ id: 'new' })];

      useChatStore.getState().setMessages('session-1', oldMessages);
      useChatStore.getState().setMessages('session-1', newMessages);

      expect(useChatStore.getState().messages['session-1']).toEqual(newMessages);
    });

    it('does not affect other sessions', () => {
      const messages1 = [createMessage({ id: '1', sessionId: 'session-1' })];
      const messages2 = [createMessage({ id: '2', sessionId: 'session-2' })];

      useChatStore.getState().setMessages('session-1', messages1);
      useChatStore.getState().setMessages('session-2', messages2);

      expect(useChatStore.getState().messages['session-1']).toEqual(messages1);
      expect(useChatStore.getState().messages['session-2']).toEqual(messages2);
    });
  });

  describe('addMessage', () => {
    it('adds a message to an empty session', () => {
      const message = createMessage();
      useChatStore.getState().addMessage('session-1', message);

      expect(useChatStore.getState().messages['session-1']).toEqual([message]);
    });

    it('appends message to existing messages', () => {
      const message1 = createMessage({ id: '1' });
      const message2 = createMessage({ id: '2' });

      useChatStore.getState().addMessage('session-1', message1);
      useChatStore.getState().addMessage('session-1', message2);

      expect(useChatStore.getState().messages['session-1']).toEqual([
        message1,
        message2,
      ]);
    });
  });

  describe('appendToLastMessage', () => {
    it('appends content to the last assistant message', () => {
      const message = createMessage({ role: 'assistant', content: 'Hello' });
      useChatStore.getState().addMessage('session-1', message);
      useChatStore.getState().appendToLastMessage('session-1', ' World');

      expect(useChatStore.getState().messages['session-1'][0].content).toBe(
        'Hello World'
      );
    });

    it('does not append to user message', () => {
      const message = createMessage({ role: 'user', content: 'Hello' });
      useChatStore.getState().addMessage('session-1', message);
      useChatStore.getState().appendToLastMessage('session-1', ' World');

      expect(useChatStore.getState().messages['session-1'][0].content).toBe(
        'Hello'
      );
    });

    it('does nothing for empty session', () => {
      useChatStore.getState().appendToLastMessage('session-1', 'content');
      expect(useChatStore.getState().messages['session-1']).toBeUndefined();
    });

    it('does not modify previous messages', () => {
      const message1 = createMessage({ id: '1', role: 'user', content: 'User' });
      const message2 = createMessage({
        id: '2',
        role: 'assistant',
        content: 'AI',
      });

      useChatStore.getState().addMessage('session-1', message1);
      useChatStore.getState().addMessage('session-1', message2);
      useChatStore.getState().appendToLastMessage('session-1', ' Response');

      expect(useChatStore.getState().messages['session-1'][0].content).toBe(
        'User'
      );
      expect(useChatStore.getState().messages['session-1'][1].content).toBe(
        'AI Response'
      );
    });
  });

  describe('clearMessages', () => {
    it('clears messages for a session', () => {
      const message = createMessage();
      useChatStore.getState().addMessage('session-1', message);
      useChatStore.getState().clearMessages('session-1');

      expect(useChatStore.getState().messages['session-1']).toEqual([]);
    });

    it('does not affect other sessions', () => {
      useChatStore.getState().addMessage('session-1', createMessage());
      useChatStore.getState().addMessage('session-2', createMessage());
      useChatStore.getState().clearMessages('session-1');

      expect(useChatStore.getState().messages['session-1']).toEqual([]);
      expect(useChatStore.getState().messages['session-2']).toHaveLength(1);
    });
  });

  describe('setLoading', () => {
    it('sets loading state to true', () => {
      useChatStore.getState().setLoading(true);
      expect(useChatStore.getState().isLoading).toBe(true);
    });

    it('sets loading state to false', () => {
      useChatStore.getState().setLoading(true);
      useChatStore.getState().setLoading(false);
      expect(useChatStore.getState().isLoading).toBe(false);
    });
  });

  describe('setCurrentRunId', () => {
    it('sets current run ID', () => {
      useChatStore.getState().setCurrentRunId('run-123');
      expect(useChatStore.getState().currentRunId).toBe('run-123');
    });

    it('clears current run ID', () => {
      useChatStore.getState().setCurrentRunId('run-123');
      useChatStore.getState().setCurrentRunId(null);
      expect(useChatStore.getState().currentRunId).toBeNull();
    });
  });

  describe('pagination', () => {
    it('sets pagination with setMessages', () => {
      const messages = [createMessage()];
      const pagination = { total: 100, hasMore: true, oldestTimestamp: 1000, newestTimestamp: 2000 };

      useChatStore.getState().setMessages('session-1', messages, pagination);

      const storedPagination = useChatStore.getState().pagination['session-1'];
      expect(storedPagination?.total).toBe(100);
      expect(storedPagination?.hasMore).toBe(true);
      expect(storedPagination?.isLoadingMore).toBe(false);
    });

    it('prepends messages with prependMessages', () => {
      const existingMessage = createMessage({ id: 'new', createdAt: 2000 });
      const olderMessage = createMessage({ id: 'old', createdAt: 1000 });

      useChatStore.getState().setMessages('session-1', [existingMessage]);
      useChatStore.getState().prependMessages('session-1', [olderMessage], { total: 2, hasMore: false });

      const messages = useChatStore.getState().messages['session-1'];
      expect(messages).toHaveLength(2);
      expect(messages[0].id).toBe('old');
      expect(messages[1].id).toBe('new');
    });

    it('setLoadingMore updates isLoadingMore', () => {
      useChatStore.getState().setLoadingMore('session-1', true);
      expect(useChatStore.getState().pagination['session-1']?.isLoadingMore).toBe(true);

      useChatStore.getState().setLoadingMore('session-1', false);
      expect(useChatStore.getState().pagination['session-1']?.isLoadingMore).toBe(false);
    });

    it('clearMessages resets pagination', () => {
      useChatStore.getState().setMessages('session-1', [createMessage()], { total: 10, hasMore: true });
      useChatStore.getState().clearMessages('session-1');

      const pagination = useChatStore.getState().pagination['session-1'];
      expect(pagination?.total).toBe(0);
      expect(pagination?.hasMore).toBe(false);
    });

    it('addMessage updates pagination newestTimestamp', () => {
      const timestamp = Date.now();
      const message = createMessage({ createdAt: timestamp });

      useChatStore.getState().setMessages('session-1', [], { total: 0, hasMore: false });
      useChatStore.getState().addMessage('session-1', message);

      const pagination = useChatStore.getState().pagination['session-1'];
      expect(pagination?.total).toBe(1);
      expect(pagination?.newestTimestamp).toBe(timestamp);
    });
  });

  describe('sessionUsage', () => {
    it('addSessionUsage initializes usage for new session', () => {
      useChatStore.getState().addSessionUsage('session-1', { inputTokens: 100, outputTokens: 50 });

      const usage = useChatStore.getState().sessionUsage['session-1'];
      expect(usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    });

    it('addSessionUsage accumulates tokens across multiple calls', () => {
      useChatStore.getState().addSessionUsage('session-1', { inputTokens: 100, outputTokens: 50 });
      useChatStore.getState().addSessionUsage('session-1', { inputTokens: 200, outputTokens: 75 });

      const usage = useChatStore.getState().sessionUsage['session-1'];
      expect(usage).toEqual({ inputTokens: 300, outputTokens: 125 });
    });

    it('addSessionUsage does not affect other sessions', () => {
      useChatStore.getState().addSessionUsage('session-1', { inputTokens: 100, outputTokens: 50 });
      useChatStore.getState().addSessionUsage('session-2', { inputTokens: 200, outputTokens: 75 });

      expect(useChatStore.getState().sessionUsage['session-1']).toEqual({ inputTokens: 100, outputTokens: 50 });
      expect(useChatStore.getState().sessionUsage['session-2']).toEqual({ inputTokens: 200, outputTokens: 75 });
    });
  });

  describe('modelOverride', () => {
    it('setModelOverride sets model string', () => {
      useChatStore.getState().setModelOverride('claude-opus-4-6');
      expect(useChatStore.getState().modelOverride).toBe('claude-opus-4-6');
    });

    it('setModelOverride with empty string clears to default', () => {
      useChatStore.getState().setModelOverride('claude-opus-4-6');
      useChatStore.getState().setModelOverride('');
      expect(useChatStore.getState().modelOverride).toBe('');
    });
  });

  describe('toolCalls', () => {
    it('addToolCall creates a new running tool call', () => {
      useChatStore.getState().addToolCall('tc-1', 'Read', { file_path: '/foo.ts' });

      const tc = useChatStore.getState().activeToolCalls['tc-1'];
      expect(tc).toBeDefined();
      expect(tc.toolName).toBe('Read');
      expect(tc.status).toBe('running');
      expect(tc.toolInput).toEqual({ file_path: '/foo.ts' });
    });

    it('addToolCall appends to toolCallsHistory in order', () => {
      useChatStore.getState().addToolCall('tc-1', 'Read', {});
      useChatStore.getState().addToolCall('tc-2', 'Edit', {});

      const history = useChatStore.getState().toolCallsHistory;
      expect(history).toHaveLength(2);
      expect(history[0].id).toBe('tc-1');
      expect(history[1].id).toBe('tc-2');
    });

    it('updateToolCallResult marks tool as completed', () => {
      useChatStore.getState().addToolCall('tc-1', 'Read', {});
      useChatStore.getState().updateToolCallResult('tc-1', 'file content here');

      const tc = useChatStore.getState().activeToolCalls['tc-1'];
      expect(tc.status).toBe('completed');
      expect(tc.result).toBe('file content here');
      expect(tc.isError).toBeUndefined();
    });

    it('updateToolCallResult marks tool as error when isError is true', () => {
      useChatStore.getState().addToolCall('tc-1', 'Bash', {});
      useChatStore.getState().updateToolCallResult('tc-1', 'command failed', true);

      const tc = useChatStore.getState().activeToolCalls['tc-1'];
      expect(tc.status).toBe('error');
      expect(tc.isError).toBe(true);
    });

    it('updateToolCallResult also updates toolCallsHistory', () => {
      useChatStore.getState().addToolCall('tc-1', 'Read', {});
      useChatStore.getState().updateToolCallResult('tc-1', 'done');

      const history = useChatStore.getState().toolCallsHistory;
      expect(history[0].status).toBe('completed');
    });

    it('updateToolCallResult does nothing for unknown tool id', () => {
      useChatStore.getState().addToolCall('tc-1', 'Read', {});
      useChatStore.getState().updateToolCallResult('tc-unknown', 'result');

      // Original tool call should be unchanged
      expect(useChatStore.getState().activeToolCalls['tc-1'].status).toBe('running');
    });

    it('clearToolCalls empties both activeToolCalls and history', () => {
      useChatStore.getState().addToolCall('tc-1', 'Read', {});
      useChatStore.getState().addToolCall('tc-2', 'Edit', {});
      useChatStore.getState().clearToolCalls();

      expect(useChatStore.getState().activeToolCalls).toEqual({});
      expect(useChatStore.getState().toolCallsHistory).toEqual([]);
    });

    it('finalizeToolCallsToMessage attaches tool calls to last assistant message', () => {
      // Set up an assistant message
      const message = createMessage({ id: 'msg-1', role: 'assistant', content: 'Response' });
      useChatStore.getState().addMessage('session-1', message);

      // Add tool calls
      useChatStore.getState().addToolCall('tc-1', 'Read', { file_path: '/a.ts' });
      useChatStore.getState().updateToolCallResult('tc-1', 'contents');

      // Finalize
      useChatStore.getState().finalizeToolCallsToMessage('session-1');

      const messages = useChatStore.getState().messages['session-1'];
      expect(messages[0].toolCalls).toHaveLength(1);
      expect(messages[0].toolCalls![0].toolName).toBe('Read');
      expect(messages[0].toolCalls![0].status).toBe('completed');

      // Tool calls should be cleared
      expect(useChatStore.getState().activeToolCalls).toEqual({});
      expect(useChatStore.getState().toolCallsHistory).toEqual([]);
    });

    it('finalizeToolCallsToMessage does nothing if last message is not assistant', () => {
      const message = createMessage({ id: 'msg-1', role: 'user', content: 'User msg' });
      useChatStore.getState().addMessage('session-1', message);
      useChatStore.getState().addToolCall('tc-1', 'Read', {});

      useChatStore.getState().finalizeToolCallsToMessage('session-1');

      // Tool calls should remain
      expect(useChatStore.getState().toolCallsHistory).toHaveLength(1);
    });

    it('finalizeToolCallsToMessage does nothing if no tool calls exist', () => {
      const message = createMessage({ id: 'msg-1', role: 'assistant', content: 'Response' });
      useChatStore.getState().addMessage('session-1', message);

      useChatStore.getState().finalizeToolCallsToMessage('session-1');

      const messages = useChatStore.getState().messages['session-1'];
      expect(messages[0].toolCalls).toBeUndefined();
    });
  });
});
