import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSessionRoute } from '../useSessionRoute';
import { useFacadeStore } from '../../../stores/facadeStore';
import { useOwnershipStore } from '../../../stores/ownershipStore';
import { useServerStore } from '../../../stores/serverStore';
import { useChatStore } from '../../../stores/chatStore';
import { useRecoveryStore } from '../../../stores/recoveryStore';

describe('useSessionRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const facade = {
      openBackend: vi.fn(),
      openSessionStream: vi.fn(),
      closeSessionStream: vi.fn(),
      catchUpContent: vi.fn(),
    };

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
      snapshotVersion: 1,
      reconnectGeneration: 0,
    });
    useOwnershipStore.setState({
      sessionBackendIds: { 'session-1': 'backend-1' },
      sessionOwnershipVersions: { 'session-1': 1 },
      projectBackendIds: {},
      taskOwners: {},
    } as any);
    useServerStore.setState({
      activeServerId: 'backend-1',
      connections: {},
      localServerPort: null,
      controlPlaneMode: 'gateway-direct',
    } as any);
    useChatStore.setState({
      messages: {},
      pagination: { 'session-1': { maxOffset: 0 } },
    } as any);
    useRecoveryStore.setState({
      coordinator: 'ready',
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
      backends: {
        'backend-1': {
          backendId: 'backend-1',
          status: 'ready',
          subscribed: true,
          lastError: null,
          lastCloseReason: null,
          statusEnteredAt: Date.now(),
        },
      },
      dataSyncs: {},
      activeSession: {
        sessionId: 'session-1',
        status: 'live',
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

  it('returns ready when backend is ready', () => {
    const { result } = renderHook(() => useSessionRoute('session-1'));

    expect(result.current.backendId).toBe('backend-1');
    expect(result.current.phase).toBe('opening_stream');
    expect(result.current.canSend).toBe(true);
  });

  it('returns error phase when facade connection is in error state', () => {
    useFacadeStore.setState((state) => ({
      ...state,
      connectionState: 'error',
    }));

    const { result } = renderHook(() => useSessionRoute('session-1'));

    expect(result.current.phase).toBe('error');
  });

  it('derives lastError from backend lastError', () => {
    useFacadeStore.setState((state) => ({
      ...state,
      backends: [{ backendId: 'backend-1', runtimeState: 'error', openState: 'open', online: true, name: 'B1', lastError: 'backend failed' } as any],
    }));

    const { result } = renderHook(() => useSessionRoute('session-1'));

    expect(result.current.phase).toBe('error');
    expect(result.current.lastError).toBe('backend failed');
  });

  it('replays backend and session recovery after reconnect generation changes', () => {
    const { result, rerender } = renderHook(() => useSessionRoute('session-1', { maintainDesiredState: true }));
    const facade = useFacadeStore.getState().facade as any;

    expect(result.current.phase).toBe('opening_stream');

    act(() => {
      useFacadeStore.setState((state) => ({
        ...state,
        reconnectGeneration: 2,
        sessionStreams: {
          'backend-1:session-1': { streamKey: 'backend-1:session-1', backendId: 'backend-1', sessionId: 'session-1', state: 'open' },
        } as any,
      }));
    });
    rerender();

    expect(facade.openBackend).toHaveBeenCalledWith('backend-1');
    expect(facade.openSessionStream).toHaveBeenCalledWith('backend-1', 'session-1');
    expect(facade.catchUpContent).toHaveBeenCalledWith('backend-1', 'session-1', 0);
  });
});
