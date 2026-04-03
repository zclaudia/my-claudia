// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useServerStore } from '../../stores/serverStore';
import { useProjectStore } from '../../stores/projectStore';
import { useRecoveryStore } from '../../stores/recoveryStore';

vi.mock('../../services/api', () => ({
  getServers: vi.fn().mockResolvedValue([]),
  getProjects: vi.fn().mockResolvedValue([]),
  getSessions: vi.fn().mockResolvedValue([]),
  getProviders: vi.fn().mockResolvedValue([]),
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
    useRecoveryStore.setState({
      backends: {
        'local-standalone': {
          status: 'offline',
        },
      },
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
    useRecoveryStore.setState({
      backends: {
        'local-standalone': {
          status: 'ready',
        },
      },
    } as any);
    const { result } = renderHook(() => useDataLoader());
    await act(async () => {
      await result.current.loadData();
    });
    // getServers is skipped for embedded server (activeServerId='local')
    expect(api.getProjects).toHaveBeenCalled();
    expect(api.getSessions).toHaveBeenCalled();
    expect(api.getProviders).toHaveBeenCalled();
  });
});
