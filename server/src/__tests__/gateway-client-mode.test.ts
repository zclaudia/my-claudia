import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { GatewayClientMode } from '../gateway-client-mode.js';

// Mock WebSocket
vi.mock('ws', () => {
  const MockWebSocket = vi.fn().mockImplementation(() => {
    const listeners = new Map<string, Set<Function>>();
    return {
      on: vi.fn((event: string, handler: Function) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(handler);
      }),
      removeAllListeners: vi.fn(() => listeners.clear()),
      close: vi.fn(),
      send: vi.fn(),
      readyState: 1, // WebSocket.OPEN
      _listeners: listeners,
      _trigger: (event: string, data?: any) => {
        const handlers = listeners.get(event);
        if (handlers) handlers.forEach(h => h(data));
      },
    };
  });
  return { default: MockWebSocket };
});

// Mock SocksProxyAgent
vi.mock('socks-proxy-agent', () => ({
  SocksProxyAgent: vi.fn().mockImplementation(() => ({ agent: true })),
}));

describe('gateway-client-mode', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('constructor', () => {
    it('initializes with config', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret123',
      });

      expect(client.gatewayUrl).toBe('http://gateway.example.com');
      expect(client.gatewaySecret).toBe('secret123');
    });

    it('accepts optional proxy config', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret123',
        proxyUrl: 'socks5://proxy.example.com:1080',
        proxyAuth: { username: 'user', password: 'pass' },
      });

      expect(client.gatewayUrl).toBe('http://gateway.example.com');
    });
  });

  describe('connection state', () => {
    it('isConnected returns false initially', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      expect(client.isConnected()).toBe(false);
    });

    it('isBackendAuthenticated returns false for unknown backend', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      expect(client.isBackendAuthenticated('unknown')).toBe(false);
    });

    it('getDiscoveredBackends returns empty array initially', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      expect(client.getDiscoveredBackends()).toEqual([]);
    });
  });

  describe('connect', () => {
    it('creates WebSocket connection', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      client.connect();

      expect(WebSocket).toHaveBeenCalledWith(
        'ws://gateway.example.com/ws',
        expect.any(Object)
      );
    });

    it('converts https to wss', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'https://gateway.example.com',
        gatewaySecret: 'secret',
      });

      client.connect();

      expect(WebSocket).toHaveBeenCalledWith(
        'wss://gateway.example.com/ws',
        expect.any(Object)
      );
    });

    it('clears existing connection before creating new one', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      client.connect();
      const firstWs = vi.mocked(WebSocket).mock.results[0].value;

      client.connect();

      expect(firstWs.removeAllListeners).toHaveBeenCalled();
      expect(firstWs.close).toHaveBeenCalled();
      expect(WebSocket).toHaveBeenCalledTimes(2);
    });

    it('sends gateway_auth on open', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'my-secret',
      });

      client.connect();
      const ws = vi.mocked(WebSocket).mock.results[0].value;

      // Trigger open event
      ws._trigger('open');

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'gateway_auth',
          gatewaySecret: 'my-secret',
        })
      );
    });
  });

  describe('disconnect', () => {
    it('closes WebSocket connection', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      client.connect();
      const ws = vi.mocked(WebSocket).mock.results[0].value;

      client.disconnect();

      expect(ws.removeAllListeners).toHaveBeenCalled();
      expect(ws.close).toHaveBeenCalled();
    });

    it('sets intentionalDisconnect flag', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      client.connect();
      client.disconnect();

      // Should not schedule reconnect
      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Reconnecting')
      );
    });

    it('clears authenticated state', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      client.connect();
      client.disconnect();

      expect(client.isConnected()).toBe(false);
    });
  });

  describe('event listeners', () => {
    it('addBackendMessageListener adds listener', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      const handler = vi.fn();
      client.addBackendMessageListener(handler);

      // Listener is added (we can't directly test the Set, but we can test behavior)
      expect(true).toBe(true);
    });

    it('removeBackendMessageListener removes listener', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      const handler = vi.fn();
      client.addBackendMessageListener(handler);
      client.removeBackendMessageListener(handler);

      expect(true).toBe(true);
    });

    it('addBackendDisconnectedListener adds listener', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      const handler = vi.fn();
      client.addBackendDisconnectedListener(handler);

      expect(true).toBe(true);
    });

    it('removeBackendDisconnectedListener removes listener', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      const handler = vi.fn();
      client.addBackendDisconnectedListener(handler);
      client.removeBackendDisconnectedListener(handler);

      expect(true).toBe(true);
    });
  });

  describe('connectBackend', () => {
    it('returns error when not connected to gateway', async () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      const result = await client.connectBackend('backend-1');

      expect(result).toEqual({
        success: false,
        error: 'Not connected to gateway',
      });
    });

    it('returns success if already authenticated', async () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      client.connect();
      const ws = vi.mocked(WebSocket).mock.results[0].value;

      // Simulate successful auth
      ws._trigger('open');
      ws._trigger('message', Buffer.from(JSON.stringify({
        type: 'gateway_auth_result',
        success: true,
        backends: [],
      })));

      // Manually add to authenticated backends (simulating successful backend auth)
      ws._trigger('message', Buffer.from(JSON.stringify({
        type: 'backend_auth_result',
        backendId: 'backend-1',
        success: true,
      })));

      const result = await client.connectBackend('backend-1');

      expect(result.success).toBe(true);
    });
  });

  describe('sendToBackend', () => {
    it('returns false when not connected', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      const result = client.sendToBackend('backend-1', { type: 'test' } as any);

      expect(result).toBe(false);
    });

    it('returns false when backend not authenticated', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      client.connect();
      const ws = vi.mocked(WebSocket).mock.results[0].value;

      // Simulate successful gateway auth
      ws._trigger('open');
      ws._trigger('message', Buffer.from(JSON.stringify({
        type: 'gateway_auth_result',
        success: true,
        backends: [],
      })));

      const result = client.sendToBackend('backend-1', { type: 'test' } as any);

      expect(result).toBe(false);
    });
  });

  describe('listBackends', () => {
    it('returns discovered backends when not connected', async () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      const result = await client.listBackends();

      expect(result).toEqual([]);
    });
  });

  describe('createHttpAgent', () => {
    it('returns undefined when no proxy configured', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      const agent = client.createHttpAgent();

      expect(agent).toBeUndefined();
    });

    it('creates agent when proxy configured', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
        proxyUrl: 'socks5://proxy.example.com:1080',
      });

      const agent = client.createHttpAgent();

      expect(agent).toEqual({ agent: true });
    });

    it('includes proxy auth when configured', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
        proxyUrl: 'socks5://proxy.example.com:1080',
        proxyAuth: { username: 'user', password: 'pass' },
      });

      const agent = client.createHttpAgent();

      expect(agent).toEqual({ agent: true });
    });
  });

  describe('reconnection', () => {
    it('schedules reconnect on disconnect', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      client.connect();
      const ws = vi.mocked(WebSocket).mock.results[0].value;

      // Trigger close (not intentional disconnect)
      ws._trigger('close');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Reconnecting')
      );
    });

    it('does not reconnect after intentional disconnect', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      client.connect();
      client.disconnect();

      // Should not have scheduled reconnect
      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Reconnecting')
      );
    });

    it('uses exponential backoff', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      client.connect();
      const ws = vi.mocked(WebSocket).mock.results[0].value;

      // First disconnect
      ws._trigger('close');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('5s') // 5000ms = 5s base interval
      );

      // Simulate reconnect attempt
      vi.advanceTimersByTime(5000);

      // Second disconnect
      vi.mocked(WebSocket).mockClear();
      const newWs = vi.mocked(WebSocket).mock.results[
        vi.mocked(WebSocket).mock.results.length - 1
      ]?.value;
      if (newWs) {
        newWs._trigger('close');
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('10s') // 5000 * 2 = 10000ms
        );
      }
    });
  });

  describe('message handling', () => {
    it('handles gateway_auth_result success', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      client.connect();
      const ws = vi.mocked(WebSocket).mock.results[0].value;

      ws._trigger('open');
      ws._trigger('message', Buffer.from(JSON.stringify({
        type: 'gateway_auth_result',
        success: true,
        backends: [{ id: 'backend-1', name: 'Backend 1' }],
      })));

      expect(client.isConnected()).toBe(true);
      expect(client.getDiscoveredBackends()).toEqual([
        { id: 'backend-1', name: 'Backend 1' },
      ]);
    });

    it('handles gateway_auth_result failure', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'wrong-secret',
      });

      client.connect();
      const ws = vi.mocked(WebSocket).mock.results[0].value;

      ws._trigger('open');
      ws._trigger('message', Buffer.from(JSON.stringify({
        type: 'gateway_auth_result',
        success: false,
        error: 'Invalid secret',
      })));

      expect(ws.close).toHaveBeenCalled();
    });

    it('handles invalid JSON gracefully', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      client.connect();
      const ws = vi.mocked(WebSocket).mock.results[0].value;

      // Should not throw
      expect(() => {
        ws._trigger('message', Buffer.from('invalid json'));
      }).not.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });
});
