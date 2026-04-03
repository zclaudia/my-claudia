import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useActiveSessionStream } from '../useActiveSessionStream';
import { useFacadeStore } from '../../stores/facadeStore';
import { useProjectStore } from '../../stores/projectStore';
import { useServerStore } from '../../stores/serverStore';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { useRecoveryStore } from '../../stores/recoveryStore';

describe('useActiveSessionStream recovery gating', () => {
  const facade = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    getSnapshot: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    onEvent: vi.fn(() => () => {}),
    openBackend: vi.fn(),
    closeBackend: vi.fn(),
    sendToBackend: vi.fn(),
    openSessionStream: vi.fn(),
    closeSessionStream: vi.fn(),
    catchUpContent: vi.fn(),
    getHttpBaseUrl: vi.fn(() => null),
    getHttpHeaders: vi.fn(() => ({})),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useFacadeStore.setState({
      facade: facade as any,
      mode: 'direct',
      connectionState: 'connected',
      connectionError: null,
      backends: [{ backendId: 'backend-1', runtimeState: 'ready', openState: 'open', online: true, name: 'B1' } as any],
      sessionStreams: {},
      localBackendId: null,
      currentInstanceId: null,
      currentDeviceId: null,
      registryRevision: 1,
      snapshotVersion: 1,
    });
    useProjectStore.setState({
      projects: [],
      sessions: [],
      providers: [],
      dataServerId: null,
      selectedProjectId: null,
      selectedSessionId: 'session-1',
      dashboardViews: {},
      providerCommands: {},
      providerCapabilities: {},
    } as any);
    useServerStore.setState({
      activeServerId: 'backend-1',
      connections: {},
      localServerPort: null,
      controlPlaneMode: 'gateway-direct',
      controlPlaneState: 'ready',
    } as any);
    useOwnershipStore.setState({
      sessionBackendIds: { 'session-1': 'backend-1' },
      sessionOwnershipVersions: { 'session-1': 1 },
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
      activeBackendId: 'backend-1',
      selectedSessionId: 'session-1',
      backends: {},
      catalogs: {},
      activeSession: {
        sessionId: 'session-1',
        status: 'waiting_backend_ready',
        backendId: 'backend-1',
        ownershipVersion: 1,
        lastError: null,
        hasGapMarker: false,
        statusEnteredAt: Date.now(),
      },
      nextOwnershipVersion: 2,
      backgroundAt: null,
    } as any);
  });

  it('does not open the session stream before recovery owner/backend verification completes', () => {
    renderHook(() => useActiveSessionStream());

    expect(facade.openBackend).toHaveBeenCalledWith('backend-1');
    expect(facade.openSessionStream).not.toHaveBeenCalled();
  });
});
