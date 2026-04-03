/**
 * Integration tests for Gateway v2 catalog subscriptions and channel communication.
 *
 * Tests the real createGatewayServer with mock backend/client WebSocket connections.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import type { Server } from 'http';
import { createGatewayServer } from '../server.js';

const GATEWAY_SECRET = 'test-secret-broadcast';
const TEST_PORT = 9002;
const WS_URL = `ws://localhost:${TEST_PORT}/ws`;

/**
 * MessageCollector - collects all messages and provides async waiting.
 * Avoids race conditions by starting collection immediately on registration.
 */
class MessageCollector {
  /** All messages received (never modified — used by findAll) */
  private allMessages: any[] = [];
  /** Unconsumed messages (consumed by waitFor) */
  private unconsumed: any[] = [];
  private waiters: Array<{ type: string; resolve: (msg: any) => void; timer: NodeJS.Timeout }> = [];

  constructor(ws: WebSocket) {
    ws.on('message', (data: WebSocket.Data) => {
      const msg = JSON.parse(data.toString());
      this.allMessages.push(msg);

      // Check if any waiter matches — consume directly without adding to unconsumed
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        if (this.waiters[i].type === msg.type) {
          const waiter = this.waiters.splice(i, 1)[0];
          clearTimeout(waiter.timer);
          waiter.resolve(msg);
          return; // consumed by waiter
        }
      }

      // No waiter matched — add to unconsumed queue
      this.unconsumed.push(msg);
    });
  }

  /** Wait for and consume a message of the given type */
  waitFor(type: string, timeoutMs = 1000): Promise<any> {
    // Check if already in unconsumed queue
    const idx = this.unconsumed.findIndex(m => m.type === type);
    if (idx !== -1) {
      return Promise.resolve(this.unconsumed.splice(idx, 1)[0]);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex(w => w.type === type && w.timer === timer);
        if (idx !== -1) this.waiters.splice(idx, 1);
        reject(new Error(`Timeout waiting for '${type}'. Unconsumed: [${this.unconsumed.map(m => m.type).join(', ')}]`));
      }, timeoutMs);
      this.waiters.push({ type, resolve, timer });
    });
  }

  /** Find all messages (including consumed ones) matching a predicate */
  findAll(predicate: (msg: any) => boolean): any[] {
    return this.allMessages.filter(predicate);
  }
}

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

// Helper: small delay
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const DELIVERY_SETTLE_MS = 20;
const UNSUBSCRIBE_SETTLE_MS = 5;

describe('Gateway v2 catalog subscriptions', () => {
  let server: Server;
  let backendWs: WebSocket;
  let backendCollector: MessageCollector;
  let backendId: string;
  let backendEpoch: number;
  let openClients: WebSocket[] = [];

  beforeEach(async () => {
    server = createGatewayServer({ gatewaySecret: GATEWAY_SECRET });
    await new Promise<void>((resolve) => server.listen(TEST_PORT, resolve));

    // Register a backend
    backendWs = new WebSocket(WS_URL);
    await waitForOpen(backendWs);
    backendCollector = new MessageCollector(backendWs);
    backendWs.send(JSON.stringify({
      type: 'peer_hello',
      protocolVersion: 2,
      peerType: 'client+backend',
      gatewaySecret: GATEWAY_SECRET,
      identity: { deviceId: 'test-device-broadcast', instanceId: 'inst-test-device-broadcast', name: 'Test Backend' },
      backend: { visible: true, capabilities: [] }
    }));
    const regResult = await backendCollector.waitFor('peer_ready');
    backendId = regResult.backend.backendId;
    backendEpoch = regResult.backend.epoch;

    // Backend publishes a catalog snapshot so clients can subscribe
    backendWs.send(JSON.stringify({
      type: 'catalog_snapshot',
      epoch: backendEpoch,
      revision: 1,
      items: [{ sessionId: 'sess-1', name: 'Session 1', createdAt: Date.now(), updatedAt: Date.now() }]
    }));
  });

  afterEach(async () => {
    await Promise.all(openClients.map(ws => closeWs(ws)));
    openClients = [];
    await closeWs(backendWs);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function connectClient(): Promise<{ ws: WebSocket; collector: MessageCollector }> {
    const clientWs = new WebSocket(WS_URL);
    await waitForOpen(clientWs);
    openClients.push(clientWs);
    const collector = new MessageCollector(clientWs);

    // Authenticate with gateway
    clientWs.send(JSON.stringify({
      type: 'peer_hello',
      protocolVersion: 2,
      peerType: 'client-only',
      gatewaySecret: GATEWAY_SECRET,
      identity: { deviceId: 'client-dev', instanceId: `client-inst-${Date.now()}-${Math.random()}` }
    }));
    await collector.waitFor('peer_ready');

    return { ws: clientWs, collector };
  }

  test('subscribe_backend_catalog delivers catalog snapshot to subscriber', async () => {
    const clientA = await connectClient();

    // Subscribe to catalog
    clientA.ws.send(JSON.stringify({
      type: 'subscribe_backend_catalog',
      backendId,
      expectedEpoch: backendEpoch
    }));

    // Should receive a catalog snapshot
    const snapshot = await clientA.collector.waitFor('backend_catalog_snapshot');
    expect(snapshot.backendId).toBe(backendId);
    expect(snapshot.epoch).toBe(backendEpoch);
    expect(snapshot.items).toBeInstanceOf(Array);
    expect(snapshot.items.length).toBe(1);
    expect(snapshot.items[0].sessionId).toBe('sess-1');
  });

  test('catalog events are delivered to subscribers', async () => {
    const clientA = await connectClient();
    const clientB = await connectClient();

    // Both subscribe to catalog
    clientA.ws.send(JSON.stringify({
      type: 'subscribe_backend_catalog',
      backendId,
      expectedEpoch: backendEpoch
    }));
    await clientA.collector.waitFor('backend_catalog_snapshot');

    clientB.ws.send(JSON.stringify({
      type: 'subscribe_backend_catalog',
      backendId,
      expectedEpoch: backendEpoch
    }));
    await clientB.collector.waitFor('backend_catalog_snapshot');

    // Backend publishes a catalog event
    backendWs.send(JSON.stringify({
      type: 'catalog_event',
      epoch: backendEpoch,
      revision: 2,
      op: 'upsert',
      item: { sessionId: 'sess-2', name: 'Session 2', createdAt: Date.now(), updatedAt: Date.now() }
    }));

    // Both clients should receive the catalog event
    const eventA = await clientA.collector.waitFor('backend_catalog_event');
    expect(eventA.backendId).toBe(backendId);
    expect(eventA.op).toBe('upsert');
    expect(eventA.item.sessionId).toBe('sess-2');

    const eventB = await clientB.collector.waitFor('backend_catalog_event');
    expect(eventB.backendId).toBe(backendId);
    expect(eventB.op).toBe('upsert');
  });

  test('unsubscribed clients do not receive catalog events', async () => {
    const clientA = await connectClient();
    const clientB = await connectClient();

    // Only client A subscribes
    clientA.ws.send(JSON.stringify({
      type: 'subscribe_backend_catalog',
      backendId,
      expectedEpoch: backendEpoch
    }));
    await clientA.collector.waitFor('backend_catalog_snapshot');

    // Backend publishes a catalog event
    backendWs.send(JSON.stringify({
      type: 'catalog_event',
      epoch: backendEpoch,
      revision: 2,
      op: 'upsert',
      item: { sessionId: 'sess-2', name: 'Session 2', createdAt: Date.now(), updatedAt: Date.now() }
    }));

    await delay(DELIVERY_SETTLE_MS);

    const eventsA = clientA.collector.findAll(m => m.type === 'backend_catalog_event');
    const eventsB = clientB.collector.findAll(m => m.type === 'backend_catalog_event');

    expect(eventsA).toHaveLength(1);
    expect(eventsB).toHaveLength(0);
  });

  test('unsubscribe_backend_catalog stops catalog event delivery', async () => {
    const client = await connectClient();

    // Subscribe
    client.ws.send(JSON.stringify({
      type: 'subscribe_backend_catalog',
      backendId,
      expectedEpoch: backendEpoch
    }));
    await client.collector.waitFor('backend_catalog_snapshot');

    // Unsubscribe
    client.ws.send(JSON.stringify({
      type: 'unsubscribe_backend_catalog',
      backendId,
      expectedEpoch: backendEpoch
    }));

    await delay(UNSUBSCRIBE_SETTLE_MS);

    // Backend publishes a catalog event
    backendWs.send(JSON.stringify({
      type: 'catalog_event',
      epoch: backendEpoch,
      revision: 2,
      op: 'upsert',
      item: { sessionId: 'sess-2', name: 'Session 2', createdAt: Date.now(), updatedAt: Date.now() }
    }));

    await delay(DELIVERY_SETTLE_MS);

    const events = client.collector.findAll(m => m.type === 'backend_catalog_event');
    expect(events).toHaveLength(0);
  });
});

describe('Gateway v2 channel communication', () => {
  let server: Server;
  let backendWsA: WebSocket;
  let backendWsB: WebSocket;
  let backendCollectorA: MessageCollector;
  let backendCollectorB: MessageCollector;
  let backendIdA: string;
  let backendEpochA: number;
  let backendIdB: string;
  let backendEpochB: number;
  let openClients: WebSocket[] = [];

  beforeEach(async () => {
    server = createGatewayServer({ gatewaySecret: GATEWAY_SECRET });
    await new Promise<void>((resolve) => server.listen(TEST_PORT, resolve));

    // Register backend A
    backendWsA = new WebSocket(WS_URL);
    await waitForOpen(backendWsA);
    backendCollectorA = new MessageCollector(backendWsA);
    backendWsA.send(JSON.stringify({
      type: 'peer_hello',
      protocolVersion: 2,
      peerType: 'client+backend',
      gatewaySecret: GATEWAY_SECRET,
      identity: { deviceId: 'device-sub-a', instanceId: 'inst-device-sub-a', name: 'Backend A' },
      backend: { visible: true, capabilities: [] }
    }));
    const regA = await backendCollectorA.waitFor('peer_ready');
    backendIdA = regA.backend.backendId;
    backendEpochA = regA.backend.epoch;

    // Register backend B
    backendWsB = new WebSocket(WS_URL);
    await waitForOpen(backendWsB);
    backendCollectorB = new MessageCollector(backendWsB);
    backendWsB.send(JSON.stringify({
      type: 'peer_hello',
      protocolVersion: 2,
      peerType: 'client+backend',
      gatewaySecret: GATEWAY_SECRET,
      identity: { deviceId: 'device-sub-b', instanceId: 'inst-device-sub-b', name: 'Backend B' },
      backend: { visible: true, capabilities: [] }
    }));
    const regB = await backendCollectorB.waitFor('peer_ready');
    backendIdB = regB.backend.backendId;
    backendEpochB = regB.backend.epoch;
  });

  afterEach(async () => {
    await Promise.all(openClients.map(ws => closeWs(ws)));
    openClients = [];
    await closeWs(backendWsA);
    await closeWs(backendWsB);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function connectClientWithChannel(backendId: string, epoch: number): Promise<{ ws: WebSocket; collector: MessageCollector; channelId: string }> {
    const clientWs = new WebSocket(WS_URL);
    await waitForOpen(clientWs);
    openClients.push(clientWs);
    const collector = new MessageCollector(clientWs);

    clientWs.send(JSON.stringify({
      type: 'peer_hello',
      protocolVersion: 2,
      peerType: 'client-only',
      gatewaySecret: GATEWAY_SECRET,
      identity: { deviceId: 'client-dev', instanceId: `client-inst-${Date.now()}-${Math.random()}` }
    }));
    await collector.waitFor('peer_ready');

    // Open channel
    clientWs.send(JSON.stringify({
      type: 'open_backend_channel',
      backendId,
      expectedEpoch: epoch
    }));
    const opened = await collector.waitFor('backend_channel_opened');

    return { ws: clientWs, collector, channelId: opened.channelId };
  }

  test('channel_server_message delivers to the correct client channel', async () => {
    const clientA = await connectClientWithChannel(backendIdA, backendEpochA);
    const clientB = await connectClientWithChannel(backendIdA, backendEpochA);

    // Backend A sends a channel_server_message to client A's channel
    backendWsA.send(JSON.stringify({
      type: 'channel_server_message',
      channelId: clientA.channelId,
      payload: { action: 'test', data: 'for A only' }
    }));

    await delay(DELIVERY_SETTLE_MS);

    const msgsA = clientA.collector.findAll(m => m.type === 'channel_server_message' && m.payload?.data === 'for A only');
    const msgsB = clientB.collector.findAll(m => m.type === 'channel_server_message' && m.payload?.data === 'for A only');

    expect(msgsA).toHaveLength(1);
    expect(msgsB).toHaveLength(0);
  });

  test('channels to different backends are independent', async () => {
    const clientChannelA = await connectClientWithChannel(backendIdA, backendEpochA);
    const clientChannelB = await connectClientWithChannel(backendIdB, backendEpochB);

    // Backend A sends to channel A
    backendWsA.send(JSON.stringify({
      type: 'channel_server_message',
      channelId: clientChannelA.channelId,
      payload: { from: 'A' }
    }));

    // Backend B sends to channel B
    backendWsB.send(JSON.stringify({
      type: 'channel_server_message',
      channelId: clientChannelB.channelId,
      payload: { from: 'B' }
    }));

    await delay(DELIVERY_SETTLE_MS);

    const fromA = clientChannelA.collector.findAll(m => m.type === 'channel_server_message' && m.payload?.from === 'A');
    const fromB = clientChannelB.collector.findAll(m => m.type === 'channel_server_message' && m.payload?.from === 'B');
    const crossA = clientChannelA.collector.findAll(m => m.type === 'channel_server_message' && m.payload?.from === 'B');
    const crossB = clientChannelB.collector.findAll(m => m.type === 'channel_server_message' && m.payload?.from === 'A');

    expect(fromA).toHaveLength(1);
    expect(fromB).toHaveLength(1);
    expect(crossA).toHaveLength(0);
    expect(crossB).toHaveLength(0);
  });

  test('close_backend_channel stops message delivery', async () => {
    const client = await connectClientWithChannel(backendIdA, backendEpochA);

    // Close the channel
    client.ws.send(JSON.stringify({
      type: 'close_backend_channel',
      channelId: client.channelId
    }));
    await client.collector.waitFor('backend_channel_closed');

    // Backend tries to send — should not be delivered
    backendWsA.send(JSON.stringify({
      type: 'channel_server_message',
      channelId: client.channelId,
      payload: { data: 'should not arrive' }
    }));

    await delay(DELIVERY_SETTLE_MS);

    const msgs = client.collector.findAll(m => m.type === 'channel_server_message' && m.payload?.data === 'should not arrive');
    expect(msgs).toHaveLength(0);
  });

  test('registry events notify all peers when a new backend connects', async () => {
    const clientWs = new WebSocket(WS_URL);
    await waitForOpen(clientWs);
    openClients.push(clientWs);
    const collector = new MessageCollector(clientWs);

    clientWs.send(JSON.stringify({
      type: 'peer_hello',
      protocolVersion: 2,
      peerType: 'client-only',
      gatewaySecret: GATEWAY_SECRET,
      identity: { deviceId: 'reg-client', instanceId: 'reg-client-inst' }
    }));
    await collector.waitFor('peer_ready');

    // Register a new backend C
    const backendWsC = new WebSocket(WS_URL);
    await waitForOpen(backendWsC);
    const collectorC = new MessageCollector(backendWsC);
    backendWsC.send(JSON.stringify({
      type: 'peer_hello',
      protocolVersion: 2,
      peerType: 'client+backend',
      gatewaySecret: GATEWAY_SECRET,
      identity: { deviceId: 'device-c', instanceId: 'inst-device-c', name: 'Backend C' },
      backend: { visible: true, capabilities: [] }
    }));
    await collectorC.waitFor('peer_ready');

    // Client should receive a registry_event for the new backend
    const event = await collector.waitFor('registry_event');
    expect(event.event.op).toBe('upsert');
    expect(event.event.item.name).toBe('Backend C');

    await closeWs(backendWsC);
  });
});
