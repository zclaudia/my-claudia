import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './chatStore';
import type { Message } from '@my-claudia/shared';

describe('chatStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useChatStore.setState({
      messages: {},
      pagination: {},
      activeRuns: {},
      activeToolCalls: {},
      toolCallsHistory: {},
      sessionUsage: {},
      modelOverrides: {},
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

  describe('run lifecycle', () => {
    it('startRun registers a run and initializes tool call state', () => {
      useChatStore.getState().startRun('run-1', 'session-1');

      expect(useChatStore.getState().activeRuns['run-1']).toBe('session-1');
      expect(useChatStore.getState().activeToolCalls['run-1']).toEqual({});
      expect(useChatStore.getState().toolCallsHistory['run-1']).toEqual([]);
    });

    it('endRun removes the run and its tool call state', () => {
      useChatStore.getState().startRun('run-1', 'session-1');
      useChatStore.getState().endRun('run-1');

      expect(useChatStore.getState().activeRuns['run-1']).toBeUndefined();
      expect(useChatStore.getState().activeToolCalls['run-1']).toBeUndefined();
      expect(useChatStore.getState().toolCallsHistory['run-1']).toBeUndefined();
    });

    it('isSessionLoading returns true when session has an active run', () => {
      useChatStore.getState().startRun('run-1', 'session-1');

      expect(useChatStore.getState().isSessionLoading('session-1')).toBe(true);
      expect(useChatStore.getState().isSessionLoading('session-2')).toBe(false);
    });

    it('isSessionLoading returns false after endRun', () => {
      useChatStore.getState().startRun('run-1', 'session-1');
      useChatStore.getState().endRun('run-1');

      expect(useChatStore.getState().isSessionLoading('session-1')).toBe(false);
    });

    it('getSessionRunId returns active runId for a session', () => {
      useChatStore.getState().startRun('run-1', 'session-1');

      expect(useChatStore.getState().getSessionRunId('session-1')).toBe('run-1');
      expect(useChatStore.getState().getSessionRunId('session-2')).toBeNull();
    });

    it('supports multiple concurrent runs', () => {
      useChatStore.getState().startRun('run-1', 'session-1');
      useChatStore.getState().startRun('run-2', 'session-2');

      expect(useChatStore.getState().isSessionLoading('session-1')).toBe(true);
      expect(useChatStore.getState().isSessionLoading('session-2')).toBe(true);
      expect(useChatStore.getState().getSessionRunId('session-1')).toBe('run-1');
      expect(useChatStore.getState().getSessionRunId('session-2')).toBe('run-2');

      // End one run, the other should still be active
      useChatStore.getState().endRun('run-1');
      expect(useChatStore.getState().isSessionLoading('session-1')).toBe(false);
      expect(useChatStore.getState().isSessionLoading('session-2')).toBe(true);
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

  describe('modelOverride (per-session)', () => {
    it('setModelOverride sets model for a specific session', () => {
      useChatStore.getState().setModelOverride('session-1', 'claude-opus-4-6');
      expect(useChatStore.getState().getModelOverride('session-1')).toBe('claude-opus-4-6');
      expect(useChatStore.getState().getModelOverride('session-2')).toBe('');
    });

    it('setModelOverride with empty string clears to default', () => {
      useChatStore.getState().setModelOverride('session-1', 'claude-opus-4-6');
      useChatStore.getState().setModelOverride('session-1', '');
      expect(useChatStore.getState().getModelOverride('session-1')).toBe('');
    });

    it('different sessions have independent model overrides', () => {
      useChatStore.getState().setModelOverride('session-1', 'claude-opus-4-6');
      useChatStore.getState().setModelOverride('session-2', 'local/glm-4.6v');
      expect(useChatStore.getState().getModelOverride('session-1')).toBe('claude-opus-4-6');
      expect(useChatStore.getState().getModelOverride('session-2')).toBe('local/glm-4.6v');
    });
  });

  describe('toolCalls', () => {
    const RUN_ID = 'run-1';

    beforeEach(() => {
      // Start a run so tool calls have a context
      useChatStore.getState().startRun(RUN_ID, 'session-1');
    });

    it('addToolCall creates a new running tool call', () => {
      useChatStore.getState().addToolCall(RUN_ID, 'tc-1', 'Read', { file_path: '/foo.ts' });

      const tc = useChatStore.getState().activeToolCalls[RUN_ID]['tc-1'];
      expect(tc).toBeDefined();
      expect(tc.toolName).toBe('Read');
      expect(tc.status).toBe('running');
      expect(tc.toolInput).toEqual({ file_path: '/foo.ts' });
    });

    it('addToolCall appends to toolCallsHistory in order', () => {
      useChatStore.getState().addToolCall(RUN_ID, 'tc-1', 'Read', {});
      useChatStore.getState().addToolCall(RUN_ID, 'tc-2', 'Edit', {});

      const history = useChatStore.getState().toolCallsHistory[RUN_ID];
      expect(history).toHaveLength(2);
      expect(history[0].id).toBe('tc-1');
      expect(history[1].id).toBe('tc-2');
    });

    it('updateToolCallResult marks tool as completed', () => {
      useChatStore.getState().addToolCall(RUN_ID, 'tc-1', 'Read', {});
      useChatStore.getState().updateToolCallResult(RUN_ID, 'tc-1', 'file content here');

      const tc = useChatStore.getState().activeToolCalls[RUN_ID]['tc-1'];
      expect(tc.status).toBe('completed');
      expect(tc.result).toBe('file content here');
      expect(tc.isError).toBeUndefined();
    });

    it('updateToolCallResult marks tool as error when isError is true', () => {
      useChatStore.getState().addToolCall(RUN_ID, 'tc-1', 'Bash', {});
      useChatStore.getState().updateToolCallResult(RUN_ID, 'tc-1', 'command failed', true);

      const tc = useChatStore.getState().activeToolCalls[RUN_ID]['tc-1'];
      expect(tc.status).toBe('error');
      expect(tc.isError).toBe(true);
    });

    it('updateToolCallResult also updates toolCallsHistory', () => {
      useChatStore.getState().addToolCall(RUN_ID, 'tc-1', 'Read', {});
      useChatStore.getState().updateToolCallResult(RUN_ID, 'tc-1', 'done');

      const history = useChatStore.getState().toolCallsHistory[RUN_ID];
      expect(history[0].status).toBe('completed');
    });

    it('updateToolCallResult does nothing for unknown tool id', () => {
      useChatStore.getState().addToolCall(RUN_ID, 'tc-1', 'Read', {});
      useChatStore.getState().updateToolCallResult(RUN_ID, 'tc-unknown', 'result');

      // Original tool call should be unchanged
      expect(useChatStore.getState().activeToolCalls[RUN_ID]['tc-1'].status).toBe('running');
    });

    it('endRun cleans up tool calls for that run', () => {
      useChatStore.getState().addToolCall(RUN_ID, 'tc-1', 'Read', {});
      useChatStore.getState().addToolCall(RUN_ID, 'tc-2', 'Edit', {});
      useChatStore.getState().endRun(RUN_ID);

      expect(useChatStore.getState().activeToolCalls[RUN_ID]).toBeUndefined();
      expect(useChatStore.getState().toolCallsHistory[RUN_ID]).toBeUndefined();
    });

    it('tool calls from different runs are isolated', () => {
      useChatStore.getState().startRun('run-2', 'session-2');
      useChatStore.getState().addToolCall(RUN_ID, 'tc-1', 'Read', {});
      useChatStore.getState().addToolCall('run-2', 'tc-2', 'Edit', {});

      expect(Object.keys(useChatStore.getState().activeToolCalls[RUN_ID])).toEqual(['tc-1']);
      expect(Object.keys(useChatStore.getState().activeToolCalls['run-2'])).toEqual(['tc-2']);

      // End one run, other's tool calls remain
      useChatStore.getState().endRun(RUN_ID);
      expect(useChatStore.getState().activeToolCalls[RUN_ID]).toBeUndefined();
      expect(useChatStore.getState().activeToolCalls['run-2']['tc-2']).toBeDefined();
    });

    it('getSessionToolCalls returns tool calls for the session active run', () => {
      useChatStore.getState().addToolCall(RUN_ID, 'tc-1', 'Read', { file_path: '/a.ts' });
      useChatStore.getState().addToolCall(RUN_ID, 'tc-2', 'Edit', {});

      const toolCalls = useChatStore.getState().getSessionToolCalls('session-1');
      expect(toolCalls).toHaveLength(2);
      expect(toolCalls.map(tc => tc.id).sort()).toEqual(['tc-1', 'tc-2']);
    });

    it('getSessionToolCalls returns empty for session without active run', () => {
      expect(useChatStore.getState().getSessionToolCalls('session-other')).toEqual([]);
    });

    it('finalizeToolCallsToMessage attaches tool calls to last assistant message', () => {
      // Set up an assistant message
      const message = createMessage({ id: 'msg-1', role: 'assistant', content: 'Response' });
      useChatStore.getState().addMessage('session-1', message);

      // Add tool calls
      useChatStore.getState().addToolCall(RUN_ID, 'tc-1', 'Read', { file_path: '/a.ts' });
      useChatStore.getState().updateToolCallResult(RUN_ID, 'tc-1', 'contents');

      // Finalize (now takes runId, looks up sessionId from activeRuns)
      useChatStore.getState().finalizeToolCallsToMessage(RUN_ID);

      const messages = useChatStore.getState().messages['session-1'];
      expect(messages[0].toolCalls).toHaveLength(1);
      expect(messages[0].toolCalls![0].toolName).toBe('Read');
      expect(messages[0].toolCalls![0].status).toBe('completed');
    });

    it('finalizeToolCallsToMessage does nothing if last message is not assistant', () => {
      const message = createMessage({ id: 'msg-1', role: 'user', content: 'User msg' });
      useChatStore.getState().addMessage('session-1', message);
      useChatStore.getState().addToolCall(RUN_ID, 'tc-1', 'Read', {});

      useChatStore.getState().finalizeToolCallsToMessage(RUN_ID);

      // Tool calls should remain
      expect(useChatStore.getState().toolCallsHistory[RUN_ID]).toHaveLength(1);
    });

    it('finalizeToolCallsToMessage does nothing if no tool calls exist', () => {
      const message = createMessage({ id: 'msg-1', role: 'assistant', content: 'Response' });
      useChatStore.getState().addMessage('session-1', message);

      useChatStore.getState().finalizeToolCallsToMessage(RUN_ID);

      const messages = useChatStore.getState().messages['session-1'];
      expect(messages[0].toolCalls).toBeUndefined();
    });
  });
});
