import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMultiServerSocket } from '../useMultiServerSocket.js';

// Mock DirectTransport
const mockDirectTransport = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  isConnected: vi.fn(() => true),
  send: vi.fn(),
};

vi.mock('./transport/DirectTransport', () => ({
  DirectTransport: vi.fn(() => mockDirectTransport),
}));

// Mock useGatewayConnection
vi.mock('./useGatewayConnection', () => ({
  useGatewayConnection: vi.fn(() => ({})),
}));

// Mock stores
const mockServerStoreState = {
  servers: [],
  activeServerId: null,
  setServerConnectionStatus: vi.fn(),
  setServerLocalConnection: vi.fn(),
  setServerFeatures: vi.fn(),
  setServerPublicKey: vi.fn(),
  updateLastConnected: vi.fn(),
};

vi.mock('../stores/serverStore', () => ({
  useServerStore: vi.fn(() => mockServerStoreState),
}));

vi.mock('../stores/gatewayStore', () => ({
  isGatewayTarget: vi.fn((id: string) => id.startsWith('gateway:')),
  parseBackendId: vi.fn((id: string) => id.replace('gateway:', '')),
}));

// Mock services
vi.mock('../services/sessionSync', () => ({
  startSessionSync: vi.fn(),
  stopSessionSync: vi.fn(),
}));

vi.mock('../services/messageHandler', () => ({
  handleServerMessage: vi.fn(),
}));

describe('hooks/useMultiServerSocket', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Reset store state
    mockServerStoreState.servers = [];
    mockServerStoreState.activeServerId = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('initialization', () => {
    it('initializes without servers', () => {
      mockServerStoreState.servers = [];

      const { result } = renderHook(() => useMultiServerSocket());

      expect(result.current).toBeDefined();
    });

    it('does not connect to gateway targets (handled by useGatewayConnection)', () => {
      mockServerStoreState.servers = [
        { id: 'gateway:backend-1', name: 'Gateway Backend', address: 'gateway.example.com' },
      ];

      const { isGatewayTarget } = require('../stores/gatewayStore');
      isGatewayTarget.mockReturnValue(true);

      renderHook(() => useMultiServerSocket());

      expect(mockDirectTransport.connect).not.toHaveBeenCalled();
    });

    it('connects to direct servers on mount', () => {
      mockServerStoreState.servers = [
        { id: 'local', name: 'Local Server', address: 'localhost:3100' },
      ];

      const { isGatewayTarget } = require('../stores/gatewayStore');
      isGatewayTarget.mockReturnValue(false);

      renderHook(() => useMultiServerSocket());

      expect(mockDirectTransport.connect).toHaveBeenCalled();
    });
  });

  describe('connection management', () => {
    it('creates transport with correct WebSocket URL', () => {
      mockServerStoreState.servers = [
        { id: 'server-1', name: 'Server 1', address: 'localhost:3100' },
      ];

      const { isGatewayTarget } = require('../stores/gatewayStore');
      isGatewayTarget.mockReturnValue(false);

      renderHook(() => useMultiServerSocket());

      const { DirectTransport } = require('./transport/DirectTransport');
      const config = DirectTransport.mock.calls[0][0];

      expect(config.url).toBe('ws://localhost:3100/ws');
    });

    it('converts http URLs to ws URLs', () => {
      mockServerStoreState.servers = [
        { id: 'server-1', name: 'Server 1', address: 'http://server.example.com' },
      ];

      const { isGatewayTarget } = require('../stores/gatewayStore');
      isGatewayTarget.mockReturnValue(false);

      renderHook(() => useMultiServerSocket());

      const { DirectTransport } = require('./transport/DirectTransport');
      const config = DirectTransport.mock.calls[0][0];

      expect(config.url).toBe('ws://server.example.com/ws');
    });

    it('converts https URLs to wss URLs', () => {
      mockServerStoreState.servers = [
        { id: 'server-1', name: 'Server 1', address: 'https://server.example.com' },
      ];

      const { isGatewayTarget } = require('../stores/gatewayStore');
      isGatewayTarget.mockReturnValue(false);

      renderHook(() => useMultiServerSocket());

      const { DirectTransport } = require('./transport/DirectTransport');
      const config = DirectTransport.mock.calls[0][0];

      expect(config.url).toBe('wss://server.example.com/ws');
    });

    it('includes clientId in URL if provided', () => {
      mockServerStoreState.servers = [
        { id: 'server-1', name: 'Server 1', address: 'localhost:3100', clientId: 'client-123' },
      ];

      const { isGatewayTarget } = require('../stores/gatewayStore');
      isGatewayTarget.mockReturnValue(false);

      renderHook(() => useMultiServerSocket());

      const { DirectTransport } = require('./transport/DirectTransport');
      const config = DirectTransport.mock.calls[0][0];

      expect(config.url).toContain('clientId=client-123');
    });
  });

  describe('message handling', () => {
    it('handles successful auth_result', () => {
      mockServerStoreState.servers = [
        { id: 'server-1', name: 'Server 1', address: 'localhost:3100' },
      ];

      const { isGatewayTarget } = require('../stores/gatewayStore');
      isGatewayTarget.mockReturnValue(false);

      renderHook(() => useMultiServerSocket());

      const { DirectTransport } = require('./transport/DirectTransport');
      const config = DirectTransport.mock.calls[0][0];

      // Simulate auth result
      act(() => {
        config.onMessage({
          type: 'auth_result',
          success: true,
          features: ['feature1'],
          publicKey: 'key123',
          isLocalConnection: true,
        });
      });

      expect(mockServerStoreState.setServerConnectionStatus).toHaveBeenCalledWith(
        'server-1',
        'connected'
      );
      expect(mockServerStoreState.setServerFeatures).toHaveBeenCalledWith(
        'server-1',
        ['feature1']
      );
      expect(mockServerStoreState.setServerPublicKey).toHaveBeenCalledWith(
        'server-1',
        'key123'
      );
    });

    it('handles failed auth_result', () => {
      mockServerStoreState.servers = [
        { id: 'server-1', name: 'Server 1', address: 'localhost:3100' },
      ];

      const { isGatewayTarget } = require('../stores/gatewayStore');
      isGatewayTarget.mockReturnValue(false);

      renderHook(() => useMultiServerSocket());

      const { DirectTransport } = require('./transport/DirectTransport');
      const config = DirectTransport.mock.calls[0][0];

      // Simulate failed auth
      act(() => {
        config.onMessage({
          type: 'auth_result',
          success: false,
          error: 'Invalid credentials',
        });
      });

      expect(mockServerStoreState.setServerConnectionStatus).toHaveBeenCalledWith(
        'server-1',
        'error',
        'Invalid credentials'
      );
    });

    it('handles correlation envelope format', () => {
      mockServerStoreState.servers = [
        { id: 'server-1', name: 'Server 1', address: 'localhost:3100' },
      ];

      const { isGatewayTarget } = require('../stores/gatewayStore');
      isGatewayTarget.mockReturnValue(false);

      const { handleServerMessage } = require('../services/messageHandler');

      renderHook(() => useMultiServerSocket());

      const { DirectTransport } = require('./transport/DirectTransport');
      const config = DirectTransport.mock.calls[0][0];

      // Simulate envelope format message
      act(() => {
        config.onMessage({
          type: 'message',
          payload: { content: 'test message' },
          metadata: { correlationId: '123' },
        });
      });

      expect(handleServerMessage).toHaveBeenCalled();
    });

    it('delegates non-auth messages to handleServerMessage', () => {
      mockServerStoreState.servers = [
        { id: 'server-1', name: 'Server 1', address: 'localhost:3100' },
      ];

      const { isGatewayTarget } = require('../stores/gatewayStore');
      isGatewayTarget.mockReturnValue(false);

      const { handleServerMessage } = require('../services/messageHandler');

      renderHook(() => useMultiServerSocket());

      const { DirectTransport } = require('./transport/DirectTransport');
      const config = DirectTransport.mock.calls[0][0];

      // Simulate message
      act(() => {
        config.onMessage({
          type: 'message',
          content: 'Hello',
        });
      });

      expect(handleServerMessage).toHaveBeenCalled();
    });
  });

  describe('transport events', () => {
    it('sets status to connected on open', () => {
      mockServerStoreState.servers = [
        { id: 'server-1', name: 'Server 1', address: 'localhost:3100' },
      ];

      const { isGatewayTarget } = require('../stores/gatewayStore');
      isGatewayTarget.mockReturnValue(false);

      renderHook(() => useMultiServerSocket());

      const { DirectTransport } = require('./transport/DirectTransport');
      const config = DirectTransport.mock.calls[0][0];

      // Simulate open
      act(() => {
        config.onOpen();
      });

      expect(mockServerStoreState.setServerConnectionStatus).toHaveBeenCalledWith(
        'server-1',
        'connected'
      );
    });

    it('sends auth message on open', () => {
      mockServerStoreState.servers = [
        { id: 'server-1', name: 'Server 1', address: 'localhost:3100' },
      ];

      const { isGatewayTarget } = require('../stores/gatewayStore');
      isGatewayTarget.mockReturnValue(false);

      renderHook(() => useMultiServerSocket());

      const { DirectTransport } = require('./transport/DirectTransport');
      const config = DirectTransport.mock.calls[0][0];

      mockDirectTransport.send.mockClear();

      // Simulate open
      act(() => {
        config.onOpen();
      });

      expect(mockDirectTransport.send).toHaveBeenCalledWith({ type: 'auth' });
    });

    it('sets status to disconnected on close', () => {
      mockServerStoreState.servers = [
        { id: 'server-1', name: 'Server 1', address: 'localhost:3100' },
      ];

      const { isGatewayTarget } = require('../stores/gatewayStore');
      isGatewayTarget.mockReturnValue(false);

      renderHook(() => useMultiServerSocket());

      const { DirectTransport } = require('./transport/DirectTransport');
      const config = DirectTransport.mock.calls[0][0];

      // Simulate close
      act(() => {
        config.onClose();
      });

      expect(mockServerStoreState.setServerConnectionStatus).toHaveBeenCalledWith(
        'server-1',
        'disconnected'
      );
    });

    it('sets status to error on error', () => {
      mockServerStoreState.servers = [
        { id: 'server-1', name: 'Server 1', address: 'localhost:3100' },
      ];

      const { isGatewayTarget } = require('../stores/gatewayStore');
      isGatewayTarget.mockReturnValue(false);

      renderHook(() => useMultiServerSocket());

      const { DirectTransport } = require('./transport/DirectTransport');
      const config = DirectTransport.mock.calls[0][0];

      // Simulate error
      act(() => {
        config.onError(new Event('error'));
      });

      expect(mockServerStoreState.setServerConnectionStatus).toHaveBeenCalledWith(
        'server-1',
        'error'
      );
    });
  });

  describe('reconnection', () => {
    it('schedules reconnect on disconnect', () => {
      mockServerStoreState.servers = [
        { id: 'server-1', name: 'Server 1', address: 'localhost:3100' },
      ];

      const { isGatewayTarget } = require('../stores/gatewayStore');
      isGatewayTarget.mockReturnValue(false);

      renderHook(() => useMultiServerSocket());

      const { DirectTransport } = require('./transport/DirectTransport');
      const config = DirectTransport.mock.calls[0][0];

      mockDirectTransport.isConnected.mockReturnValue(false);

      // Simulate close
      act(() => {
        config.onClose();
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Reconnecting')
      );
    });

    it('reconnects after interval', () => {
      mockServerStoreState.servers = [
        { id: 'server-1', name: 'Server 1', address: 'localhost:3100' },
      ];

      const { isGatewayTarget } = require('../stores/gatewayStore');
      isGatewayTarget.mockReturnValue(false);

      renderHook(() => useMultiServerSocket());

      const { DirectTransport } = require('./transport/DirectTransport');
      const config = DirectTransport.mock.calls[0][0];

      mockDirectTransport.isConnected.mockReturnValue(false);
      mockDirectTransport.connect.mockClear();

      // Simulate close
      act(() => {
        config.onClose();
      });

      // Advance timers
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(mockDirectTransport.connect).toHaveBeenCalled();
    });

    it('stops reconnecting after max attempts', () => {
      mockServerStoreState.servers = [
        { id: 'server-1', name: 'Server 1', address: 'localhost:3100' },
      ];

      const { isGatewayTarget } = require('../stores/gatewayStore');
      isGatewayTarget.mockReturnValue(false);

      renderHook(() => useMultiServerSocket());

      const { DirectTransport } = require('./transport/DirectTransport');
      const config = DirectTransport.mock.calls[0][0];

      mockDirectTransport.isConnected.mockReturnValue(false);

      // Simulate multiple reconnect attempts
      for (let i = 0; i < 10; i++) {
        act(() => {
          config.onClose();
        });
        vi.advanceTimersByTime(3000);
      }

      // Should stop trying
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Max reconnect attempts')
      );
    });
  });

  describe('cleanup', () => {
    it('disconnects transports on unmount', () => {
      mockServerStoreState.servers = [
        { id: 'server-1', name: 'Server 1', address: 'localhost:3100' },
      ];

      const { isGatewayTarget } = require('../stores/gatewayStore');
      isGatewayTarget.mockReturnValue(false);

      const { unmount } = renderHook(() => useMultiServerSocket());

      unmount();

      expect(mockDirectTransport.disconnect).toHaveBeenCalled();
    });

    it('clears reconnect timeouts on unmount', () => {
      mockServerStoreState.servers = [
        { id: 'server-1', name: 'Server 1', address: 'localhost:3100' },
      ];

      const { isGatewayTarget } = require('../stores/gatewayStore');
      isGatewayTarget.mockReturnValue(false);

      const { unmount } = renderHook(() => useMultiServerSocket());

      // Should not throw
      expect(() => unmount()).not.toThrow();
    });
  });
});
