import { beforeEach, describe, expect, it, vi } from 'vitest';

const findProcessPidsByTaskCommandMock = vi.fn();
const cleanupPendingPermissionsMock = vi.fn();
const upsertAssistantMessageMock = vi.fn();
const pluginEventsEmitMock = vi.fn(async () => {});
const sendMessageMock = vi.fn();

vi.mock('../run-lifecycle.js', () => ({
  cleanupPendingPermissions: cleanupPendingPermissionsMock,
  findProcessPidsByTaskCommand: findProcessPidsByTaskCommandMock,
  upsertAssistantMessage: upsertAssistantMessageMock,
}));

const mockProviderRegistry = {
  get: vi.fn(() => ({
    getCliPid: vi.fn(() => 111),
    getTaskProcessInfo: vi.fn(() => ({
      command: 'sleep 30',
      rootPid: undefined,
    })),
  })),
  getOrDefault: vi.fn(),
};

vi.mock('../../../../infrastructure/events/index.js', () => ({
  pluginEvents: {
    emit: pluginEventsEmitMock,
  },
}));

vi.mock('../../interactions/interaction-normalizer.js', () => ({
  normalizeFromToolUse: vi.fn(() => null),
}));

vi.mock('../../transport/broadcast.js', () => ({
  sendMessage: sendMessageMock,
}));

describe('ws/run-events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('persists system info and emits session_created on init', async () => {
    const runSqlMock = vi.fn();
    const sendRunEventMock = vi.fn();
    const persistSessionWorkingDirectoryMock = vi.fn();
    const state: Record<string, unknown> = {};
    const activeRun = {
      sessionId: 'session-1',
      latestSystemInfo: undefined,
      providerSessionId: undefined,
      collectedToolCalls: [],
      contentBlocks: [],
      fullContent: '',
      pendingPermissions: new Map(),
      recentToolCalls: [],
    } as any;

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun,
      activeRuns: new Map(),
      broadcastHeartbeat: vi.fn(),
      client: { ws: {} as any } as any,
      db: { prepare: vi.fn(() => ({ run: runSqlMock })) } as any,
      input: 'hello',
      modeValue: 'default',
      msg: {
        type: 'init',
        sessionId: 'sdk-session-1',
        systemInfo: {
          cwd: '/tmp/project',
          model: 'sonnet',
          claudeCodeVersion: '1.0.0',
          permissionMode: 'default',
          apiKeySource: 'env',
          tools: [],
          mcpServers: [],
          slashCommands: [],
          agents: [],
        },
      } as any,
      notificationService: {} as any,
      persistSessionWorkingDirectory: persistSessionWorkingDirectoryMock,
      providerType: 'claude',
      runId: 'run-1',
      sendRunEvent: sendRunEventMock,
      sessionId: 'session-1',
      sessionType: 'regular',
      state,
      toolUseIdToName: new Map(),
      providerRegistry: mockProviderRegistry as any,
    });

    expect(persistSessionWorkingDirectoryMock).toHaveBeenCalledWith('/tmp/project');
    expect(activeRun.latestSystemInfo).toEqual(expect.objectContaining({ cwd: '/tmp/project', model: 'sonnet' }));
    expect(activeRun.providerSessionId).toBe('sdk-session-1');
    expect(state.sdkSessionId).toBe('sdk-session-1');
    expect(runSqlMock).toHaveBeenCalledWith('sdk-session-1', expect.any(Number), 'session-1');
    expect(sendRunEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'system_info',
      runId: 'run-1',
      systemInfo: expect.objectContaining({ cwd: '/tmp/project', model: 'sonnet' }),
    }));
    expect(sendRunEventMock).toHaveBeenCalledWith({
      type: 'session_created',
      sessionId: 'session-1',
      sdkSessionId: 'sdk-session-1',
    });
  });

  it('completes result events, emits background completion, and notifies', async () => {
    const sendRunEventMock = vi.fn();
    const broadcastHeartbeatMock = vi.fn();
    const postItemMock = vi.fn();
    const activeRun = {
      sessionId: 'session-1',
      assistantMessageId: 'assistant-1',
      sessionType: 'background',
      providerType: 'claude',
      collectedToolCalls: [],
      contentBlocks: [],
      fullContent: '',
      pendingPermissions: new Map(),
      recentToolCalls: [],
      completed: false,
    } as any;

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun,
      activeRuns: new Map(),
      broadcastHeartbeat: broadcastHeartbeatMock,
      client: { ws: {} as any } as any,
      db: {} as any,
      input: 'hello',
      modeValue: 'default',
      msg: {
        type: 'result',
        content: 'done',
        usage: { inputTokens: 1, outputTokens: 2 },
      } as any,
      notificationService: { notify: vi.fn() } as any,
      notificationsService: { postItem: postItemMock } as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'claude',
      runId: 'run-1',
      sendRunEvent: sendRunEventMock,
      sessionId: 'session-1',
      sessionType: 'background',
      state: {},
      toolUseIdToName: new Map(),
      providerRegistry: mockProviderRegistry as any,
    });

    expect(activeRun.fullContent).toBe('done');
    expect(activeRun.completed).toBe(true);
    expect(upsertAssistantMessageMock).toHaveBeenCalledWith(activeRun, {
      usage: { inputTokens: 1, outputTokens: 2 },
      indexMetadata: true,
    });
    expect(sendRunEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'delta',
      runId: 'run-1',
      content: 'done',
    }));
    expect(sendRunEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'run_completed',
      runId: 'run-1',
      sessionId: 'session-1',
      usage: { inputTokens: 1, outputTokens: 2 },
    }));
    expect(pluginEventsEmitMock).toHaveBeenCalledWith('run.completed', expect.objectContaining({
      runId: 'run-1',
      sessionId: 'session-1',
    }));
    expect(broadcastHeartbeatMock).toHaveBeenCalled();
    expect(postItemMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      title: 'Run completed: session-1',
      summary: 'Session response is ready.',
      status: 'completed',
      source: 'manual',
    }));
    expect(sendRunEventMock).toHaveBeenCalledWith({
      type: 'background_task_update',
      sessionId: 'session-1',
      status: 'completed',
    });
  });

  it('marks heartbeat dirty before broadcasting completion state', async () => {
    const sendRunEventMock = vi.fn();
    const broadcastHeartbeatMock = vi.fn();
    const activeRun = {
      sessionId: 'session-1',
      providerType: 'claude',
      completed: false,
      collectedToolCalls: [],
      contentBlocks: [],
      fullContent: '',
      pendingPermissions: new Map(),
      recentToolCalls: [],
    } as any;

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun,
      activeRuns: new Map([['run-1', activeRun]]),
      broadcastHeartbeat: broadcastHeartbeatMock,
      client: { ws: {} as any } as any,
      db: {} as any,
      input: 'hello',
      modeValue: 'default',
      msg: { type: 'result', subtype: 'success', usage: { inputTokens: 1, outputTokens: 2 } } as any,
      notificationService: { notify: vi.fn() } as any,
      notificationsService: { postItem: vi.fn() } as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'claude',
      runId: 'run-1',
      sendRunEvent: sendRunEventMock,
      sessionId: 'session-1',
      sessionType: 'regular',
      state: {},
      toolUseIdToName: new Map(),
      providerRegistry: mockProviderRegistry as any,
    });

    expect(broadcastHeartbeatMock).toHaveBeenCalledTimes(1);
  });

  it('fails runs on provider error and removes them from activeRuns', async () => {
    const sendRunEventMock = vi.fn();
    const broadcastHeartbeatMock = vi.fn();
    const postItemMock = vi.fn();
    const activeRun = {
      sessionId: 'session-1',
      providerType: 'claude',
      collectedToolCalls: [],
      contentBlocks: [],
      fullContent: 'partial',
      pendingPermissions: new Map(),
      recentToolCalls: [],
      completed: false,
    } as any;
    const activeRuns = new Map([['run-1', activeRun]]);

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun,
      activeRuns,
      broadcastHeartbeat: broadcastHeartbeatMock,
      client: { ws: {} as any } as any,
      db: {} as any,
      input: 'hello',
      modeValue: 'default',
      msg: {
        type: 'error',
        error: 'provider exploded',
      } as any,
      notificationService: { notify: vi.fn() } as any,
      notificationsService: { postItem: postItemMock } as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'claude',
      runId: 'run-1',
      sendRunEvent: sendRunEventMock,
      sessionId: 'session-1',
      sessionType: 'regular',
      state: {},
      toolUseIdToName: new Map(),
      providerRegistry: mockProviderRegistry as any,
    });

    expect(upsertAssistantMessageMock).toHaveBeenCalledWith(activeRun, { indexMetadata: true });
    expect(sendRunEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'run_failed',
      runId: 'run-1',
      sessionId: 'session-1',
    }));
    expect(activeRun.completed).toBe(true);
    expect(pluginEventsEmitMock).toHaveBeenCalledWith('run.error', expect.objectContaining({
      runId: 'run-1',
      sessionId: 'session-1',
    }));
    expect(broadcastHeartbeatMock).toHaveBeenCalled();
    expect(postItemMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      title: 'Run failed: session-1',
      error: 'provider exploded',
      status: 'failed',
      source: 'manual',
    }));
    expect(cleanupPendingPermissionsMock).toHaveBeenCalled();
    expect(activeRuns.has('run-1')).toBe(false);
  });

  it('swallows PID backfill errors and logs a warning', async () => {
    findProcessPidsByTaskCommandMock.mockRejectedValue(new Error('ps failed'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun: {
        sessionId: 'session-1',
        providerType: 'claude',
        providerSessionId: 'sdk-1',
        collectedToolCalls: [],
        contentBlocks: [],
        fullContent: '',
        pendingPermissions: new Map(),
        recentToolCalls: [],
      } as any,
      activeRuns: new Map(),
      broadcastHeartbeat: vi.fn(),
      client: { ws: {} as any } as any,
      db: {} as any,
      input: 'hello',
      modeValue: 'default',
      msg: {
        type: 'task_notification',
        taskId: 'task-1',
        taskStatus: 'started',
        taskMessage: 'started',
      } as any,
      notificationService: {} as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'claude',
      runId: 'run-1',
      sendRunEvent: vi.fn(),
      sessionId: 'session-1',
      sessionType: 'background',
      state: {},
      toolUseIdToName: new Map(),
      providerRegistry: mockProviderRegistry as any,
    });

    await vi.runAllTimersAsync();

    expect(warnSpy).toHaveBeenCalledWith(
      '[Task Notification] Failed to backfill PID for taskId=task-1:',
      'ps failed',
    );
    warnSpy.mockRestore();
  });
});
