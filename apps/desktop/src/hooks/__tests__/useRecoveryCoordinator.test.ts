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
      controlPlaneState: 'ready',
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
        lastError: null,
        hasGapMarker: false,
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
        b1: { backendId: 'b1', status: 'ready', desiredOpen: true, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
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
      ...useRecoveryStore.getState(),
      activeBackendId: 'b1',
      selectedSessionId: 's1',
      backends: {
        b1: { backendId: 'b1', status: 'ready', desiredOpen: true, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
        b2: { backendId: 'b2', status: 'visible', desiredOpen: false, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
      },
      catalogs: {
        b1: { backendId: 'b1', status: 'ready', ownershipVersion: 3, lastError: null, lastSyncAt: Date.now(), statusEnteredAt: Date.now() },
      },
      activeSession: {
        sessionId: 's1',
        status: 'stale',
        backendId: null,
        ownershipVersion: null,
        lastError: null,
        hasGapMarker: false,
        statusEnteredAt: Date.now(),
      },
    } as any);

    renderHook(() => useRecoveryCoordinator());

    await waitFor(() => {
      expect(facade.openBackend).toHaveBeenCalledWith('b2');
    });
    expect(useRecoveryStore.getState().activeSession.status).toBe('waiting_backend_ready');
  });

  it('settles recovery when the active backend disappears after reconnect', async () => {
    useServerStore.setState({ ...useServerStore.getState(), activeServerId: 'gone' });
    useRecoveryStore.setState({
      ...useRecoveryStore.getState(),
      activeBackendId: 'gone',
      backends: {
        gone: { backendId: 'gone', status: 'absent', desiredOpen: true, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
      },
    } as any);

    renderHook(() => useRecoveryCoordinator());

    await waitFor(() => {
      expect(useRecoveryStore.getState().coordinator).toBe('ready');
    });
  });
});
