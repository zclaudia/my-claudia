import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MessageHandlerContext } from '../messageHandler';

// Mock all stores
const mockChatStore = {
  activeRuns: {} as Record<string, string>,
  runHealth: {} as Record<string, any>,
  appendToLastMessage: vi.fn(),
  appendTextBlock: vi.fn(),
  startRun: vi.fn(),
  clearSystemInfo: vi.fn(),
  updateMessageIdByClientMessageId: vi.fn(),
  addMessage: vi.fn(),
  finalizeRunToMessage: vi.fn(),
  addSessionUsage: vi.fn(),
  endRun: vi.fn(),
  addToolCall: vi.fn(),
  addToolUseBlock: vi.fn(),
  updateToolCallResult: vi.fn(),
  updateToolCallActivity: vi.fn(),
  setMode: vi.fn(),
  setRuntimeMode: vi.fn(),
  setSystemInfo: vi.fn(),
  updateRunHealth: vi.fn(),
};

const mockProjectStore = {
  selectedSessionId: 'current-session',
  setSessionActive: vi.fn(),
  replaceProjectsForBackend: vi.fn(),
  addSession: vi.fn(),
  updateSession: vi.fn(),
  sessions: [] as any[],
};

const mockServerStore = {
  activeServerId: 'server-1',
};

const mockPermissionStore = {
  aiReviewResults: {} as Record<string, any>,
  setPendingRequest: vi.fn(),
  clearRequestById: vi.fn(),
  clearStaleRequests: vi.fn(),
  hasRequest: vi.fn(() => false),
  setAIReviewResult: vi.fn((requestId: string, result: any) => {
    mockPermissionStore.aiReviewResults[requestId] = result;
  }),
};

const mockPromptRequestStore = {
  setPendingRequest: vi.fn(),
  clearRequestById: vi.fn(),
  clearRequestsForSession: vi.fn(),
  clearStaleRequests: vi.fn(),
  hasRequest: vi.fn(() => false),
};

const mockHandleLocalPRMessage = vi.fn().mockReturnValue(true);
const mockHandleWorkflowMessage = vi.fn().mockReturnValue(true);
const mockHandleScheduledTaskMessage = vi.fn().mockReturnValue(true);
const mockHandleSupervisionMessage = vi.fn().mockReturnValue(true);

const mockSessionsStore = {
  setSessionActiveFlag: vi.fn(),
  setSessionActiveById: vi.fn(),
  reconcileActiveStatus: vi.fn(),
  setActiveSessionsForBackend: vi.fn(),
};

const mockTerminalStore = {
  markReady: vi.fn(),
  handleTerminalExited: vi.fn(),
};

const mockBottomPanelStore = {
  setActiveTab: vi.fn(),
};

const mockPluginStore = {
  setPlugins: vi.fn(),
  setPendingPermissionRequest: vi.fn(),
  registerPanel: vi.fn(),
  clearPluginExtensions: vi.fn(),
  updatePanelVisibility: vi.fn(),
};

const mockFilePushStore = {
  addItem: vi.fn(),
};

const mockBackgroundTaskStore = {
  tasks: {} as Record<string, any>,
  addTask: vi.fn(),
  updateTask: vi.fn(),
};

const mockInteractionStore = {
  upsertInteraction: vi.fn(),
  resolveInteraction: vi.fn(),
  clearSession: vi.fn(),
};
const mockEagerSyncCurrentSession = vi.fn(() => Promise.resolve());
const mockRecoverCurrentSessionTail = vi.fn(() => Promise.resolve());
const mockGetProjectsForBackend = vi.fn();

vi.mock('../../stores/chatStore', () => ({
  useChatStore: { getState: () => mockChatStore },
}));
vi.mock('../../stores/projectStore', () => ({
  useProjectStore: { getState: () => mockProjectStore },
}));
vi.mock('../../stores/serverStore', () => ({
  useServerStore: { getState: () => mockServerStore },
}));
vi.mock('../../stores/permissionStore', () => ({
  usePermissionStore: { getState: () => mockPermissionStore },
}));
vi.mock('../../stores/promptRequestStore', () => ({
  usePromptRequestStore: { getState: () => mockPromptRequestStore },
}));
vi.mock('../../features/local-pr/handlers', () => ({
  handleLocalPRMessage: (...args: any[]) => mockHandleLocalPRMessage(...args),
}));
vi.mock('../../features/workflows/handlers', () => ({
  handleWorkflowMessage: (...args: any[]) => mockHandleWorkflowMessage(...args),
}));
vi.mock('../../features/scheduled-tasks/handlers', () => ({
  handleScheduledTaskMessage: (...args: any[]) => mockHandleScheduledTaskMessage(...args),
}));
vi.mock('../../features/supervision/handlers', () => ({
  handleSupervisionMessage: (...args: any[]) => mockHandleSupervisionMessage(...args),
}));
vi.mock('../../stores/sessionsStore', () => ({
  useSessionsStore: { getState: () => mockSessionsStore },
  LOCAL_BACKEND_KEY: '__local__',
  getSessionBucketKeyForBackend: (backendId: string | null | undefined) => backendId ?? '__local__',
}));
vi.mock('../../stores/terminalStore', () => ({
  useTerminalStore: { getState: () => mockTerminalStore },
}));
vi.mock('../../stores/bottomPanelStore', () => ({
  useBottomPanelStore: { getState: () => mockBottomPanelStore },
}));
vi.mock('../../stores/pluginStore', () => ({
  usePluginStore: { getState: () => mockPluginStore },
}));
vi.mock('../../stores/filePushStore', () => ({
  useFilePushStore: { getState: () => mockFilePushStore },
}));
vi.mock('../../stores/backgroundTaskStore', () => ({
  useBackgroundTaskStore: { getState: () => mockBackgroundTaskStore },
}));
vi.mock('../../stores/interactionStore', () => ({
  useInteractionStore: { getState: () => mockInteractionStore },
}));
vi.mock('../fileDownload', () => ({
  downloadPushedFile: vi.fn(),
}));
vi.mock('../sessionSync', () => ({
  eagerSyncCurrentSession: (...args: any[]) => mockEagerSyncCurrentSession(...args),
  recoverCurrentSessionTail: (...args: any[]) => mockRecoverCurrentSessionTail(...args),
}));
vi.mock('../api/projects', () => ({
  getProjectsForBackend: (...args: any[]) => mockGetProjectsForBackend(...args),
}));

const mockXtermEntry = {
  terminal: { write: vi.fn(), writeln: vi.fn() },
};
vi.mock('../../utils/xtermRegistry', () => ({
  xtermRegistry: {
    get: vi.fn(),
    delete: vi.fn(),
  },
}));

import { cleanupServerSyncState, handleServerMessage } from '../messageHandler';
import { downloadPushedFile } from '../fileDownload';
import { xtermRegistry } from '../../utils/xtermRegistry';
import { useNotificationFeedStore } from '../../stores/notificationFeedStore';
import { useToastStore } from '../../stores/toastStore';

function makeCtx(overrides?: Partial<MessageHandlerContext>): MessageHandlerContext {
  return {
    serverId: 'server-1',
    backendId: null,
    serverRunsRef: new Map(),
    resolveBackendName: () => 'Test Backend',
    logTag: 'Test',
    ...overrides,
  };
}

describe('handleServerMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProjectsForBackend.mockReset();
    mockChatStore.activeRuns = {};
    mockChatStore.runHealth = {};
    mockBackgroundTaskStore.tasks = {};
    mockProjectStore.selectedSessionId = 'current-session';
    mockProjectStore.sessions = [];
    mockServerStore.activeServerId = 'server-1';
    mockPermissionStore.aiReviewResults = {};
    useNotificationFeedStore.setState({ items: [], unreadCount: 0, hasMore: false, loading: false, hydrated: false });
    useToastStore.setState({ toasts: [] });
  });

  it('handles pong (no-op)', () => {
    handleServerMessage({ type: 'pong' }, makeCtx());
    // No store calls for pong
  });

  describe('delta', () => {
    it('appends to message when sessionId is provided', () => {
      handleServerMessage({ type: 'delta', sessionId: 's1', runId: 'r1', content: 'hello' }, makeCtx());
      expect(mockChatStore.appendToLastMessage).toHaveBeenCalledWith('s1', 'hello');
      expect(mockChatStore.appendTextBlock).toHaveBeenCalledWith('r1', 'hello');
    });

    it('looks up session from activeRuns when sessionId missing', () => {
      mockChatStore.activeRuns = { r1: 's1' };
      handleServerMessage({ type: 'delta', runId: 'r1', content: 'text' }, makeCtx());
      expect(mockChatStore.appendToLastMessage).toHaveBeenCalledWith('s1', 'text');
    });

    it('warns on untracked run', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      handleServerMessage({ type: 'delta', runId: 'r1', content: 'text' }, makeCtx());
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('run_started', () => {
    it('starts a foreground run', () => {
      handleServerMessage({
        type: 'run_started', runId: 'r1', sessionId: 's1',
        assistantMessageId: 'am1', userMessageId: 'um1', clientRequestId: 'cr1',
      }, makeCtx());

      expect(mockChatStore.startRun).toHaveBeenCalledWith('r1', 's1', false);
      expect(mockChatStore.clearSystemInfo).toHaveBeenCalledWith('s1');
      expect(mockChatStore.updateMessageIdByClientMessageId).toHaveBeenCalledWith('s1', 'cr1', 'um1');
      expect(mockChatStore.addMessage).toHaveBeenCalled();
      expect(mockProjectStore.setSessionActive).toHaveBeenCalledWith('s1', true);
      expect(mockSessionsStore.setSessionActiveFlag).toHaveBeenCalledWith('__local__', 's1', true);
    });

    it('starts a background run', () => {
      handleServerMessage({
        type: 'run_started', runId: 'r1', sessionId: 's1', sessionType: 'background',
      }, makeCtx());

      expect(mockChatStore.startRun).toHaveBeenCalledWith('r1', 's1', true);
      expect(mockProjectStore.setSessionActive).not.toHaveBeenCalled();
    });

    it('uses currentSessionId when no sessionId provided', () => {
      handleServerMessage({ type: 'run_started', runId: 'r1' }, makeCtx());
      expect(mockChatStore.startRun).toHaveBeenCalledWith('r1', 'current-session', false);
    });

    it('warns when no sessionId at all', () => {
      mockProjectStore.selectedSessionId = null as any;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      handleServerMessage({ type: 'run_started', runId: 'r1' }, makeCtx());
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('tracks foreground run in serverRunsRef', () => {
      const ctx = makeCtx();
      handleServerMessage({ type: 'run_started', runId: 'r1', sessionId: 's1' }, ctx);
      expect(ctx.serverRunsRef.get('server-1')?.has('r1')).toBe(true);
    });

    it('gateway: calls setSessionActiveById', () => {
      handleServerMessage(
        { type: 'run_started', runId: 'r1', sessionId: 's1' },
        makeCtx({ backendId: 'backend-1' })
      );
      expect(mockSessionsStore.setSessionActiveById).toHaveBeenCalledWith('backend-1', 's1', true);
      expect(mockSessionsStore.setSessionActiveFlag).toHaveBeenCalledWith('backend-1', 's1', true);
    });

    it('does not clearSystemInfo for non-active server', () => {
      handleServerMessage(
        { type: 'run_started', runId: 'r1', sessionId: 's1' },
        makeCtx({ serverId: 'other-server' })
      );
      expect(mockChatStore.clearSystemInfo).not.toHaveBeenCalled();
    });

    it('does not add a duplicate assistant placeholder for metadata-only reruns', () => {
      mockChatStore.activeRuns = { r1: 's1' };

      handleServerMessage({
        type: 'run_started',
        runId: 'r1',
        sessionId: 's1',
      }, makeCtx());

      expect(mockChatStore.addMessage).not.toHaveBeenCalled();
    });
  });

  describe('run_completed', () => {
    it('completes a run', () => {
      mockChatStore.activeRuns = { r1: 's1' };
      const ctx = makeCtx();
      ctx.serverRunsRef.set('server-1', new Set(['r1']));

      handleServerMessage({ type: 'run_completed', runId: 'r1', usage: { tokens: 100 } }, ctx);

      expect(mockPromptRequestStore.clearRequestsForSession).toHaveBeenCalledWith('s1');
      expect(mockInteractionStore.clearSession).toHaveBeenCalledWith('s1');
      expect(mockChatStore.finalizeRunToMessage).toHaveBeenCalledWith('r1');
      expect(mockChatStore.addSessionUsage).toHaveBeenCalledWith('s1', { tokens: 100 });
      expect(mockProjectStore.setSessionActive).toHaveBeenCalledWith('s1', false);
      expect(mockChatStore.endRun).toHaveBeenCalledWith('r1');
      expect(mockEagerSyncCurrentSession).toHaveBeenCalledWith('server-1');
      expect(mockRecoverCurrentSessionTail).toHaveBeenCalledWith('server-1', 's1');
      expect(ctx.serverRunsRef.get('server-1')?.has('r1')).toBe(false);
    });

    it('uses sessionId from message when available', () => {
      handleServerMessage({ type: 'run_completed', runId: 'r1', sessionId: 's2' }, makeCtx());
      expect(mockPromptRequestStore.clearRequestsForSession).toHaveBeenCalledWith('s2');
      expect(mockInteractionStore.clearSession).toHaveBeenCalledWith('s2');
    });

    it('gateway: calls setSessionActiveById', () => {
      handleServerMessage(
        { type: 'run_completed', runId: 'r1', sessionId: 's1' },
        makeCtx({ backendId: 'b1' })
      );
      expect(mockSessionsStore.setSessionActiveById).toHaveBeenCalledWith('b1', 's1', false);
    });

    it('completes a run normally after a temporary reconnect gap', () => {
      const ctx = makeCtx({ backendId: 'remote-1' });
      ctx.serverRunsRef.set('server-1', new Set(['r1']));
      mockChatStore.activeRuns = { r1: 's1' };

      handleServerMessage({ type: 'run_completed', runId: 'r1', sessionId: 's1', seq: 2 }, ctx);

      expect(mockChatStore.finalizeRunToMessage).toHaveBeenCalledWith('r1');
      expect(mockChatStore.endRun).toHaveBeenCalledWith('r1');
      expect(mockProjectStore.setSessionActive).toHaveBeenCalledWith('s1', false);
      expect(mockSessionsStore.setSessionActiveFlag).toHaveBeenCalledWith('remote-1', 's1', false);
      expect(mockSessionsStore.setSessionActiveById).toHaveBeenCalledWith('remote-1', 's1', false);
      expect(mockRecoverCurrentSessionTail).toHaveBeenCalledWith('server-1', 's1');
      expect(ctx.serverRunsRef.get('server-1')?.has('r1')).toBe(false);
    });
  });

  describe('run_failed', () => {
    it('handles run failure with error message', () => {
      mockChatStore.activeRuns = { r1: 's1' };
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      handleServerMessage({ type: 'run_failed', runId: 'r1', error: 'boom' }, makeCtx());

      expect(mockInteractionStore.clearSession).toHaveBeenCalledWith('s1');
      expect(mockChatStore.appendToLastMessage).toHaveBeenCalledWith('s1', expect.stringContaining('boom'));
      expect(mockChatStore.finalizeRunToMessage).toHaveBeenCalledWith('r1');
      expect(mockChatStore.endRun).toHaveBeenCalledWith('r1');
      expect(mockEagerSyncCurrentSession).toHaveBeenCalledWith('server-1');
      expect(mockRecoverCurrentSessionTail).toHaveBeenCalledWith('server-1', 's1');
      errSpy.mockRestore();
    });
  });

  describe('tool_use', () => {
    it('adds tool call for tracked run', () => {
      mockChatStore.activeRuns = { r1: 's1' };
      handleServerMessage({
        type: 'tool_use', runId: 'r1', toolUseId: 'tu1', toolName: 'Read', toolInput: {},
      }, makeCtx());
      expect(mockChatStore.addToolCall).toHaveBeenCalledWith('r1', 'tu1', 'Read', {});
      expect(mockChatStore.addToolUseBlock).toHaveBeenCalledWith('r1', 'tu1');
    });

    it('warns on untracked run', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      handleServerMessage({ type: 'tool_use', runId: 'r1', toolUseId: 'tu1', toolName: 'Read' }, makeCtx());
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('tool_result', () => {
    it('updates tool result for tracked run', () => {
      mockChatStore.activeRuns = { r1: 's1' };
      handleServerMessage({
        type: 'tool_result', runId: 'r1', toolUseId: 'tu1', result: 'data', isError: false,
      }, makeCtx());
      expect(mockChatStore.updateToolCallResult).toHaveBeenCalledWith('r1', 'tu1', 'data', false);
    });
  });

  describe('tool_activity', () => {
    it('updates tool call activity', () => {
      handleServerMessage({
        type: 'tool_activity', runId: 'r1', toolUseId: 'tu1', content: 'Reading file...',
      }, makeCtx());
      expect(mockChatStore.updateToolCallActivity).toHaveBeenCalledWith('r1', 'tu1', 'Reading file...');
    });

    it('skips when fields are missing', () => {
      handleServerMessage({ type: 'tool_activity', runId: 'r1' }, makeCtx());
      expect(mockChatStore.updateToolCallActivity).not.toHaveBeenCalled();
    });
  });

  it('handles mode_change', () => {
    handleServerMessage({ type: 'mode_change', sessionId: 's1', mode: 'plan' }, makeCtx());
    expect(mockChatStore.setRuntimeMode).toHaveBeenCalledWith('s1', 'plan');
    expect(mockChatStore.setMode).not.toHaveBeenCalled();
  });

  it('handles permission_request', () => {
    handleServerMessage({
      type: 'permission_request', requestId: 'pr1', sessionId: 's1',
      toolName: 'Bash', detail: 'ls', timeoutSeconds: 30,
    }, makeCtx());
    expect(mockPermissionStore.setPendingRequest).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'pr1', toolName: 'Bash', serverId: 'server-1' })
    );
  });

  it('handles prompt_request', () => {
    handleServerMessage({
      type: 'prompt_request', requestId: 'q1', sessionId: 's1', questions: ['What?'],
    }, makeCtx());
    expect(mockPromptRequestStore.setPendingRequest).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'q1', questions: ['What?'] })
    );
  });

  it('handles permission_resolved', () => {
    handleServerMessage({ type: 'permission_resolved', requestId: 'pr1' }, makeCtx());
    expect(mockPermissionStore.clearRequestById).toHaveBeenCalledWith('pr1');
  });

  it('handles permission_auto_resolved', () => {
    handleServerMessage({ type: 'permission_auto_resolved', requestId: 'pr1' }, makeCtx());
    expect(mockPermissionStore.clearRequestById).toHaveBeenCalledWith('pr1');
  });

  it('shows toast when permission_auto_resolved includes redaction metadata', () => {
    handleServerMessage({
      type: 'permission_auto_resolved',
      requestId: 'pr1',
      sessionId: 's1',
      behavior: 'approve',
      metadata: {
        payloadDisposition: 'send_with_redaction',
        redactionCount: 2,
        reviewedFileCount: 2,
      },
    }, makeCtx());

    expect(useToastStore.getState().toasts[0]).toMatchObject({
      title: 'Permission auto-approved',
      type: 'success',
    });
    expect(useToastStore.getState().toasts[0]?.message).toContain('sanitized local payload');
  });

  it('stores ai_review_completed metadata and shows toast', () => {
    handleServerMessage({
      type: 'ai_review_completed',
      requestId: 'pr2',
      sessionId: 's1',
      decision: 'uncertain',
      reasoning: 'Need user input',
      confidence: 0.42,
      metadata: {
        payloadDisposition: 'send_with_redaction',
        redactionCount: 1,
        reviewedFileCount: 1,
      },
    }, makeCtx());

    expect(mockPermissionStore.aiReviewResults.pr2).toMatchObject({
      decision: 'uncertain',
      metadata: {
        payloadDisposition: 'send_with_redaction',
        redactionCount: 1,
        reviewedFileCount: 1,
      },
    });
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      title: 'AI review completed',
      type: 'info',
    });
  });

  it('shows toast when ai_review_completed skips remote analysis for sensitive local material', () => {
    handleServerMessage({
      type: 'ai_review_completed',
      requestId: 'pr3',
      sessionId: 's1',
      decision: 'uncertain',
      reasoning: 'Remote AI review skipped because the request payload may contain sensitive local material',
      confidence: 0,
      metadata: {
        payloadDisposition: 'do_not_send',
        reviewedFileCount: 0,
      },
    }, makeCtx());

    expect(useToastStore.getState().toasts[0]).toMatchObject({
      title: 'AI review completed',
      type: 'info',
      message: 'AI review skipped remote analysis because sensitive local material was detected.',
    });
  });

  it('handles prompt_request_resolved', () => {
    handleServerMessage({ type: 'prompt_request_resolved', requestId: 'q1' }, makeCtx());
    expect(mockPromptRequestStore.clearRequestById).toHaveBeenCalledWith('q1');
  });

  it('handles interaction_todo_update', () => {
    const event = {
      type: 'interaction_todo_update',
      interactionId: 'todo-1',
      sessionId: 's1',
      source: 'tool_call',
      createdAt: Date.now(),
      todos: [{ content: 'Ship fix', status: 'pending' }],
    } as const;
    handleServerMessage(event, makeCtx());
    expect(mockInteractionStore.upsertInteraction).toHaveBeenCalledWith(event);
  });

  it('handles interaction_resolved', () => {
    handleServerMessage({ type: 'interaction_resolved', interactionId: 'q1' }, makeCtx());
    expect(mockInteractionStore.resolveInteraction).toHaveBeenCalledWith('q1');
  });

  describe('system_info', () => {
    it('sets system info for active server', () => {
      mockChatStore.activeRuns = { r1: 's1' };
      handleServerMessage({ type: 'system_info', runId: 'r1', systemInfo: { version: '1.0' } }, makeCtx());
      expect(mockChatStore.setSystemInfo).toHaveBeenCalledWith('s1', { version: '1.0' });
    });

    it('ignores system_info from non-active server', () => {
      mockChatStore.activeRuns = { r1: 's1' };
      handleServerMessage(
        { type: 'system_info', runId: 'r1', systemInfo: {} },
        makeCtx({ serverId: 'other-server' })
      );
      expect(mockChatStore.setSystemInfo).not.toHaveBeenCalled();
    });

    it('warns on untracked run', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      handleServerMessage({ type: 'system_info', runId: 'r1', systemInfo: {} }, makeCtx());
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('task_notification', () => {
    it('adds new background task', () => {
      handleServerMessage({
        type: 'task_notification', sessionId: 's1', taskId: 't1',
        status: 'started', message: 'Working...',
      }, makeCtx());
      expect(mockBackgroundTaskStore.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 't1',
          sessionId: 's1',
          status: 'started',
          source: 'sdk_task',
          stoppable: true,
        })
      );
    });

    it('updates existing background task', () => {
      mockBackgroundTaskStore.tasks = { t1: { id: 't1' } };
      handleServerMessage({
        type: 'task_notification', sessionId: 's1', taskId: 't1',
        status: 'completed', message: 'Done',
      }, makeCtx());
      expect(mockBackgroundTaskStore.updateTask).toHaveBeenCalledWith('t1', expect.objectContaining({
        status: 'completed',
      }));
    });

    it('preserves existing pid fields when update omits them', () => {
      mockBackgroundTaskStore.tasks = {
        t1: {
          id: 't1',
          sessionId: 's1',
          description: 'Working...',
          startedAt: 1,
          cliPid: 123,
          taskRootPid: 456,
          taskCommand: 'npm test',
        },
      };

      handleServerMessage({
        type: 'task_notification',
        sessionId: 's1',
        taskId: 't1',
        status: 'in_progress',
        message: 'Still working...',
      }, makeCtx());

      expect(mockBackgroundTaskStore.updateTask).toHaveBeenCalledWith('t1', expect.objectContaining({
        cliPid: 123,
        taskRootPid: 456,
        taskCommand: 'npm test',
      }));
    });

    it('skips if missing sessionId or taskId', () => {
      handleServerMessage({ type: 'task_notification' }, makeCtx());
      expect(mockBackgroundTaskStore.addTask).not.toHaveBeenCalled();
    });
  });

  describe('background_task_update', () => {
    it('marks background runs as non-stoppable', () => {
      handleServerMessage({
        type: 'background_task_update',
        sessionId: 'background-session',
        parentSessionId: 's1',
        status: 'running',
      }, makeCtx());

      expect(mockBackgroundTaskStore.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'background:background-session',
          serverId: 'server-1',
          sessionId: 's1',
          source: 'background_run',
          stoppable: false,
          status: 'in_progress',
        })
      );
    });
  });

  it('handles supervision_task_update', () => {
    const msg = { type: 'supervision_task_update', projectId: 'p1', task: { id: 'task1' } };
    handleServerMessage(msg, makeCtx());
    expect(mockHandleSupervisionMessage).toHaveBeenCalledWith(msg);
  });

  it('handles supervision_agent_update', () => {
    const msg = { type: 'supervision_agent_update', projectId: 'p1', agent: { id: 'a1' } };
    handleServerMessage(msg, makeCtx());
    expect(mockHandleSupervisionMessage).toHaveBeenCalledWith(msg);
  });

  it('handles supervision_checkpoint', () => {
    const msg = { type: 'supervision_checkpoint', projectId: 'p1', summary: 'All good' };
    handleServerMessage(msg, makeCtx());
    expect(mockHandleSupervisionMessage).toHaveBeenCalledWith(msg);
  });

  describe('sessions_created', () => {
    it('adds new session', () => {
      mockProjectStore.sessions = [];
      handleServerMessage({
        type: 'sessions_created', session: { id: 's-new', name: 'New' },
      }, makeCtx());
      expect(mockProjectStore.addSession).toHaveBeenCalledWith({ id: 's-new', name: 'New' });
    });

    it('skips duplicate session', () => {
      mockProjectStore.sessions = [{ id: 's1' }] as any;
      handleServerMessage({
        type: 'sessions_created', session: { id: 's1', name: 'Dup' },
      }, makeCtx());
      expect(mockProjectStore.addSession).not.toHaveBeenCalled();
    });
  });

  it('handles sessions_updated', () => {
    handleServerMessage({
      type: 'sessions_updated', session: { id: 's1', name: 'Updated' },
    }, makeCtx());
    expect(mockProjectStore.updateSession).toHaveBeenCalledWith('s1', { id: 's1', name: 'Updated' });
  });

  it('handles local_pr_update', () => {
    const msg = { type: 'local_pr_update', projectId: 'p1', pr: { id: 'pr1' } };
    handleServerMessage(msg, makeCtx());
    expect(mockHandleLocalPRMessage).toHaveBeenCalledWith(msg);
  });

  it('handles local_pr_deleted', () => {
    const msg = { type: 'local_pr_deleted', projectId: 'p1', prId: 'pr1' };
    handleServerMessage(msg, makeCtx());
    expect(mockHandleLocalPRMessage).toHaveBeenCalledWith(msg);
  });

  it('handles scheduled_task_update', () => {
    const msg = { type: 'scheduled_task_update', projectId: 'p1', task: { id: 'st1' } };
    handleServerMessage(msg, makeCtx());
    expect(mockHandleScheduledTaskMessage).toHaveBeenCalledWith(msg);
  });

  it('handles scheduled_task_deleted', () => {
    const msg = { type: 'scheduled_task_deleted', projectId: 'p1', taskId: 'st1' };
    handleServerMessage(msg, makeCtx());
    expect(mockHandleScheduledTaskMessage).toHaveBeenCalledWith(msg);
  });

  it('handles workflow_update', () => {
    const msg = { type: 'workflow_update', projectId: 'p1', workflow: { id: 'w1' } };
    handleServerMessage(msg, makeCtx());
    expect(mockHandleWorkflowMessage).toHaveBeenCalledWith(msg);
  });

  it('handles workflow_deleted', () => {
    const msg = { type: 'workflow_deleted', projectId: 'p1', workflowId: 'w1' };
    handleServerMessage(msg, makeCtx());
    expect(mockHandleWorkflowMessage).toHaveBeenCalledWith(msg);
  });

  it('handles workflow_run_update', () => {
    const msg = { type: 'workflow_run_update', projectId: 'p1', run: { id: 'wr1' }, stepRuns: [] };
    handleServerMessage(msg, makeCtx());
    expect(mockHandleWorkflowMessage).toHaveBeenCalledWith(msg);
  });

  it('handles workflow_step_types_changed', () => {
    const msg = { type: 'workflow_step_types_changed' };
    handleServerMessage(msg, makeCtx());
    expect(mockHandleWorkflowMessage).toHaveBeenCalledWith(msg);
  });

  describe('state_heartbeat', () => {
    const makeHeartbeat = (overrides?: any) => ({
      type: 'state_heartbeat',
      activeRuns: [],
      pendingPermissions: [],
      pendingQuestions: [],
      ...overrides,
    });

    it('adds missing runs from heartbeat', () => {
      handleServerMessage(makeHeartbeat({
        activeRuns: [{ runId: 'hb-1', sessionId: 's1', sessionType: 'foreground' }],
      }), makeCtx());
      expect(mockChatStore.startRun).toHaveBeenCalledWith('hb-1', 's1', false);
    });

    it('skips already known runs', () => {
      mockChatStore.activeRuns = { r1: 's1' };
      handleServerMessage(makeHeartbeat({
        activeRuns: [{ runId: 'r1', sessionId: 's1' }],
      }), makeCtx());
      expect(mockChatStore.startRun).not.toHaveBeenCalled();
    });

    it('cleans up stale runs', () => {
      mockChatStore.activeRuns = { r1: 's1' };
      const ctx = makeCtx();
      ctx.serverRunsRef.set('server-1', new Set(['r1']));
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      handleServerMessage(makeHeartbeat({ activeRuns: [] }), ctx);

      expect(mockChatStore.finalizeRunToMessage).toHaveBeenCalledWith('r1');
      expect(mockChatStore.endRun).toHaveBeenCalledWith('r1');
      expect(mockProjectStore.setSessionActive).toHaveBeenCalledWith('s1', false);
      expect(mockEagerSyncCurrentSession).toHaveBeenCalledWith('server-1');
      expect(mockRecoverCurrentSessionTail).toHaveBeenCalledWith('server-1', 's1');
      logSpy.mockRestore();
    });

    it('ignores stale heartbeat resurrection after terminal run event', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      handleServerMessage({ type: 'run_completed', runId: 'r1', sessionId: 's1', seq: 10 }, makeCtx());
      handleServerMessage(makeHeartbeat({
        activeRuns: [{ runId: 'r1', sessionId: 's1', sessionType: 'foreground', lastSeq: 9 }],
      }), makeCtx());

      expect(mockChatStore.startRun).not.toHaveBeenCalled();
      logSpy.mockRestore();
    });

    it('triggers tail recovery when run event seq has a gap', () => {
      handleServerMessage({ type: 'delta', runId: 'gap-run', sessionId: 's1', seq: 1, content: 'a' }, makeCtx());
      handleServerMessage({ type: 'delta', runId: 'gap-run', sessionId: 's1', seq: 3, content: 'c' }, makeCtx());

      expect(mockRecoverCurrentSessionTail).toHaveBeenCalledWith('server-1', 's1');
    });

    it('updates run health info', () => {
      mockChatStore.activeRuns = { r1: 's1' };
      handleServerMessage(makeHeartbeat({
        activeRuns: [{
          runId: 'r1', sessionId: 's1', startedAt: 1000,
          lastActivityAt: 2000, health: 'healthy',
        }],
      }), makeCtx());
      expect(mockChatStore.updateRunHealth).toHaveBeenCalledWith('r1', expect.objectContaining({
        sessionId: 's1', health: 'healthy',
      }));
    });

    it('reconciles permissions', () => {
      handleServerMessage(makeHeartbeat({
        pendingPermissions: [{
          requestId: 'pr1', sessionId: 's1', toolName: 'Bash',
        }],
      }), makeCtx());
      expect(mockPermissionStore.clearStaleRequests).toHaveBeenCalled();
      expect(mockPermissionStore.setPendingRequest).toHaveBeenCalled();
    });

    it('reconciles questions', () => {
      handleServerMessage(makeHeartbeat({
        pendingQuestions: [{
          requestId: 'q1', sessionId: 's1', questions: ['Confirm?'],
        }],
      }), makeCtx());
      expect(mockPromptRequestStore.clearStaleRequests).toHaveBeenCalled();
      expect(mockPromptRequestStore.setPendingRequest).toHaveBeenCalled();
    });

    it('gateway: reconciles active sessions', () => {
      handleServerMessage(makeHeartbeat({
        activeRuns: [{ runId: 'hb-2', sessionId: 's1', sessionType: 'foreground' }],
      }), makeCtx({ backendId: 'b1' }));
      expect(mockSessionsStore.reconcileActiveStatus).toHaveBeenCalled();
    });

    it('direct: sets active sessions for local backend', () => {
      handleServerMessage(makeHeartbeat({
        activeRuns: [{ runId: 'hb-3', sessionId: 's1' }],
      }), makeCtx());
      expect(mockSessionsStore.setActiveSessionsForBackend).toHaveBeenCalled();
    });

    it('sets systemInfo from heartbeat runs', () => {
      mockChatStore.activeRuns = { r1: 's1' };
      handleServerMessage(makeHeartbeat({
        activeRuns: [{
          runId: 'r1', sessionId: 's1', systemInfo: { version: '2.0' },
        }],
      }), makeCtx());
      expect(mockChatStore.setSystemInfo).toHaveBeenCalledWith('s1', { version: '2.0' });
    });

    it('marks stale background-run tasks as stopped after reconnect', () => {
      mockBackgroundTaskStore.tasks = {
        'background:bg-1': {
          id: 'background:bg-1',
          serverId: 'server-1',
          sessionId: 'parent-1',
          source: 'background_run',
          status: 'in_progress',
          summary: 'Still working',
        },
      };

      handleServerMessage(makeHeartbeat({ activeRuns: [] }), makeCtx());

      expect(mockBackgroundTaskStore.updateTask).toHaveBeenCalledWith(
        'background:bg-1',
        expect.objectContaining({
          status: 'stopped',
          completedAt: expect.any(Number),
        })
      );
    });

    it('does not touch active background-run tasks from heartbeat', () => {
      mockBackgroundTaskStore.tasks = {
        'background:bg-1': {
          id: 'background:bg-1',
          serverId: 'server-1',
          sessionId: 'parent-1',
          source: 'background_run',
          status: 'in_progress',
        },
      };

      handleServerMessage(makeHeartbeat({
        activeRuns: [{ runId: 'r-bg', sessionId: 'bg-1', sessionType: 'background' }],
      }), makeCtx());

      expect(mockBackgroundTaskStore.updateTask).not.toHaveBeenCalledWith(
        'background:bg-1',
        expect.objectContaining({ status: 'stopped' })
      );
    });

    it('replaces only the current backend project subset when project versions change', async () => {
      mockGetProjectsForBackend.mockResolvedValue([{ id: 'p1', name: 'Project 1' }]);

      handleServerMessage(makeHeartbeat({
        versions: { projects: 2 },
      }), makeCtx({ serverId: 'gw:remote-1', backendId: 'remote-1' }));

      await Promise.resolve();

      expect(mockGetProjectsForBackend).toHaveBeenCalledWith('remote-1');
      expect(mockProjectStore.replaceProjectsForBackend).toHaveBeenCalledWith('remote-1', [{ id: 'p1', name: 'Project 1' }]);
    });

    it('retries project reconciliation after a failed fetch because the cached version is not advanced', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockGetProjectsForBackend
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce([{ id: 'p2', name: 'Project 2' }]);

      const ctx = makeCtx({ serverId: 'gw:remote-2', backendId: 'remote-2' });
      const heartbeat = makeHeartbeat({ versions: { projects: 3 } });

      handleServerMessage(heartbeat, ctx);
      await Promise.resolve();
      await Promise.resolve();
      handleServerMessage(heartbeat, ctx);
      await Promise.resolve();
      await Promise.resolve();

      expect(mockGetProjectsForBackend).toHaveBeenCalledTimes(2);
      expect(mockProjectStore.replaceProjectsForBackend).toHaveBeenCalledWith('remote-2', [{ id: 'p2', name: 'Project 2' }]);
      errorSpy.mockRestore();
    });

    it('does not issue duplicate project fetches while the same version fetch is still in flight', async () => {
      let resolveFetch: ((projects: Array<{ id: string; name: string }>) => void) | undefined;
      mockGetProjectsForBackend.mockImplementation(
        () => new Promise((resolve) => {
          resolveFetch = resolve;
        })
      );

      const ctx = makeCtx({ serverId: 'gw:remote-3', backendId: 'remote-3' });
      const heartbeat = makeHeartbeat({ versions: { projects: 4 } });

      handleServerMessage(heartbeat, ctx);
      handleServerMessage(heartbeat, ctx);
      await Promise.resolve();

      expect(mockGetProjectsForBackend).toHaveBeenCalledTimes(1);

      resolveFetch?.([{ id: 'p3', name: 'Project 3' }]);
      await Promise.resolve();
      await Promise.resolve();

      expect(mockProjectStore.replaceProjectsForBackend).toHaveBeenCalledWith('remote-3', [{ id: 'p3', name: 'Project 3' }]);
    });

    it('ignores stale project fetch results that resolve after a newer version has already applied', async () => {
      let resolveV4: ((projects: Array<{ id: string; name: string }>) => void) | undefined;
      let resolveV5: ((projects: Array<{ id: string; name: string }>) => void) | undefined;
      mockGetProjectsForBackend
        .mockImplementationOnce(() => new Promise((resolve) => { resolveV4 = resolve; }))
        .mockImplementationOnce(() => new Promise((resolve) => { resolveV5 = resolve; }));

      const ctx = makeCtx({ serverId: 'gw:remote-4', backendId: 'remote-4' });
      handleServerMessage(makeHeartbeat({ versions: { projects: 4 } }), ctx);
      handleServerMessage(makeHeartbeat({ versions: { projects: 5 } }), ctx);

      resolveV5?.([{ id: 'p5', name: 'Project 5' }]);
      await Promise.resolve();
      await Promise.resolve();
      resolveV4?.([{ id: 'p4', name: 'Project 4' }]);
      await Promise.resolve();
      await Promise.resolve();

      expect(mockProjectStore.replaceProjectsForBackend).toHaveBeenCalledTimes(1);
      expect(mockProjectStore.replaceProjectsForBackend).toHaveBeenCalledWith('remote-4', [{ id: 'p5', name: 'Project 5' }]);
    });

    it('ignores stale project fetch results from a previous disconnected generation even at the same version', async () => {
      let resolveOld: ((projects: Array<{ id: string; name: string }>) => void) | undefined;
      let resolveNew: ((projects: Array<{ id: string; name: string }>) => void) | undefined;
      mockGetProjectsForBackend
        .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
        .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }));

      const ctx = makeCtx({ serverId: 'remote-5', backendId: 'remote-5' });
      const heartbeat = makeHeartbeat({ versions: { projects: 6 } });

      handleServerMessage(heartbeat, ctx);
      cleanupServerSyncState('remote-5');
      handleServerMessage(heartbeat, ctx);

      resolveNew?.([{ id: 'p6-new', name: 'Project 6 New' }]);
      await Promise.resolve();
      await Promise.resolve();
      resolveOld?.([{ id: 'p6-old', name: 'Project 6 Old' }]);
      await Promise.resolve();
      await Promise.resolve();

      expect(mockProjectStore.replaceProjectsForBackend).toHaveBeenCalledTimes(1);
      expect(mockProjectStore.replaceProjectsForBackend).toHaveBeenCalledWith('remote-5', [{ id: 'p6-new', name: 'Project 6 New' }]);
    });
  });

  describe('terminal messages', () => {
    it('handles terminal_opened failure', () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (xtermRegistry.get as any).mockReturnValue(mockXtermEntry);
      handleServerMessage({
        type: 'terminal_opened', terminalId: 't1', success: false, error: 'Failed',
      }, makeCtx());
      expect(errSpy).toHaveBeenCalled();
      expect(mockXtermEntry.terminal.writeln).toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it('handles terminal_opened success (no-op)', () => {
      handleServerMessage({ type: 'terminal_opened', terminalId: 't1', success: true }, makeCtx());
      // Success is a no-op
    });

    it('handles terminal_output', () => {
      (xtermRegistry.get as any).mockReturnValue(mockXtermEntry);
      handleServerMessage({ type: 'terminal_output', terminalId: 't1', data: 'hello' }, makeCtx());
      expect(mockXtermEntry.terminal.write).toHaveBeenCalledWith('hello');
      expect(mockTerminalStore.markReady).toHaveBeenCalledWith('t1');
    });

    it('handles terminal_exited', () => {
      (xtermRegistry.get as any).mockReturnValue(mockXtermEntry);
      handleServerMessage({ type: 'terminal_exited', terminalId: 't1', exitCode: 0 }, makeCtx());
      expect(mockXtermEntry.terminal.write).toHaveBeenCalled();
      expect(mockTerminalStore.handleTerminalExited).toHaveBeenCalledWith('t1');
      expect(xtermRegistry.delete).toHaveBeenCalledWith('t1');
    });
  });

  describe('file_push', () => {
    it('adds message and file push item', () => {
      handleServerMessage({
        type: 'file_push', sessionId: 's1', fileId: 'f1', fileName: 'test.txt',
        mimeType: 'text/plain', fileSize: 100, description: 'A file',
      }, makeCtx());
      expect(mockChatStore.addMessage).toHaveBeenCalled();
      expect(mockFilePushStore.addItem).toHaveBeenCalled();
    });

    it('auto-downloads when autoDownload is set', () => {
      handleServerMessage({
        type: 'file_push', sessionId: 's1', fileId: 'f1', fileName: 'test.txt',
        mimeType: 'text/plain', fileSize: 100, autoDownload: true,
      }, makeCtx());
      expect(downloadPushedFile).toHaveBeenCalledWith('f1');
    });
  });

  it('handles error', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    handleServerMessage({ type: 'error', message: 'Server error' }, makeCtx());
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  describe('plugin messages', () => {
    it('handles plugin_state', () => {
      handleServerMessage({
        type: 'plugin_state',
        plugins: [{ id: 'p1', name: 'Test', version: '1.0', status: 'active', enabled: true }],
      }, makeCtx());
      expect(mockPluginStore.setPlugins).toHaveBeenCalled();
    });

    it('handles plugin_permission_request', () => {
      handleServerMessage({
        type: 'plugin_permission_request',
        pluginId: 'p1', pluginName: 'Test', permissions: ['read'],
      }, makeCtx());
      expect(mockPluginStore.setPendingPermissionRequest).toHaveBeenCalled();
    });

    it('handles plugin_notification', async () => {
      handleServerMessage({ type: 'plugin_notification', pluginId: 'p1', title: 'Hello', body: 'World' } as any, makeCtx());
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(useNotificationFeedStore.getState().items[0]).toMatchObject({
        ownerBackendId: 'server-1',
        title: 'Hello',
        summary: 'World',
        status: 'completed',
      });
      expect(useToastStore.getState().toasts[0]).toMatchObject({
        title: 'Hello',
        message: 'World',
        type: 'info',
      });
    });

    it('canonicalizes gateway-prefixed owner backend ids for plugin notifications', async () => {
      handleServerMessage(
        { type: 'plugin_notification', pluginId: 'p1', title: 'Hello', body: 'World' } as any,
        makeCtx({ serverId: 'gw:backend-1', backendId: null }),
      );
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(useNotificationFeedStore.getState().items[0]).toMatchObject({
        ownerBackendId: 'backend-1',
      });
    });

    it('handles plugin_panel_registered', () => {
      handleServerMessage({
        type: 'plugin_panel_registered',
        panelId: 'pan1', pluginId: 'p1', label: 'Panel', icon: 'icon', iframeUrl: 'http://...', order: 1,
      }, makeCtx());
      expect(mockPluginStore.registerPanel).toHaveBeenCalled();
    });

    it('handles plugin_panel_unregistered', () => {
      handleServerMessage({
        type: 'plugin_panel_unregistered', pluginId: 'p1', panelId: 'pan1',
      }, makeCtx());
      expect(mockPluginStore.clearPluginExtensions).toHaveBeenCalledWith('p1');
    });

    it('handles plugin_show_panel on desktop', () => {
      handleServerMessage({ type: 'plugin_show_panel', panelId: 'pan1' }, makeCtx());
      expect(mockBottomPanelStore.setActiveTab).toHaveBeenCalledWith('pan1');
    });

    it('registers plugin panel regardless of viewport (platform filtering is in BottomPanel)', () => {
      vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as any);
      handleServerMessage({
        type: 'plugin_panel_registered', panelId: 'pan1', pluginId: 'p1',
        label: 'Test', icon: 'test',
      }, makeCtx());
      expect(mockPluginStore.registerPanel).toHaveBeenCalled();
    });
  });

  it('handles unknown message type', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    handleServerMessage({ type: 'unknown_type' }, makeCtx());
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('unwraps correlation envelope', () => {
    mockChatStore.activeRuns = { r1: 's1' };
    handleServerMessage({
      type: 'delta',
      payload: { runId: 'r1', content: 'wrapped', sessionId: 's1' },
      metadata: { requestId: 'req-1' },
    }, makeCtx());
    expect(mockChatStore.appendToLastMessage).toHaveBeenCalledWith('s1', 'wrapped');
  });
});
