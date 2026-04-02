/**
 * Unit tests for Gateway Client message handling (v2 protocol)
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import type { Server } from 'http';
import { createGatewayServer } from '../server.js';

const GATEWAY_SECRET = 'test-secret-client';
const TEST_PORT = 9040;
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
async function registerBackendV2(ws: WebSocket, identity: { deviceId: string; instanceId: string; name?: string }, visible = true): Promise<{ backendId: string; epoch: number }> {
  ws.send(JSON.stringify({
    type: 'peer_hello',
    protocolVersion: 2,
    peerType: 'client+backend',
    gatewaySecret: GATEWAY_SECRET,
    identity,
    backend: { visible, capabilities: [] }
  }));
  const ready = await waitForMessage(ws, 'peer_ready');
  return { backendId: ready.backend.backendId, epoch: ready.backend.epoch };
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

describe('Gateway Client Message Handling', () => {
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

  async function connectClient(): Promise<{ ws: WebSocket; collector: ReturnType<typeof createMessageCollector>; registrySync: any }> {
    const clientWs = new WebSocket(WS_URL);
    await waitForOpen(clientWs);
    openClients.push(clientWs);
    const collector = createMessageCollector(clientWs);

    const { registrySync } = await registerClientV2(clientWs);

    return { ws: clientWs, collector, registrySync };
  }

  describe('Gateway Auth', () => {
    test('should receive registry snapshot in peer_ready', async () => {
      const { collector, registrySync } = await connectClient();

      const readyMsg = collector.find(m => m.type === 'peer_ready');
      expect(readyMsg).toBeDefined();
      expect(registrySync).toBeDefined();
      expect(registrySync.mode).toBe('snapshot');
      expect(registrySync.items).toBeInstanceOf(Array);
      expect(registrySync.items.length).toBeGreaterThanOrEqual(1);
      const backendEntry = registrySync.items.find((b: any) => b.backendId === backendId);
      expect(backendEntry).toBeDefined();
      expect(backendEntry.name).toBe('Test Backend');
    });

    test('should include hidden backends in registry with visible=false', async () => {
      // Register hidden backend
      const hiddenBackendWs = new WebSocket(WS_URL);
      await waitForOpen(hiddenBackendWs);
      await registerBackendV2(hiddenBackendWs, { deviceId: 'hidden-device', instanceId: 'inst-hidden-device', name: 'Hidden Backend' }, false);

      const { registrySync } = await connectClient();

      const hiddenEntry = registrySync.items.find((b: any) => b.name === 'Hidden Backend');
      expect(hiddenEntry).toBeDefined();
      expect(hiddenEntry.visible).toBe(false);
      expect(registrySync.items.find((b: any) => b.name === 'Test Backend')).toBeDefined();

      await closeWs(hiddenBackendWs);
    });
  });

  describe('Registry Resync', () => {
    test('should return registry snapshot on resync_registry', async () => {
      const { ws: clientWs } = await connectClient();

      clientWs.send(JSON.stringify({ type: 'resync_registry', lastRevision: 0 }));

      const snapshot = await waitForMessage(clientWs, 'registry_snapshot');
      expect(snapshot.items).toBeInstanceOf(Array);
      expect(snapshot.items.length).toBeGreaterThanOrEqual(1);
      expect(snapshot.items.find((b: any) => b.backendId === backendId)).toBeDefined();
    });

    test('should reflect backend disconnect in registry', async () => {
      const { ws: clientWs } = await connectClient();

      // Register second backend
      const backendWs2 = new WebSocket(WS_URL);
      await waitForOpen(backendWs2);
      await registerBackendV2(backendWs2, { deviceId: 'second-device', instanceId: 'inst-second-device', name: 'Second Backend' });

      // Close second backend
      await closeWs(backendWs2);
      await delay(200);

      // Resync registry — second backend should be gone
      clientWs.send(JSON.stringify({ type: 'resync_registry', lastRevision: 0 }));
      const snapshot = await waitForMessage(clientWs, 'registry_snapshot');
      expect(snapshot.items.length).toBe(1);
      expect(snapshot.items[0].backendId).toBe(backendId);
    });
  });

  describe('Open Backend Channel', () => {
    test('should open channel to backend', async () => {
      const { ws: clientWs } = await connectClient();

      clientWs.send(JSON.stringify({
        type: 'open_backend_channel',
        backendId,
        expectedEpoch: backendEpoch
      }));

      const opened = await waitForMessage(clientWs, 'backend_channel_opened');
      expect(opened.channelId).toBeDefined();
      expect(opened.backendId).toBe(backendId);
      expect(opened.epoch).toBe(backendEpoch);
    });

    test('should return error for non-existent backend', async () => {
      const { ws: clientWs } = await connectClient();

      clientWs.send(JSON.stringify({
        type: 'open_backend_channel',
        backendId: 'non-existent-id',
        expectedEpoch: 1
      }));

      const result = await waitForMessage(clientWs, 'backend_channel_rejected');
      expect(result.reason).toBe('offline');
    });

    test('should reject channel with wrong epoch', async () => {
      const { ws: clientWs } = await connectClient();

      clientWs.send(JSON.stringify({
        type: 'open_backend_channel',
        backendId,
        expectedEpoch: backendEpoch + 999
      }));

      const result = await waitForMessage(clientWs, 'backend_channel_rejected');
      expect(result.reason).toBe('epoch_mismatch');
    });

    test('should return existing channel if already open', async () => {
      const { ws: clientWs } = await connectClient();

      // Open first channel
      clientWs.send(JSON.stringify({
        type: 'open_backend_channel',
        backendId,
        expectedEpoch: backendEpoch
      }));
      const opened1 = await waitForMessage(clientWs, 'backend_channel_opened');

      // Open again — should return same channel
      clientWs.send(JSON.stringify({
        type: 'open_backend_channel',
        backendId,
        expectedEpoch: backendEpoch
      }));
      const opened2 = await waitForMessage(clientWs, 'backend_channel_opened');
      expect(opened2.channelId).toBe(opened1.channelId);
    });
  });

  describe('Channel Messages', () => {
    test('should reject channel_client_message for unknown channel', async () => {
      const { ws: clientWs } = await connectClient();

      clientWs.send(JSON.stringify({
        type: 'channel_client_message',
        channelId: 'non-existent-channel',
        payload: { type: 'test' }
      }));

      const error = await waitForMessage(clientWs, 'gateway_error');
      expect(error.code).toBe('BACKEND_CHANNEL_NOT_FOUND');
    });
  });

  describe('Close Backend Channel', () => {
    test('should close channel and notify both sides', async () => {
      const { ws: clientWs } = await connectClient();

      clientWs.send(JSON.stringify({
        type: 'open_backend_channel',
        backendId,
        expectedEpoch: backendEpoch
      }));
      const opened = await waitForMessage(clientWs, 'backend_channel_opened');

      clientWs.send(JSON.stringify({
        type: 'close_backend_channel',
        channelId: opened.channelId
      }));

      // Client should receive channel_closed
      const closed = await waitForMessage(clientWs, 'backend_channel_closed');
      expect(closed.channelId).toBe(opened.channelId);
      expect(closed.reason).toBe('client_closed');

      // Backend should also receive channel_closed
      const backendClosed = await waitForMessage(backendWs, 'backend_channel_closed');
      expect(backendClosed.channelId).toBe(opened.channelId);
    });
  });

  describe('Unknown Message Types', () => {
    test('should return error for unknown message type', async () => {
      const { ws: clientWs } = await connectClient();

      clientWs.send(JSON.stringify({
        type: 'unknown_message_type',
        data: 'test'
      }));

      const error = await waitForMessage(clientWs, 'gateway_error');
      expect(error.code).toBe('INVALID_MESSAGE');
    });
  });

  describe('Multiple Clients', () => {
    test('should handle multiple clients opening channels to same backend', async () => {
      const { ws: client1 } = await connectClient();
      const { ws: client2 } = await connectClient();

      // Both open channels to same backend
      client1.send(JSON.stringify({ type: 'open_backend_channel', backendId, expectedEpoch: backendEpoch }));
      client2.send(JSON.stringify({ type: 'open_backend_channel', backendId, expectedEpoch: backendEpoch }));

      const opened1 = await waitForMessage(client1, 'backend_channel_opened');
      const opened2 = await waitForMessage(client2, 'backend_channel_opened');

      // Should be different channel IDs
      expect(opened1.channelId).not.toBe(opened2.channelId);
    });
  });
});
