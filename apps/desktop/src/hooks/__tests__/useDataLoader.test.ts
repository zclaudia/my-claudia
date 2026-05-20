// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useServerStore } from '../../stores/serverStore';
import { useProjectStore } from '../../stores/projectStore';
import { useFacadeStore } from '../../stores/facadeStore';

vi.mock('../../services/api', () => ({
  getServers: vi.fn().mockResolvedValue([]),
  getProjects: vi.fn().mockResolvedValue([]),
  getSessions: vi.fn().mockResolvedValue([]),
  getProviders: vi.fn().mockResolvedValue([]),
  fetchAndSyncPlugins: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../stores/gatewayStore', () => ({
  isGatewayTarget: vi.fn().mockReturnValue(false),
}));

import { useDataLoader } from '../useDataLoader';
import * as api from '../../services/api';

describe('useDataLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useServerStore.setState({
      activeServerId: 'local-standalone',
      connections: {
        'local-standalone': {
          status: 'disconnected',
          error: null,
          isLocalConnection: true,
          features: [],
        },
      },
    } as any);
    useProjectStore.setState({
      selectedSessionId: null,
      setProjects: vi.fn(),
      mergeSessions: vi.fn(),
      setProviders: vi.fn(),
      setDataServerId: vi.fn(),
      selectSession: vi.fn(),
    } as any);
    useFacadeStore.setState({
      connectionState: 'idle',
      backends: [],
    } as any);
  });

  it('returns loadData function', () => {
    const { result } = renderHook(() => useDataLoader());
    expect(result.current.loadData).toBeInstanceOf(Function);
  });

  it('does not load data when disconnected', async () => {
    const { result } = renderHook(() => useDataLoader());
    await act(async () => {
      await result.current.loadData();
    });
    expect(api.getProjects).not.toHaveBeenCalled();
  });

  it('loads data when connected', async () => {
    useFacadeStore.setState({
      connectionState: 'connected',
      backends: [
        { backendId: 'local-standalone', runtimeState: 'ready' },
      ],
    } as any);
    const { result } = renderHook(() => useDataLoader());
    await act(async () => {
      await result.current.loadData();
    });
    expect(api.getProjects).toHaveBeenCalled();
    expect(api.getSessions).toHaveBeenCalled();
    expect(api.getProviders).toHaveBeenCalled();
  });

  it('does not auto-select sessions from newly loaded internal projects', async () => {
    useFacadeStore.setState({
      connectionState: 'connected',
      backends: [
        { backendId: 'local-standalone', runtimeState: 'ready' },
      ],
    } as any);
    useProjectStore.setState({
      selectedSessionId: 'previous-backend-session',
      projects: [],
      setProjects: vi.fn(),
      mergeSessions: vi.fn(),
      setProviders: vi.fn(),
      setDataServerId: vi.fn(),
      selectSession: vi.fn(),
    } as any);
    vi.mocked(api.getProjects).mockResolvedValueOnce([
      { id: 'visible-project', name: 'Visible', type: 'code', createdAt: 1, updatedAt: 1 },
      { id: '__claudia', name: 'Claudia Chat', type: 'chat_only', isInternal: true, createdAt: 1, updatedAt: 2 },
    ]);
    vi.mocked(api.getSessions).mockResolvedValueOnce([
      { id: 'visible-session', projectId: 'visible-project', name: 'Visible Session', type: 'regular', createdAt: 1, updatedAt: 10 },
      { id: 'internal-session', projectId: '__claudia', name: 'Internal Session', type: 'regular', createdAt: 1, updatedAt: 20 },
    ]);

    const { result } = renderHook(() => useDataLoader());
    await act(async () => {
      await result.current.loadData();
    });

    expect(useProjectStore.getState().selectSession).toHaveBeenCalledWith('visible-session');
  });

  it('does not load data when backend is not ready', async () => {
    useFacadeStore.setState({
      connectionState: 'connected',
      backends: [
        { backendId: 'local-standalone', runtimeState: 'visible' },
      ],
    } as any);

    const { result } = renderHook(() => useDataLoader());
    await act(async () => {
      await result.current.loadData();
    });

    expect(api.getProjects).not.toHaveBeenCalled();
  });
});
