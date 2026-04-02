// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGatewayConnection } from '../useGatewayConnection.js';
import { getServerGatewayStatus } from '../../services/api';

// ---------------------------------------------------------------------------
// Hoisted mocks (vi.mock factories are hoisted above imports)
// ---------------------------------------------------------------------------
const {
  mockFacade,
  mockFacadeStoreState,
  mockGatewayStoreState,
  mockSetState,
  mockIsBackendReady,
} = vi.hoisted(() => {
  const mockFacade = {
    openBackend: vi.fn(),
    sendToBackend: vi.fn(),
    disconnect: vi.fn(),
  };

  const mockFacadeStoreState = {
    facade: mockFacade as any,
    backends: [] as any[],
    connectionState: 'connected' as string,
  };

  const mockGatewayStoreState: Record<string, any> = {
    gatewayUrl: null,
    gatewaySecret: null,
    isConnected: false,
    directGatewayUrl: null,
    directGatewaySecret: null,
  };

  const mockSetState = vi.fn((partial: any) => {
    const updates = typeof partial === 'function' ? partial(mockGatewayStoreState) : partial;
    Object.assign(mockGatewayStoreState, updates);
  });

  const mockIsBackendReady = vi.fn(() => false);

  return { mockFacade, mockFacadeStoreState, mockGatewayStoreState, mockSetState, mockIsBackendReady };
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('../../stores/facadeStore', () => ({
  useFacadeStore: vi.fn((selector?: any) =>
    selector ? selector(mockFacadeStoreState) : mockFacadeStoreState,
  ),
}));

vi.mock('../../stores/gatewayStore', () => ({
  useGatewayStore: Object.assign(
    vi.fn(() => mockGatewayStoreState),
    {
      getState: () => mockGatewayStoreState,
      setState: mockSetState,
      subscribe: vi.fn(() => vi.fn()),
    },
  ),
  toGatewayServerId: vi.fn((id: string) => `gw:${id}`),
  isGatewayTarget: vi.fn((id: string) => id.startsWith('gw:')),
  parseBackendId: vi.fn((id: string) => id.replace('gw:', '')),
  GATEWAY_SERVER_PREFIX: 'gw:',
}));

vi.mock('../../services/api', () => ({
  getServerGatewayStatus: vi.fn(() =>
    Promise.resolve({
      enabled: false,
      gatewayUrl: null,
      gatewaySecret: null,
      connected: false,
    }),
  ),
}));

vi.mock('../../utils/backendConnection', () => ({
  isBackendReady: (...args: any[]) => mockIsBackendReady(...args),
}));

describe('hooks/useGatewayConnection', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Reset store state
    mockGatewayStoreState.gatewayUrl = null;
    mockGatewayStoreState.gatewaySecret = null;
    mockGatewayStoreState.isConnected = false;
    mockGatewayStoreState.directGatewayUrl = null;
    mockGatewayStoreState.directGatewaySecret = null;

    // Reset facade
    mockFacadeStoreState.facade = mockFacade as any;
    mockFacadeStoreState.backends = [];
    mockFacadeStoreState.connectionState = 'connected';

    mockIsBackendReady.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleErrorSpy.mockRestore();
  });

  // ---------- Gateway config polling ----------

  it('polls server gateway status and syncs enabled config to store', async () => {
    const mockGetStatus = vi.mocked(getServerGatewayStatus);
    mockGetStatus.mockResolvedValue({
      enabled: true,
      gatewayUrl: 'https://gw.example.com',
      gatewaySecret: 'sec',
      connected: true,
    } as any);

    renderHook(() => useGatewayConnection());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockSetState).toHaveBeenCalledWith({
      gatewayUrl: 'https://gw.example.com',
      gatewaySecret: 'sec',
      isConnected: true,
    });
  });

  it('syncs null config when server gateway is disabled', async () => {
    const mockGetStatus = vi.mocked(getServerGatewayStatus);
    mockGetStatus.mockResolvedValue({
      enabled: false,
      gatewayUrl: null,
      gatewaySecret: null,
      connected: false,
    } as any);

    renderHook(() => useGatewayConnection());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockSetState).toHaveBeenCalledWith({
      gatewayUrl: null,
      gatewaySecret: null,
      isConnected: false,
    });
  });

  it('polls server gateway status on 30s interval', async () => {
    const mockGetStatus = vi.mocked(getServerGatewayStatus);
    mockGetStatus.mockResolvedValue({
      enabled: false,
      gatewayUrl: null,
      gatewaySecret: null,
      connected: false,
    } as any);

    renderHook(() => useGatewayConnection());

    // Flush initial call
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockGetStatus).toHaveBeenCalledTimes(1);

    // Advance 30s for the interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    expect(mockGetStatus).toHaveBeenCalledTimes(2);
  });

  it('skips polling and seeds runtime config in direct/mobile mode', async () => {
    mockGatewayStoreState.directGatewayUrl = 'https://mobile-gw.example.com';
    mockGatewayStoreState.directGatewaySecret = 'mobile-sec';

    const mockGetStatus = vi.mocked(getServerGatewayStatus);

    renderHook(() => useGatewayConnection());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockGetStatus).not.toHaveBeenCalled();
    expect(mockSetState).toHaveBeenCalledWith({
      gatewayUrl: 'https://mobile-gw.example.com',
      gatewaySecret: 'mobile-sec',
    });
  });

  it('handles polling error gracefully without crashing', async () => {
    const mockGetStatus = vi.mocked(getServerGatewayStatus);
    mockGetStatus.mockRejectedValue(new Error('Network error'));

    renderHook(() => useGatewayConnection());

    // Should not throw
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // setState should not have been called since the poll failed
    expect(mockSetState).not.toHaveBeenCalled();
  });

  it('cleans up interval on unmount', async () => {
    const mockGetStatus = vi.mocked(getServerGatewayStatus);
    mockGetStatus.mockResolvedValue({
      enabled: false,
      gatewayUrl: null,
      gatewaySecret: null,
      connected: false,
    } as any);

    const { unmount } = renderHook(() => useGatewayConnection());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockGetStatus).toHaveBeenCalledTimes(1);

    unmount();

    // Advancing time after unmount should not poll again
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    expect(mockGetStatus).toHaveBeenCalledTimes(1);
  });

  // ---------- Public API: openChannel ----------

  it('openChannel calls facade.openBackend', () => {
    const { result } = renderHook(() => useGatewayConnection());

    act(() => {
      result.current.openChannel('backend-1');
    });

    expect(mockFacade.openBackend).toHaveBeenCalledWith('backend-1');
  });

  it('openChannel does nothing when facade is null', () => {
    mockFacadeStoreState.facade = null;

    const { result } = renderHook(() => useGatewayConnection());

    act(() => {
      result.current.openChannel('backend-1');
    });

    expect(mockFacade.openBackend).not.toHaveBeenCalled();
  });

  // ---------- Public API: sendToBackend ----------

  it('sendToBackend delegates to facade.sendToBackend', () => {
    const { result } = renderHook(() => useGatewayConnection());

    const message = { type: 'init' as const, projectId: 'p1' };
    act(() => {
      result.current.sendToBackend('backend-1', message as any);
    });

    expect(mockFacade.sendToBackend).toHaveBeenCalledWith('backend-1', message);
  });

  it('sendToBackend does nothing when facade is null', () => {
    mockFacadeStoreState.facade = null;

    const { result } = renderHook(() => useGatewayConnection());

    act(() => {
      result.current.sendToBackend('backend-1', { type: 'init' } as any);
    });

    expect(mockFacade.sendToBackend).not.toHaveBeenCalled();
  });

  // ---------- Public API: isBackendConnected / isBackendAuthenticated ----------

  it('isBackendConnected returns true when facade backend is ready', () => {
    mockFacadeStoreState.backends = [
      { backendId: 'backend-1', online: true, runtimeState: 'ready' },
    ];
    mockIsBackendReady.mockReturnValue(true);

    const { result } = renderHook(() => useGatewayConnection());

    expect(result.current.isBackendConnected('backend-1')).toBe(true);
  });

  it('isBackendConnected returns false when backend not found', () => {
    mockFacadeStoreState.backends = [];

    const { result } = renderHook(() => useGatewayConnection());

    expect(result.current.isBackendConnected('backend-1')).toBe(false);
  });

  it('isBackendConnected returns false when facade is null', () => {
    mockFacadeStoreState.facade = null;

    const { result } = renderHook(() => useGatewayConnection());

    expect(result.current.isBackendConnected('backend-1')).toBe(false);
  });

  it('isBackendAuthenticated is an alias for isBackendConnected', () => {
    const { result } = renderHook(() => useGatewayConnection());

    expect(result.current.isBackendAuthenticated).toBe(result.current.isBackendConnected);
  });

  // ---------- Public API: disconnectGateway ----------

  it('disconnectGateway calls facade.disconnect', () => {
    const { result } = renderHook(() => useGatewayConnection());

    act(() => {
      result.current.disconnectGateway();
    });

    expect(mockFacade.disconnect).toHaveBeenCalled();
  });

  it('disconnectGateway does nothing when facade is null', () => {
    mockFacadeStoreState.facade = null;

    const { result } = renderHook(() => useGatewayConnection());

    act(() => {
      result.current.disconnectGateway();
    });

    expect(mockFacade.disconnect).not.toHaveBeenCalled();
  });

  // ---------- Polling edge cases ----------

  it('does not set gateway config when enabled but secret is missing', async () => {
    const mockGetStatus = vi.mocked(getServerGatewayStatus);
    mockGetStatus.mockResolvedValue({
      enabled: true,
      gatewayUrl: 'https://gw.example.com',
      gatewaySecret: null,
      connected: false,
    } as any);

    renderHook(() => useGatewayConnection());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Should set null config since secret is missing
    expect(mockSetState).toHaveBeenCalledWith({
      gatewayUrl: null,
      gatewaySecret: null,
      isConnected: false,
    });
  });

  it('does not update state if unmounted before poll resolves', async () => {
    let resolvePromise: (value: any) => void;
    const mockGetStatus = vi.mocked(getServerGatewayStatus);
    mockGetStatus.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePromise = resolve;
        }),
    );

    const { unmount } = renderHook(() => useGatewayConnection());

    // Unmount before the promise resolves
    unmount();

    // Now resolve
    await act(async () => {
      resolvePromise!({
        enabled: true,
        gatewayUrl: 'https://gw.example.com',
        gatewaySecret: 'sec',
        connected: true,
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    // setState should not have been called since component is unmounted
    expect(mockSetState).not.toHaveBeenCalled();
  });
});
