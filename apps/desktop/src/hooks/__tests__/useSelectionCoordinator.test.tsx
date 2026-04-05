import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSelectionCoordinator } from '../useSelectionCoordinator';

const { mockConnectServer, mockGetProjectBackendId, mockGetSessionBackendId, mockResolveCanonicalBackendId } = vi.hoisted(() => ({
  mockConnectServer: vi.fn(),
  mockGetProjectBackendId: vi.fn(() => 'backend-1'),
  mockGetSessionBackendId: vi.fn(() => 'backend-1'),
  mockResolveCanonicalBackendId: vi.fn((backendId: string | null | undefined) => backendId),
}));

vi.mock('../../contexts/ConnectionContext', () => ({
  useConnection: () => ({
    connectServer: mockConnectServer,
  }),
}));

vi.mock('../../stores/ownershipStore', () => ({
  useOwnershipStore: {
    getState: () => ({
      getProjectBackendId: mockGetProjectBackendId,
      getSessionBackendId: mockGetSessionBackendId,
    }),
  },
}));

vi.mock('../../utils/controlPlane', () => ({
  getControlPlaneMode: () => 'gateway-direct',
  resolveLocalBackendId: () => 'local',
  resolveCanonicalBackendId: mockResolveCanonicalBackendId,
}));

import { useServerStore } from '../../stores/serverStore';
import { useProjectStore } from '../../stores/projectStore';
import { useRecoveryStore } from '../../stores/recoveryStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { isAndroid } from '../../utils/platform';

vi.mock('../../utils/platform', async (importOriginal) => {
  const mod = await importOriginal<Record<string, any>>();
  return {
    ...mod,
    isAndroid: vi.fn(() => false),
  };
});

describe('useSelectionCoordinator', () => {
  beforeEach(() => {
    mockConnectServer.mockReset();
    mockGetProjectBackendId.mockReturnValue('backend-1');
    mockGetSessionBackendId.mockReturnValue('backend-1');
    mockResolveCanonicalBackendId.mockImplementation((backendId: string | null | undefined) => backendId);
    useServerStore.setState({
      activeServerId: 'backend-1',
      connections: {
        'backend-1': { isLocalConnection: false, features: [] },
      },
      localServerPort: null,
      controlPlaneMode: 'gateway-direct',
    });
    useRecoveryStore.setState({
      backends: {
        'backend-1': {
          backendId: 'backend-1',
          status: 'ready',
          subscribed: true,
          dataReady: true,
          retryCount: 0,
          lastError: null,
          lastCloseReason: null,
          statusEnteredAt: Date.now(),
        },
      },
    } as any);
    useFacadeStore.setState({
      connectionState: 'connected',
      backends: [{ backendId: 'backend-1', runtimeState: 'ready', name: 'Backend 1' }],
    } as any);
    vi.mocked(isAndroid).mockReturnValue(false);
    useProjectStore.setState({
      projects: [],
      sessions: [],
      providers: [],
      selectedProjectId: null,
      selectedSessionId: null,
      dashboardViews: {},
      providerCommands: {},
      providerCapabilities: {},
    });
  });

  it('does not reconnect when selecting a project on the already active backend', () => {
    const { result } = renderHook(() => useSelectionCoordinator());

    act(() => {
      result.current.selectProject('project-1');
    });

    expect(useServerStore.getState().activeServerId).toBe('backend-1');
    expect(useProjectStore.getState().selectedProjectId).toBe('project-1');
    expect(mockConnectServer).not.toHaveBeenCalled();
  });

  it('does not reconnect when selecting a session on the already active backend', () => {
    useProjectStore.setState({
      sessions: [{
        id: 'session-1',
        projectId: 'project-1',
        name: 'Session 1',
        type: 'regular',
        createdAt: 1,
        updatedAt: 1,
      }],
    });

    const { result } = renderHook(() => useSelectionCoordinator());

    act(() => {
      result.current.selectSession('session-1', { backendId: 'backend-1' });
    });

    expect(useServerStore.getState().activeServerId).toBe('backend-1');
    expect(useProjectStore.getState().selectedSessionId).toBe('session-1');
    expect(mockConnectServer).not.toHaveBeenCalled();
  });

  it('reconnects when selecting on the same backend but the connection is down', () => {
    useRecoveryStore.setState({
      backends: {
        'backend-1': {
          backendId: 'backend-1',
          status: 'visible',
          subscribed: false,
          dataReady: false,
          retryCount: 0,
          lastError: null,
          lastCloseReason: null,
          statusEnteredAt: Date.now(),
        },
      },
    } as any);

    const { result } = renderHook(() => useSelectionCoordinator());

    act(() => {
      result.current.selectProject('project-1');
    });

    expect(useServerStore.getState().activeServerId).toBe('backend-1');
    expect(useProjectStore.getState().selectedProjectId).toBe('project-1');
    expect(mockConnectServer).toHaveBeenCalledWith('backend-1');
  });

  it('reissues connect intent when the same backend is still marked connecting', () => {
    useRecoveryStore.setState({
      backends: {
        'backend-1': {
          backendId: 'backend-1',
          status: 'subscribing',
          subscribed: false,
          dataReady: false,
          retryCount: 0,
          lastError: null,
          lastCloseReason: null,
          statusEnteredAt: Date.now(),
        },
      },
    } as any);

    const { result } = renderHook(() => useSelectionCoordinator());

    act(() => {
      result.current.selectSession('session-1', { backendId: 'backend-1' });
    });

    expect(mockConnectServer).toHaveBeenCalledWith('backend-1');
  });

  it('clears session and project when switching to a different backend', () => {
    useProjectStore.setState({
      selectedProjectId: 'project-1',
      selectedSessionId: 'session-1',
    });
    useRecoveryStore.setState({
      backends: {
        'backend-1': { backendId: 'backend-1', status: 'ready', subscribed: true, dataReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
        'backend-2': { backendId: 'backend-2', status: 'ready', subscribed: true, dataReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
      },
    } as any);

    const { result } = renderHook(() => useSelectionCoordinator());

    act(() => {
      result.current.selectBackend('backend-2');
    });

    expect(useServerStore.getState().activeServerId).toBe('backend-2');
    expect(useProjectStore.getState().selectedSessionId).toBeNull();
    expect(useProjectStore.getState().selectedProjectId).toBeNull();
    expect(mockConnectServer).toHaveBeenCalledWith('backend-2');
  });

  it('canonicalizes legacy local backend ids before connecting', () => {
    mockGetSessionBackendId.mockReturnValue('local');
    mockResolveCanonicalBackendId.mockImplementation((backendId: string | null | undefined) =>
      backendId === 'local' ? 'local-backend-1' : backendId
    );
    useServerStore.setState({
      activeServerId: 'local-backend-1',
      connections: {
        'local-backend-1': { isLocalConnection: true, features: [] },
      },
      controlPlaneMode: 'embedded-local',
    });
    useRecoveryStore.setState({
      backends: {
        'local-backend-1': {
          backendId: 'local-backend-1',
          status: 'visible',
          subscribed: false,
          dataReady: false,
          retryCount: 0,
          lastError: null,
          lastCloseReason: null,
          statusEnteredAt: Date.now(),
        },
      },
    } as any);

    const { result } = renderHook(() => useSelectionCoordinator());

    act(() => {
      result.current.selectSession('session-1');
    });

    expect(mockConnectServer).toHaveBeenCalledWith('local-backend-1');
  });

  it('does not reissue connect intent when backend is already ready', () => {
    useFacadeStore.setState({
      connectionState: 'connected',
      backends: [{ backendId: 'backend-1', runtimeState: 'ready', name: 'Backend 1' }],
    } as any);

    const { result } = renderHook(() => useSelectionCoordinator());

    act(() => {
      result.current.selectProject('project-1');
    });

    // Backend is already ready, no need to reconnect
    expect(mockConnectServer).not.toHaveBeenCalled();
  });
});
