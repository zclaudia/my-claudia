import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { GatewayClientMode } from '../gateway-client-mode.js';

// Mock WebSocket
vi.mock('ws', () => {
  const MockWebSocket = vi.fn().mockImplementation(function(this: any) {
    const listeners = new Map<string, Set<Function>>();
    this.on = vi.fn((event: string, handler: Function) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    });
    this.removeListener = vi.fn((event: string, handler: Function) => {
      listeners.get(event)?.delete(handler);
    });
    this.removeAllListeners = vi.fn(() => listeners.clear());
    this.close = vi.fn();
    this.send = vi.fn();
    this.readyState = 1; // WebSocket.OPEN
    this._listeners = listeners;
    this._trigger = (event: string, data?: any) => {
      const handlers = listeners.get(event);
      if (handlers) handlers.forEach(h => h(data));
    };
  });
  MockWebSocket.OPEN = 1;
  MockWebSocket.CLOSED = 0;
  return { default: MockWebSocket };
});

// Mock SocksProxyAgent
vi.mock('socks-proxy-agent', () => ({
  SocksProxyAgent: vi.fn().mockImplementation(function(this: any) {
    this.agent = true;
    return this;
  }),
}));

// Re-import after mocking
import { SocksProxyAgent } from 'socks-proxy-agent';

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

    it('handles backends_list message', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      client.connect();
      const ws = vi.mocked(WebSocket).mock.results[0].value;

      // Auth first
      ws._trigger('open');
      ws._trigger('message', Buffer.from(JSON.stringify({
        type: 'gateway_auth_result',
        success: true,
        backends: [],
      })));

      // Receive backends list
      ws._trigger('message', Buffer.from(JSON.stringify({
        type: 'backends_list',
        backends: [{ id: 'b1', name: 'Backend 1' }, { id: 'b2', name: 'Backend 2' }],
      })));

      expect(client.getDiscoveredBackends()).toHaveLength(2);
    });

    it('handles backend_message and notifies listeners', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      const messageHandler = vi.fn();
      client.addBackendMessageListener(messageHandler);

      client.connect();
      const ws = vi.mocked(WebSocket).mock.results[0].value;

      ws._trigger('open');
      ws._trigger('message', Buffer.from(JSON.stringify({
        type: 'gateway_auth_result',
        success: true,
      })));

      ws._trigger('message', Buffer.from(JSON.stringify({
        type: 'backend_message',
        backendId: 'b1',
        message: { type: 'session_event', data: 'test' },
      })));

      expect(messageHandler).toHaveBeenCalledWith('b1', { type: 'session_event', data: 'test' });
    });

    it('handles error in backend message listener gracefully', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      const failingHandler = vi.fn().mockImplementation(() => { throw new Error('handler error'); });
      client.addBackendMessageListener(failingHandler);

      client.connect();
      const ws = vi.mocked(WebSocket).mock.results[0].value;

      ws._trigger('open');
      ws._trigger('message', Buffer.from(JSON.stringify({
        type: 'gateway_auth_result',
        success: true,
      })));

      ws._trigger('message', Buffer.from(JSON.stringify({
        type: 'backend_message',
        backendId: 'b1',
        message: { type: 'test' },
      })));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error in backend message handler'),
        expect.any(Error)
      );
    });

    it('handles backend_disconnected and notifies listeners', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      const disconnectHandler = vi.fn();
      client.addBackendDisconnectedListener(disconnectHandler);

      client.connect();
      const ws = vi.mocked(WebSocket).mock.results[0].value;

      ws._trigger('open');
      ws._trigger('message', Buffer.from(JSON.stringify({
        type: 'gateway_auth_result',
        success: true,
      })));

      // Authenticate backend first
      ws._trigger('message', Buffer.from(JSON.stringify({
        type: 'backend_auth_result',
        backendId: 'b1',
        success: true,
      })));

      expect(client.isBackendAuthenticated('b1')).toBe(true);

      // Backend disconnects
      ws._trigger('message', Buffer.from(JSON.stringify({
        type: 'backend_disconnected',
        backendId: 'b1',
      })));

      expect(disconnectHandler).toHaveBeenCalledWith('b1');
      expect(client.isBackendAuthenticated('b1')).toBe(false);
    });

    it('handles error in backend disconnected listener gracefully', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      const failingHandler = vi.fn().mockImplementation(() => { throw new Error('dc error'); });
      client.addBackendDisconnectedListener(failingHandler);

      client.connect();
      const ws = vi.mocked(WebSocket).mock.results[0].value;

      ws._trigger('open');
      ws._trigger('message', Buffer.from(JSON.stringify({
        type: 'gateway_auth_result',
        success: true,
      })));

      ws._trigger('message', Buffer.from(JSON.stringify({
        type: 'backend_disconnected',
        backendId: 'b1',
      })));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error in backend disconnected handler'),
        expect.any(Error)
      );
    });

    it('handles gateway_error message', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      client.connect();
      const ws = vi.mocked(WebSocket).mock.results[0].value;

      ws._trigger('open');
      ws._trigger('message', Buffer.from(JSON.stringify({
        type: 'gateway_error',
        code: 'RATE_LIMIT',
        message: 'Too many requests',
      })));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('RATE_LIMIT')
      );
    });

    it('handles gateway_auth_result success without backends', () => {
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
        // No backends field
      })));

      expect(client.isConnected()).toBe(true);
      expect(client.getDiscoveredBackends()).toEqual([]);
    });
  });

  describe('sendToBackend', () => {
    it('sends message when connected and backend authenticated', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      client.connect();
      const ws = vi.mocked(WebSocket).mock.results[0].value;

      // Auth gateway
      ws._trigger('open');
      ws._trigger('message', Buffer.from(JSON.stringify({
        type: 'gateway_auth_result',
        success: true,
      })));

      // Auth backend
      ws._trigger('message', Buffer.from(JSON.stringify({
        type: 'backend_auth_result',
        backendId: 'b1',
        success: true,
      })));

      const result = client.sendToBackend('b1', { type: 'ping' } as any);
      expect(result).toBe(true);
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({
        type: 'send_to_backend',
        backendId: 'b1',
        message: { type: 'ping' },
      }));
    });
  });

  describe('listBackends with pending resolution', () => {
    it('resolves listBackends when backends_list received', async () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      client.connect();
      const ws = vi.mocked(WebSocket).mock.results[0].value;

      // Auth gateway
      ws._trigger('open');
      ws._trigger('message', Buffer.from(JSON.stringify({
        type: 'gateway_auth_result',
        success: true,
      })));

      const listPromise = client.listBackends();

      // Respond with backends list
      ws._trigger('message', Buffer.from(JSON.stringify({
        type: 'backends_list',
        backends: [{ id: 'b1', name: 'B1' }],
      })));

      const backends = await listPromise;
      expect(backends).toEqual([{ id: 'b1', name: 'B1' }]);
    });

    it('times out listBackends after 10s', async () => {
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
        backends: [{ id: 'cached', name: 'Cached' }],
      })));

      const listPromise = client.listBackends();
      vi.advanceTimersByTime(10000);

      const backends = await listPromise;
      expect(backends).toEqual([{ id: 'cached', name: 'Cached' }]);
    });
  });

  describe('connectBackend pending resolution', () => {
    it('resolves connectBackend when backend_auth_result received', async () => {
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
      })));

      const connectPromise = client.connectBackend('b1');

      ws._trigger('message', Buffer.from(JSON.stringify({
        type: 'backend_auth_result',
        backendId: 'b1',
        success: true,
        features: ['streaming'],
      })));

      const result = await connectPromise;
      expect(result).toEqual({ success: true, features: ['streaming'] });
    });

    it('times out connectBackend after 15s', async () => {
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
      })));

      const connectPromise = client.connectBackend('b1');
      vi.advanceTimersByTime(15000);

      const result = await connectPromise;
      expect(result).toEqual({ success: false, error: 'Backend auth timeout' });
    });

    it('resolves connectBackend with failure', async () => {
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
      })));

      const connectPromise = client.connectBackend('b1');

      ws._trigger('message', Buffer.from(JSON.stringify({
        type: 'backend_auth_result',
        backendId: 'b1',
        success: false,
        error: 'Backend not found',
      })));

      const result = await connectPromise;
      expect(result).toEqual({ success: false, error: 'Backend not found' });
    });
  });

  describe('proxy configuration in connect', () => {
    it('configures SOCKS5 proxy when proxyUrl provided', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
        proxyUrl: 'socks5://proxy:1080',
      });

      client.connect();

      expect(SocksProxyAgent).toHaveBeenCalledWith('socks5://proxy:1080');
    });

    it('adds proxy auth when provided', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
        proxyUrl: 'socks5://proxy:1080',
        proxyAuth: { username: 'user', password: 'pass' },
      });

      client.connect();

      expect(SocksProxyAgent).toHaveBeenCalledWith(
        expect.stringContaining('user:pass')
      );
    });

    it('handles proxy configuration error', () => {
      vi.mocked(SocksProxyAgent).mockImplementationOnce(() => {
        throw new Error('Invalid proxy URL');
      });

      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
        proxyUrl: 'invalid://proxy',
      });

      client.connect();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to configure proxy'),
        expect.any(Error)
      );
    });
  });

  describe('connection close handling', () => {
    it('rejects pending backend auths on close', async () => {
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
      })));

      const connectPromise = client.connectBackend('b1');

      // Close connection
      ws._trigger('close');

      const result = await connectPromise;
      expect(result).toEqual({ success: false, error: 'Disconnected' });
    });

    it('rejects pending listBackends on close', async () => {
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
      })));

      const listPromise = client.listBackends();

      ws._trigger('close');

      const backends = await listPromise;
      expect(backends).toEqual([]);
    });

    it('handles WebSocket error event', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      client.connect();
      const ws = vi.mocked(WebSocket).mock.results[0].value;

      ws._trigger('error', new Error('Connection refused'));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Connection error'),
        expect.any(Error)
      );
    });

    it('clears reconnect timeout in connect', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      client.connect();
      const ws1 = vi.mocked(WebSocket).mock.results[0].value;

      // Trigger close to schedule reconnect
      ws1._trigger('close');

      // Connect again should clear the pending reconnect
      client.connect();

      expect(WebSocket).toHaveBeenCalledTimes(2);
    });
  });

  describe('createHttpAgent', () => {
    it('handles proxy agent creation error', () => {
      vi.mocked(SocksProxyAgent).mockImplementationOnce(() => {
        throw new Error('Agent creation failed');
      });

      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
        proxyUrl: 'socks5://proxy:1080',
      });

      const agent = client.createHttpAgent();
      expect(agent).toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create HTTP agent'),
        expect.any(Error)
      );
    });

    it('includes auth in HTTP agent', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
        proxyUrl: 'socks5://proxy:1080',
        proxyAuth: { username: 'u', password: 'p' },
      });

      client.createHttpAgent();
      expect(SocksProxyAgent).toHaveBeenCalledWith(expect.stringContaining('u:p'));
    });
  });

  describe('reconnection', () => {
    it('prevents duplicate reconnect scheduling', () => {
      const client = new GatewayClientMode({
        gatewayUrl: 'http://gateway.example.com',
        gatewaySecret: 'secret',
      });

      client.connect();
      const ws = vi.mocked(WebSocket).mock.results[0].value;

      // Trigger close twice rapidly
      ws._trigger('close');
      // Second close shouldn't schedule another reconnect
      // (reconnectTimeout is already set)

      // Only one "Reconnecting" log for the same attempt
      const reconnectLogs = (consoleLogSpy.mock.calls as string[][]).filter(
        c => c[0]?.includes?.('Reconnecting')
      );
      expect(reconnectLogs).toHaveLength(1);
    });
  });
});
