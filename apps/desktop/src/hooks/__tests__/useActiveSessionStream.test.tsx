import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useActiveSessionStream } from '../useActiveSessionStream';
import { useFacadeStore } from '../../stores/facadeStore';
import { useProjectStore } from '../../stores/projectStore';
import { useServerStore } from '../../stores/serverStore';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { useChatStore } from '../../stores/chatStore';

describe('useActiveSessionStream', () => {
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
      mode: 'embedded',
      connectionState: 'connected',
      backends: [],
      sessionStreams: {},
      localBackendId: null,
      currentInstanceId: null,
      currentDeviceId: null,
      registryRevision: 0,
      snapshotVersion: 0,
    });

    useProjectStore.setState({
      projects: [],
      sessions: [],
      providers: [],
      dataServerId: null,
      selectedProjectId: 'project-1',
      selectedSessionId: 'session-1',
      dashboardViews: {},
      providerCommands: {},
      providerCapabilities: {},
    });

    useServerStore.setState((state) => ({
      ...state,
      activeServerId: 'backend-1',
    }));

    useOwnershipStore.setState({
      sessionBackendIds: { 'session-1': 'backend-1' },
      projectBackendIds: {},
      taskOwners: {},
    });

    useChatStore.setState((state) => ({
      ...state,
      pagination: {
        ...state.pagination,
        'session-1': {
          total: 0,
          hasMore: false,
          isLoadingMore: false,
          maxOffset: 12,
        },
      },
    }));
  });

  it('opens the selected session stream and closes it on unmount', () => {
    const { unmount } = renderHook(() => useActiveSessionStream());

    expect(facade.openBackend).toHaveBeenCalledWith('backend-1');
    expect(facade.openSessionStream).toHaveBeenCalledWith('backend-1', 'session-1');

    unmount();

    expect(facade.closeSessionStream).toHaveBeenCalledWith('backend-1', 'session-1');
  });

  it('requests catch-up once the stream becomes open', () => {
    const { rerender } = renderHook(() => useActiveSessionStream());

    expect(facade.catchUpContent).not.toHaveBeenCalled();

    act(() => {
      useFacadeStore.setState((state) => ({
        ...state,
        sessionStreams: {
          ...state.sessionStreams,
          'backend-1:session-1': {
            streamKey: 'backend-1:session-1',
            backendId: 'backend-1',
            sessionId: 'session-1',
            state: 'open',
            channelId: 'channel-1',
            latestOffset: 12,
            updatedAt: Date.now(),
          },
        },
      }));
    });

    rerender();

    expect(facade.catchUpContent).toHaveBeenCalledWith('backend-1', 'session-1', 12);
  });

  it('switches streams when the selected session changes', () => {
    const { rerender } = renderHook(() => useActiveSessionStream());

    act(() => {
      useOwnershipStore.setState((state) => ({
        ...state,
        sessionBackendIds: {
          ...state.sessionBackendIds,
          'session-2': 'backend-2',
        },
      }));
      useProjectStore.setState((state) => ({
        ...state,
        selectedSessionId: 'session-2',
      }));
      useServerStore.setState((state) => ({
        ...state,
        activeServerId: 'backend-2',
      }));
    });

    rerender();

    expect(facade.closeSessionStream).toHaveBeenCalledWith('backend-1', 'session-1');
    expect(facade.openBackend).toHaveBeenCalledWith('backend-2');
    expect(facade.openSessionStream).toHaveBeenCalledWith('backend-2', 'session-2');
  });
});
