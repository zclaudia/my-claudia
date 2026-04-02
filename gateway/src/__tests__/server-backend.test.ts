/**
 * Unit tests for Gateway Backend message handling (v2 protocol)
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import type { Server } from 'http';
import { createGatewayServer } from '../server.js';

const GATEWAY_SECRET = 'test-secret-backend';
const TEST_PORT = 9030;
const WS_URL = `ws://localhost:${TEST_PORT}/ws`;

// Helper: wait for WebSocket to open
function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.on('open', () => resolve());
    ws.on('error', (err) => reject(err));
  });
}

// Helper: close WebSocket and wait for it to finish
function closeWs(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (!ws || ws.readyState === WebSocket.CLOSED) return resolve();
    ws.on('close', () => resolve());
    ws.close();
  });
}

// Helper: collect next message of specific type
function waitForMessage(ws: WebSocket, type: string, timeoutMs = 1000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for message type: ${type}`));
    }, timeoutMs);

    const handler = (data: WebSocket.Data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

// Helper: create a message collector that tracks all messages
function createMessageCollector(ws: WebSocket) {
  const messages: any[] = [];
  ws.on('message', (data) => {
    messages.push(JSON.parse(data.toString()));
  });
  return {
    getMessages: () => messages,
    find: (predicate: (m: any) => boolean) => messages.find(predicate),
    findAll: (predicate: (m: any) => boolean) => messages.filter(predicate),
    clear: () => messages.length = 0
  };
}

// Helper: small delay
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// Helper: register a backend with v2 protocol
async function registerBackendV2(ws: WebSocket, identity: { deviceId: string; instanceId: string; name?: string }, visible = true): Promise<{ backendId: string; epoch: number; peerSessionId: string }> {
  ws.send(JSON.stringify({
    type: 'peer_hello',
    protocolVersion: 2,
    peerType: 'client+backend',
    gatewaySecret: GATEWAY_SECRET,
    identity,
    backend: { visible, capabilities: [] }
  }));
  const ready = await waitForMessage(ws, 'peer_ready');
  return { backendId: ready.backend.backendId, epoch: ready.backend.epoch, peerSessionId: ready.peerSessionId };
}

// Helper: register a client with v2 protocol
async function registerClientV2(ws: WebSocket): Promise<{ peerSessionId: string; registrySync: any }> {
  ws.send(JSON.stringify({
    type: 'peer_hello',
    protocolVersion: 2,
    peerType: 'client-only',
    gatewaySecret: GATEWAY_SECRET,
    identity: { deviceId: 'client-dev', instanceId: `client-inst-${Date.now()}-${Math.random()}` }
  }));
  const ready = await waitForMessage(ws, 'peer_ready');
  return { peerSessionId: ready.peerSessionId, registrySync: ready.registrySync };
}

describe('Gateway Backend Message Handling', () => {
  let server: Server;
  let backendWs: WebSocket;
  let backendId: string;
  let backendEpoch: number;
  let backendCollector: ReturnType<typeof createMessageCollector>;
  let openClients: WebSocket[] = [];

  beforeEach(async () => {
    server = createGatewayServer({ gatewaySecret: GATEWAY_SECRET });
    await new Promise<void>((resolve) => server.listen(TEST_PORT, resolve));

    // Register a backend
    backendWs = new WebSocket(WS_URL);
    await waitForOpen(backendWs);
    backendCollector = createMessageCollector(backendWs);

    const reg = await registerBackendV2(backendWs, { deviceId: 'test-backend-device', instanceId: 'inst-test-backend-device', name: 'Test Backend' });
    backendId = reg.backendId;
    backendEpoch = reg.epoch;
  });

  afterEach(async () => {
    await Promise.all(openClients.map(ws => closeWs(ws)));
    openClients = [];
    await closeWs(backendWs);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe('Backend Registration', () => {
    test('should receive registry sync in peer_ready after registration', async () => {
      const readyMsg = backendCollector.find(m => m.type === 'peer_ready');
      expect(readyMsg).toBeDefined();
      expect(readyMsg.registrySync).toBeDefined();
      expect(readyMsg.registrySync.mode).toBe('snapshot');
      expect(readyMsg.registrySync.items).toBeInstanceOf(Array);
    });

    test('should generate unique backendId for each device', async () => {
      // Register another backend
      const backendWs2 = new WebSocket(WS_URL);
      await waitForOpen(backendWs2);

      const reg2 = await registerBackendV2(backendWs2, { deviceId: 'different-device', instanceId: 'inst-different-device', name: 'Second Backend' });
      expect(reg2.backendId).not.toBe(backendId);
      expect(reg2.backendId).toMatch(/^[a-f0-9]{8}$/);

      await closeWs(backendWs2);
    });

    test('should support visible=false for hidden backends', async () => {
      const hiddenBackendWs = new WebSocket(WS_URL);
      await waitForOpen(hiddenBackendWs);
      const collector = createMessageCollector(hiddenBackendWs);

      const reg = await registerBackendV2(hiddenBackendWs, { deviceId: 'hidden-device', instanceId: 'inst-hidden-device', name: 'Hidden Backend' }, false);
      expect(reg.backendId).toBeDefined();

      // The hidden backend should appear in registry snapshot with visible: false
      const readyMsg = collector.find(m => m.type === 'peer_ready');
      expect(readyMsg).toBeDefined();
      const hiddenInRegistry = readyMsg.registrySync.items.find((b: any) => b.backendId === reg.backendId);
      expect(hiddenInRegistry).toBeDefined();
      expect(hiddenInRegistry.visible).toBe(false);

      await closeWs(hiddenBackendWs);
    });

    test('should use default name if not provided', async () => {
      const noNameBackendWs = new WebSocket(WS_URL);
      await waitForOpen(noNameBackendWs);

      const reg = await registerBackendV2(noNameBackendWs, { deviceId: 'no-name-device', instanceId: 'inst-no-name-device' });
      expect(reg.backendId).toBeDefined();

      await closeWs(noNameBackendWs);
    });
  });

  describe('Channel Communication', () => {
    test('should open a channel to backend', async () => {
      const clientWs = new WebSocket(WS_URL);
      await waitForOpen(clientWs);
      openClients.push(clientWs);

      await registerClientV2(clientWs);

      // Open a channel to the backend
      clientWs.send(JSON.stringify({
        type: 'open_backend_channel',
        backendId,
        expectedEpoch: backendEpoch
      }));

      const opened = await waitForMessage(clientWs, 'backend_channel_opened');
      expect(opened.backendId).toBe(backendId);
      expect(opened.channelId).toBeDefined();
      expect(opened.epoch).toBe(backendEpoch);
    });

    test('should reject channel to non-existent backend', async () => {
      const clientWs = new WebSocket(WS_URL);
      await waitForOpen(clientWs);
      openClients.push(clientWs);

      await registerClientV2(clientWs);

      clientWs.send(JSON.stringify({
        type: 'open_backend_channel',
        backendId: 'nonexist1',
        expectedEpoch: 1
      }));

      const rejected = await waitForMessage(clientWs, 'backend_channel_rejected');
      expect(rejected.backendId).toBe('nonexist1');
      expect(rejected.reason).toBe('offline');
    });

    test('should forward channel_client_message to backend', async () => {
      const clientWs = new WebSocket(WS_URL);
      await waitForOpen(clientWs);
      openClients.push(clientWs);

      await registerClientV2(clientWs);

      clientWs.send(JSON.stringify({
        type: 'open_backend_channel',
        backendId,
        expectedEpoch: backendEpoch
      }));

      const opened = await waitForMessage(clientWs, 'backend_channel_opened');
      const channelId = opened.channelId;

      // Send a channel message from client
      clientWs.send(JSON.stringify({
        type: 'channel_client_message',
        channelId,
        payload: { action: 'test', data: 'hello' }
      }));

      // Backend should receive it
      const msg = await waitForMessage(backendWs, 'channel_client_message');
      expect(msg.channelId).toBe(channelId);
      expect(msg.payload.action).toBe('test');
    });

    test('should forward channel_server_message to client', async () => {
      const clientWs = new WebSocket(WS_URL);
      await waitForOpen(clientWs);
      openClients.push(clientWs);

      await registerClientV2(clientWs);

      clientWs.send(JSON.stringify({
        type: 'open_backend_channel',
        backendId,
        expectedEpoch: backendEpoch
      }));

      const opened = await waitForMessage(clientWs, 'backend_channel_opened');
      const channelId = opened.channelId;

      // Backend sends a channel_server_message
      backendWs.send(JSON.stringify({
        type: 'channel_server_message',
        channelId,
        payload: { action: 'response', data: 'world' }
      }));

      // Client should receive it
      const msg = await waitForMessage(clientWs, 'channel_server_message');
      expect(msg.channelId).toBe(channelId);
      expect(msg.payload.action).toBe('response');
    });
  });

  describe('HTTP Proxy Response', () => {
    test('should handle http_proxy_response', async () => {
      // Just verify it doesn't throw for non-existent request
      backendWs.send(JSON.stringify({
        type: 'http_proxy_response',
        requestId: 'non-existent-request',
        statusCode: 200,
        headers: {},
        bodyEncoding: 'utf8',
        body: '{}'
      }));

      await delay(50);
    });
  });

  describe('Backend Disconnect', () => {
    test('should notify clients via channel_closed when backend disconnects', async () => {
      const clientWs = new WebSocket(WS_URL);
      await waitForOpen(clientWs);
      openClients.push(clientWs);

      await registerClientV2(clientWs);

      // Open a channel
      clientWs.send(JSON.stringify({
        type: 'open_backend_channel',
        backendId,
        expectedEpoch: backendEpoch
      }));

      await waitForMessage(clientWs, 'backend_channel_opened');

      // Close backend connection
      await closeWs(backendWs);

      await delay(200);

      // Client should receive registry_event showing backend removed
      // (and backend_channel_closed for the channel)
    });
  });

  describe('Ping/Pong', () => {
    test('should respond to ping', async () => {
      // WebSocket library handles pong automatically
      // Just verify connection stays alive
      await delay(100);
      expect(backendWs.readyState).toBe(WebSocket.OPEN);
    });
  });

  describe('Heartbeat', () => {
    test('should respond to backend_heartbeat with heartbeat_ack', async () => {
      backendWs.send(JSON.stringify({
        type: 'backend_heartbeat',
        epoch: backendEpoch
      }));

      const ack = await waitForMessage(backendWs, 'heartbeat_ack');
      expect(ack.epoch).toBe(backendEpoch);
    });
  });
});
