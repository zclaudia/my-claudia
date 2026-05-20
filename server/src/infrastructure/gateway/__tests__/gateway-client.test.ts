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
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    randomUUID: vi.fn().mockReturnValue('test-uuid-123'),
    createHash: actual.createHash,
  };
});

// Mock run-state utility
vi.mock('../../../utils/run-state.js', () => ({
  hasForegroundActiveRunForSession: vi.fn().mockReturnValue(false),
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

    it('exposes CQE interface properties', () => {
      client = new GatewayClient(mockConfig);
      expect(client.commands).toBeDefined();
      expect(client.commands.connection).toBeDefined();
      expect(client.commands.channel).toBeDefined();
      expect(client.commands.backendData).toBeDefined();
      expect(client.commands.stream).toBeDefined();
      expect(client.queries).toBeDefined();
      expect(client.queries.identity).toBeDefined();
      expect(client.queries.connection).toBeDefined();
      expect(client.queries.registry).toBeDefined();
      expect(client.events).toBeDefined();
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

    it('clears connection state', () => {
      (client as any).isConnected = true;
      (client as any).backendId = 'test-backend';
      (client as any).epoch = 1;

      client.disconnect();

      expect((client as any).isConnected).toBe(false);
      expect((client as any).backendId).toBeNull();
      expect((client as any).epoch).toBeNull();
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

    it('getDiscoveredBackends returns visible backends from registry', () => {
      (client as any).registryItems.set('backend-1', {
        backendId: 'backend-1',
        instanceId: 'instance-1',
        deviceId: 'device-1',
        channel: 'prod',
        name: 'Backend 1',
        visible: true,
      });
      (client as any).registryItems.set('backend-2', {
        backendId: 'backend-2',
        instanceId: 'instance-2',
        deviceId: 'device-2',
        channel: 'prod',
        name: 'Backend 2',
        visible: true,
      });

      const backends = client.getDiscoveredBackends();
      expect(backends).toHaveLength(2);
      expect(backends.map(b => b.backendId)).toEqual(['backend-1', 'backend-2']);
    });

    it('isGatewayConnected returns connection status', () => {
      (client as any).isConnected = true;

      expect(client.isGatewayConnected()).toBe(true);

      (client as any).isConnected = false;

      expect(client.isGatewayConnected()).toBe(false);
    });

    it('queries.identity.getBackendId returns backendId', () => {
      (client as any).backendId = 'test-backend-id';
      expect(client.queries.identity.getBackendId()).toBe('test-backend-id');
    });

    it('queries.connection.isConnected returns connection status', () => {
      (client as any).isConnected = true;
      expect(client.queries.connection.isConnected()).toBe(true);
    });

    it('queries.registry.getDiscoveredBackends returns backends list', () => {
      (client as any).registryItems.set('backend-1', {
        backendId: 'backend-1', instanceId: 'i1', deviceId: 'd1',
        channel: 'prod', name: 'B1', visible: true,
      });
      expect(client.queries.registry.getDiscoveredBackends()).toHaveLength(1);
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

    it('handles peer_ready success message', () => {
      const mockWs = (client as any).ws;
      const message = {
        type: 'peer_ready',
        peerSessionId: 'session-abc',
        recoveryToken: 'token-123',
        backend: {
          backendId: 'backend-123',
          epoch: 1,
        },
        registrySync: {
          mode: 'snapshot',
          revision: 1,
          items: [
            {
              backendId: 'backend-123',
              instanceId: 'inst-1',
              deviceId: 'dev-1',
              channel: 'prod',
              name: 'Backend 1',
              visible: true,
              online: true,
            },
          ],
        },
      };

      const messageHandler = mockWs.on.mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];
      if (messageHandler) {
        messageHandler(Buffer.from(JSON.stringify(message)));
      }

      expect((client as any).isConnected).toBe(true);
      expect((client as any).peerSessionId).toBe('session-abc');
      expect((client as any).backendId).toBe('backend-123');
      expect((client as any).epoch).toBe(1);
      expect((client as any).reconnectAttempts).toBe(0);
      expect(client.getDiscoveredBackends()).toHaveLength(1);
    });

    it('handles registry_snapshot message', () => {
      const mockWs = (client as any).ws;
      (client as any).backendId = 'backend-1';

      const messageHandler = mockWs.on.mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];

      messageHandler?.(Buffer.from(JSON.stringify({
        type: 'registry_snapshot',
        revision: 2,
        items: [
          {
            backendId: 'backend-1',
            instanceId: 'instance-1',
            deviceId: 'device-1',
            channel: 'prod',
            name: 'Backend 1',
            visible: true,
          },
          {
            backendId: 'backend-2',
            instanceId: 'instance-2',
            deviceId: 'device-2',
            channel: 'prod',
            name: 'Backend 2',
            visible: true,
          }
        ]
      })));

      expect((client as any).registryItems.size).toBe(2);
      expect(client.getDiscoveredBackends()).toHaveLength(2);
    });

    it('clears connection state when websocket closes', () => {
      const mockWs = (client as any).ws;
      (client as any).isConnected = true;
      (client as any).backendId = 'backend-123';
      (client as any).epoch = 1;

      const closeHandler = mockWs.on.mock.calls.find(
        (call: any[]) => call[0] === 'close'
      )?.[1];

      closeHandler?.(1006);

      expect((client as any).isConnected).toBe(false);
      expect((client as any).backendId).toBeNull();
      expect((client as any).epoch).toBeNull();
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

    it('sends session_content_patch_error when catch-up query fails', async () => {
      const sendWsSpy = vi.spyOn(client as any, 'sendWs').mockImplementation(() => {});

      client.commands.channel.onCatchUp(async () => {
        throw new Error('catch-up query failed');
      });

      await (client as any).handleCatchUpRequest({
        type: 'catch_up_session_content',
        backendId: 'backend-1',
        sessionId: 'session-1',
        afterOffset: 7,
      });

      expect(sendWsSpy).toHaveBeenCalledWith(expect.objectContaining({
        type: 'session_content_patch_error',
        backendId: 'backend-1',
        sessionId: 'session-1',
        afterOffset: 7,
        message: 'catch-up query failed',
      }));
    });

    it('removes backend from subscribedBackends on unsubscribed event', () => {
      const onOutgoingBackendUnsubscribed = vi.fn();
      client.events.setOutgoingEvents({ onOutgoingBackendUnsubscribed });
      (client as any).backendId = 'local-backend';

      // Simulate a subscribed backend
      (client as any).subscribedBackends.add('remote-backend');

      (client as any).handleBackendUnsubscribed({
        type: 'backend_unsubscribed',
        backendId: 'remote-backend',
        reason: 'peer_closed',
      });

      expect((client as any).subscribedBackends.has('remote-backend')).toBe(false);
      expect(onOutgoingBackendUnsubscribed).toHaveBeenCalledWith('remote-backend', 'peer_closed');
    });

    it('forwards all outgoing backend data messages to event handlers', () => {
      const onOutgoingBackendDataSnapshot = vi.fn();
      const onOutgoingBackendDataEvent = vi.fn();
      client.events.setOutgoingEvents({
        onOutgoingBackendDataSnapshot,
        onOutgoingBackendDataEvent,
      });

      (client as any).handleOutgoingBackendDataSnapshot({
        type: 'backend_data_snapshot',
        backendId: 'remote-backend',
        sessions: [],
        projects: [],
      });
      (client as any).handleOutgoingBackendDataEvent({
        type: 'backend_data_event',
        backendId: 'remote-backend',
        op: 'session_remove',
        sessionId: 'session-1',
      });

      expect(onOutgoingBackendDataSnapshot).toHaveBeenCalledWith('remote-backend', [], []);
      expect(onOutgoingBackendDataEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'backend_data_event',
        op: 'session_remove',
        sessionId: 'session-1',
      }));
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

    it('schedules reconnect when the websocket errors without a close event', () => {
      client.connect();
      const mockWs = (client as any).ws;

      const errorHandler = mockWs.on.mock.calls.find(
        (call: any[]) => call[0] === 'error'
      )?.[1];
      errorHandler?.(new Error('proxy unavailable'));

      expect((client as any).reconnectTimeout).not.toBeNull();
      expect((client as any).reconnectAttempts).toBe(1);
    });

    it('schedules reconnect when the connection attempt never opens or closes', () => {
      client.connect();

      vi.advanceTimersByTime((client as any).connectTimeoutMs);

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

    it('caps reconnect interval at max interval', () => {
      (client as any).reconnectAttempts = 10;

      (client as any).scheduleReconnect();

      // Should be capped at 60000ms
      const delay = (client as any).reconnectMaxInterval;
      expect(delay).toBe(60000);
    });
  });

  describe('session broadcasting via catalog', () => {
    it('publishes catalog snapshot when connected with db', () => {
      // Setup mock db with prepare().all() chain
      const mockAll = vi.fn().mockReturnValue([{ id: 'session-1', name: 'Test', createdAt: 1, updatedAt: 1, lastMessageOffset: 5 }]);
      mockDb.prepare = vi.fn().mockReturnValue({ all: mockAll });

      client = new GatewayClient(mockConfig, mockDb, mockActiveRuns);
      client.connect();
      const mockWs = (client as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (client as any).backendId = 'backend-123';
      (client as any).epoch = 1;
      (client as any).isConnected = true;

      client.commands.backendData.publishSnapshot();

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('backend_data_snapshot')
      );
    });

    it('broadcastSessionEvent publishes backend data event', () => {
      client = new GatewayClient(mockConfig);
      client.connect();
      const mockWs = (client as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (client as any).backendId = 'backend-123';
      (client as any).epoch = 1;
      (client as any).isConnected = true;

      client.commands.backendData.broadcastSessionEvent('created', { id: 'session-1', name: 'Test' });

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('backend_data_event')
      );
    });

    it('broadcastSessionEvent removes archived sessions', () => {
      client = new GatewayClient(mockConfig);
      client.connect();
      const mockWs = (client as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (client as any).backendId = 'backend-123';
      (client as any).epoch = 1;
      (client as any).isConnected = true;

      client.commands.backendData.broadcastSessionEvent('updated', {
        id: 'session-1',
        name: 'Archived Session',
        archivedAt: Date.now(),
      });

      const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sent).toMatchObject({
        type: 'backend_data_event',
        op: 'session_remove',
        sessionId: 'session-1',
      });
    });

    it('broadcastProjectEvent publishes project upsert events', () => {
      client = new GatewayClient(mockConfig);
      client.connect();
      const mockWs = (client as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (client as any).backendId = 'backend-123';
      (client as any).epoch = 1;
      (client as any).isConnected = true;

      client.commands.backendData.broadcastProjectEvent('updated', {
        id: 'project-1',
        name: 'Project One',
        createdAt: 1,
        updatedAt: 2,
      });

      const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sent).toMatchObject({
        type: 'backend_data_event',
        op: 'project_upsert',
        item: {
          projectId: 'project-1',
          name: 'Project One',
          createdAt: 1,
          updatedAt: 2,
        },
      });
    });

    it('broadcastProjectEvent publishes project remove events', () => {
      client = new GatewayClient(mockConfig);
      client.connect();
      const mockWs = (client as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (client as any).backendId = 'backend-123';
      (client as any).epoch = 1;
      (client as any).isConnected = true;

      client.commands.backendData.broadcastProjectEvent('deleted', { id: 'project-1' });

      const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sent).toMatchObject({
        type: 'backend_data_event',
        op: 'project_remove',
        projectId: 'project-1',
      });
    });

    it('does not publish catalog event when disconnected', () => {
      client = new GatewayClient(mockConfig);
      (client as any).ws = null;
      (client as any).isConnected = false;

      // Should not throw
      client.broadcastSessionEvent('created', { id: 'session-1' });
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

    it('handles sendToChannel with null WebSocket', () => {
      client = new GatewayClient(mockConfig);
      (client as any).ws = null;

      // Should not throw
      client.sendToChannel('channel-1', { type: 'test' } as any);
    });

    it('sends a targeted state heartbeat alongside snapshot requests for late subscribers', () => {
      const getStateHeartbeat = vi.fn(() => ({
        type: 'state_heartbeat',
        activeRuns: [],
        pendingPermissions: [],
        pendingQuestions: [],
      }));
      client = new GatewayClient({ ...mockConfig, getStateHeartbeat }, mockDb, mockActiveRuns);
      const ws = {
        send: vi.fn(),
        readyState: 1,
        removeAllListeners: vi.fn(),
        close: vi.fn(),
      };
      (client as any).ws = ws;
      (client as any).isConnected = true;
      (client as any).epoch = 1;
      (client as any).backendId = 'local-backend';

      const now = Date.now();
      mockDb.prepare = vi.fn()
        .mockReturnValueOnce({
          all: vi.fn(() => [{
            id: 'session-1',
            name: 'Session 1',
            projectId: 'project-1',
            createdAt: now,
            updatedAt: now,
          }]),
        })
        .mockReturnValueOnce({
          all: vi.fn(() => [{
            id: 'project-1',
            name: 'Project 1',
            createdAt: now,
            updatedAt: now,
          }]),
        });

      client.publishBackendDataSnapshot('peer-session-1');

      expect(getStateHeartbeat).toHaveBeenCalledTimes(1);
      expect(ws.send).toHaveBeenCalledTimes(2);
      expect(JSON.parse(ws.send.mock.calls[0][0])).toMatchObject({
        type: 'backend_data_snapshot',
      });
      expect(JSON.parse(ws.send.mock.calls[1][0])).toMatchObject({
        type: 'backend_server_message',
        backendId: 'local-backend',
        targetPeerSessionId: 'peer-session-1',
        message: {
          type: 'state_heartbeat',
          pendingQuestions: [],
        },
      });
    });
  });
});
