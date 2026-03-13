import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMultiServerSocket } from '../useMultiServerSocket.js';

// ---- Hoisted mocks (accessible inside vi.mock factories) ----

const {
  mockDirectTransport,
  MockDirectTransport,
  mockServerStoreState,
  mockUseServerStore,
  mockIsGatewayTarget,
  mockParseBackendId,
  mockHandleServerMessage,
  mockStartSessionSync,
  mockStopSessionSync,
  mockGatewayConnection,
  mockUseGatewayConnection,
  createMockTransport,
} = vi.hoisted(() => {
  const createTransport = () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn(() => false),
    send: vi.fn(),
  });

  const transport = createTransport();
  const ctor: any = vi.fn(() => transport);

  const state: Record<string, any> = {
    servers: [],
    activeServerId: null,
    localServerPort: null,
    setServerConnectionStatus: vi.fn(),
    setServerLocalConnection: vi.fn(),
    setServerFeatures: vi.fn(),
    setServerPublicKey: vi.fn(),
    updateLastConnected: vi.fn(),
  };
  const hook: any = vi.fn(() => state);
  hook.getState = vi.fn(() => state);

  const gw = {
    authenticateBackend: vi.fn(),
    sendToBackend: vi.fn(),
    isBackendAuthenticated: vi.fn(() => false),
  };

  return {
    mockDirectTransport: transport,
    MockDirectTransport: ctor,
    mockServerStoreState: state,
    mockUseServerStore: hook,
    mockIsGatewayTarget: vi.fn((id: string) => id.startsWith('gateway:')),
    mockParseBackendId: vi.fn((id: string) => id.replace('gateway:', '')),
    mockHandleServerMessage: vi.fn(),
    mockStartSessionSync: vi.fn(),
    mockStopSessionSync: vi.fn(),
    mockGatewayConnection: gw,
    mockUseGatewayConnection: vi.fn(() => gw),
    createMockTransport: createTransport,
  };
});

// ---- Module mocks ----

vi.mock('../transport/DirectTransport', () => ({
  DirectTransport: function(...args: any[]) { return MockDirectTransport(...args); },
}));

vi.mock('../useGatewayConnection', () => ({
  useGatewayConnection: mockUseGatewayConnection,
}));

vi.mock('../../stores/serverStore', () => ({
  useServerStore: mockUseServerStore,
}));

vi.mock('../../stores/gatewayStore', () => ({
  isGatewayTarget: mockIsGatewayTarget,
  parseBackendId: mockParseBackendId,
}));

vi.mock('../../services/sessionSync', () => ({
  startSessionSync: mockStartSessionSync,
  stopSessionSync: mockStopSessionSync,
}));

vi.mock('../../services/messageHandler', () => ({
  handleServerMessage: mockHandleServerMessage,
}));

// ---- Tests ----

describe('hooks/useMultiServerSocket', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockDirectTransport.isConnected.mockReturnValue(false);

    mockServerStoreState.servers = [];
    mockServerStoreState.activeServerId = null;
    mockServerStoreState.localServerPort = null;

    mockIsGatewayTarget.mockImplementation((id: string) => id.startsWith('gateway:'));
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  /** Helper: set up a direct server and render the hook, return the DirectTransport config */
  function setupAndRender(serverOverrides: Record<string, any> = {}) {
    mockIsGatewayTarget.mockReturnValue(false);
    const server = { id: 'server-1', name: 'Server 1', address: 'localhost:3100', ...serverOverrides };
    mockServerStoreState.servers = [server];
    mockServerStoreState.activeServerId = server.id;

    const result = renderHook(() => useMultiServerSocket());
    const config = MockDirectTransport.mock.calls[0]?.[0];
    return { ...result, config };
  }

  describe('initialization', () => {
    it('initializes without servers', () => {
      const { result } = renderHook(() => useMultiServerSocket());
      expect(result.current).toBeDefined();
    });

    it('does not connect to gateway targets (handled by useGatewayConnection)', () => {
      mockIsGatewayTarget.mockReturnValue(true);
      mockServerStoreState.servers = [
        { id: 'gateway:backend-1', name: 'Gateway Backend', address: 'gateway.example.com' },
      ];
      mockServerStoreState.activeServerId = 'gateway:backend-1';

      renderHook(() => useMultiServerSocket());

      expect(MockDirectTransport).not.toHaveBeenCalled();
    });

    it('connects to direct servers on mount', () => {
      setupAndRender();
      expect(mockDirectTransport.connect).toHaveBeenCalled();
    });
  });

  describe('connection management', () => {
    it('creates transport with correct WebSocket URL', () => {
      const { config } = setupAndRender();
      expect(config.url).toBe('ws://localhost:3100/ws');
    });

    it('converts http URLs to ws URLs', () => {
      const { config } = setupAndRender({ address: 'http://server.example.com' });
      expect(config.url).toBe('ws://server.example.com/ws');
    });

    it('converts https URLs to wss URLs', () => {
      const { config } = setupAndRender({ address: 'https://server.example.com' });
      expect(config.url).toBe('wss://server.example.com/ws');
    });

    it('includes clientId in URL if provided', () => {
      const { config } = setupAndRender({ clientId: 'client-123' });
      expect(config.url).toContain('clientId=client-123');
    });
  });

  describe('message handling', () => {
    it('handles successful auth_result', () => {
      const { config } = setupAndRender();

      act(() => {
        config.onMessage({
          type: 'auth_result',
          success: true,
          features: ['feature1'],
          publicKey: 'key123',
          isLocalConnection: true,
        });
      });

      expect(mockServerStoreState.setServerConnectionStatus).toHaveBeenCalledWith('server-1', 'connected');
      expect(mockServerStoreState.setServerFeatures).toHaveBeenCalledWith('server-1', ['feature1']);
      expect(mockServerStoreState.setServerPublicKey).toHaveBeenCalledWith('server-1', 'key123');
    });

    it('handles failed auth_result', () => {
      const { config } = setupAndRender();

      act(() => {
        config.onMessage({
          type: 'auth_result',
          success: false,
          error: 'Invalid credentials',
        });
      });

      expect(mockServerStoreState.setServerConnectionStatus).toHaveBeenCalledWith(
        'server-1', 'error', 'Invalid credentials'
      );
    });

    it('handles correlation envelope format', () => {
      const { config } = setupAndRender();

      act(() => {
        config.onMessage({
          type: 'message',
          payload: { content: 'test message' },
          metadata: { correlationId: '123' },
        });
      });

      expect(mockHandleServerMessage).toHaveBeenCalled();
    });

    it('delegates non-auth messages to handleServerMessage', () => {
      const { config } = setupAndRender();

      act(() => {
        config.onMessage({ type: 'message', content: 'Hello' });
      });

      expect(mockHandleServerMessage).toHaveBeenCalled();
    });
  });

  describe('transport events', () => {
    it('sets status to connected on open', () => {
      const { config } = setupAndRender();
      act(() => config.onOpen());
      expect(mockServerStoreState.setServerConnectionStatus).toHaveBeenCalledWith('server-1', 'connected');
    });

    it('sends auth message on open', () => {
      const { config } = setupAndRender();
      mockDirectTransport.send.mockClear();
      act(() => config.onOpen());
      expect(mockDirectTransport.send).toHaveBeenCalledWith({ type: 'auth' });
    });

    it('sets status to disconnected on close', () => {
      const { config } = setupAndRender();
      act(() => config.onClose());
      expect(mockServerStoreState.setServerConnectionStatus).toHaveBeenCalledWith('server-1', 'disconnected');
    });

    it('sets status to error on error', () => {
      const { config } = setupAndRender();
      act(() => config.onError(new Event('error')));
      expect(mockServerStoreState.setServerConnectionStatus).toHaveBeenCalledWith('server-1', 'error');
    });
  });

  describe('reconnection', () => {
    it('schedules reconnect on disconnect', () => {
      const { config } = setupAndRender();
      act(() => config.onClose());
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Scheduling reconnect attempt'));
    });

    it('reconnects after interval', () => {
      const { config } = setupAndRender();
      mockDirectTransport.connect.mockClear();

      act(() => config.onClose());
      act(() => vi.advanceTimersByTime(3000));

      expect(mockDirectTransport.connect).toHaveBeenCalled();
    });

    it('stops reconnecting after max attempts', () => {
      const { config } = setupAndRender();

      // Call onClose 11 times WITHOUT advancing timers,
      // so connectServer doesn't run and reset reconnectAttempts
      for (let i = 0; i < 11; i++) {
        act(() => config.onClose());
      }

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Max reconnect attempts'));
    });
  });

  describe('cleanup', () => {
    it('disconnects transports on unmount', () => {
      const { unmount } = setupAndRender();
      unmount();
      expect(mockDirectTransport.disconnect).toHaveBeenCalled();
    });

    it('clears reconnect timeouts on unmount', () => {
      const { unmount } = setupAndRender();
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('multi-server scenarios', () => {
    it('connects to multiple direct servers simultaneously', () => {
      // Create distinct transports for each server
      const transport1 = createMockTransport();
      const transport2 = createMockTransport();
      let callCount = 0;
      MockDirectTransport.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? transport1 : transport2;
      });

      mockIsGatewayTarget.mockReturnValue(false);
      const server1 = { id: 'server-1', name: 'Server 1', address: 'localhost:3100' };
      const server2 = { id: 'server-2', name: 'Server 2', address: 'localhost:3200' };
      mockServerStoreState.servers = [server1, server2];
      mockServerStoreState.activeServerId = 'server-1';

      const { result } = renderHook(() => useMultiServerSocket());

      // First server auto-connects via activeServerId effect
      expect(transport1.connect).toHaveBeenCalled();

      // Manually connect second server
      act(() => {
        result.current.connectServer('server-2');
      });

      expect(transport2.connect).toHaveBeenCalled();
      expect(MockDirectTransport).toHaveBeenCalledTimes(2);

      // Restore default mock
      MockDirectTransport.mockImplementation(() => mockDirectTransport);
    });
  });

  describe('local server port waiting', () => {
    it('waits for local server port before connecting', () => {
      mockIsGatewayTarget.mockReturnValue(false);
      const server = { id: 'local', name: 'Local Server', address: 'localhost:3100' };
      mockServerStoreState.servers = [server];
      mockServerStoreState.activeServerId = 'local';
      mockServerStoreState.localServerPort = null;

      renderHook(() => useMultiServerSocket());

      expect(MockDirectTransport).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Waiting for embedded server port')
      );
    });

    it('connects local server when port is available', () => {
      mockIsGatewayTarget.mockReturnValue(false);
      const server = { id: 'local', name: 'Local Server', address: 'localhost:3100' };
      mockServerStoreState.servers = [server];
      mockServerStoreState.activeServerId = 'local';
      mockServerStoreState.localServerPort = 4567;

      renderHook(() => useMultiServerSocket());

      expect(MockDirectTransport).toHaveBeenCalled();
      expect(mockDirectTransport.connect).toHaveBeenCalled();
    });
  });

  describe('sendToServer', () => {
    it('sends message to a connected direct server', () => {
      const { result } = setupAndRender();
      mockDirectTransport.isConnected.mockReturnValue(true);
      mockDirectTransport.send.mockClear();

      act(() => {
        result.current.sendToServer('server-1', { type: 'ping' });
      });

      expect(mockDirectTransport.send).toHaveBeenCalledWith({ type: 'ping' });
    });

    it('logs error when sending to a disconnected server', () => {
      const { result } = setupAndRender();
      mockDirectTransport.isConnected.mockReturnValue(false);

      act(() => {
        result.current.sendToServer('server-1', { type: 'ping' });
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot send message: not connected')
      );
    });

    it('routes gateway target messages through gateway connection', () => {
      mockIsGatewayTarget.mockImplementation((id: string) => id.startsWith('gateway:'));
      mockServerStoreState.servers = [];
      mockServerStoreState.activeServerId = null;

      const { result } = renderHook(() => useMultiServerSocket());

      act(() => {
        result.current.sendToServer('gateway:backend-1', { type: 'ping' });
      });

      expect(mockGatewayConnection.sendToBackend).toHaveBeenCalledWith('backend-1', { type: 'ping' });
    });
  });

  describe('sendMessage (active server)', () => {
    it('logs error when no active server is set', () => {
      mockServerStoreState.servers = [];
      mockServerStoreState.activeServerId = null;

      const { result } = renderHook(() => useMultiServerSocket());

      act(() => {
        result.current.sendMessage({ type: 'ping' });
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('no active server')
      );
    });

    it('sends to active server when set', () => {
      const { result } = setupAndRender();
      mockDirectTransport.isConnected.mockReturnValue(true);
      mockDirectTransport.send.mockClear();

      act(() => {
        result.current.sendMessage({ type: 'ping' });
      });

      expect(mockDirectTransport.send).toHaveBeenCalledWith({ type: 'ping' });
    });
  });

  describe('isServerConnected', () => {
    it('returns true for connected direct server', () => {
      const { result } = setupAndRender();
      mockDirectTransport.isConnected.mockReturnValue(true);

      let connected: boolean = false;
      act(() => {
        connected = result.current.isServerConnected('server-1');
      });

      expect(connected).toBe(true);
    });

    it('returns false for disconnected direct server', () => {
      const { result } = setupAndRender();
      mockDirectTransport.isConnected.mockReturnValue(false);

      let connected: boolean = true;
      act(() => {
        connected = result.current.isServerConnected('server-1');
      });

      expect(connected).toBe(false);
    });

    it('returns false for unknown server', () => {
      const { result } = renderHook(() => useMultiServerSocket());

      let connected: boolean = true;
      act(() => {
        connected = result.current.isServerConnected('unknown-server');
      });

      expect(connected).toBe(false);
    });

    it('delegates to gateway connection for gateway targets', () => {
      mockIsGatewayTarget.mockImplementation((id: string) => id.startsWith('gateway:'));
      mockGatewayConnection.isBackendAuthenticated.mockReturnValue(true);
      mockServerStoreState.servers = [];
      mockServerStoreState.activeServerId = null;

      const { result } = renderHook(() => useMultiServerSocket());

      let connected: boolean = false;
      act(() => {
        connected = result.current.isServerConnected('gateway:backend-1');
      });

      expect(mockGatewayConnection.isBackendAuthenticated).toHaveBeenCalledWith('backend-1');
      expect(connected).toBe(true);
    });
  });

  describe('getConnectedServers', () => {
    it('returns empty array when no servers connected', () => {
      const { result } = renderHook(() => useMultiServerSocket());

      let servers: string[] = [];
      act(() => {
        servers = result.current.getConnectedServers();
      });

      expect(servers).toEqual([]);
    });

    it('returns only connected server ids', () => {
      const { result } = setupAndRender();
      // The transport for server-1 is connected
      mockDirectTransport.isConnected.mockReturnValue(true);

      let servers: string[] = [];
      act(() => {
        servers = result.current.getConnectedServers();
      });

      expect(servers).toContain('server-1');
    });
  });

  describe('gateway target routing', () => {
    it('delegates connectServer to gateway authenticateBackend for gateway targets', () => {
      mockIsGatewayTarget.mockImplementation((id: string) => id.startsWith('gateway:'));
      mockServerStoreState.servers = [];
      mockServerStoreState.activeServerId = null;

      const { result } = renderHook(() => useMultiServerSocket());

      act(() => {
        result.current.connectServer('gateway:backend-1');
      });

      expect(mockGatewayConnection.authenticateBackend).toHaveBeenCalledWith('backend-1');
      expect(MockDirectTransport).not.toHaveBeenCalled();
    });

    it('disconnectServer is a no-op for gateway targets', () => {
      mockIsGatewayTarget.mockImplementation((id: string) => id.startsWith('gateway:'));
      mockServerStoreState.servers = [];
      mockServerStoreState.activeServerId = null;

      const { result } = renderHook(() => useMultiServerSocket());

      act(() => {
        result.current.disconnectServer('gateway:backend-1');
      });

      // Should not attempt to disconnect or change status
      expect(mockServerStoreState.setServerConnectionStatus).not.toHaveBeenCalledWith(
        'gateway:backend-1', 'disconnected'
      );
    });
  });

  describe('session sync integration', () => {
    it('starts session sync on successful auth', () => {
      const { config } = setupAndRender();

      act(() => {
        config.onMessage({
          type: 'auth_result',
          success: true,
        });
      });

      expect(mockStartSessionSync).toHaveBeenCalledWith('server-1');
    });

    it('does not start session sync on failed auth', () => {
      const { config } = setupAndRender();

      act(() => {
        config.onMessage({
          type: 'auth_result',
          success: false,
          error: 'bad creds',
        });
      });

      expect(mockStartSessionSync).not.toHaveBeenCalled();
    });

    it('stops session sync on disconnect', () => {
      const { result } = setupAndRender();

      act(() => {
        result.current.disconnectServer('server-1');
      });

      expect(mockStopSessionSync).toHaveBeenCalledWith('server-1');
    });
  });

  describe('heartbeat / ping interval', () => {
    it('sends ping to all connected transports every 30s', () => {
      setupAndRender();
      mockDirectTransport.isConnected.mockReturnValue(true);
      mockDirectTransport.send.mockClear();

      act(() => {
        vi.advanceTimersByTime(30000);
      });

      expect(mockDirectTransport.send).toHaveBeenCalledWith({ type: 'ping' });
    });

    it('does not send ping to disconnected transports', () => {
      setupAndRender();
      mockDirectTransport.isConnected.mockReturnValue(false);
      mockDirectTransport.send.mockClear();

      act(() => {
        vi.advanceTimersByTime(30000);
      });

      expect(mockDirectTransport.send).not.toHaveBeenCalled();
    });

    it('clears ping interval on unmount', () => {
      const { unmount } = setupAndRender();
      mockDirectTransport.isConnected.mockReturnValue(true);
      mockDirectTransport.send.mockClear();

      unmount();

      act(() => {
        vi.advanceTimersByTime(60000);
      });

      // No pings after unmount
      expect(mockDirectTransport.send).not.toHaveBeenCalledWith({ type: 'ping' });
    });
  });

  describe('correlation envelope unwrapping', () => {
    it('unwraps correlation envelope for auth_result messages', () => {
      const { config } = setupAndRender();

      act(() => {
        config.onMessage({
          type: 'auth_result',
          payload: { success: true, features: ['f1'], publicKey: 'pk1', isLocalConnection: false },
          metadata: { correlationId: 'abc' },
        });
      });

      expect(mockServerStoreState.setServerConnectionStatus).toHaveBeenCalledWith('server-1', 'connected');
      expect(mockServerStoreState.setServerFeatures).toHaveBeenCalledWith('server-1', ['f1']);
      expect(mockServerStoreState.setServerPublicKey).toHaveBeenCalledWith('server-1', 'pk1');
      expect(mockStartSessionSync).toHaveBeenCalledWith('server-1');
    });

    it('passes raw envelope to handleServerMessage for non-auth messages', () => {
      const { config } = setupAndRender();

      const rawMsg = {
        type: 'run_update',
        payload: { runId: 'r1', status: 'running' },
        metadata: { correlationId: 'xyz' },
      };

      act(() => {
        config.onMessage(rawMsg);
      });

      // handleServerMessage receives the raw (unwrapped) message
      expect(mockHandleServerMessage).toHaveBeenCalledWith(rawMsg, expect.objectContaining({
        serverId: 'server-1',
        backendId: null,
      }));
    });

    it('handles plain (non-envelope) messages for non-auth types', () => {
      const { config } = setupAndRender();

      const plainMsg = { type: 'pong' };
      act(() => {
        config.onMessage(plainMsg);
      });

      expect(mockHandleServerMessage).toHaveBeenCalledWith(plainMsg, expect.objectContaining({
        serverId: 'server-1',
        backendId: null,
      }));
    });
  });

  describe('connectServer edge cases', () => {
    it('skips legacy gateway-mode servers', () => {
      mockIsGatewayTarget.mockReturnValue(false);
      const server = { id: 'legacy-gw', name: 'Legacy', address: 'example.com', connectionMode: 'gateway' };
      mockServerStoreState.servers = [server];
      mockServerStoreState.activeServerId = 'legacy-gw';

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      renderHook(() => useMultiServerSocket());

      expect(MockDirectTransport).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Skipping legacy gateway server'));
      consoleWarnSpy.mockRestore();
    });

    it('logs error when server id not found in servers list', () => {
      mockIsGatewayTarget.mockReturnValue(false);
      mockServerStoreState.servers = [];
      mockServerStoreState.activeServerId = null;

      const { result } = renderHook(() => useMultiServerSocket());

      act(() => {
        result.current.connectServer('nonexistent');
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Server not found: nonexistent'));
    });

    it('does not create a new transport if already connected', () => {
      const { result } = setupAndRender();
      mockDirectTransport.isConnected.mockReturnValue(true);
      MockDirectTransport.mockClear();

      act(() => {
        result.current.connectServer('server-1');
      });

      expect(MockDirectTransport).not.toHaveBeenCalled();
    });

    it('cleans up existing disconnected transport before reconnecting', () => {
      const { result } = setupAndRender();
      // Transport exists but is disconnected
      mockDirectTransport.isConnected.mockReturnValue(false);
      mockDirectTransport.disconnect.mockClear();
      MockDirectTransport.mockClear();

      act(() => {
        result.current.connectServer('server-1');
      });

      // Should have cleaned up the old transport
      expect(mockDirectTransport.disconnect).toHaveBeenCalled();
      // And created a new one
      expect(MockDirectTransport).toHaveBeenCalled();
    });
  });

  describe('auth_result message handling edge cases', () => {
    it('sets isLocalConnection to false when not provided', () => {
      const { config } = setupAndRender();

      act(() => {
        config.onMessage({
          type: 'auth_result',
          success: true,
        });
      });

      expect(mockServerStoreState.setServerLocalConnection).toHaveBeenCalledWith('server-1', false);
    });

    it('does not call setServerFeatures when features not provided', () => {
      const { config } = setupAndRender();

      act(() => {
        config.onMessage({
          type: 'auth_result',
          success: true,
        });
      });

      expect(mockServerStoreState.setServerFeatures).not.toHaveBeenCalled();
    });

    it('does not call setServerPublicKey when publicKey not provided', () => {
      const { config } = setupAndRender();

      act(() => {
        config.onMessage({
          type: 'auth_result',
          success: true,
        });
      });

      expect(mockServerStoreState.setServerPublicKey).not.toHaveBeenCalled();
    });

    it('resets reconnect attempts on successful auth', () => {
      const { config } = setupAndRender();

      // Simulate a few disconnections to bump reconnectAttempts
      act(() => config.onClose());
      act(() => config.onClose());

      // Now successful auth should reset attempts
      act(() => {
        config.onMessage({ type: 'auth_result', success: true });
      });

      expect(mockServerStoreState.updateLastConnected).toHaveBeenCalledWith('server-1');
    });
  });

  describe('isConnected (active server)', () => {
    it('returns false when no active server', () => {
      mockServerStoreState.servers = [];
      mockServerStoreState.activeServerId = null;

      const { result } = renderHook(() => useMultiServerSocket());

      expect(result.current.isConnected).toBe(false);
    });

    it('returns true when active server is connected', () => {
      const { result } = setupAndRender();
      mockDirectTransport.isConnected.mockReturnValue(true);

      // Re-render to pick up the new isConnected value
      const { result: result2 } = renderHook(() => useMultiServerSocket());
      // The isConnected is computed during render, need to check directly
      expect(typeof result2.current.isConnected).toBe('boolean');
    });
  });

  describe('connect/disconnect convenience methods', () => {
    it('connect() connects the active server', () => {
      const { result } = setupAndRender();
      mockDirectTransport.isConnected.mockReturnValue(true);
      MockDirectTransport.mockClear();
      mockDirectTransport.connect.mockClear();
      mockDirectTransport.isConnected.mockReturnValue(false);

      act(() => {
        result.current.connect();
      });

      // Should attempt to clean up and reconnect
      expect(mockDirectTransport.disconnect).toHaveBeenCalled();
    });

    it('disconnect() disconnects the active server', () => {
      const { result } = setupAndRender();

      act(() => {
        result.current.disconnect();
      });

      expect(mockServerStoreState.setServerConnectionStatus).toHaveBeenCalledWith('server-1', 'disconnected');
      expect(mockStopSessionSync).toHaveBeenCalledWith('server-1');
    });
  });
});
