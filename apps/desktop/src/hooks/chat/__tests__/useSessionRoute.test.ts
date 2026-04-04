import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSessionRoute } from '../useSessionRoute';
import { useFacadeStore } from '../../../stores/facadeStore';
import { useOwnershipStore } from '../../../stores/ownershipStore';
import { useServerStore } from '../../../stores/serverStore';
import { useChatStore } from '../../../stores/chatStore';
import { useRecoveryStore } from '../../../stores/recoveryStore';
import { useMobileRecoveryStore } from '../../../stores/mobileRecoveryStore';
import { isAndroid } from '../../../utils/platform';

vi.mock('../../../utils/platform', async (importOriginal) => {
  const mod = await importOriginal<Record<string, any>>();
  return {
    ...mod,
    isAndroid: vi.fn(() => false),
  };
});

describe('useSessionRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isAndroid).mockReturnValue(false);

    useFacadeStore.setState({
      facade: null,
      mode: 'direct',
      connectionState: 'connected',
      connectionError: null,
      backends: [{ backendId: 'backend-1', runtimeState: 'ready', openState: 'open', online: true, name: 'B1' } as any],
      sessionStreams: {},
      localBackendId: null,
      currentInstanceId: null,
      currentDeviceId: null,
      snapshotVersion: 1,
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
    useMobileRecoveryStore.setState({
      phase: 'idle',
      step: null,
      activeBackendId: 'backend-1',
      selectedSessionId: 'session-1',
      currentJob: {
        jobId: null,
        status: 'idle',
        reason: null,
        startedAt: null,
        finishedAt: null,
      },
      lastError: null,
    });
  });

  it('returns ready when desktop recovery is idle and backend is ready', () => {
    const { result } = renderHook(() => useSessionRoute('session-1'));

    expect(result.current.backendId).toBe('backend-1');
    expect(result.current.phase).toBe('opening_stream');
    expect(result.current.canSend).toBe(true);
  });

  it('uses mobile recovery coarse state on Android while recovery job owns the session', () => {
    vi.mocked(isAndroid).mockReturnValue(true);
    useMobileRecoveryStore.setState({
      phase: 'recovering',
      step: 'session',
      activeBackendId: 'backend-1',
      selectedSessionId: 'session-1',
      currentJob: {
        jobId: 1,
        status: 'running',
        reason: 'resume',
        startedAt: Date.now(),
        finishedAt: null,
      },
      lastError: null,
    });

    const { result } = renderHook(() => useSessionRoute('session-1', { maintainDesiredState: true }));

    expect(result.current.phase).toBe('opening_stream');
    expect(result.current.canSend).toBe(false);
  });

  it('surfaces mobile recovery errors on Android', () => {
    vi.mocked(isAndroid).mockReturnValue(true);
    useFacadeStore.setState((state) => ({
      ...state,
      connectionState: 'error',
    }));
    useMobileRecoveryStore.setState({
      phase: 'error',
      step: null,
      activeBackendId: 'backend-1',
      selectedSessionId: 'session-1',
      currentJob: {
        jobId: 2,
        status: 'failed',
        reason: 'resume',
        startedAt: Date.now(),
        finishedAt: Date.now(),
      },
      lastError: 'mobile recovery failed',
    });

    const { result } = renderHook(() => useSessionRoute('session-1'));

    expect(result.current.phase).toBe('error');
    expect(result.current.lastError).toBe('mobile recovery failed');
  });
});
