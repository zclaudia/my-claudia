import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/messageHandler', () => ({
  handleServerMessage: vi.fn(),
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
import { useTerminalStore } from '../../stores/terminalStore';
import { xtermRegistry } from '../../utils/xtermRegistry';

describe('useBackendFacade run_event forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    useServerStore.setState({
      activeServerId: null,
      connections: {},
      localServerPort: null,
      controlPlaneMode: 'embedded-local',
      controlPlaneState: 'connecting',
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
      registryRevision: 1,
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
        registryRevision: 2,
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
      status: 'connected',
      features: ['remoteTerminal'],
    });
    expect(useServerStore.getState().activeServerSupports('remoteTerminal')).toBe(true);
  });

  it('downgrades backend connection status while transport is reconnecting', () => {
    useServerStore.setState({
      ...useServerStore.getState(),
      connections: {
        'local-standalone': { status: 'connected', error: null, isLocalConnection: true, features: [] },
      },
    });

    syncToGatewayStore({
      type: 'connection_state_changed',
      state: 'reconnecting',
    } as any);

    expect(useServerStore.getState().controlPlaneState).toBe('connecting');
    expect(useServerStore.getState().connections['local-standalone']).toMatchObject({
      status: 'connecting',
      error: null,
    });
  });

  it('does not keep backend connected on snapshot updates while transport is connecting', () => {
    syncToGatewayStore({
      type: 'snapshot_updated',
      snapshot: {
        snapshotVersion: 2,
        capturedAt: Date.now(),
        mode: 'direct',
        connectionState: 'connecting',
        localBackendId: null,
        currentInstanceId: 'instance-local',
        currentDeviceId: 'device-local',
        registryRevision: 2,
        sessionStreams: {},
        backends: [
          {
            backendId: 'remote-1',
            name: 'Remote',
            online: true,
            runtimeState: 'ready',
            openState: 'open',
            channelId: 'ch-1',
            instanceId: 'instance-remote',
            deviceId: 'device-remote',
            channel: 'prod',
            isThisInstance: false,
            isThisDevice: false,
            capabilities: ['remoteTerminal'],
          },
        ],
      },
    } as any);

    expect(useServerStore.getState().connections['remote-1']).toMatchObject({
      status: 'connecting',
      features: ['remoteTerminal'],
    });
  });

  it('downgrades local backend on snapshot updates while embedded transport is connecting', () => {
    syncToGatewayStore({
      type: 'snapshot_updated',
      snapshot: {
        snapshotVersion: 2,
        capturedAt: Date.now(),
        mode: 'embedded',
        connectionState: 'connecting',
        localBackendId: 'local-standalone',
        currentInstanceId: 'instance-local',
        currentDeviceId: 'device-local',
        registryRevision: 2,
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
      status: 'connecting',
      features: ['remoteTerminal'],
    });
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
        registryRevision: 4,
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
      state: 'opening',
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

  it('filters archived sessions out of catalog snapshots', () => {
    syncToGatewayStore({
      type: 'catalog_snapshot',
      backendId: 'remote-1',
      items: [
        { sessionId: 'session-1', title: 'Active', createdAt: 1, updatedAt: 2, activeRunStatus: 'idle' },
        { sessionId: 'session-archived', title: 'Archived', createdAt: 3, updatedAt: 4, activeRunStatus: 'idle', archived: true },
      ],
    } as any);

    expect(useSessionsStore.getState().remoteSessions.get('remote-1')).toEqual([
      expect.objectContaining({ id: 'session-1', name: 'Active' }),
    ]);
  });

  it('removes archived sessions on catalog upsert events', () => {
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
      type: 'catalog_event',
      backendId: 'remote-1',
      op: 'upsert',
      item: {
        sessionId: 'session-2',
        title: 'Session 2',
        createdAt: 2,
        updatedAt: 3,
        activeRunStatus: 'idle',
        archived: true,
      },
    } as any);

    expect(useSessionsStore.getState().remoteSessions.get('remote-1')).toEqual([
      expect.objectContaining({ id: 'session-1', name: 'Session 1' }),
    ]);
  });

  it('marks remote terminals for reattach on transport disconnect', () => {
    const markDetachedSpy = vi.spyOn(xtermRegistry, 'markDetached').mockImplementation(() => {});
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

    expect(useTerminalStore.getState().shouldReattach('terminal-1')).toBe(true);
    expect(useTerminalStore.getState().shouldReattach('terminal-2')).toBe(false);
    expect(markDetachedSpy).toHaveBeenCalledWith('terminal-1');
    markDetachedSpy.mockRestore();
  });

  it('does not mark terminals for reattach when backend was user-closed', () => {
    const markDetachedSpy = vi.spyOn(xtermRegistry, 'markDetached').mockImplementation(() => {});
    useTerminalStore.setState({
      ...useTerminalStore.getState(),
      terminals: {
        'remote-1::project-1': 'terminal-1',
      },
    });

    syncToGatewayStore({
      type: 'backend_state_changed',
      backendId: 'remote-1',
      state: 'offline',
      error: 'user_closed',
    } as any);

    expect(useTerminalStore.getState().shouldReattach('terminal-1')).toBe(false);
    expect(markDetachedSpy).not.toHaveBeenCalled();
    markDetachedSpy.mockRestore();
  });
});
