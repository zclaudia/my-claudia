import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSelectionCoordinator } from '../useSelectionCoordinator';

const { mockConnectServer, mockGetProjectBackendId, mockGetSessionBackendId } = vi.hoisted(() => ({
  mockConnectServer: vi.fn(),
  mockGetProjectBackendId: vi.fn(() => 'backend-1'),
  mockGetSessionBackendId: vi.fn(() => 'backend-1'),
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
}));

import { useServerStore } from '../../stores/serverStore';
import { useProjectStore } from '../../stores/projectStore';

describe('useSelectionCoordinator', () => {
  beforeEach(() => {
    mockConnectServer.mockReset();
    mockGetProjectBackendId.mockReturnValue('backend-1');
    mockGetSessionBackendId.mockReturnValue('backend-1');
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
});
