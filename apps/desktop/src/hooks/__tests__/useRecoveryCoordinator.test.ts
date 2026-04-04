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

const mockSyncBackendData = vi.fn();
const mockRecoverCurrentSessionTail = vi.fn();
vi.mock('../../services/sessionSync', () => ({
  syncBackendData: (...args: any[]) => mockSyncBackendData(...args),
  recoverCurrentSessionTail: (...args: any[]) => mockRecoverCurrentSessionTail(...args),
}));

import { useRecoveryCoordinator } from '../useRecoveryCoordinator';
import { useFacadeStore } from '../../stores/facadeStore';
import { useProjectStore } from '../../stores/projectStore';
import { useServerStore } from '../../stores/serverStore';
import { useRecoveryStore } from '../../stores/recoveryStore';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { RecoveryController } from '../../services/recoveryStateMachine';
import { RecoveryTimerManager } from '../../services/recoveryTimers';

describe('useRecoveryCoordinator', () => {
  const facade = {
    openBackend: vi.fn(),
    openSessionStream: vi.fn(),
    catchUpContent: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSyncBackendData.mockResolvedValue({ completed: true, sessions: [] });
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
      dataSyncs: {},
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

  /** Helper: render the hook. */
  function setupCoordinator() {
    return renderHook(() => useRecoveryCoordinator());
  }

  async function flushRecovery(
    dispatch: ReturnType<typeof useRecoveryCoordinator>,
  ): Promise<void> {
    await act(async () => {
      dispatch({ type: 'reconcile' });
      await new Promise<void>((resolve) => queueMicrotask(resolve));
    });
  }

  it('registers the recovery event dispatcher on mount', async () => {
    const { result } = setupCoordinator();

    await act(async () => {
      result.current({
        type: 'selection_changed',
        activeBackendId: 'b1',
        selectedSessionId: 's1',
      });
      await new Promise<void>((resolve) => queueMicrotask(resolve));
    });

    expect(useRecoveryStore.getState().activeBackendId).toBe('b1');
    expect(useRecoveryStore.getState().selectedSessionId).toBe('s1');
  });

  it('marks data sync as failed when sync returns completed:false', async () => {
    mockSyncBackendData.mockResolvedValue({ completed: false, sessions: [] });

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
        b1: { backendId: 'b1', status: 'ready', subscribed: true, dataReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
      },
    } as any);

    const { result } = setupCoordinator();
    await flushRecovery(result.current);

    await waitFor(() => {
      expect(mockSyncBackendData).toHaveBeenCalledWith('b1', 'full');
    });

    // Should have called noteDataSyncFailed (not stuck silently).
    // First failure keeps syncing_full (retry budget not exhausted) but clears
    // the dedup key so the next tick will retry.
    await waitFor(() => {
      const dataSync = useRecoveryStore.getState().dataSyncs.b1;
      expect(dataSync?.lastError).toBe('Data sync incomplete');
    });
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
        status: 'connected', mode: 'direct', generation: 1,
        error: null, peerSessionId: null, retryCount: 0, lastMessageAt: null, statusEnteredAt: Date.now(),
      },
      activeBackendId: 'b1',
      selectedSessionId: 's1',
      backends: {
        b1: { backendId: 'b1', status: 'ready', subscribed: true, dataReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
        b2: { backendId: 'b2', status: 'visible', subscribed: false, dataReady: false, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
      },
      dataSyncs: {
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

    const { result } = setupCoordinator();
    await flushRecovery(result.current);

    expect(facade.openBackend).toHaveBeenCalledWith('b2');
    expect(useRecoveryStore.getState().activeSession.status).toBe('waiting_backend_ready');
  });

  it('continues recovery when owner backend data sync becomes ready after waiting', async () => {
    useFacadeStore.setState({
      ...useFacadeStore.getState(),
      backends: [
        { backendId: 'b1', online: true, runtimeState: 'ready', openState: 'open', name: 'B1' } as any,
        { backendId: 'b2', online: true, runtimeState: 'ready', openState: 'open', name: 'B2' } as any,
      ],
      sessionStreams: {
        'b2:s1': { streamKey: 'b2:s1', state: 'open', backendId: 'b2', sessionId: 's1', updatedAt: Date.now() } as any,
      },
    });
    useServerStore.setState({ ...useServerStore.getState(), activeServerId: 'b1' });
    useProjectStore.setState({ ...useProjectStore.getState(), selectedSessionId: 's1' } as any);
    useOwnershipStore.setState({
      ...useOwnershipStore.getState(),
      sessionBackendIds: { s1: 'b2' },
      sessionOwnershipVersions: { s1: 7 },
    } as any);
    useRecoveryStore.setState({
      coordinator: 'recovering',
      transport: {
        status: 'connected', mode: 'direct', generation: 1,
        error: null, peerSessionId: null, retryCount: 0, lastMessageAt: null, statusEnteredAt: Date.now(),
      },
      activeBackendId: 'b1',
      selectedSessionId: 's1',
      backends: {
        b1: { backendId: 'b1', status: 'ready', subscribed: true, dataReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
        b2: { backendId: 'b2', status: 'ready', subscribed: true, dataReady: false, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
      },
      dataSyncs: {
        b1: { backendId: 'b1', status: 'ready', ownershipVersion: 3, retryCount: 0, lastError: null, lastSyncAt: Date.now(), statusEnteredAt: Date.now() },
        b2: { backendId: 'b2', status: 'syncing_full', ownershipVersion: 0, retryCount: 0, lastError: null, lastSyncAt: null, statusEnteredAt: Date.now() },
      },
      activeSession: {
        sessionId: 's1', status: 'waiting_backend_ready', backendId: 'b2',
        ownershipVersion: null, retryCount: 0, lastError: null, hasGapMarker: false, lastMessageAt: null, statusEnteredAt: Date.now(),
      },
      nextOwnershipVersion: 8,
      backgroundAt: null,
    } as any);

    const { result } = setupCoordinator();

    // Simulate data sync becoming ready
    useRecoveryStore.setState((state) => ({
      ...state,
      dataSyncs: {
        ...state.dataSyncs,
        b2: { ...state.dataSyncs.b2, status: 'ready', ownershipVersion: 7 },
      },
    }));
    await flushRecovery(result.current);

    await waitFor(() => {
      expect(mockRecoverCurrentSessionTail).toHaveBeenCalledWith('b2', 's1');
    });
    expect(useRecoveryStore.getState().activeSession.status).toBe('live');
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
        b1: { backendId: 'b1', status: 'ready', subscribed: true, dataReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
      },
      dataSyncs: {
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

    const { result } = setupCoordinator();
    await flushRecovery(result.current);

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
        b1: { backendId: 'b1', status: 'ready', subscribed: true, dataReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
      },
      dataSyncs: {
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

    const { result } = setupCoordinator();
    await flushRecovery(result.current);

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
        b1: { backendId: 'b1', status: 'ready', subscribed: true, dataReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
        b_gone: { backendId: 'b_gone', status: 'absent', subscribed: false, dataReady: false, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
      },
      dataSyncs: {
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

    const { result } = setupCoordinator();
    await flushRecovery(result.current);

    const state = useRecoveryStore.getState();
    expect(state.activeSession.status).toBe('error');
    expect(state.activeSession.lastError).toContain('unavailable');
  });

  it('completes recovery without session when no session is selected', async () => {
    mockSyncBackendData.mockResolvedValue({ completed: true, sessions: [{ id: 'x' }] });

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
        b1: { backendId: 'b1', status: 'ready', subscribed: true, dataReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
      },
      dataSyncs: {},
      activeSession: {
        sessionId: null, status: 'idle', backendId: null,
        ownershipVersion: null, retryCount: 0, lastError: null,
        hasGapMarker: false, lastMessageAt: null, statusEnteredAt: Date.now(),
      },
      nextOwnershipVersion: 1,
      backgroundAt: null,
    } as any);

    const { result } = setupCoordinator();
    await flushRecovery(result.current);

    await waitFor(() => {
      expect(mockSyncBackendData).toHaveBeenCalledWith('b1', 'full');
    });

    await waitFor(() => {
      const state = useRecoveryStore.getState();
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

    const { result } = setupCoordinator();
    await flushRecovery(result.current);

    expect(facade.openBackend).not.toHaveBeenCalled();
    expect(mockSyncBackendData).not.toHaveBeenCalled();
  });

  it('clears dedup keys after recovery completes so next cycle is not short-circuited', async () => {
    mockSyncBackendData.mockResolvedValue({ completed: true, sessions: [{ id: 'x' }] });
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
        b1: { backendId: 'b1', status: 'ready', subscribed: true, dataReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
      },
      dataSyncs: {},
      activeSession: {
        sessionId: 's1', status: 'stale', backendId: null,
        ownershipVersion: null, retryCount: 0, lastError: null,
        hasGapMarker: false, lastMessageAt: null, statusEnteredAt: Date.now(),
      },
      nextOwnershipVersion: 6,
      backgroundAt: null,
    } as any);

    const { result } = setupCoordinator();
    await flushRecovery(result.current);

    // Wait for first recovery to complete
    await waitFor(() => {
      expect(useRecoveryStore.getState().coordinator).toBe('ready');
    });
    expect(mockSyncBackendData).toHaveBeenCalledTimes(1);

    // Simulate a second recovery cycle (same generation, as startBackendRecovery doesn't increment)
    mockSyncBackendData.mockClear();
    mockSyncBackendData.mockResolvedValue({ completed: true, sessions: [] });
    act(() => {
      useRecoveryStore.setState({
        ...useRecoveryStore.getState(),
        coordinator: 'recovering',
        dataSyncs: {},
      } as any);
    });

    await flushRecovery(result.current);

    // Should NOT be short-circuited by stale key — data sync must run again
    await waitFor(() => {
      expect(mockSyncBackendData).toHaveBeenCalledWith('b1', 'full');
    });
  });

  it('scheduleTick coalesces multiple calls', async () => {
    const timerManager = new RecoveryTimerManager();
    const machine = new RecoveryController(timerManager);
    const tickSpy = vi.spyOn(machine, 'tick');

    machine.scheduleTick();
    machine.scheduleTick();
    machine.scheduleTick();

    // Wait for microtask to execute
    await new Promise(resolve => queueMicrotask(resolve));

    expect(tickSpy.mock.calls.length).toBe(1);

    machine.dispose();
    timerManager.dispose();
  });
});
