/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../../services/appLifecycleManager', () => ({
  appLifecycleManager: {
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

const mockSyncBackendCatalog = vi.fn();
const mockRecoverCurrentSessionTail = vi.fn();
vi.mock('../../services/sessionSync', () => ({
  syncBackendCatalog: (...args: any[]) => mockSyncBackendCatalog(...args),
  recoverCurrentSessionTail: (...args: any[]) => mockRecoverCurrentSessionTail(...args),
}));

import { useRecoveryCoordinator } from '../useRecoveryCoordinator';
import { useFacadeStore } from '../../stores/facadeStore';
import { useProjectStore } from '../../stores/projectStore';
import { useServerStore } from '../../stores/serverStore';
import { useRecoveryStore } from '../../stores/recoveryStore';
import { useOwnershipStore } from '../../stores/ownershipStore';

describe('useRecoveryCoordinator', () => {
  const facade = {
    openBackend: vi.fn(),
    openSessionStream: vi.fn(),
    catchUpContent: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSyncBackendCatalog.mockResolvedValue({ completed: true, sessions: [] });
    mockRecoverCurrentSessionTail.mockResolvedValue(undefined);

    useFacadeStore.setState({
      facade: facade as any,
      mode: 'direct',
      connectionState: 'connected',
      connectionError: null,
      backends: [],
      sessionStreams: {},
      localBackendId: null,
      currentInstanceId: null,
      currentDeviceId: null,
      registryRevision: 1,
      snapshotVersion: 1,
    });

    useServerStore.setState({
      activeServerId: null,
      connections: {},
      localServerPort: null,
      controlPlaneMode: 'gateway-direct',
    } as any);

    useProjectStore.setState({
      projects: [],
      sessions: [],
      providers: [],
      dataServerId: null,
      selectedProjectId: null,
      selectedSessionId: null,
      dashboardViews: {},
      providerCommands: {},
      providerCapabilities: {},
    } as any);

    useOwnershipStore.setState({
      sessionBackendIds: {},
      sessionOwnershipVersions: {},
      projectBackendIds: {},
      taskOwners: {},
    } as any);

    useRecoveryStore.setState({
      coordinator: 'recovering',
      transport: {
        status: 'connected',
        mode: 'direct',
        generation: 1,
        error: null,
        peerSessionId: null,
        retryCount: 0,
        lastMessageAt: null,
        statusEnteredAt: Date.now(),
      },
      activeBackendId: null,
      selectedSessionId: null,
      backends: {},
      catalogs: {},
      activeSession: {
        sessionId: null,
        status: 'idle',
        backendId: null,
        ownershipVersion: null,
        retryCount: 0,
        lastError: null,
        hasGapMarker: false,
        lastMessageAt: null,
        statusEnteredAt: Date.now(),
      },
      nextOwnershipVersion: 1,
      backgroundAt: null,
    } as any);
  });

  it('does not mark catalog ready when sync is skipped or incomplete', async () => {
    mockSyncBackendCatalog.mockResolvedValue({ completed: false, sessions: [] });

    useFacadeStore.setState({
      ...useFacadeStore.getState(),
      backends: [
        { backendId: 'b1', online: true, runtimeState: 'ready', openState: 'open', name: 'B1' } as any,
      ],
    });
    useServerStore.setState({ ...useServerStore.getState(), activeServerId: 'b1' });
    useRecoveryStore.setState({
      ...useRecoveryStore.getState(),
      activeBackendId: 'b1',
      backends: {
        b1: { backendId: 'b1', status: 'ready', desiredOpen: true, channelReady: true, catalogReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
      },
    } as any);

    renderHook(() => useRecoveryCoordinator());

    await waitFor(() => {
      expect(mockSyncBackendCatalog).toHaveBeenCalledWith('b1', 'full');
    });

    expect(useRecoveryStore.getState().catalogs.b1?.status).toBe('syncing_full');
    expect(useRecoveryStore.getState().coordinator).toBe('recovering');
  });

  it('opens the verified owner backend when active session owner is on another backend', async () => {
    useFacadeStore.setState({
      ...useFacadeStore.getState(),
      backends: [
        { backendId: 'b1', online: true, runtimeState: 'ready', openState: 'open', name: 'B1' } as any,
        { backendId: 'b2', online: true, runtimeState: 'visible', openState: 'closed', name: 'B2' } as any,
      ],
    });
    useServerStore.setState({ ...useServerStore.getState(), activeServerId: 'b1' });
    useProjectStore.setState({ ...useProjectStore.getState(), selectedSessionId: 's1' } as any);
    useOwnershipStore.setState({
      ...useOwnershipStore.getState(),
      sessionBackendIds: { s1: 'b2' },
    } as any);
    useRecoveryStore.setState({
      coordinator: 'recovering',
      transport: {
        status: 'connected',
        mode: 'direct',
        generation: 1,
        error: null,
        peerSessionId: null,
        retryCount: 0,
        lastMessageAt: null,
        statusEnteredAt: Date.now(),
      },
      activeBackendId: 'b1',
      selectedSessionId: 's1',
      backends: {
        b1: { backendId: 'b1', status: 'ready', desiredOpen: true, channelReady: true, catalogReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
        b2: { backendId: 'b2', status: 'visible', desiredOpen: false, channelReady: false, catalogReady: false, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
      },
      catalogs: {
        b1: { backendId: 'b1', status: 'ready', ownershipVersion: 3, retryCount: 0, lastError: null, lastSyncAt: Date.now(), statusEnteredAt: Date.now() },
      },
      activeSession: {
        sessionId: 's1',
        status: 'stale',
        backendId: null,
        ownershipVersion: null,
        retryCount: 0,
        lastError: null,
        hasGapMarker: false,
        lastMessageAt: null,
        statusEnteredAt: Date.now(),
      },
      nextOwnershipVersion: 1,
      backgroundAt: null,
    } as any);

    renderHook(() => useRecoveryCoordinator());

    await waitFor(() => {
      expect(facade.openBackend).toHaveBeenCalledWith('b2');
    });
    expect(useRecoveryStore.getState().activeSession.status).toBe('waiting_backend_ready');
  });

  it('runs full Phase 3: session stream open → catch-up → hydrate → live', async () => {
    mockRecoverCurrentSessionTail.mockResolvedValue(undefined);

    useFacadeStore.setState({
      ...useFacadeStore.getState(),
      backends: [
        { backendId: 'b1', online: true, runtimeState: 'ready', openState: 'open', name: 'B1' } as any,
      ],
      sessionStreams: { 'b1:s1': { state: 'open', backendId: 'b1', sessionId: 's1' } },
    });
    useServerStore.setState({ ...useServerStore.getState(), activeServerId: 'b1' });
    useProjectStore.setState({ ...useProjectStore.getState(), selectedSessionId: 's1' } as any);
    useOwnershipStore.setState({
      ...useOwnershipStore.getState(),
      sessionBackendIds: { s1: 'b1' },
      sessionOwnershipVersions: { s1: 5 },
    } as any);
    useRecoveryStore.setState({
      coordinator: 'recovering',
      transport: {
        status: 'connected', mode: 'direct', generation: 1,
        error: null, peerSessionId: null, retryCount: 0,
        lastMessageAt: null, statusEnteredAt: Date.now(),
      },
      activeBackendId: 'b1',
      selectedSessionId: 's1',
      backends: {
        b1: { backendId: 'b1', status: 'ready', desiredOpen: true, channelReady: true, catalogReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
      },
      catalogs: {
        b1: { backendId: 'b1', status: 'ready', ownershipVersion: 5, retryCount: 0, lastError: null, lastSyncAt: Date.now(), statusEnteredAt: Date.now() },
      },
      activeSession: {
        sessionId: 's1', status: 'stale', backendId: null,
        ownershipVersion: null, retryCount: 0, lastError: null,
        hasGapMarker: false, lastMessageAt: null, statusEnteredAt: Date.now(),
      },
      nextOwnershipVersion: 6,
      backgroundAt: null,
    } as any);

    renderHook(() => useRecoveryCoordinator());

    await waitFor(() => {
      expect(mockRecoverCurrentSessionTail).toHaveBeenCalledWith('b1', 's1');
    });

    await waitFor(() => {
      const state = useRecoveryStore.getState();
      expect(state.activeSession.status).toBe('live');
      expect(state.coordinator).toBe('ready');
    });
  });

  it('marks session error when session recovery tail fails', async () => {
    mockRecoverCurrentSessionTail.mockRejectedValue(new Error('tail fetch failed'));

    useFacadeStore.setState({
      ...useFacadeStore.getState(),
      backends: [
        { backendId: 'b1', online: true, runtimeState: 'ready', openState: 'open', name: 'B1' } as any,
      ],
      sessionStreams: { 'b1:s1': { state: 'open', backendId: 'b1', sessionId: 's1' } },
    });
    useServerStore.setState({ ...useServerStore.getState(), activeServerId: 'b1' });
    useProjectStore.setState({ ...useProjectStore.getState(), selectedSessionId: 's1' } as any);
    useOwnershipStore.setState({
      ...useOwnershipStore.getState(),
      sessionBackendIds: { s1: 'b1' },
      sessionOwnershipVersions: { s1: 5 },
    } as any);
    useRecoveryStore.setState({
      coordinator: 'recovering',
      transport: {
        status: 'connected', mode: 'direct', generation: 1,
        error: null, peerSessionId: null, retryCount: 0,
        lastMessageAt: null, statusEnteredAt: Date.now(),
      },
      activeBackendId: 'b1',
      selectedSessionId: 's1',
      backends: {
        b1: { backendId: 'b1', status: 'ready', desiredOpen: true, channelReady: true, catalogReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
      },
      catalogs: {
        b1: { backendId: 'b1', status: 'ready', ownershipVersion: 5, retryCount: 0, lastError: null, lastSyncAt: Date.now(), statusEnteredAt: Date.now() },
      },
      activeSession: {
        sessionId: 's1', status: 'stale', backendId: null,
        ownershipVersion: null, retryCount: 0, lastError: null,
        hasGapMarker: false, lastMessageAt: null, statusEnteredAt: Date.now(),
      },
      nextOwnershipVersion: 6,
      backgroundAt: null,
    } as any);

    renderHook(() => useRecoveryCoordinator());

    await waitFor(() => {
      const state = useRecoveryStore.getState();
      expect(state.activeSession.status).toBe('error');
      expect(state.activeSession.lastError).toContain('tail fetch failed');
    });
  });

  it('marks session error when owner backend is absent', async () => {
    useFacadeStore.setState({
      ...useFacadeStore.getState(),
      backends: [
        { backendId: 'b1', online: true, runtimeState: 'ready', openState: 'open', name: 'B1' } as any,
      ],
    });
    useServerStore.setState({ ...useServerStore.getState(), activeServerId: 'b1' });
    useProjectStore.setState({ ...useProjectStore.getState(), selectedSessionId: 's1' } as any);
    useOwnershipStore.setState({
      ...useOwnershipStore.getState(),
      sessionBackendIds: { s1: 'b_gone' },
    } as any);
    useRecoveryStore.setState({
      coordinator: 'recovering',
      transport: {
        status: 'connected', mode: 'direct', generation: 1,
        error: null, peerSessionId: null, retryCount: 0,
        lastMessageAt: null, statusEnteredAt: Date.now(),
      },
      activeBackendId: 'b1',
      selectedSessionId: 's1',
      backends: {
        b1: { backendId: 'b1', status: 'ready', desiredOpen: true, channelReady: true, catalogReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
        b_gone: { backendId: 'b_gone', status: 'absent', desiredOpen: false, channelReady: false, catalogReady: false, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
      },
      catalogs: {
        b1: { backendId: 'b1', status: 'ready', ownershipVersion: 3, retryCount: 0, lastError: null, lastSyncAt: Date.now(), statusEnteredAt: Date.now() },
      },
      activeSession: {
        sessionId: 's1', status: 'stale', backendId: null,
        ownershipVersion: null, retryCount: 0, lastError: null,
        hasGapMarker: false, lastMessageAt: null, statusEnteredAt: Date.now(),
      },
      nextOwnershipVersion: 1,
      backgroundAt: null,
    } as any);

    renderHook(() => useRecoveryCoordinator());

    await waitFor(() => {
      const state = useRecoveryStore.getState();
      expect(state.activeSession.status).toBe('error');
      expect(state.activeSession.lastError).toContain('unavailable');
    });
  });

  it('completes recovery without session when no session is selected', async () => {
    mockSyncBackendCatalog.mockResolvedValue({ completed: true, sessions: [{ id: 'x' }] });

    useFacadeStore.setState({
      ...useFacadeStore.getState(),
      backends: [
        { backendId: 'b1', online: true, runtimeState: 'ready', openState: 'open', name: 'B1' } as any,
      ],
    });
    useServerStore.setState({ ...useServerStore.getState(), activeServerId: 'b1' });
    useProjectStore.setState({ ...useProjectStore.getState(), selectedSessionId: null } as any);
    useRecoveryStore.setState({
      coordinator: 'recovering',
      transport: {
        status: 'connected', mode: 'direct', generation: 1,
        error: null, peerSessionId: null, retryCount: 0,
        lastMessageAt: null, statusEnteredAt: Date.now(),
      },
      activeBackendId: 'b1',
      selectedSessionId: null,
      backends: {
        b1: { backendId: 'b1', status: 'ready', desiredOpen: true, channelReady: true, catalogReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
      },
      catalogs: {},
      activeSession: {
        sessionId: null, status: 'idle', backendId: null,
        ownershipVersion: null, retryCount: 0, lastError: null,
        hasGapMarker: false, lastMessageAt: null, statusEnteredAt: Date.now(),
      },
      nextOwnershipVersion: 1,
      backgroundAt: null,
    } as any);

    renderHook(() => useRecoveryCoordinator());

    await waitFor(() => {
      expect(mockSyncBackendCatalog).toHaveBeenCalledWith('b1', 'full');
    });

    await waitFor(() => {
      const state = useRecoveryStore.getState();
      expect(state.catalogs.b1?.status).toBe('ready');
      expect(state.coordinator).toBe('ready');
    });
  });

  it('does not proceed when transport is not connected', async () => {
    useRecoveryStore.setState({
      ...useRecoveryStore.getState(),
      transport: {
        ...useRecoveryStore.getState().transport,
        status: 'connecting',
      },
    } as any);

    renderHook(() => useRecoveryCoordinator());

    // Should NOT call openBackend or syncBackendCatalog
    expect(facade.openBackend).not.toHaveBeenCalled();
    expect(mockSyncBackendCatalog).not.toHaveBeenCalled();
  });

  it('settles recovery when the active backend disappears after reconnect', async () => {
    useServerStore.setState({ ...useServerStore.getState(), activeServerId: 'gone' });
    useRecoveryStore.setState({
      ...useRecoveryStore.getState(),
      activeBackendId: 'gone',
      backends: {
        gone: { backendId: 'gone', status: 'absent', desiredOpen: true, channelReady: false, catalogReady: false, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
      },
    } as any);

    renderHook(() => useRecoveryCoordinator());

    await waitFor(() => {
      expect(useRecoveryStore.getState().coordinator).toBe('ready');
    });
  });
});
