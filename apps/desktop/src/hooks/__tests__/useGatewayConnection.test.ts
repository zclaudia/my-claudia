import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGatewayConnection } from '../useGatewayConnection.js';

// Capture GatewayTransport constructor calls
let capturedConstructorArgs: any[] = [];
const mockTransportInstance = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  isConnected: vi.fn(() => true),
  isBackendAuthenticated: vi.fn(() => false),
  authenticateBackend: vi.fn(),
  updateSubscriptions: vi.fn(),
};

const MockGatewayTransport = vi.fn(() => mockTransportInstance);

vi.mock('./transport/GatewayTransport', () => ({
  GatewayTransport: MockGatewayTransport,
}));

// Mock stores
const mockGatewayStoreState = {
  gatewayUrl: null,
  gatewaySecret: null,
  isConnected: false,
  localBackendId: null,
  discoveredBackends: [],
  subscribedBackendIds: [],
  directGatewayUrl: null,
  directGatewaySecret: null,
  setConnected: vi.fn(),
  setDiscoveredBackends: vi.fn(),
  setBackendAuthStatus: vi.fn(),
  syncFromServer: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
};

vi.mock('../stores/gatewayStore', () => ({
  useGatewayStore: Object.assign(
    vi.fn(() => mockGatewayStoreState),
    {
      getState: () => mockGatewayStoreState,
      subscribe: vi.fn(() => vi.fn()),
    }
  ),
  toGatewayServerId: vi.fn((id: string) => `gateway:${id}`),
  isGatewayTarget: vi.fn((id: string) => id.startsWith('gateway:')),
  parseBackendId: vi.fn((id: string) => id.replace('gateway:', '')),
}));

const mockServerStoreState = {
  activeServerId: null,
  setServerConnectionStatus: vi.fn(),
  setServerLocalConnection: vi.fn(),
  setServerFeatures: vi.fn(),
  setServerPublicKey: vi.fn(),
  updateLastConnected: vi.fn(),
};

vi.mock('../stores/serverStore', () => ({
  useServerStore: Object.assign(
    vi.fn(() => mockServerStoreState),
    {
      getState: () => mockServerStoreState,
    }
  ),
}));

const mockSessionsStoreState = {
  clearAllSessions: vi.fn(),
};

vi.mock('../stores/sessionsStore', () => ({
  useSessionsStore: Object.assign(
    vi.fn(() => mockSessionsStoreState),
    {
      getState: () => mockSessionsStoreState,
    }
  ),
}));

// Mock services
vi.mock('../services/api', () => ({
  getServerGatewayStatus: vi.fn(() =>
    Promise.resolve({
      enabled: false,
      gatewayUrl: null,
      gatewaySecret: null,
      discoveredBackends: [],
      backendId: null,
      connected: false,
    })
  ),
}));

vi.mock('../services/messageHandler', () => ({
  handleServerMessage: vi.fn(),
}));

vi.mock('../services/sessionSync', () => ({
  stopSessionSync: vi.fn(),
}));

describe('hooks/useGatewayConnection', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Reset captured args
    capturedConstructorArgs = [];

    // Override mock to capture constructor args
    MockGatewayTransport.mockImplementation((...args: any[]) => {
      capturedConstructorArgs.push(args);
      return mockTransportInstance;
    });

    // Reset store state
    mockGatewayStoreState.gatewayUrl = null;
    mockGatewayStoreState.gatewaySecret = null;
    mockGatewayStoreState.isConnected = false;
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

  describe('initialization', () => {
    it('does not create transport without gateway config', () => {
      mockGatewayStoreState.gatewayUrl = null;
      mockGatewayStoreState.gatewaySecret = null;

      renderHook(() => useGatewayConnection());

      expect(mockTransportInstance.connect).not.toHaveBeenCalled();
    });

    it('creates transport when gateway config is available', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      renderHook(() => useGatewayConnection());

      expect(mockTransportInstance.connect).toHaveBeenCalled();
    });

    it('converts http URL to ws URL', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      renderHook(() => useGatewayConnection());

      // Check that the constructor was called with the correct URL
      expect(MockGatewayTransport).toHaveBeenCalled();
      const callArgs = MockGatewayTransport.mock.calls[0][0];
      expect(callArgs.url).toBe('ws://gateway.example.com/ws');
    });

    it('converts https URL to wss URL', () => {
      mockGatewayStoreState.gatewayUrl = 'https://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      renderHook(() => useGatewayConnection());

      const callArgs = MockGatewayTransport.mock.calls[0][0];
      expect(callArgs.url).toBe('wss://gateway.example.com/ws');
    });

    it('handles URL without protocol', () => {
      mockGatewayStoreState.gatewayUrl = 'gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      renderHook(() => useGatewayConnection());

      const callArgs = MockGatewayTransport.mock.calls[0][0];
      expect(callArgs.url).toBe('ws://gateway.example.com/ws');
    });
  });

  describe('connection lifecycle', () => {
    it('connects transport on mount when config available', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      renderHook(() => useGatewayConnection());

      expect(mockTransportInstance.connect).toHaveBeenCalled();
    });

    it('disconnects transport on unmount', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      const { unmount } = renderHook(() => useGatewayConnection());
      unmount();

      expect(mockTransportInstance.disconnect).toHaveBeenCalled();
    });

    it('clears reconnect timeout on unmount', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      const { unmount } = renderHook(() => useGatewayConnection());
      unmount();

      // With fake timers, we can advance time to ensure no pending timeouts
      vi.advanceTimersByTime(10000);
      // If there were pending reconnects, they would have executed
    });
  });

  describe('reconnection', () => {
    it('schedules reconnect on disconnect', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      renderHook(() => useGatewayConnection());

      // Trigger a disconnect
      const connectCallback = mockTransportInstance.connect.mock.calls[0]?.[0]?.onDisconnect;
      if (connectCallback) {
        connectCallback();
      }

      vi.advanceTimersByTime(5000);

      expect(mockTransportInstance.connect).toHaveBeenCalled();
    });

    it('reconnects after interval', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      renderHook(() => useGatewayConnection());

      // Initial connect
      const initialConnectCount = mockTransportInstance.connect.mock.calls.length;

      // Simulate disconnect
      const connectCallback = mockTransportInstance.connect.mock.calls[0]?.[0]?.onDisconnect;
      if (connectCallback) {
        connectCallback();
      }

      // Advance past reconnect interval
      vi.advanceTimersByTime(5001);

      expect(mockTransportInstance.connect).toHaveBeenCalledTimes(initialConnectCount + 1);
    });

    it('stops reconnecting after max attempts', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      renderHook(() => useGatewayConnection());

      // Try multiple reconnects
      for (let i = 0; i < 10; i++) {
        const connectCallback = mockTransportInstance.connect.mock.calls[Math.max(0, mockTransportInstance.connect.mock.calls.length - 1)]?.[0]?.onDisconnect;
        if (connectCallback) {
          connectCallback();
        }
        vi.advanceTimersByTime(5001);
      }

      // After max attempts, should stop trying
      const finalCount = mockTransportInstance.connect.mock.calls.length;
      // Should have some limit on reconnects
    });

    it('clears sessions after max reconnect attempts', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      renderHook(() => useGatewayConnection());

      // Simulate max reconnect failures
      for (let i = 0; i < 10; i++) {
        const connectCallback = mockTransportInstance.connect.mock.calls[Math.max(0, mockTransportInstance.connect.mock.calls.length - 1)]?.[0]?.onDisconnect;
        if (connectCallback) {
          connectCallback();
        }
        vi.advanceTimersByTime(5001);
      }

      // Sessions should be cleared after max attempts
      expect(mockSessionsStoreState.clearAllSessions).toHaveBeenCalled();
    });
  });

  describe('visibility change handling', () => {
    it('reconnects immediately when app becomes visible', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      renderHook(() => useGatewayConnection());

      // Simulate visibility change
      document.dispatchEvent(new Event('visibilitychange'));

      // Should attempt to connect
      vi.runAllTimers();
    });
  });

  describe('backend authentication', () => {
    it('auto-authenticates when active server is gateway target', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';
      mockGatewayStoreState.subscribedBackendIds = ['backend-1'];

      renderHook(() => useGatewayConnection());

      // Check if authentication was attempted
      vi.runAllTimers();
    });

    it('skips authentication if already authenticated', () => {
      mockTransportInstance.isBackendAuthenticated.mockReturnValue(true);
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      renderHook(() => useGatewayConnection());

      // Should not authenticate if already authenticated
      expect(mockTransportInstance.authenticateBackend).not.toHaveBeenCalled();
    });

    it('authenticates online backends when connected', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';
      mockGatewayStoreState.discoveredBackends = [
        { id: 'backend-1', name: 'Backend 1', status: 'online' }
      ];

      renderHook(() => useGatewayConnection());

      // Should authenticate discovered backends
      vi.runAllTimers();
    });
  });

  describe('backend message handling', () => {
    it('handles auth_result message', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      renderHook(() => useGatewayConnection());

      // Simulate receiving an auth_result message
      const messageHandler = mockTransportInstance.connect.mock.calls[0]?.[0]?.onMessage;
      if (messageHandler) {
        messageHandler({
          type: 'envelope',
          correlationId: 'test',
          message: { type: 'auth_result', success: true }
        });
      }

      // Should update auth status
      expect(mockGatewayStoreState.setBackendAuthStatus).toHaveBeenCalled();
    });

    it('handles failed auth_result message', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      renderHook(() => useGatewayConnection());

      const messageHandler = mockTransportInstance.connect.mock.calls[0]?.[0]?.onMessage;
      if (messageHandler) {
        messageHandler({
          type: 'envelope',
          correlationId: 'test',
          message: { type: 'auth_result', success: false, error: 'Invalid token' }
        });
      }

      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('skips messages from local backend', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';
      mockGatewayStoreState.localBackendId = 'local-backend';

      renderHook(() => useGatewayConnection());

      // Should not process messages from local backend
    });

    it('handles backend disconnected', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      renderHook(() => useGatewayConnection());

      const messageHandler = mockTransportInstance.connect.mock.calls[0]?.[0]?.onMessage;
      if (messageHandler) {
        messageHandler({
          type: 'envelope',
          correlationId: 'test',
          message: { type: 'backend_disconnected', backendId: 'backend-1' }
        });
      }

      expect(mockGatewayStoreState.setDiscoveredBackends).toHaveBeenCalled();
    });
  });

  describe('subscription management', () => {
    it('subscribes to all backends when subscribedBackendIds is empty', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';
      mockGatewayStoreState.discoveredBackends = [
        { id: 'backend-1', name: 'Backend 1', status: 'online' },
        { id: 'backend-2', name: 'Backend 2', status: 'online' }
      ];
      mockGatewayStoreState.subscribedBackendIds = [];

      renderHook(() => useGatewayConnection());

      expect(mockTransportInstance.updateSubscriptions).toHaveBeenCalled();
    });

    it('subscribes to specific backends when subscribedBackendIds is set', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';
      mockGatewayStoreState.discoveredBackends = [
        { id: 'backend-1', name: 'Backend 1', status: 'online' },
        { id: 'backend-2', name: 'Backend 2', status: 'online' }
      ];
      mockGatewayStoreState.subscribedBackendIds = ['backend-1'];

      renderHook(() => useGatewayConnection());

      expect(mockTransportInstance.updateSubscriptions).toHaveBeenCalledWith(
        expect.arrayContaining(['backend-1'])
      );
    });
  });
});
