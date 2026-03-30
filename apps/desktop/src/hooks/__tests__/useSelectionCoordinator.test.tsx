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

describe('useSelectionCoordinator', () => {
  beforeEach(() => {
    mockConnectServer.mockReset();
    mockGetProjectBackendId.mockReturnValue('backend-1');
    mockGetSessionBackendId.mockReturnValue('backend-1');
    mockResolveCanonicalBackendId.mockImplementation((backendId: string | null | undefined) => backendId);
    useServerStore.setState({
      activeServerId: 'backend-1',
      connections: {
        'backend-1': { status: 'connected', error: null, isLocalConnection: false, features: [] },
      },
      localServerPort: null,
      controlPlaneMode: 'gateway-direct',
      controlPlaneState: 'ready',
    });
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
    useServerStore.setState({
      connections: {
        'backend-1': { status: 'disconnected', error: null, isLocalConnection: false, features: [] },
      },
    });

    const { result } = renderHook(() => useSelectionCoordinator());

    act(() => {
      result.current.selectProject('project-1');
    });

    expect(useServerStore.getState().activeServerId).toBe('backend-1');
    expect(useProjectStore.getState().selectedProjectId).toBe('project-1');
    expect(mockConnectServer).toHaveBeenCalledWith('backend-1');
  });

  it('reissues connect intent when the same backend is still marked connecting', () => {
    useServerStore.setState({
      connections: {
        'backend-1': { status: 'connecting', error: null, isLocalConnection: false, features: [] },
      },
    });

    const { result } = renderHook(() => useSelectionCoordinator());

    act(() => {
      result.current.selectSession('session-1', { backendId: 'backend-1' });
    });

    expect(mockConnectServer).toHaveBeenCalledWith('backend-1');
  });

  it('canonicalizes legacy local backend ids before connecting', () => {
    mockGetSessionBackendId.mockReturnValue('local');
    mockResolveCanonicalBackendId.mockImplementation((backendId: string | null | undefined) =>
      backendId === 'local' ? 'local-backend-1' : backendId
    );
    useServerStore.setState({
      activeServerId: 'local-backend-1',
      connections: {
        'local-backend-1': { status: 'disconnected', error: null, isLocalConnection: true, features: [] },
      },
      controlPlaneMode: 'embedded-local',
    });

    const { result } = renderHook(() => useSelectionCoordinator());

    act(() => {
      result.current.selectSession('session-1');
    });

    expect(mockConnectServer).toHaveBeenCalledWith('local-backend-1');
  });
});
