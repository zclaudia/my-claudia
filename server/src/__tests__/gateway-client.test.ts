import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GatewayClient } from '../gateway-client.js';
import WebSocket from 'ws';
import * as fs from 'fs';
import * as crypto from 'crypto';

// Mock WebSocket
vi.mock('ws', () => {
  const MockWebSocket = vi.fn().mockImplementation(function(this: any) {
    this.on = vi.fn();
    this.removeAllListeners = vi.fn();
    this.close = vi.fn();
    this.send = vi.fn();
    this.readyState = 1;
  });
  MockWebSocket.OPEN = 1;
  MockWebSocket.CLOSED = 0;
  return {
    default: MockWebSocket
  };
});

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn()
}));

// Mock crypto
vi.mock('crypto', () => ({
  randomUUID: vi.fn()
}));

describe('GatewayClient', () => {
  let client: GatewayClient;
  let mockConfig: any;
  let mockDb: any;
  let mockActiveRuns: Map<string, any>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = {
      gatewayUrl: 'http://gateway.example.com',
      gatewaySecret: 'test-secret',
      name: 'test-backend',
      serverPort: 3100,
      visible: true
    };

    mockDb = {
      prepare: vi.fn()
    };

    mockActiveRuns = new Map();

    // Mock fs functions
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockImplementation(() => {});
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        deviceId: 'existing-device-id',
        createdAt: Date.now()
      }));

    // Mock crypto.randomUUID
    vi.mocked(crypto.randomUUID).mockReturnValue('new-device-uuid');
  });

  afterEach(() => {
    if (client) {
      client.disconnect();
    }
  });

  describe('constructor', () => {
    it('initializes with config', () => {
      client = new GatewayClient(mockConfig);

      expect(client).toBeDefined();
    });

    it('generates device ID if not exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      client = new GatewayClient(mockConfig);

      expect(crypto.randomUUID).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('loads existing device ID from file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        deviceId: 'existing-device-id',
        createdAt: Date.now()
      }));

      client = new GatewayClient(mockConfig);

      expect(fs.readFileSync).toHaveBeenCalled();
    });

    it('generates new UUID if config invalid', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json');

      client = new GatewayClient(mockConfig);

      expect(crypto.randomUUID).toHaveBeenCalled();
    });

    it('accepts optional db and activeRuns', () => {
      client = new GatewayClient(mockConfig, mockDb, mockActiveRuns);

      expect(client).toBeDefined();
    });
  });

  describe('connect', () => {
    beforeEach(() => {
      client = new GatewayClient(mockConfig);
    });

    it('creates WebSocket connection to gateway URL', () => {
      client.connect();

      expect(WebSocket).toHaveBeenCalledWith(
        expect.stringContaining('ws://gateway.example.com/ws'),
        expect.any(Object)
      );
    });

    it('configures SOCKS5 proxy if provided', () => {
      const configWithProxy = {
        ...mockConfig,
        proxyUrl: 'socks5://proxy.example.com:1080'
      };
      client = new GatewayClient(configWithProxy);
      client.connect();

      expect(WebSocket).toHaveBeenCalled();
    });

    it('adds proxy authentication to URL', () => {
      const configWithAuth = {
        ...mockConfig,
        proxyUrl: 'socks5://proxy.example.com:1080',
        proxyAuth: {
          username: 'user',
          password: 'pass'
        }
      };
      client = new GatewayClient(configWithAuth);
      client.connect();

      expect(WebSocket).toHaveBeenCalled();
    });

    it('clears pending reconnect timeout', () => {
      const mockTimeout = setTimeout(() => {}, 10000);
      (client as any).reconnectTimeout = mockTimeout;

      client.connect();

      expect((client as any).reconnectTimeout).toBeNull();
    });

    it('closes existing WebSocket before reconnecting', () => {
      const mockWs = {
        removeAllListeners: vi.fn(),
        close: vi.fn()
      };
      (client as any).ws = mockWs;

      client.connect();

      expect(mockWs.removeAllListeners).toHaveBeenCalled();
      expect(mockWs.close).toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    beforeEach(() => {
      client = new GatewayClient(mockConfig);
    });

    it('sets intentional disconnect flag', () => {
      client.disconnect();

      expect((client as any).intentionalDisconnect).toBe(true);
    });

    it('clears reconnect timeout', () => {
      const mockTimeout = setTimeout(() => {}, 10000);
      (client as any).reconnectTimeout = mockTimeout;

      client.disconnect();

      expect((client as any).reconnectTimeout).toBeNull();
    });

    it('closes WebSocket connection', () => {
      const mockWs = {
        removeAllListeners: vi.fn(),
        close: vi.fn()
      };
      (client as any).ws = mockWs;

      client.disconnect();

      expect(mockWs.removeAllListeners).toHaveBeenCalled();
      expect(mockWs.close).toHaveBeenCalled();
    });

    it('clears all state', () => {
      (client as any).isConnected = true;
      (client as any).backendId = 'test-backend';
      (client as any).discoveredBackends = [{ id: 'test' }];

      client.disconnect();

      expect((client as any).isConnected).toBe(false);
      expect((client as any).backendId).toBeNull();
      expect((client as any).discoveredBackends).toEqual([]);
    });
  });

  describe('sendToClient', () => {
    beforeEach(() => {
      client = new GatewayClient(mockConfig);
    });

    it('sends message to specific client', () => {
      client.connect();
      const mockWs = (client as any).ws;
      mockWs.readyState = WebSocket.OPEN;

      client.sendToClient('client-123', { type: 'test' } as any);

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('client-123')
      );
    });

    it('logs error if WebSocket not connected', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      client.connect();
      const mockWs = (client as any).ws;
      mockWs.readyState = WebSocket.CLOSED;

      client.sendToClient('client-123', { type: 'test' } as any);

      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('does nothing if WebSocket is null', () => {
      (client as any).ws = null;

      client.sendToClient('client-123', { type: 'test' } as any);

      // Should not throw
    });
  });

  describe('broadcast', () => {
    beforeEach(() => {
      client = new GatewayClient(mockConfig);
    });

    it('broadcasts message to all subscribers', () => {
      client.connect();
      const mockWs = (client as any).ws;
      mockWs.readyState = WebSocket.OPEN;

      client.broadcast({ type: 'test_broadcast' } as any);

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('broadcast_to_subscribers')
      );
    });

    it('logs error if not connected', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      client.connect();
      const mockWs = (client as any).ws;
      mockWs.readyState = WebSocket.CLOSED;

      client.broadcast({ type: 'test' } as any);

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('getter methods', () => {
    beforeEach(() => {
      client = new GatewayClient(mockConfig);
    });

    it('getBackendId returns current backend ID', () => {
      (client as any).backendId = 'test-backend-123';

      expect(client.getBackendId()).toBe('test-backend-123');
    });

    it('getDiscoveredBackends returns backends list', () => {
      const testBackends = [
        { id: 'backend-1', name: 'Test 1' },
        { id: 'backend-2', name: 'Test 2' },
      ];
      (client as any).discoveredBackends = testBackends;

      expect(client.getDiscoveredBackends()).toEqual(testBackends);
    });

    it('isGatewayConnected returns connection status', () => {
      (client as any).isConnected = true;

      expect(client.isGatewayConnected()).toBe(true);

      (client as any).isConnected = false;

      expect(client.isGatewayConnected()).toBe(false);
    });
  });

  describe('event handler registration', () => {
    beforeEach(() => {
      client = new GatewayClient(mockConfig);
    });

    it('registers message handler', () => {
      const handler = vi.fn();
      client.onMessage(handler);

      expect((client as any).messageHandler).toBe(handler);
    });

    it('registers client connected handler', () => {
      const handler = vi.fn();
      client.onClientConnected(handler);

      expect((client as any).clientConnectedHandler).toBe(handler);
    });

    it('registers client disconnected handler', () => {
      const handler = vi.fn();
      client.onClientDisconnected(handler);

      expect((client as any).clientDisconnectedHandler).toBe(handler);
    });

    it('registers client subscribed handler', () => {
      const handler = vi.fn();
      client.onClientSubscribed(handler);

      expect((client as any).clientSubscribedHandler).toBe(handler);
    });
  });

  describe('HTTP proxy content handling', () => {
    it('does not stream known text-like content types', () => {
      const shouldStream = (GatewayClient as any).shouldStream as (headers: Record<string, string>) => boolean;

      expect(shouldStream({ 'content-type': 'application/json' })).toBe(false);
      expect(shouldStream({ 'content-type': 'text/plain; charset=utf-8' })).toBe(false);
      expect(shouldStream({ 'content-type': 'application/problem+json' })).toBe(false);
      expect(shouldStream({ 'content-type': 'application/xml' })).toBe(false);
    });

    it('streams binary content types to avoid UTF-8 corruption', () => {
      const shouldStream = (GatewayClient as any).shouldStream as (headers: Record<string, string>) => boolean;

      expect(shouldStream({ 'content-type': 'image/png' })).toBe(true);
      expect(shouldStream({ 'content-type': 'application/pdf' })).toBe(true);
      expect(shouldStream({ 'content-type': 'application/octet-stream' })).toBe(true);
      expect(shouldStream({ 'content-type': 'application/vnd.android.package-archive' })).toBe(true);
    });

    it('streams large payloads regardless of content type', () => {
      const shouldStream = (GatewayClient as any).shouldStream as (headers: Record<string, string>) => boolean;

      expect(
        shouldStream({
          'content-type': 'application/json',
          'content-length': String(2 * 1024 * 1024),
        })
      ).toBe(true);
    });
  });

  describe('message handling', () => {
    beforeEach(() => {
      client = new GatewayClient(mockConfig);
      client.connect();
    });

    it('handles register_result success message', () => {
      const mockWs = (client as any).ws;
      const message = {
        type: 'register_result',
        success: true,
        backendId: 'backend-123'
      };

      // Simulate receiving message
      const openHandler = mockWs.on.mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];
      if (openHandler) {
        openHandler(Buffer.from(JSON.stringify(message)));
      }

      expect((client as any).isConnected).toBe(true);
      expect((client as any).backendId).toBe('backend-123');
      expect((client as any).reconnectAttempts).toBe(0);
    });

    it('handles register_result failure message', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockWs = (client as any).ws;
      const message = {
        type: 'register_result',
        success: false,
        error: 'Invalid secret'
      };

      const messageHandler = mockWs.on.mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];
      if (messageHandler) {
        messageHandler(Buffer.from(JSON.stringify(message)));
      }

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('handles backends_list message', () => {
      const mockWs = (client as any).ws;
      const message = {
        type: 'backends_list',
        backends: [
          { backendId: 'backend-1', name: 'Backend 1' },
          { backendId: 'backend-2', name: 'Backend 2' }
        ]
      };

      (client as any).backendId = 'backend-1';

      const messageHandler = mockWs.on.mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];
      if (messageHandler) {
        messageHandler(Buffer.from(JSON.stringify(message)));
      }

      const backends = client.getDiscoveredBackends();
      expect(backends).toHaveLength(2);
      expect(backends[0].isLocal).toBe(true);
      expect(backends[1].isLocal).toBe(false);
    });

    it('handles client_connected message', () => {
      const handler = vi.fn();
      client.onClientConnected(handler);

      const mockWs = (client as any).ws;
      const message = {
        type: 'client_connected',
        clientId: 'client-123'
      };

      const messageHandler = mockWs.on.mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];
      if (messageHandler) {
        messageHandler(Buffer.from(JSON.stringify(message)));
      }

      expect(handler).toHaveBeenCalledWith('client-123');
    });

    it('handles client_disconnected message', () => {
      const handler = vi.fn();
      client.onClientDisconnected(handler);

      const mockWs = (client as any).ws;
      (client as any).authenticatedClients.add('client-123');

      const message = {
        type: 'client_disconnected',
        clientId: 'client-123'
      };

      const messageHandler = mockWs.on.mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];
      if (messageHandler) {
        messageHandler(Buffer.from(JSON.stringify(message)));
      }

      expect(handler).toHaveBeenCalledWith('client-123');
      expect((client as any).authenticatedClients.has('client-123')).toBe(false);
    });

    it('handles client_auth message and authenticates client', () => {
      const mockWs = (client as any).ws;
      mockWs.readyState = WebSocket.OPEN;

      const message = {
        type: 'client_auth',
        clientId: 'client-456'
      };

      const messageHandler = mockWs.on.mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];
      if (messageHandler) {
        messageHandler(Buffer.from(JSON.stringify(message)));
      }

      expect((client as any).authenticatedClients.has('client-456')).toBe(true);
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('client_auth_result')
      );
    });

    it('rejects messages from unauthenticated clients', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockWs = (client as any).ws;
      mockWs.readyState = WebSocket.OPEN;

      const message = {
        type: 'forwarded',
        clientId: 'unauthenticated-client',
        message: { type: 'test' }
      };

      const messageHandler = mockWs.on.mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];
      if (messageHandler) {
        messageHandler(Buffer.from(JSON.stringify(message)));
      }

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Rejecting message from unauthenticated client')
      );
      consoleLogSpy.mockRestore();
    });

    it('forwards messages from authenticated clients to handler', async () => {
      const messageHandler = vi.fn().mockResolvedValue({ type: 'response' });
      client.onMessage(messageHandler);

      const mockWs = (client as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (client as any).authenticatedClients.add('client-789');

      const message = {
        type: 'forwarded',
        clientId: 'client-789',
        message: { type: 'test_request' }
      };

      const handler = mockWs.on.mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];
      if (handler) {
        handler(Buffer.from(JSON.stringify(message)));
      }

      // Wait for async handler
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(messageHandler).toHaveBeenCalledWith('client-789', { type: 'test_request' });
    });

    it('handles invalid JSON message gracefully', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockWs = (client as any).ws;

      const messageHandler = mockWs.on.mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];
      if (messageHandler) {
        messageHandler(Buffer.from('invalid json'));
      }

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('reconnection logic', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      client = new GatewayClient(mockConfig);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('schedules reconnect with exponential backoff', () => {
      client.connect();
      const mockWs = (client as any).ws;

      // Simulate close event (not code 4000)
      const closeHandler = mockWs.on.mock.calls.find(
        (call: any[]) => call[0] === 'close'
      )?.[1];
      if (closeHandler) {
        closeHandler(1000);
      }

      expect((client as any).reconnectTimeout).not.toBeNull();
      expect((client as any).reconnectAttempts).toBe(1);
    });

    it('does not reconnect after code 4000 (replaced)', () => {
      client.connect();
      const mockWs = (client as any).ws;

      const closeHandler = mockWs.on.mock.calls.find(
        (call: any[]) => call[0] === 'close'
      )?.[1];
      if (closeHandler) {
        closeHandler(4000);
      }

      expect((client as any).reconnectTimeout).toBeNull();
    });

    it('does not reconnect after intentional disconnect', () => {
      client.connect();
      const mockWs = (client as any).ws;

      // Get the close handler before disconnect
      const closeHandler = mockWs.on.mock.calls.find(
        (call: any[]) => call[0] === 'close'
      )?.[1];

      // Now disconnect
      client.disconnect();

      // Even if close event fires after disconnect, should not schedule reconnect
      if (closeHandler) {
        closeHandler(1000);
      }

      expect((client as any).reconnectTimeout).toBeNull();
    });

    it('prevents duplicate reconnect scheduling', () => {
      client.connect();
      const mockWs = (client as any).ws;

      // Trigger first close to schedule reconnect
      const closeHandler = mockWs.on.mock.calls.find(
        (call: any[]) => call[0] === 'close'
      )?.[1];
      if (closeHandler) {
        closeHandler(1000);
      }

      const firstTimeout = (client as any).reconnectTimeout;
      expect(firstTimeout).not.toBeNull();

      // Try to trigger another close - should not schedule another reconnect
      if (closeHandler) {
        closeHandler(1000);
      }

      // Should still be the same timeout (not replaced)
      expect((client as any).reconnectTimeout).toBe(firstTimeout);
    });

    it('caps reconnect interval at max interval', () => {
      (client as any).reconnectAttempts = 10;

      (client as any).scheduleReconnect();

      // Should be capped at 60000ms
      const delay = (client as any).reconnectMaxInterval;
      expect(delay).toBe(60000);
    });
  });

  describe('session broadcasting', () => {
    it('broadcasts session event when connected', () => {
      // Setup mock db with prepare().get() chain
      const mockGet = vi.fn().mockReturnValue({ lastMessageOffset: 5 });
      mockDb.prepare = vi.fn().mockReturnValue({ get: mockGet });

      client = new GatewayClient(mockConfig, mockDb, mockActiveRuns);
      client.connect();
      const mockWs = (client as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (client as any).backendId = 'backend-123';

      client.broadcastSessionEvent('created', { id: 'session-1', name: 'Test' });

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('broadcast_session_event')
      );
    });

    it('does not broadcast session event when disconnected', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      client = new GatewayClient(mockConfig);
      (client as any).ws = null;

      client.broadcastSessionEvent('created', { id: 'session-1' });

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('broadcasts sessions list on client subscribed', () => {
      mockDb.prepare = vi.fn().mockReturnValue({
        all: () => [{ id: 'session-1', projectId: 'proj-1', name: 'Test' }]
      });

      client = new GatewayClient(mockConfig, mockDb, mockActiveRuns);
      client.connect();
      const mockWs = (client as any).ws;
      mockWs.readyState = WebSocket.OPEN;

      const message = {
        type: 'client_subscribed',
        clientId: 'client-123'
      };

      const messageHandler = mockWs.on.mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];
      if (messageHandler) {
        messageHandler(Buffer.from(JSON.stringify(message)));
      }

      expect(mockWs.send).toHaveBeenCalled();
    });
  });

  describe('additional content type handling', () => {
    it('handles empty content-type header', () => {
      const shouldStream = (GatewayClient as any).shouldStream as (headers: Record<string, string>) => boolean;

      expect(shouldStream({})).toBe(false);
      expect(shouldStream({ 'content-type': '' })).toBe(false);
    });

    it('handles content-type with charset and other params', () => {
      const shouldStream = (GatewayClient as any).shouldStream as (headers: Record<string, string>) => boolean;

      expect(shouldStream({ 'content-type': 'text/html; charset=utf-8' })).toBe(false);
      expect(shouldStream({ 'content-type': 'application/json; charset=utf-8' })).toBe(false);
    });

    it('handles javascript content types', () => {
      const shouldStream = (GatewayClient as any).shouldStream as (headers: Record<string, string>) => boolean;

      expect(shouldStream({ 'content-type': 'application/javascript' })).toBe(false);
      expect(shouldStream({ 'content-type': 'text/javascript' })).toBe(false);
    });

    it('handles form-urlencoded content type', () => {
      const shouldStream = (GatewayClient as any).shouldStream as (headers: Record<string, string>) => boolean;

      expect(shouldStream({ 'content-type': 'application/x-www-form-urlencoded' })).toBe(false);
    });

    it('handles graphql response content type', () => {
      const shouldStream = (GatewayClient as any).shouldStream as (headers: Record<string, string>) => boolean;

      expect(shouldStream({ 'content-type': 'application/graphql-response+json' })).toBe(false);
    });

    it('streams unknown content types', () => {
      const shouldStream = (GatewayClient as any).shouldStream as (headers: Record<string, string>) => boolean;

      expect(shouldStream({ 'content-type': 'application/unknown' })).toBe(true);
      expect(shouldStream({ 'content-type': 'video/mp4' })).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles close without existing WebSocket', () => {
      client = new GatewayClient(mockConfig);
      (client as any).ws = null;

      // Should not throw
      client.disconnect();
    });

    it('handles sendToClient with null WebSocket', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      client = new GatewayClient(mockConfig);
      (client as any).ws = null;

      client.sendToClient('client-123', { type: 'test' } as any);

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('handles broadcast with null WebSocket', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      client = new GatewayClient(mockConfig);
      (client as any).ws = null;

      client.broadcast({ type: 'test' } as any);

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('handles message handler error gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const errorHandler = vi.fn().mockRejectedValue(new Error('Handler error'));
      client = new GatewayClient(mockConfig);
      client.onMessage(errorHandler);
      client.connect();

      const mockWs = (client as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (client as any).authenticatedClients.add('client-error');

      const message = {
        type: 'forwarded',
        clientId: 'client-error',
        message: { type: 'test' }
      };

      const handler = mockWs.on.mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];
      if (handler) {
        handler(Buffer.from(JSON.stringify(message)));
      }

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });
});
