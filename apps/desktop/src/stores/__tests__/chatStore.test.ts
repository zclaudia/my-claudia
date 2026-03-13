import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore, type MessageWithToolCalls } from '../chatStore';

const makeMsg = (id: string, role: 'user' | 'assistant' = 'user', content = 'hello'): MessageWithToolCalls => ({
  id,
  sessionId: 'sess-1',
  role,
  content,
  createdAt: Date.now(),
});

describe('chatStore', () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: {},
      pagination: {},
      activeRuns: {},
      backgroundRunIds: new Set(),
      runHealth: {},
      activeToolCalls: {},
      toolCallsHistory: {},
      runContentBlocks: {},
      systemInfoBySession: {},
      modeOverrides: {},
      sessionUsage: {},
      modelOverrides: {},
      permissionOverrides: {},
      worktreeOverrides: {},
      drafts: {},
    });
  });

  // ── Messages ────────────────────────────────────────

  describe('setMessages', () => {
    it('sets messages for a session', () => {
      const msgs = [makeMsg('m1'), makeMsg('m2')];
      useChatStore.getState().setMessages('sess-1', msgs);
      expect(useChatStore.getState().messages['sess-1']).toEqual(msgs);
    });

    it('sets pagination when provided', () => {
      useChatStore.getState().setMessages('sess-1', [], { total: 10, hasMore: true });
      const p = useChatStore.getState().pagination['sess-1'];
      expect(p.total).toBe(10);
      expect(p.hasMore).toBe(true);
      expect(p.isLoadingMore).toBe(false);
    });
  });

  describe('prependMessages', () => {
    it('prepends messages to existing', () => {
      useChatStore.getState().setMessages('sess-1', [makeMsg('m2')]);
      useChatStore.getState().prependMessages('sess-1', [makeMsg('m1')]);
      const msgs = useChatStore.getState().messages['sess-1'];
      expect(msgs).toHaveLength(2);
      expect(msgs[0].id).toBe('m1');
      expect(msgs[1].id).toBe('m2');
    });
  });

  describe('appendMessages', () => {
    it('appends messages to existing', () => {
      useChatStore.getState().setMessages('sess-1', [makeMsg('m1')]);
      useChatStore.getState().appendMessages('sess-1', [makeMsg('m2')]);
      const msgs = useChatStore.getState().messages['sess-1'];
      expect(msgs).toHaveLength(2);
      expect(msgs[1].id).toBe('m2');
    });

    it('deduplicates by message ID', () => {
      useChatStore.getState().setMessages('sess-1', [makeMsg('m1')]);
      useChatStore.getState().appendMessages('sess-1', [makeMsg('m1'), makeMsg('m2')]);
      expect(useChatStore.getState().messages['sess-1']).toHaveLength(2);
    });

    it('returns state unchanged when all messages are duplicates', () => {
      useChatStore.getState().setMessages('sess-1', [makeMsg('m1')]);
      const before = useChatStore.getState().messages;
      useChatStore.getState().appendMessages('sess-1', [makeMsg('m1')]);
      expect(useChatStore.getState().messages).toBe(before);
    });

    it('updates pagination maxOffset', () => {
      useChatStore.getState().setMessages('sess-1', [makeMsg('m1')], { total: 1, hasMore: false, maxOffset: 5 });
      useChatStore.getState().appendMessages('sess-1', [makeMsg('m2')], { total: 2, hasMore: false, maxOffset: 10 });
      expect(useChatStore.getState().pagination['sess-1'].maxOffset).toBe(10);
    });
  });

  describe('addMessage', () => {
    it('adds message to session', () => {
      useChatStore.getState().addMessage('sess-1', makeMsg('m1'));
      expect(useChatStore.getState().messages['sess-1']).toHaveLength(1);
    });

    it('deduplicates by id', () => {
      useChatStore.getState().addMessage('sess-1', makeMsg('m1'));
      useChatStore.getState().addMessage('sess-1', makeMsg('m1'));
      expect(useChatStore.getState().messages['sess-1']).toHaveLength(1);
    });

    it('deduplicates by clientMessageId', () => {
      const msg1 = { ...makeMsg('m1'), clientMessageId: 'client-1' };
      const msg2 = { ...makeMsg('m2'), clientMessageId: 'client-1' };
      useChatStore.getState().addMessage('sess-1', msg1);
      useChatStore.getState().addMessage('sess-1', msg2);
      expect(useChatStore.getState().messages['sess-1']).toHaveLength(1);
    });

    it('updates pagination total and newestTimestamp', () => {
      const msg = makeMsg('m1');
      useChatStore.getState().addMessage('sess-1', msg);
      const p = useChatStore.getState().pagination['sess-1'];
      expect(p.total).toBe(1);
      expect(p.newestTimestamp).toBe(msg.createdAt);
    });
  });

  describe('updateMessageIdByClientMessageId', () => {
    it('updates message id by clientMessageId', () => {
      const msg = { ...makeMsg('temp-id'), clientMessageId: 'client-1' };
      useChatStore.getState().addMessage('sess-1', msg);
      useChatStore.getState().updateMessageIdByClientMessageId('sess-1', 'client-1', 'server-id');
      expect(useChatStore.getState().messages['sess-1'][0].id).toBe('server-id');
    });

    it('does nothing when clientMessageId not found', () => {
      useChatStore.getState().addMessage('sess-1', makeMsg('m1'));
      const before = useChatStore.getState().messages;
      useChatStore.getState().updateMessageIdByClientMessageId('sess-1', 'nonexistent', 'new-id');
      expect(useChatStore.getState().messages).toBe(before);
    });
  });

  describe('appendToLastMessage', () => {
    it('appends content to last assistant message', () => {
      useChatStore.getState().setMessages('sess-1', [
        makeMsg('m1', 'user'),
        makeMsg('m2', 'assistant', 'Hello'),
      ]);
      useChatStore.getState().appendToLastMessage('sess-1', ' World');
      expect(useChatStore.getState().messages['sess-1'][1].content).toBe('Hello World');
    });

    it('does nothing with empty messages', () => {
      const before = useChatStore.getState().messages;
      useChatStore.getState().appendToLastMessage('sess-1', 'text');
      expect(useChatStore.getState().messages).toBe(before);
    });

    it('does nothing when no assistant message', () => {
      useChatStore.getState().setMessages('sess-1', [makeMsg('m1', 'user')]);
      const before = useChatStore.getState().messages;
      useChatStore.getState().appendToLastMessage('sess-1', 'text');
      expect(useChatStore.getState().messages).toBe(before);
    });
  });

  describe('clearMessages', () => {
    it('clears messages and pagination for session', () => {
      useChatStore.getState().setMessages('sess-1', [makeMsg('m1')], { total: 1, hasMore: false });
      useChatStore.getState().clearMessages('sess-1');
      expect(useChatStore.getState().messages['sess-1']).toEqual([]);
      expect(useChatStore.getState().pagination['sess-1'].total).toBe(0);
    });
  });

  describe('setLoadingMore', () => {
    it('sets loading state', () => {
      useChatStore.getState().setLoadingMore('sess-1', true);
      expect(useChatStore.getState().pagination['sess-1'].isLoadingMore).toBe(true);
    });
  });

  // ── Run lifecycle ────────────────────────────────────

  describe('startRun / endRun', () => {
    it('starts and ends a run', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      expect(useChatStore.getState().activeRuns['run-1']).toBe('sess-1');
      expect(useChatStore.getState().activeToolCalls['run-1']).toEqual({});

      useChatStore.getState().endRun('run-1');
      expect(useChatStore.getState().activeRuns['run-1']).toBeUndefined();
    });

    it('tracks background runs', () => {
      useChatStore.getState().startRun('run-bg', 'sess-1', true);
      expect(useChatStore.getState().backgroundRunIds.has('run-bg')).toBe(true);

      useChatStore.getState().endRun('run-bg');
      expect(useChatStore.getState().backgroundRunIds.has('run-bg')).toBe(false);
    });
  });

  describe('updateRunHealth', () => {
    it('sets run health info', () => {
      const health = { sessionId: 'sess-1', startedAt: 1000, lastActivityAt: 2000, health: 'healthy' as const };
      useChatStore.getState().updateRunHealth('run-1', health);
      expect(useChatStore.getState().runHealth['run-1']).toEqual(health);
    });
  });

  // ── Tool calls ──────────────────────────────────────

  describe('tool call actions', () => {
    it('addToolCall adds a tool call', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().addToolCall('run-1', 'tc-1', 'Read', { file: 'a.ts' });

      const tc = useChatStore.getState().activeToolCalls['run-1']['tc-1'];
      expect(tc.toolName).toBe('Read');
      expect(tc.status).toBe('running');
    });

    it('updateToolCallResult completes a tool call', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().addToolCall('run-1', 'tc-1', 'Read', {});
      useChatStore.getState().updateToolCallResult('run-1', 'tc-1', 'content', false);

      const tc = useChatStore.getState().activeToolCalls['run-1']['tc-1'];
      expect(tc.status).toBe('completed');
      expect(tc.result).toBe('content');
    });

    it('updateToolCallResult marks error', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().addToolCall('run-1', 'tc-1', 'Bash', {});
      useChatStore.getState().updateToolCallResult('run-1', 'tc-1', 'error msg', true);

      const tc = useChatStore.getState().activeToolCalls['run-1']['tc-1'];
      expect(tc.status).toBe('error');
      expect(tc.isError).toBe(true);
    });

    it('updateToolCallResult returns state when runId missing', () => {
      const before = useChatStore.getState();
      useChatStore.getState().updateToolCallResult('nonexistent', 'tc-1', 'result');
      expect(useChatStore.getState().activeToolCalls).toBe(before.activeToolCalls);
    });

    it('updateToolCallActivity sets activity text', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().addToolCall('run-1', 'tc-1', 'Read', {});
      useChatStore.getState().updateToolCallActivity('run-1', 'tc-1', 'Reading file...');

      const tc = useChatStore.getState().activeToolCalls['run-1']['tc-1'];
      expect(tc.activity).toBe('Reading file...');
    });

    it('updateToolCallActivity does nothing for completed tool call', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().addToolCall('run-1', 'tc-1', 'Read', {});
      useChatStore.getState().updateToolCallResult('run-1', 'tc-1', 'done');
      const before = useChatStore.getState().activeToolCalls;
      useChatStore.getState().updateToolCallActivity('run-1', 'tc-1', 'activity');
      expect(useChatStore.getState().activeToolCalls).toBe(before);
    });
  });

  // ── Content blocks ──────────────────────────────────

  describe('content block actions', () => {
    it('appendTextBlock creates new text block', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().appendTextBlock('run-1', 'Hello');
      const blocks = useChatStore.getState().runContentBlocks['run-1'];
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toEqual({ type: 'text', content: 'Hello' });
    });

    it('appendTextBlock appends to existing text block', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().appendTextBlock('run-1', 'Hello');
      useChatStore.getState().appendTextBlock('run-1', ' World');
      const blocks = useChatStore.getState().runContentBlocks['run-1'];
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toEqual({ type: 'text', content: 'Hello World' });
    });

    it('appendTextBlock creates new block after tool_use block', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().appendTextBlock('run-1', 'Before');
      useChatStore.getState().addToolUseBlock('run-1', 'tc-1');
      useChatStore.getState().appendTextBlock('run-1', 'After');
      const blocks = useChatStore.getState().runContentBlocks['run-1'];
      expect(blocks).toHaveLength(3);
      expect(blocks[0].type).toBe('text');
      expect(blocks[1].type).toBe('tool_use');
      expect(blocks[2].type).toBe('text');
    });

    it('addToolUseBlock adds tool use block', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().addToolUseBlock('run-1', 'tc-1');
      const blocks = useChatStore.getState().runContentBlocks['run-1'];
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toEqual({ type: 'tool_use', toolUseId: 'tc-1' });
    });
  });

  // ── finalizeRunToMessage ────────────────────────────

  describe('finalizeRunToMessage', () => {
    it('finalizes tool calls and content blocks onto assistant message', () => {
      useChatStore.getState().setMessages('sess-1', [
        makeMsg('m1', 'user'),
        makeMsg('m2', 'assistant', 'response'),
      ]);
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().addToolCall('run-1', 'tc-1', 'Read', {});
      useChatStore.getState().appendTextBlock('run-1', 'text');
      useChatStore.getState().finalizeRunToMessage('run-1');

      const msg = useChatStore.getState().messages['sess-1'][1];
      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.contentBlocks).toHaveLength(1);
    });

    it('does nothing when no active run', () => {
      const before = useChatStore.getState().messages;
      useChatStore.getState().finalizeRunToMessage('nonexistent');
      expect(useChatStore.getState().messages).toBe(before);
    });

    it('does nothing when no messages', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      const before = useChatStore.getState().messages;
      useChatStore.getState().finalizeRunToMessage('run-1');
      expect(useChatStore.getState().messages).toBe(before);
    });

    it('preserves existing tool calls when more complete', () => {
      const existingTC = [{ id: 'tc-1', toolName: 'Read', toolInput: {}, status: 'completed' as const, result: 'data' }];
      useChatStore.getState().setMessages('sess-1', [
        { ...makeMsg('m2', 'assistant', 'response'), toolCalls: existingTC },
      ]);
      useChatStore.getState().startRun('run-1', 'sess-1');
      // Run has no tool calls (empty)
      useChatStore.getState().finalizeRunToMessage('run-1');

      const msg = useChatStore.getState().messages['sess-1'][0];
      expect(msg.toolCalls).toEqual(existingTC);
    });
  });

  // ── System info ─────────────────────────────────────

  describe('system info', () => {
    it('sets and gets system info', () => {
      const info = { model: 'claude-4', cwd: '/home' };
      useChatStore.getState().setSystemInfo('sess-1', info);
      expect(useChatStore.getState().getSystemInfo('sess-1')).toEqual(info);
    });

    it('clears system info', () => {
      useChatStore.getState().setSystemInfo('sess-1', { model: 'test' });
      useChatStore.getState().clearSystemInfo('sess-1');
      expect(useChatStore.getState().getSystemInfo('sess-1')).toBeNull();
    });

    it('returns null for unknown session', () => {
      expect(useChatStore.getState().getSystemInfo('unknown')).toBeNull();
    });
  });

  // ── Mode overrides ─────────────────────────────────

  describe('mode overrides', () => {
    it('sets and gets mode', () => {
      useChatStore.getState().setMode('sess-1', 'yolo');
      expect(useChatStore.getState().getMode('sess-1')).toBe('yolo');
    });

    it('returns empty string for unknown session', () => {
      expect(useChatStore.getState().getMode('unknown')).toBe('');
    });
  });

  // ── Usage tracking ─────────────────────────────────

  describe('addSessionUsage', () => {
    it('accumulates usage', () => {
      useChatStore.getState().addSessionUsage('sess-1', { inputTokens: 100, outputTokens: 50 });
      useChatStore.getState().addSessionUsage('sess-1', { inputTokens: 200, outputTokens: 100, contextWindow: 100000 });

      const usage = useChatStore.getState().sessionUsage['sess-1'];
      expect(usage.inputTokens).toBe(300);
      expect(usage.outputTokens).toBe(150);
      expect(usage.contextWindow).toBe(100000);
      expect(usage.latestInputTokens).toBe(200);
      expect(usage.latestOutputTokens).toBe(100);
    });
  });

  // ── Model overrides ─────────────────────────────────

  describe('model overrides', () => {
    it('sets and gets model', () => {
      useChatStore.getState().setModelOverride('sess-1', 'claude-sonnet');
      expect(useChatStore.getState().getModelOverride('sess-1')).toBe('claude-sonnet');
    });

    it('returns empty string for unknown session', () => {
      expect(useChatStore.getState().getModelOverride('unknown')).toBe('');
    });
  });

  // ── Permission overrides ────────────────────────────

  describe('permission overrides', () => {
    it('sets and gets permission policy', () => {
      useChatStore.getState().setPermissionOverride('sess-1', { autoApprove: true } as any);
      expect(useChatStore.getState().getPermissionOverride('sess-1')).toEqual({ autoApprove: true });
    });

    it('clears permission override when null', () => {
      useChatStore.getState().setPermissionOverride('sess-1', { autoApprove: true } as any);
      useChatStore.getState().setPermissionOverride('sess-1', null);
      expect(useChatStore.getState().getPermissionOverride('sess-1')).toBeNull();
    });
  });

  // ── Worktree overrides ──────────────────────────────

  describe('worktree overrides', () => {
    it('sets and gets worktree path', () => {
      useChatStore.getState().setWorktreeOverride('sess-1', '/worktree/path');
      expect(useChatStore.getState().getWorktreeOverride('sess-1')).toBe('/worktree/path');
    });

    it('clears worktree override', () => {
      useChatStore.getState().setWorktreeOverride('sess-1', '/path');
      useChatStore.getState().clearWorktreeOverride('sess-1');
      expect(useChatStore.getState().getWorktreeOverride('sess-1')).toBe('');
    });
  });

  // ── Drafts ──────────────────────────────────────────

  describe('drafts', () => {
    it('sets and gets draft', () => {
      useChatStore.getState().setDraft('sess-1', 'draft text');
      expect(useChatStore.getState().drafts['sess-1']).toBe('draft text');
    });

    it('clears draft when content is empty', () => {
      useChatStore.getState().setDraft('sess-1', 'text');
      useChatStore.getState().setDraft('sess-1', '');
      expect(useChatStore.getState().drafts['sess-1']).toBeUndefined();
    });

    it('clearDraft removes draft', () => {
      useChatStore.getState().setDraft('sess-1', 'text');
      useChatStore.getState().clearDraft('sess-1');
      expect(useChatStore.getState().drafts['sess-1']).toBeUndefined();
    });
  });

  // ── Getters ─────────────────────────────────────────

  describe('getters', () => {
    it('getPagination returns pagination info', () => {
      useChatStore.getState().setMessages('sess-1', [], { total: 5, hasMore: true });
      const p = useChatStore.getState().getPagination('sess-1');
      expect(p?.total).toBe(5);
    });

    it('isSessionLoading returns true for active foreground run', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      expect(useChatStore.getState().isSessionLoading('sess-1')).toBe(true);
    });

    it('isSessionLoading returns false for background run', () => {
      useChatStore.getState().startRun('run-bg', 'sess-1', true);
      expect(useChatStore.getState().isSessionLoading('sess-1')).toBe(false);
    });

    it('isSessionLoading returns false when no run', () => {
      expect(useChatStore.getState().isSessionLoading('sess-1')).toBe(false);
    });

    it('getSessionRunId returns run id', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      expect(useChatStore.getState().getSessionRunId('sess-1')).toBe('run-1');
    });

    it('getSessionRunId returns null when no run', () => {
      expect(useChatStore.getState().getSessionRunId('sess-1')).toBeNull();
    });

    it('getSessionHealth returns health for active run', () => {
      const health = { sessionId: 'sess-1', startedAt: 1000, lastActivityAt: 2000, health: 'healthy' as const };
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().updateRunHealth('run-1', health);
      expect(useChatStore.getState().getSessionHealth('sess-1')).toEqual(health);
    });

    it('getSessionHealth returns null when no run', () => {
      expect(useChatStore.getState().getSessionHealth('sess-1')).toBeNull();
    });

    it('getSessionToolCalls returns tool calls for active run', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().addToolCall('run-1', 'tc-1', 'Read', {});
      const tcs = useChatStore.getState().getSessionToolCalls('sess-1');
      expect(tcs).toHaveLength(1);
    });

    it('getSessionToolCalls returns empty when no run', () => {
      expect(useChatStore.getState().getSessionToolCalls('sess-1')).toEqual([]);
    });

    it('getSessionContentBlocks returns blocks for active run', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().appendTextBlock('run-1', 'text');
      expect(useChatStore.getState().getSessionContentBlocks('sess-1')).toHaveLength(1);
    });

    it('getSessionContentBlocks returns empty when no run', () => {
      expect(useChatStore.getState().getSessionContentBlocks('sess-1')).toEqual([]);
    });

    it('getSessionToolCallHistory returns history for active run', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().addToolCall('run-1', 'tc-1', 'Read', {});
      useChatStore.getState().addToolCall('run-1', 'tc-2', 'Edit', {});
      const history = useChatStore.getState().getSessionToolCallHistory('sess-1');
      expect(history).toHaveLength(2);
    });

    it('getSessionToolCallHistory returns empty when no run', () => {
      expect(useChatStore.getState().getSessionToolCallHistory('sess-1')).toEqual([]);
    });
  });
});
