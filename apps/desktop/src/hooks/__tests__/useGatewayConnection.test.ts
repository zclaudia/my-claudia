import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGatewayConnection } from '../useGatewayConnection.js';
import { handleServerMessage } from '../../services/messageHandler';
import { stopSessionSync } from '../../services/sessionSync';
import { getServerGatewayStatus } from '../../services/api';
import { useGatewayStore } from '../../stores/gatewayStore';

const { mockTransportInstance, MockGatewayTransport } = vi.hoisted(() => {
  const mockTransportInstance = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn(() => true),
    isBackendAuthenticated: vi.fn(() => false),
    authenticateBackend: vi.fn(),
    updateSubscriptions: vi.fn(),
    sendToBackend: vi.fn(),
    requestBackendsList: vi.fn(),
  };

  return {
    mockTransportInstance,
    MockGatewayTransport: vi.fn(function MockGatewayTransport() {
      return mockTransportInstance;
    }),
  };
});

vi.mock('../transport/GatewayTransport', () => ({
  GatewayTransport: MockGatewayTransport,
}));

const mockGatewayStoreState = {
  gatewayUrl: null as string | null,
  gatewaySecret: null as string | null,
  isConnected: false,
  localBackendId: null as string | null,
  discoveredBackends: [],
  subscribedBackendIds: [] as string[],
  directGatewayUrl: null as string | null,
  directGatewaySecret: null as string | null,
  setConnected: vi.fn(),
  setDiscoveredBackends: vi.fn(),
  setBackendAuthStatus: vi.fn(),
  syncFromServer: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
};

vi.mock('../../stores/gatewayStore', () => ({
  useGatewayStore: Object.assign(
    vi.fn(() => mockGatewayStoreState),
    {
      getState: () => mockGatewayStoreState,
      subscribe: vi.fn(() => vi.fn()),
    },
  ),
  toGatewayServerId: vi.fn((id: string) => `gateway:${id}`),
  isGatewayTarget: vi.fn((id: string) => id.startsWith('gateway:')),
  parseBackendId: vi.fn((id: string) => id.replace('gateway:', '')),
}));

const mockServerStoreState = {
  activeServerId: null as string | null,
  setServerConnectionStatus: vi.fn(),
  setServerLocalConnection: vi.fn(),
  setServerFeatures: vi.fn(),
  setServerPublicKey: vi.fn(),
  updateLastConnected: vi.fn(),
};

vi.mock('../../stores/serverStore', () => ({
  useServerStore: Object.assign(
    vi.fn(() => mockServerStoreState),
    {
      getState: () => mockServerStoreState,
    },
  ),
}));

const mockSessionsStoreState = {
  clearAllSessions: vi.fn(),
  clearBackendSessions: vi.fn(),
};

vi.mock('../../stores/sessionsStore', () => ({
  useSessionsStore: Object.assign(
    vi.fn(() => mockSessionsStoreState),
    {
      getState: () => mockSessionsStoreState,
    },
  ),
}));

vi.mock('../../services/api', () => ({
  getServerGatewayStatus: vi.fn(() =>
    Promise.resolve({
      enabled: false,
      gatewayUrl: null,
      gatewaySecret: null,
      discoveredBackends: [],
      backendId: null,
      connected: false,
    }),
  ),
}));

vi.mock('../../services/messageHandler', () => ({
  handleServerMessage: vi.fn(),
}));

vi.mock('../../services/sessionSync', () => ({
  stopSessionSync: vi.fn(),
}));

describe('hooks/useGatewayConnection', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  function getTransportConfig() {
    return MockGatewayTransport.mock.calls[0]?.[0];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockGatewayStoreState.gatewayUrl = null;
    mockGatewayStoreState.gatewaySecret = null;
    mockGatewayStoreState.isConnected = false;
    mockGatewayStoreState.localBackendId = null;
    mockGatewayStoreState.discoveredBackends = [];
    mockGatewayStoreState.subscribedBackendIds = [];
    mockGatewayStoreState.directGatewayUrl = null;
    mockGatewayStoreState.directGatewaySecret = null;

    mockServerStoreState.activeServerId = null;

    mockTransportInstance.isConnected.mockReturnValue(true);
    mockTransportInstance.isBackendAuthenticated.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('does not create transport without gateway config', () => {
    renderHook(() => useGatewayConnection());

    expect(MockGatewayTransport).not.toHaveBeenCalled();
    expect(mockTransportInstance.connect).not.toHaveBeenCalled();
  });

  it('creates transport and normalizes the websocket URL', () => {
    mockGatewayStoreState.gatewayUrl = 'https://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';

    renderHook(() => useGatewayConnection());

    expect(MockGatewayTransport).toHaveBeenCalledTimes(1);
    expect(getTransportConfig().url).toBe('wss://gateway.example.com/ws');
    expect(mockTransportInstance.connect).toHaveBeenCalledTimes(1);
  });

  it('disconnects the transport on unmount', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';

    const { unmount } = renderHook(() => useGatewayConnection());
    unmount();

    expect(mockTransportInstance.disconnect).toHaveBeenCalledTimes(1);
  });

  it('reconnects after a disconnect when the transport is offline', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';
    mockTransportInstance.isConnected.mockReturnValue(false);

    renderHook(() => useGatewayConnection());

    act(() => {
      getTransportConfig().onDisconnected();
    });
    vi.advanceTimersByTime(3000);

    expect(mockTransportInstance.connect).toHaveBeenCalledTimes(2);
  });

  it('stops session sync and clears sessions after max reconnect attempts', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';
    mockTransportInstance.isConnected.mockReturnValue(false);

    renderHook(() => useGatewayConnection());

    for (let i = 0; i < 31; i++) {
      act(() => {
        getTransportConfig().onDisconnected();
      });
      vi.advanceTimersByTime(3000);
    }

    expect(mockSessionsStoreState.clearAllSessions).toHaveBeenCalled();
    expect(stopSessionSync).toHaveBeenCalled();
  });

  it('reconnects immediately when the document becomes visible again', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';
    mockTransportInstance.isConnected.mockReturnValue(false);

    renderHook(() => useGatewayConnection());

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(mockTransportInstance.connect).toHaveBeenCalledTimes(2);
  });

  it('auto-authenticates the active gateway backend', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';
    mockServerStoreState.activeServerId = 'gateway:backend-1';

    renderHook(() => useGatewayConnection());

    expect(mockGatewayStoreState.setBackendAuthStatus).toHaveBeenCalledWith('backend-1', 'pending');
    expect(mockServerStoreState.setServerConnectionStatus).toHaveBeenCalledWith('gateway:backend-1', 'connecting');
    expect(mockTransportInstance.authenticateBackend).toHaveBeenCalledWith('backend-1');
  });

  it('skips backend authentication when already authenticated', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';
    mockServerStoreState.activeServerId = 'gateway:backend-1';
    mockTransportInstance.isBackendAuthenticated.mockReturnValue(true);

    renderHook(() => useGatewayConnection());

    expect(mockTransportInstance.authenticateBackend).not.toHaveBeenCalled();
  });

  it('syncs subscriptions when the gateway connects', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';
    mockGatewayStoreState.subscribedBackendIds = ['backend-1'];

    renderHook(() => useGatewayConnection());

    act(() => {
      getTransportConfig().onConnected();
    });

    expect(mockGatewayStoreState.setConnected).toHaveBeenCalledWith(true);
    expect(mockTransportInstance.updateSubscriptions).toHaveBeenCalledWith(['backend-1']);
  });

  it('subscribes to all backends when no explicit subscriptions are configured', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';

    renderHook(() => useGatewayConnection());

    act(() => {
      getTransportConfig().onConnected();
    });

    expect(mockTransportInstance.updateSubscriptions).toHaveBeenCalledWith([], true);
  });

  it('handles successful backend auth results', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';

    renderHook(() => useGatewayConnection());

    act(() => {
      getTransportConfig().onBackendAuthResult('backend-1', true, undefined, { tools: ['read'] });
    });

    expect(mockGatewayStoreState.setBackendAuthStatus).toHaveBeenCalledWith('backend-1', 'authenticated');
    expect(mockServerStoreState.setServerConnectionStatus).toHaveBeenCalledWith('gateway:backend-1', 'connected');
    expect(mockServerStoreState.setServerFeatures).toHaveBeenCalledWith('gateway:backend-1', { tools: ['read'] });
  });

  it('handles failed backend auth results', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';

    renderHook(() => useGatewayConnection());

    act(() => {
      getTransportConfig().onBackendAuthResult('backend-1', false, 'Invalid token');
    });

    expect(mockGatewayStoreState.setBackendAuthStatus).toHaveBeenCalledWith('backend-1', 'failed');
    expect(mockServerStoreState.setServerConnectionStatus).toHaveBeenCalledWith('gateway:backend-1', 'error', 'Invalid token');
  });

  it('ignores backend messages from the local backend', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';
    mockGatewayStoreState.localBackendId = 'local-backend';

    renderHook(() => useGatewayConnection());

    act(() => {
      getTransportConfig().onBackendMessage('local-backend', {
        type: 'delta',
        delta: { type: 'text', text: 'hello' },
      });
    });

    expect(handleServerMessage).not.toHaveBeenCalled();
  });

  it('forwards non-auth backend messages to the shared handler', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';

    renderHook(() => useGatewayConnection());

    const message = {
      type: 'delta',
      delta: { type: 'text', text: 'hello' },
    };

    act(() => {
      getTransportConfig().onBackendMessage('backend-1', message);
    });

    expect(handleServerMessage).toHaveBeenCalledWith(
      message,
      expect.objectContaining({
        serverId: 'gateway:backend-1',
        backendId: 'backend-1',
      }),
    );
  });

  it('handles backend disconnections', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';

    renderHook(() => useGatewayConnection());

    act(() => {
      getTransportConfig().onBackendDisconnected('backend-1');
    });

    expect(mockGatewayStoreState.setBackendAuthStatus).toHaveBeenCalledWith('backend-1', 'failed');
    expect(mockServerStoreState.setServerConnectionStatus).toHaveBeenCalledWith('gateway:backend-1', 'disconnected');
  });

  // ---------- Gateway config polling ----------

  it('polls server gateway status and syncs enabled config to store', async () => {
    const mockGetStatus = vi.mocked(getServerGatewayStatus);
    mockGetStatus.mockResolvedValue({
      enabled: true,
      gatewayUrl: 'https://gw.example.com',
      gatewaySecret: 'sec',
      discoveredBackends: [{ backendId: 'b1', name: 'B1', online: true }],
      backendId: 'local-1',
      connected: true,
    } as any);

    renderHook(() => useGatewayConnection());

    // Flush the initial async poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockGatewayStoreState.syncFromServer).toHaveBeenCalledWith(
      'https://gw.example.com',
      'sec',
      [{ backendId: 'b1', name: 'B1', online: true }],
      'local-1',
      true,
    );
  });

  it('syncs null config when server gateway is disabled', async () => {
    const mockGetStatus = vi.mocked(getServerGatewayStatus);
    mockGetStatus.mockResolvedValue({
      enabled: false,
      gatewayUrl: null,
      gatewaySecret: null,
      discoveredBackends: [],
      backendId: null,
      connected: false,
    } as any);

    renderHook(() => useGatewayConnection());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockGatewayStoreState.syncFromServer).toHaveBeenCalledWith(null, null, [], null, false);
  });

  it('polls server gateway status on 10s interval', async () => {
    const mockGetStatus = vi.mocked(getServerGatewayStatus);
    mockGetStatus.mockResolvedValue({
      enabled: false,
      gatewayUrl: null,
      gatewaySecret: null,
      discoveredBackends: [],
      backendId: null,
      connected: false,
    } as any);

    renderHook(() => useGatewayConnection());

    // Flush initial call
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockGetStatus).toHaveBeenCalledTimes(1);

    // Advance 10s for the interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });

    expect(mockGetStatus).toHaveBeenCalledTimes(2);
  });

  it('skips polling and uses direct config in mobile mode', async () => {
    mockGatewayStoreState.directGatewayUrl = 'https://mobile-gw.example.com';
    mockGatewayStoreState.directGatewaySecret = 'mobile-sec';

    const mockGetStatus = vi.mocked(getServerGatewayStatus);

    renderHook(() => useGatewayConnection());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockGetStatus).not.toHaveBeenCalled();
    expect(mockGatewayStoreState.syncFromServer).toHaveBeenCalledWith(
      'https://mobile-gw.example.com',
      'mobile-sec',
      [],
    );
  });

  it('handles polling error gracefully without crashing', async () => {
    const mockGetStatus = vi.mocked(getServerGatewayStatus);
    mockGetStatus.mockRejectedValue(new Error('Network error'));

    renderHook(() => useGatewayConnection());

    // Should not throw
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockGatewayStoreState.syncFromServer).not.toHaveBeenCalled();
  });

  // ---------- Visibility change handling ----------

  it('does not reconnect on visibility change when document is hidden', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';

    renderHook(() => useGatewayConnection());

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Only the initial connect call, no reconnect
    expect(mockTransportInstance.connect).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect on visibility change when transport is already connected', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';
    mockTransportInstance.isConnected.mockReturnValue(true);

    renderHook(() => useGatewayConnection());

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Only the initial connect, no extra reconnect
    expect(mockTransportInstance.connect).toHaveBeenCalledTimes(1);
  });

  it('clears pending reconnect timeout on visibility reconnect', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';
    mockTransportInstance.isConnected.mockReturnValue(false);

    renderHook(() => useGatewayConnection());

    // Trigger a disconnect to schedule a reconnect timeout
    act(() => {
      getTransportConfig().onDisconnected();
    });

    // Now become visible — should clear the pending timeout and reconnect immediately
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Initial connect + visibility reconnect (the scheduled one gets cleared)
    expect(mockTransportInstance.connect).toHaveBeenCalledTimes(2);

    // Advancing past the reconnect interval should NOT trigger another connect
    vi.advanceTimersByTime(3000);
    expect(mockTransportInstance.connect).toHaveBeenCalledTimes(2);
  });

  // ---------- Heartbeat interval ----------

  it('requests backends list on heartbeat when connected', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';
    mockTransportInstance.isConnected.mockReturnValue(true);

    renderHook(() => useGatewayConnection());

    expect(mockTransportInstance.requestBackendsList).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(30000);
    });

    expect(mockTransportInstance.requestBackendsList).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(30000);
    });

    expect(mockTransportInstance.requestBackendsList).toHaveBeenCalledTimes(2);
  });

  it('does not request backends list on heartbeat when disconnected', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';
    mockTransportInstance.isConnected.mockReturnValue(false);

    renderHook(() => useGatewayConnection());

    act(() => {
      vi.advanceTimersByTime(30000);
    });

    expect(mockTransportInstance.requestBackendsList).not.toHaveBeenCalled();
  });

  // ---------- Backend discovery auto-auth ----------

  it('auto-authenticates all online discovered backends when gateway connects', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';
    mockGatewayStoreState.isConnected = true;
    mockGatewayStoreState.discoveredBackends = [
      { backendId: 'b1', name: 'B1', online: true },
      { backendId: 'b2', name: 'B2', online: false },
      { backendId: 'b3', name: 'B3', online: true },
    ] as any;

    renderHook(() => useGatewayConnection());

    // b1 and b3 should be authenticated, b2 (offline) should not
    expect(mockTransportInstance.authenticateBackend).toHaveBeenCalledWith('b1');
    expect(mockTransportInstance.authenticateBackend).toHaveBeenCalledWith('b3');
    expect(mockTransportInstance.authenticateBackend).not.toHaveBeenCalledWith('b2');
    expect(mockGatewayStoreState.setBackendAuthStatus).toHaveBeenCalledWith('b1', 'pending');
    expect(mockGatewayStoreState.setBackendAuthStatus).toHaveBeenCalledWith('b3', 'pending');
  });

  it('skips auto-auth for already authenticated backends in discovery', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';
    mockGatewayStoreState.isConnected = true;
    mockGatewayStoreState.discoveredBackends = [
      { backendId: 'b1', name: 'B1', online: true },
    ] as any;
    mockTransportInstance.isBackendAuthenticated.mockReturnValue(true);

    renderHook(() => useGatewayConnection());

    expect(mockTransportInstance.authenticateBackend).not.toHaveBeenCalled();
  });

  // ---------- localBackendId cleanup ----------

  it('clears stale backend sessions when localBackendId is set', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';
    mockGatewayStoreState.localBackendId = 'my-local-backend';

    renderHook(() => useGatewayConnection());

    expect(mockSessionsStoreState.clearBackendSessions).toHaveBeenCalledWith('my-local-backend');
  });

  it('does not clear sessions when localBackendId is null', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';
    mockGatewayStoreState.localBackendId = null;

    renderHook(() => useGatewayConnection());

    expect(mockSessionsStoreState.clearBackendSessions).not.toHaveBeenCalled();
  });

  // ---------- handleBackendMessage: auth_result ----------

  it('handles auth_result success with publicKey via onBackendMessage', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';

    renderHook(() => useGatewayConnection());

    act(() => {
      getTransportConfig().onBackendMessage('backend-1', {
        type: 'auth_result',
        success: true,
        publicKey: 'pk-123',
      });
    });

    expect(mockServerStoreState.setServerConnectionStatus).toHaveBeenCalledWith('gateway:backend-1', 'connected');
    expect(mockServerStoreState.setServerLocalConnection).toHaveBeenCalledWith('gateway:backend-1', false);
    expect(mockServerStoreState.setServerPublicKey).toHaveBeenCalledWith('gateway:backend-1', 'pk-123');
    expect(mockServerStoreState.updateLastConnected).toHaveBeenCalledWith('gateway:backend-1');
    expect(handleServerMessage).not.toHaveBeenCalled();
  });

  it('handles auth_result success without publicKey', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';

    renderHook(() => useGatewayConnection());

    act(() => {
      getTransportConfig().onBackendMessage('backend-1', {
        type: 'auth_result',
        success: true,
      });
    });

    expect(mockServerStoreState.setServerConnectionStatus).toHaveBeenCalledWith('gateway:backend-1', 'connected');
    expect(mockServerStoreState.setServerPublicKey).not.toHaveBeenCalled();
  });

  it('handles auth_result failure via onBackendMessage', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';

    renderHook(() => useGatewayConnection());

    act(() => {
      getTransportConfig().onBackendMessage('backend-1', {
        type: 'auth_result',
        success: false,
        error: 'Bad credentials',
      });
    });

    expect(mockServerStoreState.setServerConnectionStatus).toHaveBeenCalledWith('gateway:backend-1', 'error', 'Bad credentials');
    expect(handleServerMessage).not.toHaveBeenCalled();
  });

  it('unwraps correlation envelope before processing auth_result', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';

    renderHook(() => useGatewayConnection());

    act(() => {
      getTransportConfig().onBackendMessage('backend-1', {
        type: 'auth_result',
        payload: { success: true, publicKey: 'pk-456' },
        metadata: { correlationId: '123' },
      });
    });

    expect(mockServerStoreState.setServerConnectionStatus).toHaveBeenCalledWith('gateway:backend-1', 'connected');
    expect(mockServerStoreState.setServerPublicKey).toHaveBeenCalledWith('gateway:backend-1', 'pk-456');
  });

  // ---------- Public API methods ----------

  it('sendToBackend sends message through transport', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';

    const { result } = renderHook(() => useGatewayConnection());

    const message = { type: 'init' as const, projectId: 'p1' };
    act(() => {
      result.current.sendToBackend('backend-1', message as any);
    });

    expect(mockTransportInstance.sendToBackend).toHaveBeenCalledWith('backend-1', message);
  });

  it('sendToBackend logs error when no transport exists', () => {
    const { result } = renderHook(() => useGatewayConnection());

    act(() => {
      result.current.sendToBackend('backend-1', { type: 'init' } as any);
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith('[GatewayConn] No gateway transport');
  });

  it('isBackendAuthenticated returns transport auth status', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';
    mockTransportInstance.isBackendAuthenticated.mockReturnValue(true);

    const { result } = renderHook(() => useGatewayConnection());

    expect(result.current.isBackendAuthenticated('backend-1')).toBe(true);
    expect(mockTransportInstance.isBackendAuthenticated).toHaveBeenCalledWith('backend-1');
  });

  it('isBackendAuthenticated returns false when no transport', () => {
    const { result } = renderHook(() => useGatewayConnection());

    expect(result.current.isBackendAuthenticated('backend-1')).toBe(false);
  });

  it('disconnectGateway cleans up transport and reconnect timeout', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';
    mockTransportInstance.isConnected.mockReturnValue(false);

    const { result } = renderHook(() => useGatewayConnection());

    // Schedule a reconnect so there is a pending timeout
    act(() => {
      getTransportConfig().onDisconnected();
    });

    act(() => {
      result.current.disconnectGateway();
    });

    expect(mockTransportInstance.disconnect).toHaveBeenCalled();
    expect(mockGatewayStoreState.setConnected).toHaveBeenCalledWith(false);

    // Advancing timers should not trigger another connect since timeout was cleared
    vi.advanceTimersByTime(3000);
    // connect: 1 initial
    expect(mockTransportInstance.connect).toHaveBeenCalledTimes(1);
  });

  it('authenticateBackend logs error when transport is not connected', () => {
    const { result } = renderHook(() => useGatewayConnection());

    act(() => {
      result.current.authenticateBackend('backend-1');
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith('[GatewayConn] Cannot authenticate: gateway not connected');
    expect(mockTransportInstance.authenticateBackend).not.toHaveBeenCalled();
  });

  it('authenticateBackend sets pending status and calls transport', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';
    mockTransportInstance.isConnected.mockReturnValue(true);

    const { result } = renderHook(() => useGatewayConnection());

    act(() => {
      result.current.authenticateBackend('backend-2');
    });

    expect(mockGatewayStoreState.setBackendAuthStatus).toHaveBeenCalledWith('backend-2', 'pending');
    expect(mockTransportInstance.authenticateBackend).toHaveBeenCalledWith('backend-2');
  });

  // ---------- URL normalization ----------

  it('prepends ws:// when URL has no protocol', () => {
    mockGatewayStoreState.gatewayUrl = 'gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';

    renderHook(() => useGatewayConnection());

    expect(getTransportConfig().url).toBe('ws://gateway.example.com/ws');
  });

  // ---------- onError callback ----------

  it('logs transport errors via onError callback', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';

    renderHook(() => useGatewayConnection());

    act(() => {
      getTransportConfig().onError('WebSocket failed');
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith('[GatewayConn] Gateway error:', 'WebSocket failed');
  });

  // ---------- onBackendsUpdated callback ----------

  it('updates discovered backends via onBackendsUpdated callback', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';

    renderHook(() => useGatewayConnection());

    const backends = [{ backendId: 'b1', name: 'Backend 1', online: true }];
    act(() => {
      getTransportConfig().onBackendsUpdated(backends);
    });

    expect(mockGatewayStoreState.setDiscoveredBackends).toHaveBeenCalledWith(backends);
  });

  // ---------- Cleanup on config removal ----------

  it('cleans up transport when gateway config is cleared', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';

    const { rerender } = renderHook(() => useGatewayConnection());

    expect(mockTransportInstance.connect).toHaveBeenCalledTimes(1);

    // Clear config
    mockGatewayStoreState.gatewayUrl = null;
    mockGatewayStoreState.gatewaySecret = null;

    rerender();

    expect(mockTransportInstance.disconnect).toHaveBeenCalled();
    expect(mockGatewayStoreState.setConnected).toHaveBeenCalledWith(false);
  });

  // ---------- Backend auth result without features ----------

  it('handles successful backend auth without features (no setServerFeatures call)', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';

    renderHook(() => useGatewayConnection());

    act(() => {
      getTransportConfig().onBackendAuthResult('backend-1', true, undefined, undefined);
    });

    expect(mockGatewayStoreState.setBackendAuthStatus).toHaveBeenCalledWith('backend-1', 'authenticated');
    expect(mockServerStoreState.setServerConnectionStatus).toHaveBeenCalledWith('gateway:backend-1', 'connected');
    expect(mockServerStoreState.setServerFeatures).not.toHaveBeenCalled();
  });

  // ---------- Subscription store changes ----------

  it('pushes subscription changes to gateway via store subscriber', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';
    mockTransportInstance.isConnected.mockReturnValue(true);

    // Capture the subscribe callback
    const storeSubscribe = vi.mocked(useGatewayStore.subscribe as any);
    let subscriberFn: (state: any) => void;
    storeSubscribe.mockImplementation((fn: any) => {
      subscriberFn = fn;
      return vi.fn();
    });

    renderHook(() => useGatewayConnection());

    // Simulate subscription change
    act(() => {
      subscriberFn!({ subscribedBackendIds: ['b1', 'b2'] });
    });

    expect(mockTransportInstance.updateSubscriptions).toHaveBeenCalledWith(['b1', 'b2']);

    // Change to empty (subscribe all)
    act(() => {
      subscriberFn!({ subscribedBackendIds: [] });
    });

    expect(mockTransportInstance.updateSubscriptions).toHaveBeenCalledWith([], true);
  });

  // ---------- Auto-auth: non-gateway active server ----------

  it('does not auto-authenticate when active server is not a gateway target', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';
    mockServerStoreState.activeServerId = 'local-server';

    renderHook(() => useGatewayConnection());

    expect(mockTransportInstance.authenticateBackend).not.toHaveBeenCalled();
  });

  it('does not auto-authenticate when transport is not connected', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';
    mockServerStoreState.activeServerId = 'gateway:backend-1';
    mockTransportInstance.isConnected.mockReturnValue(false);

    renderHook(() => useGatewayConnection());

    expect(mockTransportInstance.authenticateBackend).not.toHaveBeenCalled();
  });

  // ---------- Reconnect: transport still connected ----------

  it('does not reconnect if transport is still connected after timeout', () => {
    mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
    mockGatewayStoreState.gatewaySecret = 'secret123';

    renderHook(() => useGatewayConnection());

    // First set disconnected to trigger reconnect schedule
    mockTransportInstance.isConnected.mockReturnValue(false);
    act(() => {
      getTransportConfig().onDisconnected();
    });

    // Before timeout fires, set transport back to connected
    mockTransportInstance.isConnected.mockReturnValue(true);
    vi.advanceTimersByTime(3000);

    // Only initial connect, no reconnect since isConnected is true
    expect(mockTransportInstance.connect).toHaveBeenCalledTimes(1);
  });
});
