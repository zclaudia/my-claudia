/**
 * Integration tests for Gateway broadcast_to_subscribers and update_subscriptions
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
  waitFor(type: string, timeoutMs = 5000): Promise<any> {
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

describe('Gateway broadcast_to_subscribers', () => {
  let server: Server;
  let backendWs: WebSocket;
  let backendCollector: MessageCollector;
  let backendId: string;
  let openClients: WebSocket[] = [];

  beforeEach(async () => {
    server = createGatewayServer({ gatewaySecret: GATEWAY_SECRET });
    await new Promise<void>((resolve) => server.listen(TEST_PORT, resolve));

    // Register a backend
    backendWs = new WebSocket(WS_URL);
    await waitForOpen(backendWs);
    backendCollector = new MessageCollector(backendWs);
    backendWs.send(JSON.stringify({
      type: 'register',
      gatewaySecret: GATEWAY_SECRET,
      deviceId: 'test-device-broadcast',
      name: 'Test Backend',
      visible: true
    }));
    const regResult = await backendCollector.waitFor('register_result');
    expect(regResult.success).toBe(true);
    backendId = regResult.backendId;
  });

  afterEach(async () => {
    await Promise.all(openClients.map(ws => closeWs(ws)));
    openClients = [];
    await closeWs(backendWs);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function connectAndAuthClient(): Promise<{ ws: WebSocket; collector: MessageCollector }> {
    const clientWs = new WebSocket(WS_URL);
    await waitForOpen(clientWs);
    openClients.push(clientWs);
    const collector = new MessageCollector(clientWs);

    // Authenticate with gateway
    clientWs.send(JSON.stringify({
      type: 'gateway_auth',
      gatewaySecret: GATEWAY_SECRET,
    }));
    const authResult = await collector.waitFor('gateway_auth_result');
    expect(authResult.success).toBe(true);
    // Request backends list (gateway doesn't auto-send it)
    clientWs.send(JSON.stringify({ type: 'list_backends' }));
    await collector.waitFor('backends_list');

    // Connect to the backend
    clientWs.send(JSON.stringify({
      type: 'connect_backend',
      backendId,
    }));

    // Backend receives client_auth and responds
    const clientAuth = await backendCollector.waitFor('client_auth');
    backendWs.send(JSON.stringify({
      type: 'client_auth_result',
      clientId: clientAuth.clientId,
      success: true,
      features: [],
    }));

    // Client receives backend_auth_result
    const backendAuth = await collector.waitFor('backend_auth_result');
    expect(backendAuth.success).toBe(true);

    // Backend receives client_subscribed (auto-subscribe)
    await backendCollector.waitFor('client_subscribed');

    return { ws: clientWs, collector };
  }

  test('broadcast_to_subscribers delivers messages to all subscribed clients', async () => {
    const clientA = await connectAndAuthClient();
    const clientB = await connectAndAuthClient();

    // Backend broadcasts a message
    backendWs.send(JSON.stringify({
      type: 'broadcast_to_subscribers',
      message: { type: 'delta', delta: 'hello world' },
    }));

    await delay(200);

    const broadcastA = clientA.collector.findAll(m => m.type === 'backend_message' && m.message?.type === 'delta');
    const broadcastB = clientB.collector.findAll(m => m.type === 'backend_message' && m.message?.type === 'delta');

    expect(broadcastA).toHaveLength(1);
    expect(broadcastA[0].backendId).toBe(backendId);
    expect(broadcastA[0].message.delta).toBe('hello world');

    expect(broadcastB).toHaveLength(1);
    expect(broadcastB[0].backendId).toBe(backendId);
    expect(broadcastB[0].message.delta).toBe('hello world');
  });

  test('broadcast_to_subscribers does not deliver to unsubscribed clients', async () => {
    const clientA = await connectAndAuthClient();
    const clientB = await connectAndAuthClient();

    // Client B unsubscribes from the backend
    clientB.ws.send(JSON.stringify({
      type: 'update_subscriptions',
      subscribedBackendIds: [],
    }));
    await clientB.collector.waitFor('subscription_ack');

    // Backend broadcasts
    backendWs.send(JSON.stringify({
      type: 'broadcast_to_subscribers',
      message: { type: 'permission_request', requestId: 'perm-1', toolName: 'Bash' },
    }));

    await delay(200);

    const broadcastA = clientA.collector.findAll(m => m.type === 'backend_message' && m.message?.type === 'permission_request');
    const broadcastB = clientB.collector.findAll(m => m.type === 'backend_message' && m.message?.type === 'permission_request');

    expect(broadcastA).toHaveLength(1);
    expect(broadcastB).toHaveLength(0);
  });

  test('broadcast_to_subscribers delivers permission_resolved to all subscribers', async () => {
    const clientA = await connectAndAuthClient();
    const clientB = await connectAndAuthClient();

    // Backend broadcasts permission_resolved
    backendWs.send(JSON.stringify({
      type: 'broadcast_to_subscribers',
      message: { type: 'permission_resolved', requestId: 'perm-1', decision: 'allow' },
    }));

    await delay(200);

    const resolvedA = clientA.collector.findAll(m => m.type === 'backend_message' && m.message?.type === 'permission_resolved');
    const resolvedB = clientB.collector.findAll(m => m.type === 'backend_message' && m.message?.type === 'permission_resolved');

    expect(resolvedA).toHaveLength(1);
    expect(resolvedA[0].message.requestId).toBe('perm-1');
    expect(resolvedA[0].message.decision).toBe('allow');

    expect(resolvedB).toHaveLength(1);
    expect(resolvedB[0].message.requestId).toBe('perm-1');
  });

  test('broadcast_to_subscribers delivers state_heartbeat to all subscribers', async () => {
    const clientA = await connectAndAuthClient();

    // Backend broadcasts state_heartbeat
    backendWs.send(JSON.stringify({
      type: 'broadcast_to_subscribers',
      message: {
        type: 'state_heartbeat',
        activeRuns: [{ runId: 'run-1', sessionId: 'sess-1' }],
        pendingPermissions: [{ requestId: 'perm-1', toolName: 'Bash', detail: 'ls', timeoutSeconds: 60 }],
        pendingQuestions: [],
      },
    }));

    await delay(200);

    const heartbeat = clientA.collector.findAll(m => m.type === 'backend_message' && m.message?.type === 'state_heartbeat');
    expect(heartbeat).toHaveLength(1);
    expect(heartbeat[0].message.activeRuns).toHaveLength(1);
    expect(heartbeat[0].message.pendingPermissions).toHaveLength(1);
    expect(heartbeat[0].message.pendingQuestions).toHaveLength(0);
  });
});

describe('Gateway update_subscriptions', () => {
  let server: Server;
  let backendWsA: WebSocket;
  let backendWsB: WebSocket;
  let backendCollectorA: MessageCollector;
  let backendCollectorB: MessageCollector;
  let backendIdA: string;
  let backendIdB: string;
  let openClients: WebSocket[] = [];

  beforeEach(async () => {
    server = createGatewayServer({ gatewaySecret: GATEWAY_SECRET });
    await new Promise<void>((resolve) => server.listen(TEST_PORT, resolve));

    // Register backend A
    backendWsA = new WebSocket(WS_URL);
    await waitForOpen(backendWsA);
    backendCollectorA = new MessageCollector(backendWsA);
    backendWsA.send(JSON.stringify({
      type: 'register',
      gatewaySecret: GATEWAY_SECRET,
      deviceId: 'device-sub-a',
      name: 'Backend A',
      visible: true
    }));
    const regA = await backendCollectorA.waitFor('register_result');
    backendIdA = regA.backendId;

    // Register backend B
    backendWsB = new WebSocket(WS_URL);
    await waitForOpen(backendWsB);
    backendCollectorB = new MessageCollector(backendWsB);
    backendWsB.send(JSON.stringify({
      type: 'register',
      gatewaySecret: GATEWAY_SECRET,
      deviceId: 'device-sub-b',
      name: 'Backend B',
      visible: true
    }));
    const regB = await backendCollectorB.waitFor('register_result');
    backendIdB = regB.backendId;
  });

  afterEach(async () => {
    await Promise.all(openClients.map(ws => closeWs(ws)));
    openClients = [];
    await closeWs(backendWsA);
    await closeWs(backendWsB);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function connectClientToBackends(backendIds: string[]): Promise<{ ws: WebSocket; collector: MessageCollector }> {
    const clientWs = new WebSocket(WS_URL);
    await waitForOpen(clientWs);
    openClients.push(clientWs);
    const collector = new MessageCollector(clientWs);

    clientWs.send(JSON.stringify({
      type: 'gateway_auth',
      gatewaySecret: GATEWAY_SECRET,
    }));
    await collector.waitFor('gateway_auth_result');
    // Request backends list (gateway doesn't auto-send it)
    clientWs.send(JSON.stringify({ type: 'list_backends' }));
    await collector.waitFor('backends_list');

    for (const bid of backendIds) {
      clientWs.send(JSON.stringify({
        type: 'connect_backend',
        backendId: bid,
      }));

      const backendWs = bid === backendIdA ? backendWsA : backendWsB;
      const backendCollector = bid === backendIdA ? backendCollectorA : backendCollectorB;
      const clientAuth = await backendCollector.waitFor('client_auth');
      backendWs.send(JSON.stringify({
        type: 'client_auth_result',
        clientId: clientAuth.clientId,
        success: true,
        features: [],
      }));
      await collector.waitFor('backend_auth_result');
      await backendCollector.waitFor('client_subscribed');
    }

    return { ws: clientWs, collector };
  }

  test('update_subscriptions returns subscription_ack', async () => {
    const client = await connectClientToBackends([backendIdA, backendIdB]);

    client.ws.send(JSON.stringify({
      type: 'update_subscriptions',
      subscribedBackendIds: [backendIdA],
    }));

    const ack = await client.collector.waitFor('subscription_ack');
    expect(ack.subscribedBackendIds).toContain(backendIdA);
    expect(ack.subscribedBackendIds).not.toContain(backendIdB);
  });

  test('update_subscriptions filters broadcasts to subscribed backends only', async () => {
    const client = await connectClientToBackends([backendIdA, backendIdB]);

    // Unsubscribe from backend B
    client.ws.send(JSON.stringify({
      type: 'update_subscriptions',
      subscribedBackendIds: [backendIdA],
    }));
    await client.collector.waitFor('subscription_ack');

    // Broadcast from backend A (subscribed)
    backendWsA.send(JSON.stringify({
      type: 'broadcast_to_subscribers',
      message: { type: 'delta', delta: 'from A' },
    }));

    // Broadcast from backend B (unsubscribed)
    backendWsB.send(JSON.stringify({
      type: 'broadcast_to_subscribers',
      message: { type: 'delta', delta: 'from B' },
    }));

    await delay(300);

    const fromA = client.collector.findAll(m => m.type === 'backend_message' && m.message?.delta === 'from A');
    const fromB = client.collector.findAll(m => m.type === 'backend_message' && m.message?.delta === 'from B');

    expect(fromA).toHaveLength(1);
    expect(fromB).toHaveLength(0);
  });

  test('subscribeAll re-subscribes to all backends', async () => {
    const client = await connectClientToBackends([backendIdA, backendIdB]);

    // First unsubscribe from B
    client.ws.send(JSON.stringify({
      type: 'update_subscriptions',
      subscribedBackendIds: [backendIdA],
    }));
    await client.collector.waitFor('subscription_ack');

    // Then subscribe to all
    client.ws.send(JSON.stringify({
      type: 'update_subscriptions',
      subscribedBackendIds: [],
      subscribeAll: true,
    }));
    const ack = await client.collector.waitFor('subscription_ack');
    expect(ack.subscribedBackendIds).toContain(backendIdA);
    expect(ack.subscribedBackendIds).toContain(backendIdB);

    // Backend B should receive client_subscribed when re-subscribed
    await backendCollectorB.waitFor('client_subscribed');

    // Broadcast from B should now be delivered
    backendWsB.send(JSON.stringify({
      type: 'broadcast_to_subscribers',
      message: { type: 'delta', delta: 'from B after resubscribe' },
    }));

    await delay(200);

    const fromB = client.collector.findAll(m => m.type === 'backend_message' && m.message?.delta === 'from B after resubscribe');
    expect(fromB).toHaveLength(1);
  });

  test('explicit subscriptions prevent auto-subscribe on new backend auth', async () => {
    const clientWs = new WebSocket(WS_URL);
    await waitForOpen(clientWs);
    openClients.push(clientWs);
    const collector = new MessageCollector(clientWs);

    clientWs.send(JSON.stringify({
      type: 'gateway_auth',
      gatewaySecret: GATEWAY_SECRET,
    }));
    await collector.waitFor('gateway_auth_result');
    // Request backends list (gateway doesn't auto-send it)
    clientWs.send(JSON.stringify({ type: 'list_backends' }));
    await collector.waitFor('backends_list');

    // Set explicit subscriptions to only backend A before connecting
    clientWs.send(JSON.stringify({
      type: 'update_subscriptions',
      subscribedBackendIds: [backendIdA],
    }));
    await collector.waitFor('subscription_ack');

    // Connect to backend A (should subscribe)
    clientWs.send(JSON.stringify({
      type: 'connect_backend',
      backendId: backendIdA,
    }));
    const authA = await backendCollectorA.waitFor('client_auth');
    backendWsA.send(JSON.stringify({
      type: 'client_auth_result',
      clientId: authA.clientId,
      success: true,
      features: [],
    }));
    await collector.waitFor('backend_auth_result');
    await backendCollectorA.waitFor('client_subscribed');

    // Connect to backend B (should NOT subscribe due to explicit filter)
    clientWs.send(JSON.stringify({
      type: 'connect_backend',
      backendId: backendIdB,
    }));
    const authB = await backendCollectorB.waitFor('client_auth');
    backendWsB.send(JSON.stringify({
      type: 'client_auth_result',
      clientId: authB.clientId,
      success: true,
      features: [],
    }));
    await collector.waitFor('backend_auth_result');

    // Broadcast from B — should NOT arrive since client is not subscribed
    backendWsB.send(JSON.stringify({
      type: 'broadcast_to_subscribers',
      message: { type: 'delta', delta: 'should not arrive' },
    }));

    await delay(300);

    const fromB = collector.findAll(m => m.type === 'backend_message' && m.message?.delta === 'should not arrive');
    expect(fromB).toHaveLength(0);
  });
});
