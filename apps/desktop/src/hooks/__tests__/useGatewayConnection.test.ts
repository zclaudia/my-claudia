import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGatewayConnection } from '../useGatewayConnection.js';
import { handleServerMessage } from '../../services/messageHandler';
import { stopSessionSync } from '../../services/sessionSync';

const { mockTransportInstance, MockGatewayTransport } = vi.hoisted(() => {
  const mockTransportInstance = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn(() => true),
    isBackendAuthenticated: vi.fn(() => false),
    authenticateBackend: vi.fn(),
    updateSubscriptions: vi.fn(),
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
});
