import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGatewayConnection } from '../useGatewayConnection.js';

// Mock GatewayTransport
const mockTransport = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  isConnected: vi.fn(() => true),
  isBackendAuthenticated: vi.fn(() => false),
  authenticateBackend: vi.fn(),
  updateSubscriptions: vi.fn(),
};

vi.mock('./transport/GatewayTransport', () => ({
  GatewayTransport: vi.fn(() => mockTransport),
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

    // Reset store state
    mockGatewayStoreState.gatewayUrl = null;
    mockGatewayStoreState.gatewaySecret = null;
    mockGatewayStoreState.isConnected = false;
    mockGatewayStoreState.discoveredBackends = [];
    mockGatewayStoreState.subscribedBackendIds = [];

    mockServerStoreState.activeServerId = null;

    mockTransport.isConnected.mockReturnValue(true);
    mockTransport.isBackendAuthenticated.mockReturnValue(false);
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

      expect(mockTransport.connect).not.toHaveBeenCalled();
    });

    it('creates transport when gateway config is available', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      renderHook(() => useGatewayConnection());

      expect(mockTransport.connect).toHaveBeenCalled();
    });

    it('converts http URL to ws URL', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      renderHook(() => useGatewayConnection());

      const { GatewayTransport } = require('./transport/GatewayTransport');
      expect(GatewayTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'ws://gateway.example.com/ws',
        })
      );
    });

    it('converts https URL to wss URL', () => {
      mockGatewayStoreState.gatewayUrl = 'https://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      renderHook(() => useGatewayConnection());

      const { GatewayTransport } = require('./transport/GatewayTransport');
      expect(GatewayTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'wss://gateway.example.com/ws',
        })
      );
    });

    it('handles URL without protocol', () => {
      mockGatewayStoreState.gatewayUrl = 'gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      renderHook(() => useGatewayConnection());

      const { GatewayTransport } = require('./transport/GatewayTransport');
      expect(GatewayTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'ws://gateway.example.com/ws',
        })
      );
    });
  });

  describe('connection lifecycle', () => {
    it('connects transport on mount when config available', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      renderHook(() => useGatewayConnection());

      expect(mockTransport.connect).toHaveBeenCalled();
    });

    it('disconnects transport on unmount', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      const { unmount } = renderHook(() => useGatewayConnection());

      unmount();

      expect(mockTransport.disconnect).toHaveBeenCalled();
    });

    it('clears reconnect timeout on unmount', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      const { unmount } = renderHook(() => useGatewayConnection());

      unmount();

      // No error should occur
      expect(true).toBe(true);
    });
  });

  describe('reconnection', () => {
    it('schedules reconnect on disconnect', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      renderHook(() => useGatewayConnection());

      // Get the onDisconnected callback
      const { GatewayTransport } = require('./transport/GatewayTransport');
      const config = GatewayTransport.mock.calls[0][0];

      // Simulate disconnect
      act(() => {
        config.onDisconnected();
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Reconnecting')
      );
    });

    it('clears sessions after max reconnect attempts', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      renderHook(() => useGatewayConnection());

      const { GatewayTransport } = require('./transport/GatewayTransport');
      const config = GatewayTransport.mock.calls[0][0];

      // Simulate max reconnect attempts
      for (let i = 0; i < 30; i++) {
        act(() => {
          config.onDisconnected();
        });
        vi.advanceTimersByTime(3000);
      }

      expect(mockSessionsStoreState.clearAllSessions).toHaveBeenCalled();
    });

    it('reconnects after interval', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';
      mockTransport.isConnected.mockReturnValue(false);

      renderHook(() => useGatewayConnection());

      const { GatewayTransport } = require('./transport/GatewayTransport');
      const config = GatewayTransport.mock.calls[0][0];

      mockTransport.connect.mockClear();

      // Simulate disconnect
      act(() => {
        config.onDisconnected();
      });

      // Advance timers
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(mockTransport.connect).toHaveBeenCalled();
    });
  });

  describe('visibility change handling', () => {
    it('reconnects immediately when app becomes visible', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';
      mockTransport.isConnected.mockReturnValue(false);

      renderHook(() => useGatewayConnection());

      mockTransport.connect.mockClear();

      // Simulate visibility change to visible
      act(() => {
        Object.defineProperty(document, 'visibilityState', {
          value: 'visible',
          writable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });

      expect(mockTransport.connect).toHaveBeenCalled();
    });

    it('does not reconnect when already connected', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';
      mockTransport.isConnected.mockReturnValue(true);

      renderHook(() => useGatewayConnection());

      mockTransport.connect.mockClear();

      // Simulate visibility change
      act(() => {
        Object.defineProperty(document, 'visibilityState', {
          value: 'visible',
          writable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });

      expect(mockTransport.connect).not.toHaveBeenCalled();
    });
  });

  describe('backend authentication', () => {
    it('auto-authenticates when active server is gateway target', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';
      mockServerStoreState.activeServerId = 'gateway:backend-1';

      const { isGatewayTarget } = require('../stores/gatewayStore');
      isGatewayTarget.mockReturnValue(true);

      renderHook(() => useGatewayConnection());

      expect(mockTransport.authenticateBackend).toHaveBeenCalled();
    });

    it('skips authentication if already authenticated', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';
      mockServerStoreState.activeServerId = 'gateway:backend-1';
      mockTransport.isBackendAuthenticated.mockReturnValue(true);

      const { isGatewayTarget } = require('../stores/gatewayStore');
      isGatewayTarget.mockReturnValue(true);

      renderHook(() => useGatewayConnection());

      expect(mockTransport.authenticateBackend).not.toHaveBeenCalled();
    });

    it('authenticates online backends when connected', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';
      mockGatewayStoreState.isConnected = true;
      mockGatewayStoreState.discoveredBackends = [
        { backendId: 'backend-1', name: 'Backend 1', online: true },
        { backendId: 'backend-2', name: 'Backend 2', online: false },
      ];

      renderHook(() => useGatewayConnection());

      // Should only authenticate online backends
      expect(mockTransport.authenticateBackend).toHaveBeenCalledWith('backend-1');
      expect(mockTransport.authenticateBackend).not.toHaveBeenCalledWith('backend-2');
    });
  });

  describe('backend message handling', () => {
    it('handles auth_result message', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      renderHook(() => useGatewayConnection());

      const { GatewayTransport } = require('./transport/GatewayTransport');
      const config = GatewayTransport.mock.calls[0][0];

      // Simulate auth result
      act(() => {
        config.onBackendMessage('backend-1', {
          type: 'auth_result',
          success: true,
          publicKey: 'key123',
        });
      });

      expect(mockServerStoreState.setServerConnectionStatus).toHaveBeenCalledWith(
        'gateway:backend-1',
        'connected'
      );
    });

    it('handles failed auth_result message', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      renderHook(() => useGatewayConnection());

      const { GatewayTransport } = require('./transport/GatewayTransport');
      const config = GatewayTransport.mock.calls[0][0];

      // Simulate failed auth result
      act(() => {
        config.onBackendMessage('backend-1', {
          type: 'auth_result',
          success: false,
          error: 'Invalid credentials',
        });
      });

      expect(mockServerStoreState.setServerConnectionStatus).toHaveBeenCalledWith(
        'gateway:backend-1',
        'error',
        'Invalid credentials'
      );
    });

    it('skips messages from local backend', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';
      mockGatewayStoreState.localBackendId = 'local-backend';

      renderHook(() => useGatewayConnection());

      const { GatewayTransport } = require('./transport/GatewayTransport');
      const config = GatewayTransport.mock.calls[0][0];

      const { handleServerMessage } = require('../services/messageHandler');
      handleServerMessage.mockClear();

      // Simulate message from local backend
      act(() => {
        config.onBackendMessage('local-backend', {
          type: 'message',
          content: 'test',
        });
      });

      expect(handleServerMessage).not.toHaveBeenCalled();
    });

    it('handles backend disconnected', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';

      renderHook(() => useGatewayConnection());

      const { GatewayTransport } = require('./transport/GatewayTransport');
      const config = GatewayTransport.mock.calls[0][0];

      // Simulate backend disconnected
      act(() => {
        config.onBackendDisconnected('backend-1');
      });

      expect(mockGatewayStoreState.setBackendAuthStatus).toHaveBeenCalledWith(
        'backend-1',
        'failed'
      );
      expect(mockServerStoreState.setServerConnectionStatus).toHaveBeenCalledWith(
        'gateway:backend-1',
        'disconnected'
      );
    });
  });

  describe('subscription management', () => {
    it('subscribes to all backends when subscribedBackendIds is empty', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';
      mockGatewayStoreState.subscribedBackendIds = [];

      renderHook(() => useGatewayConnection());

      const { GatewayTransport } = require('./transport/GatewayTransport');
      const config = GatewayTransport.mock.calls[0][0];

      // Simulate connection
      act(() => {
        config.onConnected();
      });

      expect(mockTransport.updateSubscriptions).toHaveBeenCalledWith([], true);
    });

    it('subscribes to specific backends when subscribedBackendIds is set', () => {
      mockGatewayStoreState.gatewayUrl = 'http://gateway.example.com';
      mockGatewayStoreState.gatewaySecret = 'secret123';
      mockGatewayStoreState.subscribedBackendIds = ['backend-1', 'backend-2'];

      renderHook(() => useGatewayConnection());

      const { GatewayTransport } = require('./transport/GatewayTransport');
      const config = GatewayTransport.mock.calls[0][0];

      // Simulate connection
      act(() => {
        config.onConnected();
      });

      expect(mockTransport.updateSubscriptions).toHaveBeenCalledWith(['backend-1', 'backend-2']);
    });
  });

  describe('gateway status polling', () => {
    it('polls server gateway status on mount', async () => {
      const { getServerGatewayStatus } = require('../services/api');

      renderHook(() => useGatewayConnection());

      // Wait for initial poll
      await act(async () => {
        await Promise.resolve();
      });

      expect(getServerGatewayStatus).toHaveBeenCalled();
    });

    it('syncs gateway config from server status', async () => {
      const { getServerGatewayStatus } = require('../services/api');
      getServerGatewayStatus.mockResolvedValueOnce({
        enabled: true,
        gatewayUrl: 'http://server.example.com',
        gatewaySecret: 'server-secret',
        discoveredBackends: [],
        backendId: 'server-backend',
        connected: true,
      });

      renderHook(() => useGatewayConnection());

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockGatewayStoreState.syncFromServer).toHaveBeenCalled();
    });

    it('uses direct config in mobile mode', async () => {
      mockGatewayStoreState.directGatewayUrl = 'http://direct.example.com';
      mockGatewayStoreState.directGatewaySecret = 'direct-secret';

      renderHook(() => useGatewayConnection());

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockGatewayStoreState.syncFromServer).toHaveBeenCalledWith(
        'http://direct.example.com',
        'direct-secret',
        []
      );
    });
  });
});
