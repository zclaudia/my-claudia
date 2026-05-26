import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/messageHandler', () => ({
  handleServerMessage: vi.fn(),
  cleanupServerSyncState: vi.fn(),
}));

import { syncToGatewayStore } from '../useBackendFacade';
import { useFacadeStore } from '../../stores/facadeStore';
import { useToastStore } from '../../stores/toastStore';
import { handleServerMessage } from '../../services/messageHandler';
import { useServerStore } from '../../stores/serverStore';
import { useChatStore } from '../../stores/chatStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionsStore } from '../../stores/sessionsStore';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { useRecoveryStore } from '../../stores/recoveryStore';
import { useSessionRunStateStore } from '../../stores/sessionRunStateStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { terminalRegistry } from '../../services/terminal/TerminalRegistry';

describe('useBackendFacade run_event forwarding', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useToastStore.setState({ toasts: [] });
    useServerStore.setState({
      activeServerId: null,
      connections: {},
      localServerPort: null,
      controlPlaneMode: 'embedded-local',
    });
    useFacadeStore.setState({
      facade: null,
      mode: 'embedded',
      connectionState: 'connected',
      backends: [
        {
          backendId: 'local-standalone',
          name: 'Local',
          online: true,
          runtimeState: 'ready',
          openState: 'open',
          isThisInstance: true,
          instanceId: 'instance-local',
        } as any,
      ],
      sessionStreams: {},
      localBackendId: 'local-standalone',
      currentInstanceId: 'instance-local',
      currentDeviceId: 'device-local',
      snapshotVersion: 1,
    });
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
      runtimeModes: {},
      sessionUsage: {},
      modelOverrides: {},
      permissionOverrides: {},
      worktreeOverrides: {},
      drafts: {},
    } as any);
    useSessionRunStateStore.setState({ records: {} });
    useProjectStore.setState({
      projects: [],
      sessions: [{ id: 'session-1', projectId: 'project-1', name: 'Session 1', isActive: true }],
      dataServerId: null,
      selectedProjectId: null,
      selectedSessionId: null,
      dashboardViews: {},
      providers: [],
      providerCommands: {},
      providerCapabilities: {},
    } as any);
    useSessionsStore.setState({
      remoteSessions: new Map([
        ['remote-1', [{ id: 'session-1', projectId: '', name: 'Session 1', createdAt: 1, updatedAt: 1, isActive: true, type: 'regular' }]],
      ]),
      activeSessionIdsByBackend: new Map([['remote-1', new Set(['session-1'])]]),
      recentlyCompletedSessions: [],
    } as any);
    useOwnershipStore.setState({
      sessionBackendIds: { 'session-1': 'remote-1' },
      projectBackendIds: {},
      taskOwners: {},
    } as any);
    useTerminalStore.setState({
      terminals: {},
      readyTerminals: new Set(),
      drawerOpen: {},
      ctrlActive: {},
      poppedOutTerminals: {},
      reattachTerminals: {},
    } as any);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    consoleWarnSpy.mockRestore();
  });

  it('forwards local backend run events to the shared message handler', () => {
    const serverEvent = {
      type: 'run_started',
      runId: 'run-1',
      sessionId: 'session-1',
      clientRequestId: 'client-1',
      userMessageId: 'user-1',
      assistantMessageId: 'assistant-1',
    } as any;

    syncToGatewayStore({
      type: 'run_event',
      backendId: 'local-standalone',
      event: serverEvent,
    } as any);

    expect(handleServerMessage).toHaveBeenCalledWith(
      serverEvent,
      expect.objectContaining({
        serverId: 'local-standalone',
        backendId: 'local-standalone',
        logTag: 'Facade:local-standalone',
      }),
    );
  });

  it('forwards backend messages without sessionId to the shared message handler', () => {
    const serverMessage = {
      type: 'terminal_output',
      terminalId: 'term-1',
      data: 'prompt',
    } as any;

    syncToGatewayStore({
      type: 'backend_message_received',
      backendId: 'local-standalone',
      message: serverMessage,
    } as any);

    expect(handleServerMessage).toHaveBeenCalledWith(
      serverMessage,
      expect.objectContaining({
        serverId: 'local-standalone',
        backendId: 'local-standalone',
        logTag: 'Facade:local-standalone',
      }),
    );
  });

  it('shows toast when content catch-up fails', () => {
    syncToGatewayStore({
      type: 'content_patch_failed',
      backendId: 'local-standalone',
      sessionId: 'session-1',
      afterOffset: 12,
      error: 'catch-up query failed',
    } as any);

    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: 'error',
      title: '消息同步失败',
      message: 'catch-up query failed',
    });
  });

  it('syncs backend capabilities into server features on snapshot updates', () => {
    syncToGatewayStore({
      type: 'snapshot_updated',
      snapshot: {
        snapshotVersion: 2,
        capturedAt: Date.now(),
        mode: 'embedded',
        connectionState: 'connected',
        localBackendId: 'local-standalone',
        currentInstanceId: 'instance-local',
        currentDeviceId: 'device-local',
        sessionStreams: {},
        backends: [
          {
            backendId: 'local-standalone',
            name: 'Local',
            online: true,
            runtimeState: 'ready',
            openState: 'open',
            channelId: 'ch-1',
            instanceId: 'instance-local',
            deviceId: 'device-local',
            channel: 'local',
            isThisInstance: true,
            isThisDevice: true,
            capabilities: ['remoteTerminal'],
          },
        ],
      },
    } as any);

    expect(useServerStore.getState().connections['local-standalone']).toMatchObject({
      features: ['remoteTerminal'],
    });
    expect(useServerStore.getState().activeServerSupports('remoteTerminal')).toBe(true);
  });

  it('migrates a stale local backend selection to the current local backend id', () => {
    useFacadeStore.setState({
      ...useFacadeStore.getState(),
      localBackendId: 'local-embedded',
      backends: [
        {
          backendId: 'local-embedded',
          name: 'Local',
          online: true,
          runtimeState: 'ready',
          openState: 'open',
          isThisInstance: true,
          instanceId: 'instance-local',
          channel: 'local',
        } as any,
      ],
    });
    useServerStore.setState({
      ...useServerStore.getState(),
      activeServerId: 'local-standalone',
    });

    syncToGatewayStore({
      type: 'snapshot_updated',
      snapshot: {
        snapshotVersion: 4,
        capturedAt: Date.now(),
        mode: 'embedded',
        connectionState: 'connected',
        localBackendId: 'local-embedded',
        currentInstanceId: 'instance-local',
        currentDeviceId: 'device-local',
        sessionStreams: {},
        backends: [
          {
            backendId: 'local-embedded',
            name: 'Local',
            online: true,
            runtimeState: 'ready',
            openState: 'open',
            channelId: 'ch-local',
            instanceId: 'instance-local',
            deviceId: 'device-local',
            channel: 'local',
            isThisInstance: true,
            isThisDevice: true,
            capabilities: [],
          },
        ],
      },
    } as any);

    expect(useServerStore.getState().activeServerId).toBe('local-embedded');
  });

  it('deduplicates deferred auto-open across repeated snapshots', () => {
    const openBackend = vi.fn();
    useFacadeStore.setState({
      ...useFacadeStore.getState(),
      facade: {
        getSnapshot: () => ({
          backends: [
            { backendId: 'remote-1', openState: 'unsubscribed', runtimeState: 'visible' },
          ],
        }),
        openBackend,
      } as any,
    });
    useServerStore.setState({
      ...useServerStore.getState(),
      activeServerId: 'remote-1',
    });

    const snapshot = {
      snapshotVersion: 2,
      capturedAt: Date.now(),
      mode: 'direct',
      connectionState: 'connected',
      localBackendId: null,
      currentInstanceId: 'instance-local',
      currentDeviceId: 'device-local',
      sessionStreams: {},
      backends: [
        {
          backendId: 'remote-1',
          name: 'Remote',
          online: true,
          runtimeState: 'visible',
          openState: 'unsubscribed',
          instanceId: 'instance-remote',
          deviceId: 'device-remote',
          channel: 'prod',
          isThisInstance: false,
          isThisDevice: false,
          capabilities: [],
        },
      ],
    };

    syncToGatewayStore({ type: 'snapshot_updated', snapshot } as any);
    syncToGatewayStore({ type: 'snapshot_updated', snapshot } as any);

    expect(openBackend).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(openBackend).toHaveBeenCalledTimes(1);
    expect(openBackend).toHaveBeenCalledWith('remote-1');
  });

  it('keeps active runs alive while a backend reconnects unexpectedly', () => {
    useChatStore.setState({
      ...useChatStore.getState(),
      activeRuns: { 'run-1': 'session-1' },
    });

    syncToGatewayStore({
      type: 'run_event',
      backendId: 'remote-1',
      event: {
        type: 'run_started',
        runId: 'run-1',
        sessionId: 'session-1',
        assistantMessageId: 'assistant-1',
      },
    } as any);

    syncToGatewayStore({
      type: 'backend_state_changed',
      backendId: 'remote-1',
      state: 'subscribing',
      error: 'peer_disconnected',
    } as any);

    expect(useChatStore.getState().activeRuns['run-1']).toBe('session-1');
    expect(useProjectStore.getState().sessions.find((s) => s.id === 'session-1')?.lastRunStatus).toBeUndefined();
    expect(Array.from(useSessionsStore.getState().activeSessionIdsByBackend.get('remote-1') ?? [])).toEqual(['session-1']);
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      type: 'error',
      title: '远程连接已中断',
      message: expect.stringContaining('正在等待恢复'),
    });
  });

  it('filters archived sessions out of backend data snapshots', () => {
    syncToGatewayStore({
      type: 'backend_data_snapshot',
      backendId: 'remote-1',
      sessions: [
        { sessionId: 'session-1', title: 'Active', createdAt: 1, updatedAt: 2, runStatus: 'idle' },
        { sessionId: 'session-archived', title: 'Archived', createdAt: 3, updatedAt: 4, runStatus: 'idle', archived: true },
      ],
      projects: [],
    } as any);

    expect(useSessionsStore.getState().remoteSessions.get('remote-1')).toEqual([
      expect.objectContaining({ id: 'session-1', name: 'Active' }),
    ]);
  });

  it('backend_data_snapshot initializes recoveryStore data sync as ready and stamps ownership', () => {
    useRecoveryStore.setState({
      backends: {
        'remote-1': { backendId: 'remote-1', status: 'ready', subscribed: true, dataReady: false, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
      },
      dataSyncs: {},
      nextOwnershipVersion: 1,
    } as any);

    syncToGatewayStore({
      type: 'backend_data_snapshot',
      backendId: 'remote-1',
      sessions: [
        { sessionId: 's1', title: 'S1', createdAt: 1, updatedAt: 2, runStatus: 'idle' },
        { sessionId: 's2', title: 'S2', createdAt: 3, updatedAt: 4, runStatus: 'idle' },
      ],
      projects: [],
    } as any);

    const dataSync = useRecoveryStore.getState().dataSyncs['remote-1'];
    expect(dataSync).toBeDefined();
    expect(dataSync.status).toBe('ready');
    expect(dataSync.ownershipVersion).toBe(1);

    const backend = useRecoveryStore.getState().backends['remote-1'];
    expect(backend.dataReady).toBe(true);
    expect(backend.status).toBe('ready');
  });

  it('cleans up stale runs only for the snapshot backend', () => {
    useChatStore.getState().startRun('run-remote', 'session-1');
    useChatStore.getState().startRun('run-local', 'session-local');
    useProjectStore.setState({
      ...useProjectStore.getState(),
      sessions: [
        { id: 'session-1', projectId: 'project-1', name: 'Session 1', isActive: true },
        { id: 'session-local', projectId: 'project-local', name: 'Local Session', isActive: true },
      ],
    } as any);
    useOwnershipStore.getState().setSessionOwner('session-1', 'remote-1');
    useOwnershipStore.getState().setSessionOwner('session-local', 'local-standalone');

    syncToGatewayStore({
      type: 'backend_data_snapshot',
      backendId: 'remote-1',
      sessions: [],
      projects: [],
    } as any);

    expect(useChatStore.getState().activeRuns['run-remote']).toBeUndefined();
    expect(useChatStore.getState().activeRuns['run-local']).toBe('session-local');
  });

  it('snapshot stale-run cleanup clears backend activity markers', () => {
    useChatStore.getState().startRun('run-1', 'session-1');
    useOwnershipStore.getState().setSessionOwner('session-1', 'remote-1');

    syncToGatewayStore({
      type: 'run_event',
      backendId: 'remote-1',
      event: {
        type: 'run_started',
        runId: 'run-1',
        sessionId: 'session-1',
        assistantMessageId: 'assistant-1',
      },
    } as any);

    syncToGatewayStore({
      type: 'backend_data_snapshot',
      backendId: 'remote-1',
      sessions: [],
      projects: [],
    } as any);

    syncToGatewayStore({
      type: 'backend_state_changed',
      backendId: 'remote-1',
      state: 'error',
      error: 'transport_disconnected',
    } as any);

    expect(useChatStore.getState().activeRuns['run-1']).toBeUndefined();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('removes archived sessions on backend data upsert events', () => {
    useSessionsStore.setState({
      ...useSessionsStore.getState(),
      remoteSessions: new Map([
        ['remote-1', [
          { id: 'session-1', projectId: '', name: 'Session 1', createdAt: 1, updatedAt: 1, isActive: false, type: 'regular' },
          { id: 'session-2', projectId: '', name: 'Session 2', createdAt: 2, updatedAt: 2, isActive: false, type: 'regular' },
        ]],
      ]),
      activeSessionIdsByBackend: new Map([['remote-1', new Set()]]),
    } as any);

    syncToGatewayStore({
      type: 'backend_data_event',
      backendId: 'remote-1',
      event: {
        type: 'backend_data_event',
        op: 'session_upsert',
        item: {
          sessionId: 'session-2',
          title: 'Session 2',
          createdAt: 2,
          updatedAt: 3,
          runStatus: 'idle',
          archived: true,
        },
      },
    } as any);

    expect(useSessionsStore.getState().remoteSessions.get('remote-1')).toEqual([
      expect.objectContaining({ id: 'session-1', name: 'Session 1' }),
    ]);
  });

  it('upserts remote projects with the event backend owner instead of the active backend', () => {
    useServerStore.setState({
      ...useServerStore.getState(),
      activeServerId: 'local-standalone',
    });
    useProjectStore.setState({
      ...useProjectStore.getState(),
      projects: [{ id: 'project-1', name: 'Local Project', type: 'code', createdAt: 1, updatedAt: 1 }],
    } as any);
    useOwnershipStore.setState({
      ...useOwnershipStore.getState(),
      projectBackendIds: { 'project-1': 'local-standalone' },
    } as any);

    syncToGatewayStore({
      type: 'backend_data_event',
      backendId: 'remote-1',
      event: {
        type: 'backend_data_event',
        op: 'project_upsert',
        item: {
          projectId: 'project-2',
          name: 'Remote Project',
          createdAt: 10,
          updatedAt: 11,
        },
      },
    } as any);

    expect(useProjectStore.getState().projects).toEqual([
      expect.objectContaining({ id: 'project-1', name: 'Local Project' }),
      expect.objectContaining({ id: 'project-2', name: 'Remote Project' }),
    ]);
    expect(useOwnershipStore.getState().getProjectBackendId('project-2')).toBe('remote-1');
  });

  it('removes only the project owned by the event backend', () => {
    useProjectStore.setState({
      ...useProjectStore.getState(),
      projects: [
        { id: 'shared-project', name: 'Remote Project', type: 'code', createdAt: 1, updatedAt: 1 },
        { id: 'local-project', name: 'Local Project', type: 'code', createdAt: 2, updatedAt: 2 },
      ],
    } as any);
    useOwnershipStore.setState({
      ...useOwnershipStore.getState(),
      projectBackendIds: {
        'shared-project': 'remote-1',
        'local-project': 'local-standalone',
      },
    } as any);

    syncToGatewayStore({
      type: 'backend_data_event',
      backendId: 'local-standalone',
      event: {
        type: 'backend_data_event',
        op: 'project_remove',
        projectId: 'shared-project',
      },
    } as any);

    expect(useProjectStore.getState().projects).toEqual([
      expect.objectContaining({ id: 'shared-project', name: 'Remote Project' }),
      expect.objectContaining({ id: 'local-project', name: 'Local Project' }),
    ]);

    syncToGatewayStore({
      type: 'backend_data_event',
      backendId: 'remote-1',
      event: {
        type: 'backend_data_event',
        op: 'project_remove',
        projectId: 'shared-project',
      },
    } as any);

    expect(useProjectStore.getState().projects).toEqual([
      expect.objectContaining({ id: 'local-project', name: 'Local Project' }),
    ]);
  });

  it('ignores project_upsert when another backend already owns the same project id', () => {
    useProjectStore.setState({
      ...useProjectStore.getState(),
      projects: [
        { id: 'shared-project', name: 'Remote Project', type: 'code', createdAt: 1, updatedAt: 1 },
      ],
    } as any);
    useOwnershipStore.setState({
      ...useOwnershipStore.getState(),
      projectBackendIds: {
        'shared-project': 'remote-1',
      },
    } as any);

    syncToGatewayStore({
      type: 'backend_data_event',
      backendId: 'local-standalone',
      event: {
        type: 'backend_data_event',
        op: 'project_upsert',
        item: {
          projectId: 'shared-project',
          name: 'Local Collision',
          createdAt: 10,
          updatedAt: 11,
        },
      },
    } as any);

    expect(useProjectStore.getState().projects).toEqual([
      expect.objectContaining({ id: 'shared-project', name: 'Remote Project' }),
    ]);
    expect(useOwnershipStore.getState().getProjectBackendId('shared-project')).toBe('remote-1');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Ignoring project event collision for shared-project')
    );
  });

  it('detaches remote terminals on transport disconnect', () => {
    const t1 = terminalRegistry.getOrCreate('terminal-1', {
      terminalId: 'terminal-1',
      sendMessage: vi.fn(),
      getTheme: () => ({}) as any,
      factories: {
        createTerminal: () => ({
          cols: 80, rows: 24, options: {}, open: vi.fn(), dispose: vi.fn(),
          loadAddon: vi.fn(), write: vi.fn(), writeln: vi.fn(), focus: vi.fn(),
          onData: () => ({ dispose: vi.fn() }),
        } as any),
        createFitAddon: () => ({ fit: vi.fn(), dispose: vi.fn(), activate: vi.fn() } as any),
      },
    });
    // Drive controller into 'open' so detach is allowed
    t1.open({ projectId: 'project-1' });
    t1.handleServerMessage({ type: 'terminal_opened', terminalId: 'terminal-1', success: true } as any);

    useTerminalStore.setState({
      ...useTerminalStore.getState(),
      terminals: {
        'remote-1::project-1': 'terminal-1',
        'remote-2::project-1': 'terminal-2',
      },
    });

    syncToGatewayStore({
      type: 'backend_state_changed',
      backendId: 'remote-1',
      state: 'offline',
      error: 'transport_disconnected',
    } as any);

    expect(t1.getState().kind).toBe('detached');
    terminalRegistry.delete('terminal-1');
  });

  it('does not detach terminals when backend was user-closed', () => {
    const t1 = terminalRegistry.getOrCreate('terminal-1', {
      terminalId: 'terminal-1',
      sendMessage: vi.fn(),
      getTheme: () => ({}) as any,
      factories: {
        createTerminal: () => ({
          cols: 80, rows: 24, options: {}, open: vi.fn(), dispose: vi.fn(),
          loadAddon: vi.fn(), write: vi.fn(), writeln: vi.fn(), focus: vi.fn(),
          onData: () => ({ dispose: vi.fn() }),
        } as any),
        createFitAddon: () => ({ fit: vi.fn(), dispose: vi.fn(), activate: vi.fn() } as any),
      },
    });
    t1.open({ projectId: 'project-1' });
    t1.handleServerMessage({ type: 'terminal_opened', terminalId: 'terminal-1', success: true } as any);

    useTerminalStore.setState({
      ...useTerminalStore.getState(),
      terminals: { 'remote-1::project-1': 'terminal-1' },
    });

    syncToGatewayStore({
      type: 'backend_state_changed',
      backendId: 'remote-1',
      state: 'offline',
      error: 'user_closed',
    } as any);

    expect(t1.getState().kind).toBe('open');
    terminalRegistry.delete('terminal-1');
  });
});
