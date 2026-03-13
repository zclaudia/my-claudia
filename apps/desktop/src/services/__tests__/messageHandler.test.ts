import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MessageHandlerContext } from '../messageHandler';

// Mock all stores
const mockChatStore = {
  activeRuns: {} as Record<string, string>,
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
  setSystemInfo: vi.fn(),
  updateRunHealth: vi.fn(),
};

const mockProjectStore = {
  selectedSessionId: 'current-session',
  setSessionActive: vi.fn(),
  addSession: vi.fn(),
  updateSession: vi.fn(),
  sessions: [] as any[],
};

const mockServerStore = {
  activeServerId: 'server-1',
};

const mockPermissionStore = {
  setPendingRequest: vi.fn(),
  clearRequestById: vi.fn(),
  clearStaleRequests: vi.fn(),
  hasRequest: vi.fn(() => false),
};

const mockAskUserQuestionStore = {
  setPendingRequest: vi.fn(),
  clearRequestById: vi.fn(),
  clearRequestsForSession: vi.fn(),
  clearStaleRequests: vi.fn(),
  hasRequest: vi.fn(() => false),
};

const mockSupervisionStore = {
  upsertTask: vi.fn(),
  setAgent: vi.fn(),
  setCheckpointSummary: vi.fn(),
};

const mockLocalPRStore = {
  upsertPR: vi.fn(),
  removePR: vi.fn(),
};

const mockScheduledTaskStore = {
  upsertTask: vi.fn(),
  removeTask: vi.fn(),
};

const mockWorkflowStore = {
  upsertWorkflow: vi.fn(),
  removeWorkflow: vi.fn(),
  upsertRun: vi.fn(),
  loadStepTypes: vi.fn(),
};

const mockSessionsStore = {
  setSessionActiveFlag: vi.fn(),
  setSessionActiveById: vi.fn(),
  reconcileActiveStatus: vi.fn(),
  setActiveSessionsForBackend: vi.fn(),
};

const mockTerminalStore = {
  markReady: vi.fn(),
  handleTerminalExited: vi.fn(),
  setBottomPanelTab: vi.fn(),
};

const mockPluginStore = {
  setPlugins: vi.fn(),
  setPendingPermissionRequest: vi.fn(),
  registerPanel: vi.fn(),
  clearPluginExtensions: vi.fn(),
};

const mockFilePushStore = {
  addItem: vi.fn(),
};

const mockBackgroundTaskStore = {
  tasks: {} as Record<string, any>,
  addTask: vi.fn(),
  updateTask: vi.fn(),
};

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
vi.mock('../../stores/askUserQuestionStore', () => ({
  useAskUserQuestionStore: { getState: () => mockAskUserQuestionStore },
}));
vi.mock('../../stores/supervisionStore', () => ({
  useSupervisionStore: { getState: () => mockSupervisionStore },
}));
vi.mock('../../stores/localPRStore', () => ({
  useLocalPRStore: { getState: () => mockLocalPRStore },
}));
vi.mock('../../stores/scheduledTaskStore', () => ({
  useScheduledTaskStore: { getState: () => mockScheduledTaskStore },
}));
vi.mock('../../stores/workflowStore', () => ({
  useWorkflowStore: { getState: () => mockWorkflowStore },
}));
vi.mock('../../stores/sessionsStore', () => ({
  useSessionsStore: { getState: () => mockSessionsStore },
  LOCAL_BACKEND_KEY: '__local__',
}));
vi.mock('../../stores/terminalStore', () => ({
  useTerminalStore: { getState: () => mockTerminalStore },
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
vi.mock('../fileDownload', () => ({
  downloadPushedFile: vi.fn(),
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

import { handleServerMessage } from '../messageHandler';
import { downloadPushedFile } from '../fileDownload';
import { xtermRegistry } from '../../utils/xtermRegistry';

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
    mockChatStore.activeRuns = {};
    mockBackgroundTaskStore.tasks = {};
    mockProjectStore.selectedSessionId = 'current-session';
    mockProjectStore.sessions = [];
    mockServerStore.activeServerId = 'server-1';
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
  });

  describe('run_completed', () => {
    it('completes a run', () => {
      mockChatStore.activeRuns = { r1: 's1' };
      const ctx = makeCtx();
      ctx.serverRunsRef.set('server-1', new Set(['r1']));

      handleServerMessage({ type: 'run_completed', runId: 'r1', usage: { tokens: 100 } }, ctx);

      expect(mockAskUserQuestionStore.clearRequestsForSession).toHaveBeenCalledWith('s1');
      expect(mockChatStore.finalizeRunToMessage).toHaveBeenCalledWith('r1');
      expect(mockChatStore.addSessionUsage).toHaveBeenCalledWith('s1', { tokens: 100 });
      expect(mockProjectStore.setSessionActive).toHaveBeenCalledWith('s1', false);
      expect(mockChatStore.endRun).toHaveBeenCalledWith('r1');
      expect(ctx.serverRunsRef.get('server-1')?.has('r1')).toBe(false);
    });

    it('uses sessionId from message when available', () => {
      handleServerMessage({ type: 'run_completed', runId: 'r1', sessionId: 's2' }, makeCtx());
      expect(mockAskUserQuestionStore.clearRequestsForSession).toHaveBeenCalledWith('s2');
    });

    it('gateway: calls setSessionActiveById', () => {
      handleServerMessage(
        { type: 'run_completed', runId: 'r1', sessionId: 's1' },
        makeCtx({ backendId: 'b1' })
      );
      expect(mockSessionsStore.setSessionActiveById).toHaveBeenCalledWith('b1', 's1', false);
    });
  });

  describe('run_failed', () => {
    it('handles run failure with error message', () => {
      mockChatStore.activeRuns = { r1: 's1' };
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      handleServerMessage({ type: 'run_failed', runId: 'r1', error: 'boom' }, makeCtx());

      expect(mockChatStore.appendToLastMessage).toHaveBeenCalledWith('s1', expect.stringContaining('boom'));
      expect(mockChatStore.finalizeRunToMessage).toHaveBeenCalledWith('r1');
      expect(mockChatStore.endRun).toHaveBeenCalledWith('r1');
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
    expect(mockChatStore.setMode).toHaveBeenCalledWith('s1', 'plan');
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

  it('handles ask_user_question', () => {
    handleServerMessage({
      type: 'ask_user_question', requestId: 'q1', sessionId: 's1', questions: ['What?'],
    }, makeCtx());
    expect(mockAskUserQuestionStore.setPendingRequest).toHaveBeenCalledWith(
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

  it('handles ask_user_question_resolved', () => {
    handleServerMessage({ type: 'ask_user_question_resolved', requestId: 'q1' }, makeCtx());
    expect(mockAskUserQuestionStore.clearRequestById).toHaveBeenCalledWith('q1');
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
        expect.objectContaining({ id: 't1', sessionId: 's1', status: 'started' })
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

    it('skips if missing sessionId or taskId', () => {
      handleServerMessage({ type: 'task_notification' }, makeCtx());
      expect(mockBackgroundTaskStore.addTask).not.toHaveBeenCalled();
    });
  });

  it('handles supervision_task_update', () => {
    handleServerMessage({
      type: 'supervision_task_update', projectId: 'p1', task: { id: 'task1' },
    }, makeCtx());
    expect(mockSupervisionStore.upsertTask).toHaveBeenCalledWith('p1', { id: 'task1' });
  });

  it('handles supervision_agent_update', () => {
    handleServerMessage({
      type: 'supervision_agent_update', projectId: 'p1', agent: { id: 'a1' },
    }, makeCtx());
    expect(mockSupervisionStore.setAgent).toHaveBeenCalledWith('p1', { id: 'a1' });
  });

  it('handles supervision_checkpoint', () => {
    handleServerMessage({
      type: 'supervision_checkpoint', projectId: 'p1', summary: 'All good',
    }, makeCtx());
    expect(mockSupervisionStore.setCheckpointSummary).toHaveBeenCalledWith('p1', 'All good');
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
    handleServerMessage({ type: 'local_pr_update', projectId: 'p1', pr: { id: 'pr1' } }, makeCtx());
    expect(mockLocalPRStore.upsertPR).toHaveBeenCalledWith('p1', { id: 'pr1' });
  });

  it('handles local_pr_deleted', () => {
    handleServerMessage({ type: 'local_pr_deleted', projectId: 'p1', prId: 'pr1' }, makeCtx());
    expect(mockLocalPRStore.removePR).toHaveBeenCalledWith('p1', 'pr1');
  });

  it('handles scheduled_task_update', () => {
    handleServerMessage({ type: 'scheduled_task_update', projectId: 'p1', task: { id: 'st1' } }, makeCtx());
    expect(mockScheduledTaskStore.upsertTask).toHaveBeenCalledWith('p1', { id: 'st1' });
  });

  it('handles scheduled_task_deleted', () => {
    handleServerMessage({ type: 'scheduled_task_deleted', projectId: 'p1', taskId: 'st1' }, makeCtx());
    expect(mockScheduledTaskStore.removeTask).toHaveBeenCalledWith('p1', 'st1');
  });

  it('handles workflow_update', () => {
    handleServerMessage({ type: 'workflow_update', projectId: 'p1', workflow: { id: 'w1' } }, makeCtx());
    expect(mockWorkflowStore.upsertWorkflow).toHaveBeenCalledWith('p1', { id: 'w1' });
  });

  it('handles workflow_deleted', () => {
    handleServerMessage({ type: 'workflow_deleted', projectId: 'p1', workflowId: 'w1' }, makeCtx());
    expect(mockWorkflowStore.removeWorkflow).toHaveBeenCalledWith('p1', 'w1');
  });

  it('handles workflow_run_update', () => {
    handleServerMessage({
      type: 'workflow_run_update', projectId: 'p1', run: { id: 'wr1' }, stepRuns: [],
    }, makeCtx());
    expect(mockWorkflowStore.upsertRun).toHaveBeenCalledWith('p1', { id: 'wr1' }, []);
  });

  it('handles workflow_step_types_changed', () => {
    handleServerMessage({ type: 'workflow_step_types_changed' }, makeCtx());
    expect(mockWorkflowStore.loadStepTypes).toHaveBeenCalled();
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
        activeRuns: [{ runId: 'r1', sessionId: 's1', sessionType: 'foreground' }],
      }), makeCtx());
      expect(mockChatStore.startRun).toHaveBeenCalledWith('r1', 's1', false);
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
      logSpy.mockRestore();
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
      expect(mockAskUserQuestionStore.clearStaleRequests).toHaveBeenCalled();
      expect(mockAskUserQuestionStore.setPendingRequest).toHaveBeenCalled();
    });

    it('gateway: reconciles active sessions', () => {
      handleServerMessage(makeHeartbeat({
        activeRuns: [{ runId: 'r1', sessionId: 's1', sessionType: 'foreground' }],
      }), makeCtx({ backendId: 'b1' }));
      expect(mockSessionsStore.reconcileActiveStatus).toHaveBeenCalled();
    });

    it('direct: sets active sessions for local backend', () => {
      handleServerMessage(makeHeartbeat({
        activeRuns: [{ runId: 'r1', sessionId: 's1' }],
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

    it('handles plugin_notification', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      handleServerMessage({ type: 'plugin_notification', title: 'Hello', body: 'World' }, makeCtx());
      expect(logSpy).toHaveBeenCalled();
      logSpy.mockRestore();
    });

    it('handles plugin_panel_registered on desktop', () => {
      vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as any);
      handleServerMessage({
        type: 'plugin_panel_registered',
        panelId: 'pan1', pluginId: 'p1', label: 'Panel', icon: 'icon', iframeUrl: 'http://...', order: 1,
      }, makeCtx());
      expect(mockPluginStore.registerPanel).toHaveBeenCalled();
    });

    it('handles plugin_panel_unregistered on desktop', () => {
      vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as any);
      handleServerMessage({
        type: 'plugin_panel_unregistered', pluginId: 'p1', panelId: 'pan1',
      }, makeCtx());
      expect(mockPluginStore.clearPluginExtensions).toHaveBeenCalledWith('p1');
    });

    it('handles plugin_show_panel on desktop', () => {
      vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as any);
      handleServerMessage({ type: 'plugin_show_panel', panelId: 'pan1' }, makeCtx());
      expect(mockTerminalStore.setBottomPanelTab).toHaveBeenCalledWith('plugin:pan1');
    });

    it('skips plugin UI messages on mobile', () => {
      vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as any);
      handleServerMessage({
        type: 'plugin_panel_registered', panelId: 'pan1', pluginId: 'p1',
      }, makeCtx());
      expect(mockPluginStore.registerPanel).not.toHaveBeenCalled();
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
