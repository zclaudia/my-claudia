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
});
