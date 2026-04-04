import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useMobileRecoveryJobManager } from '../useMobileRecoveryJob';
import { useFacadeStore } from '../../stores/facadeStore';
import { useMobileRecoveryStore } from '../../stores/mobileRecoveryStore';
import { useProjectStore } from '../../stores/projectStore';
import { useServerStore } from '../../stores/serverStore';
import { useRecoveryStore } from '../../stores/recoveryStore';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { useChatStore } from '../../stores/chatStore';

const mockSyncBackendData = vi.fn();
const mockRecoverCurrentSessionTail = vi.fn();
vi.mock('../../services/sessionSync', () => ({
  syncBackendData: (...args: any[]) => mockSyncBackendData(...args),
  recoverCurrentSessionTail: (...args: any[]) => mockRecoverCurrentSessionTail(...args),
}));

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('useMobileRecoveryJobManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockSyncBackendData.mockResolvedValue({ completed: true, sessions: [] });
    mockRecoverCurrentSessionTail.mockResolvedValue(undefined);

    useMobileRecoveryStore.getState().reset();
    useFacadeStore.setState({
      facade: null,
      mode: 'direct',
      connectionState: 'disconnected',
      connectionError: null,
      backends: [{
        backendId: 'backend-1',
        runtimeState: 'visible',
        openState: 'closed',
        online: true,
        name: 'Backend 1',
      } as any],
      sessionStreams: {},
      localBackendId: null,
      currentInstanceId: null,
      currentDeviceId: null,
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
    } as any);
    useRecoveryStore.setState({
      coordinator: 'ready',
      transport: {
        status: 'connected',
        mode: 'direct',
        generation: 1,
        error: null,
        peerSessionId: null,
        retryCount: 0,
        lastMessageAt: Date.now(),
        statusEnteredAt: Date.now(),
      },
      activeBackendId: 'backend-1',
      selectedSessionId: 'session-1',
      backends: {},
      dataSyncs: {},
      activeSession: {
        sessionId: 'session-1',
        status: 'idle',
        backendId: null,
        ownershipVersion: null,
        retryCount: 0,
        lastError: null,
        hasGapMarker: false,
        lastMessageAt: null,
        statusEnteredAt: Date.now(),
      },
      nextOwnershipVersion: 2,
      backgroundAt: null,
    } as any);
    useOwnershipStore.setState({
      sessionBackendIds: { 'session-1': 'backend-1' },
      sessionOwnershipVersions: { 'session-1': 1 },
      projectBackendIds: {},
      taskOwners: {},
    } as any);
    useChatStore.setState({
      messages: {},
      pagination: { 'session-1': { maxOffset: 0 } },
    } as any);
  });

  it('runs the serial transport/backend/session recovery chain for resume', async () => {
    const facade = {
      forceReconnect: vi.fn(() => {
        useFacadeStore.setState((state) => ({
          ...state,
          connectionState: 'connected',
        }));
      }),
      probeHealth: vi.fn(),
      openBackend: vi.fn((backendId: string) => {
        useFacadeStore.setState((state) => ({
          ...state,
          backends: state.backends.map((backend) =>
            backend.backendId === backendId
              ? { ...backend, runtimeState: 'ready', openState: 'open' }
              : backend
          ),
        }));
      }),
      openSessionStream: vi.fn((backendId: string, sessionId: string) => {
        useFacadeStore.setState((state) => ({
          ...state,
          sessionStreams: {
            ...state.sessionStreams,
            [`${backendId}:${sessionId}`]: {
              streamKey: `${backendId}:${sessionId}`,
              backendId,
              sessionId,
              state: 'open',
              updatedAt: Date.now(),
            } as any,
          },
        }));
      }),
      catchUpContent: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      getSnapshot: vi.fn(() => useFacadeStore.getState()),
      subscribe: vi.fn(() => () => {}),
      onEvent: vi.fn(() => () => {}),
      closeBackend: vi.fn(),
      sendToBackend: vi.fn(),
      closeSessionStream: vi.fn(),
      getHttpBaseUrl: vi.fn(() => null),
      getHttpHeaders: vi.fn(() => ({})),
    };
    useFacadeStore.setState((state) => ({
      ...state,
      facade: facade as any,
    }));

    const { result } = renderHook(() => useMobileRecoveryJobManager());

    await act(async () => {
      result.current.start('resume');
      await flush();
    });

    expect(facade.openBackend).toHaveBeenCalledWith('backend-1');
    expect(mockSyncBackendData).toHaveBeenCalledWith('backend-1', 'full');
    expect(facade.openSessionStream).toHaveBeenCalledWith('backend-1', 'session-1');
    expect(facade.catchUpContent).toHaveBeenCalledWith('backend-1', 'session-1', 0);
    expect(mockRecoverCurrentSessionTail).toHaveBeenCalledWith('backend-1', 'session-1');
    expect(useMobileRecoveryStore.getState().phase).toBe('ready');
    expect(useMobileRecoveryStore.getState().currentJob.status).toBe('succeeded');
  });

  it('recovers the owner backend before opening the active session stream', async () => {
    useFacadeStore.setState({
      facade: null,
      mode: 'direct',
      connectionState: 'connected',
      connectionError: null,
      backends: [
        {
          backendId: 'backend-1',
          runtimeState: 'ready',
          openState: 'open',
          online: true,
          name: 'Backend 1',
        },
        {
          backendId: 'backend-2',
          runtimeState: 'visible',
          openState: 'closed',
          online: true,
          name: 'Backend 2',
        },
      ] as any,
      sessionStreams: {},
      localBackendId: null,
      currentInstanceId: null,
      currentDeviceId: null,
      snapshotVersion: 1,
    });
    useOwnershipStore.setState({
      sessionBackendIds: { 'session-1': 'backend-2' },
      sessionOwnershipVersions: { 'session-1': 2 },
      projectBackendIds: {},
      taskOwners: {},
    } as any);

    const facade = {
      forceReconnect: vi.fn(),
      probeHealth: vi.fn(),
      openBackend: vi.fn((backendId: string) => {
        useFacadeStore.setState((state) => ({
          ...state,
          backends: state.backends.map((backend) =>
            backend.backendId === backendId
              ? { ...backend, runtimeState: 'ready', openState: 'open' }
              : backend
          ),
        }));
      }),
      openSessionStream: vi.fn((backendId: string, sessionId: string) => {
        useFacadeStore.setState((state) => ({
          ...state,
          sessionStreams: {
            ...state.sessionStreams,
            [`${backendId}:${sessionId}`]: {
              streamKey: `${backendId}:${sessionId}`,
              backendId,
              sessionId,
              state: 'open',
              updatedAt: Date.now(),
            } as any,
          },
        }));
      }),
      catchUpContent: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      getSnapshot: vi.fn(() => useFacadeStore.getState()),
      subscribe: vi.fn(() => () => {}),
      onEvent: vi.fn(() => () => {}),
      closeBackend: vi.fn(),
      sendToBackend: vi.fn(),
      closeSessionStream: vi.fn(),
      getHttpBaseUrl: vi.fn(() => null),
      getHttpHeaders: vi.fn(() => ({})),
    };
    useFacadeStore.setState((state) => ({
      ...state,
      facade: facade as any,
    }));

    const { result } = renderHook(() => useMobileRecoveryJobManager());

    await act(async () => {
      result.current.start('resume');
      await flush();
    });

    expect(mockSyncBackendData).toHaveBeenNthCalledWith(1, 'backend-1', 'full');
    expect(mockSyncBackendData).toHaveBeenNthCalledWith(2, 'backend-2', 'full');
    expect(facade.openBackend).toHaveBeenCalledWith('backend-2');
    expect(facade.openSessionStream).toHaveBeenCalledWith('backend-2', 'session-1');
    expect(facade.catchUpContent).toHaveBeenCalledWith('backend-2', 'session-1', 0);
    expect(mockRecoverCurrentSessionTail).toHaveBeenCalledWith('backend-2', 'session-1');
    expect(useMobileRecoveryStore.getState().phase).toBe('ready');
  });

  it('waits for async transport/backend/session updates and advances step-by-step', async () => {
    const facade = {
      forceReconnect: vi.fn(() => {
        setTimeout(() => {
          useFacadeStore.setState((state) => ({
            ...state,
            connectionState: 'connected',
          }));
        }, 50);
      }),
      probeHealth: vi.fn(),
      openBackend: vi.fn((backendId: string) => {
        setTimeout(() => {
          useFacadeStore.setState((state) => ({
            ...state,
            backends: state.backends.map((backend) =>
              backend.backendId === backendId
                ? { ...backend, runtimeState: 'ready', openState: 'open' }
                : backend
            ),
          }));
        }, 50);
      }),
      openSessionStream: vi.fn((backendId: string, sessionId: string) => {
        setTimeout(() => {
          useFacadeStore.setState((state) => ({
            ...state,
            sessionStreams: {
              ...state.sessionStreams,
              [`${backendId}:${sessionId}`]: {
                streamKey: `${backendId}:${sessionId}`,
                backendId,
                sessionId,
                state: 'open',
                updatedAt: Date.now(),
              } as any,
            },
          }));
        }, 50);
      }),
      catchUpContent: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      getSnapshot: vi.fn(() => useFacadeStore.getState()),
      subscribe: vi.fn(() => () => {}),
      onEvent: vi.fn(() => () => {}),
      closeBackend: vi.fn(),
      sendToBackend: vi.fn(),
      closeSessionStream: vi.fn(),
      getHttpBaseUrl: vi.fn(() => null),
      getHttpHeaders: vi.fn(() => ({})),
    };

    useFacadeStore.setState((state) => ({
      ...state,
      facade: facade as any,
      connectionState: 'disconnected',
    }));

    const { result } = renderHook(() => useMobileRecoveryJobManager());

    act(() => {
      result.current.start('resume');
    });

    expect(useMobileRecoveryStore.getState().phase).toBe('recovering');
    expect(useMobileRecoveryStore.getState().step).toBe('transport');

    await waitFor(() => {
      expect(useMobileRecoveryStore.getState().step).toBe('backend');
    });

    await waitFor(() => {
      expect(useMobileRecoveryStore.getState().step).toBe('session');
    });

    await waitFor(() => {
      expect(useMobileRecoveryStore.getState().phase).toBe('ready');
      expect(useMobileRecoveryStore.getState().currentJob.status).toBe('succeeded');
    });

    expect(facade.forceReconnect).toHaveBeenCalledOnce();
    expect(facade.openBackend).toHaveBeenCalledWith('backend-1');
    expect(facade.openSessionStream).toHaveBeenCalledWith('backend-1', 'session-1');
  });

  it('fails the mobile recovery job when data sync is incomplete', async () => {
    mockSyncBackendData.mockResolvedValue({ completed: false, sessions: [] });

    const facade = {
      forceReconnect: vi.fn(),
      probeHealth: vi.fn(),
      openBackend: vi.fn((backendId: string) => {
        useFacadeStore.setState((state) => ({
          ...state,
          backends: state.backends.map((backend) =>
            backend.backendId === backendId
              ? { ...backend, runtimeState: 'ready', openState: 'open' }
              : backend
          ),
        }));
      }),
      openSessionStream: vi.fn(),
      catchUpContent: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      getSnapshot: vi.fn(() => useFacadeStore.getState()),
      subscribe: vi.fn(() => () => {}),
      onEvent: vi.fn(() => () => {}),
      closeBackend: vi.fn(),
      sendToBackend: vi.fn(),
      closeSessionStream: vi.fn(),
      getHttpBaseUrl: vi.fn(() => null),
      getHttpHeaders: vi.fn(() => ({})),
    };
    useFacadeStore.setState((state) => ({
      ...state,
      facade: facade as any,
      connectionState: 'connected',
    }));

    const { result } = renderHook(() => useMobileRecoveryJobManager());

    await act(async () => {
      result.current.start('resume');
      await flush();
    });

    expect(useMobileRecoveryStore.getState().phase).toBe('error');
    expect(useMobileRecoveryStore.getState().lastError).toBe('Data sync incomplete');
    expect(facade.openSessionStream).not.toHaveBeenCalled();
  });
});
