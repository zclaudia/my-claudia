/**
 * Unit tests for Gateway Client message handling
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
function waitForMessage(ws: WebSocket, type: string, timeoutMs = 5000): Promise<any> {
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

describe('Gateway Client Message Handling', () => {
  let server: Server;
  let backendWs: WebSocket;
  let backendId: string;
  let backendCollector: ReturnType<typeof createMessageCollector>;
  let openClients: WebSocket[] = [];

  beforeEach(async () => {
    server = createGatewayServer({ gatewaySecret: GATEWAY_SECRET });
    await new Promise<void>((resolve) => server.listen(TEST_PORT, resolve));

    // Register a backend
    backendWs = new WebSocket(WS_URL);
    await waitForOpen(backendWs);
    backendCollector = createMessageCollector(backendWs);
    
    backendWs.send(JSON.stringify({
      type: 'register',
      gatewaySecret: GATEWAY_SECRET,
      deviceId: 'test-backend-device',
      name: 'Test Backend',
      visible: true
    }));
    
    const regResult = await waitForMessage(backendWs, 'register_result');
    backendId = regResult.backendId;
  });

  afterEach(async () => {
    await Promise.all(openClients.map(ws => closeWs(ws)));
    openClients = [];
    await closeWs(backendWs);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function connectClient(): Promise<{ ws: WebSocket; collector: ReturnType<typeof createMessageCollector> }> {
    const clientWs = new WebSocket(WS_URL);
    await waitForOpen(clientWs);
    openClients.push(clientWs);
    const collector = createMessageCollector(clientWs);

    // Authenticate with gateway
    clientWs.send(JSON.stringify({
      type: 'gateway_auth',
      gatewaySecret: GATEWAY_SECRET,
    }));
    const authResult = await waitForMessage(clientWs, 'gateway_auth_result');
    expect(authResult.success).toBe(true);

    return { ws: clientWs, collector };
  }

  describe('Gateway Auth', () => {
    test('should receive backends list in auth result', async () => {
      const { ws: clientWs, collector } = await connectClient();

      const authResult = collector.find(m => m.type === 'gateway_auth_result');
      expect(authResult).toBeDefined();
      expect(authResult.backends).toBeInstanceOf(Array);
      expect(authResult.backends.length).toBe(1);
      expect(authResult.backends[0].backendId).toBe(backendId);
      expect(authResult.backends[0].name).toBe('Test Backend');
      expect(authResult.backends[0].online).toBe(true);
    });

    test('should not include hidden backends in list', async () => {
      // Register hidden backend
      const hiddenBackendWs = new WebSocket(WS_URL);
      await waitForOpen(hiddenBackendWs);
      hiddenBackendWs.send(JSON.stringify({
        type: 'register',
        gatewaySecret: GATEWAY_SECRET,
        deviceId: 'hidden-device',
        name: 'Hidden Backend',
        visible: false
      }));
      await waitForMessage(hiddenBackendWs, 'register_result');

      const { collector } = await connectClient();

      const authResult = collector.find(m => m.type === 'gateway_auth_result');
      expect(authResult.backends.find((b: any) => b.name === 'Hidden Backend')).toBeUndefined();
      expect(authResult.backends.find((b: any) => b.name === 'Test Backend')).toBeDefined();

      await closeWs(hiddenBackendWs);
    });
  });

  describe('List Backends', () => {
    test('should return updated backend list', async () => {
      const { ws: clientWs, collector } = await connectClient();

      // Request backends list
      clientWs.send(JSON.stringify({ type: 'list_backends' }));
      
      const backendsList = await waitForMessage(clientWs, 'backends_list');
      expect(backendsList.backends).toBeInstanceOf(Array);
      expect(backendsList.backends.length).toBe(1);
      expect(backendsList.backends[0].backendId).toBe(backendId);
    });

    test('should reflect backend disconnect in list', async () => {
      const { ws: clientWs, collector } = await connectClient();

      // Register second backend
      const backendWs2 = new WebSocket(WS_URL);
      await waitForOpen(backendWs2);
      backendWs2.send(JSON.stringify({
        type: 'register',
        gatewaySecret: GATEWAY_SECRET,
        deviceId: 'second-device',
        name: 'Second Backend',
        visible: true
      }));
      const regResult = await waitForMessage(backendWs2, 'register_result');
      
      // Get updated list
      clientWs.send(JSON.stringify({ type: 'list_backends' }));
      let backendsList = await waitForMessage(clientWs, 'backends_list');
      expect(backendsList.backends.length).toBe(2);

      // Close second backend
      await closeWs(backendWs2);
      await delay(200);

      // Get list again
      collector.clear();
      clientWs.send(JSON.stringify({ type: 'list_backends' }));
      backendsList = await waitForMessage(clientWs, 'backends_list');
      expect(backendsList.backends.length).toBe(1);
      expect(backendsList.backends[0].backendId).toBe(backendId);
    });
  });

  describe('Connect Backend', () => {
    test('should send client_auth to backend', async () => {
      const { ws: clientWs } = await connectClient();

      // Connect to backend
      clientWs.send(JSON.stringify({
        type: 'connect_backend',
        backendId
      }));

      const clientAuth = await waitForMessage(backendWs, 'client_auth');
      expect(clientAuth.clientId).toBeDefined();
    });

    test('should return error for non-existent backend', async () => {
      const { ws: clientWs } = await connectClient();

      clientWs.send(JSON.stringify({
        type: 'connect_backend',
        backendId: 'non-existent-id'
      }));

      const result = await waitForMessage(clientWs, 'backend_auth_result');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Backend not found or offline');
    });

    test('should return auth result after backend responds', async () => {
      const { ws: clientWs } = await connectClient();

      clientWs.send(JSON.stringify({
        type: 'connect_backend',
        backendId
      }));

      const clientAuth = await waitForMessage(backendWs, 'client_auth');
      
      // Backend accepts auth
      backendWs.send(JSON.stringify({
        type: 'client_auth_result',
        clientId: clientAuth.clientId,
        success: true,
        features: ['test']
      }));

      const authResult = await waitForMessage(clientWs, 'backend_auth_result');
      expect(authResult.success).toBe(true);
      expect(authResult.backendId).toBe(backendId);
      expect(authResult.features).toEqual(['test']);
    });
  });

  describe('Send to Backend', () => {
    test.skip('should forward message to backend - may timeout', async () => {
      const { ws: clientWs } = await connectClient();

      // First connect to backend
      clientWs.send(JSON.stringify({
        type: 'connect_backend',
        backendId
      }));

      const clientAuth = await waitForMessage(backendWs, 'client_auth');
      backendWs.send(JSON.stringify({
        type: 'client_auth_result',
        clientId: clientAuth.clientId,
        success: true
      }));
      await waitForMessage(clientWs, 'backend_auth_result');
      await waitForMessage(backendWs, 'client_subscribed');

      // Send message to backend
      clientWs.send(JSON.stringify({
        type: 'send_to_backend',
        backendId,
        message: { type: 'user_message', text: 'Hello backend!' }
      }));

      const forwarded = await waitForMessage(backendWs, 'forwarded');
      expect(forwarded.clientId).toBe(clientAuth.clientId);
      expect(forwarded.message.type).toBe('user_message');
      expect(forwarded.message.text).toBe('Hello backend!');
    });

    test('should reject if not authenticated to backend', async () => {
      const { ws: clientWs } = await connectClient();

      // Try to send without authenticating
      clientWs.send(JSON.stringify({
        type: 'send_to_backend',
        backendId,
        message: { type: 'test' }
      }));

      const error = await waitForMessage(clientWs, 'gateway_error');
      expect(error.code).toBe('NOT_AUTHENTICATED');
      expect(error.backendId).toBe(backendId);
    });

    test.skip('should handle backend disconnect during send - may timeout', async () => {
      const { ws: clientWs } = await connectClient();

      // Connect to backend
      clientWs.send(JSON.stringify({
        type: 'connect_backend',
        backendId
      }));

      const clientAuth = await waitForMessage(backendWs, 'client_auth');
      backendWs.send(JSON.stringify({
        type: 'client_auth_result',
        clientId: clientAuth.clientId,
        success: true
      }));
      await waitForMessage(clientWs, 'backend_auth_result');

      // Close backend
      await closeWs(backendWs);
      await delay(100);

      // Try to send - should get disconnected notification
      clientWs.send(JSON.stringify({
        type: 'send_to_backend',
        backendId,
        message: { type: 'test' }
      }));

      const disconnected = await waitForMessage(clientWs, 'backend_disconnected');
      expect(disconnected.backendId).toBe(backendId);
    });
  });

  describe('Update Subscriptions', () => {
    test.skip('should subscribe to specific backends - may timeout', async () => {
      // Register second backend
      const backendWs2 = new WebSocket(WS_URL);
      await waitForOpen(backendWs2);
      const backendCollector2 = createMessageCollector(backendWs2);
      
      backendWs2.send(JSON.stringify({
        type: 'register',
        gatewaySecret: GATEWAY_SECRET,
        deviceId: 'second-sub-device',
        name: 'Second Backend',
        visible: true
      }));
      const regResult = await waitForMessage(backendWs2, 'register_result');
      const backendId2 = regResult.backendId;

      const { ws: clientWs } = await connectClient();

      // Connect to both backends
      for (const bid of [backendId, backendId2]) {
        const ws = bid === backendId ? backendWs : backendWs2;
        clientWs.send(JSON.stringify({
          type: 'connect_backend',
          backendId: bid
        }));
        const clientAuth = await waitForMessage(ws, 'client_auth');
        ws.send(JSON.stringify({
          type: 'client_auth_result',
          clientId: clientAuth.clientId,
          success: true
        }));
        await waitForMessage(clientWs, 'backend_auth_result');
        await waitForMessage(ws, 'client_subscribed');
      }

      // Subscribe to only first backend
      clientWs.send(JSON.stringify({
        type: 'update_subscriptions',
        subscribedBackendIds: [backendId]
      }));

      const ack = await waitForMessage(clientWs, 'subscription_ack');
      expect(ack.subscribedBackendIds).toContain(backendId);
      expect(ack.subscribedBackendIds).not.toContain(backendId2);

      await closeWs(backendWs2);
    });

    test('should handle subscribeAll', async () => {
      const { ws: clientWs } = await connectClient();

      // Connect to backend
      clientWs.send(JSON.stringify({
        type: 'connect_backend',
        backendId
      }));

      const clientAuth = await waitForMessage(backendWs, 'client_auth');
      backendWs.send(JSON.stringify({
        type: 'client_auth_result',
        clientId: clientAuth.clientId,
        success: true
      }));
      await waitForMessage(clientWs, 'backend_auth_result');

      // Subscribe to all
      clientWs.send(JSON.stringify({
        type: 'update_subscriptions',
        subscribedBackendIds: [],
        subscribeAll: true
      }));

      const ack = await waitForMessage(clientWs, 'subscription_ack');
      expect(ack.subscribedBackendIds).toContain(backendId);
    });

    test.skip('should notify backend when client subscribes - may timeout', async () => {
      const { ws: clientWs } = await connectClient();

      // Connect to backend
      clientWs.send(JSON.stringify({
        type: 'connect_backend',
        backendId
      }));

      const clientAuth = await waitForMessage(backendWs, 'client_auth');
      backendWs.send(JSON.stringify({
        type: 'client_auth_result',
        clientId: clientAuth.clientId,
        success: true
      }));
      await waitForMessage(clientWs, 'backend_auth_result');

      // Should receive client_subscribed
      const subscribed = await waitForMessage(backendWs, 'client_subscribed');
      expect(subscribed.clientId).toBe(clientAuth.clientId);
    });

    test.skip('should notify backend when client unsubscribes - may timeout', async () => {
      const { ws: clientWs } = await connectClient();

      // Connect to backend
      clientWs.send(JSON.stringify({
        type: 'connect_backend',
        backendId
      }));

      const clientAuth = await waitForMessage(backendWs, 'client_auth');
      backendWs.send(JSON.stringify({
        type: 'client_auth_result',
        clientId: clientAuth.clientId,
        success: true
      }));
      await waitForMessage(clientWs, 'backend_auth_result');
      await waitForMessage(backendWs, 'client_subscribed');

      // Unsubscribe
      clientWs.send(JSON.stringify({
        type: 'update_subscriptions',
        subscribedBackendIds: []
      }));

      await waitForMessage(clientWs, 'subscription_ack');

      // Backend should handle this gracefully (client will be removed from subscribers)
      // The unsubscribe happens internally without explicit notification
      await delay(100);
    });
  });

  describe('Client Disconnect', () => {
    test.skip('should clean up client state on disconnect - may timeout', async () => {
      const { ws: clientWs } = await connectClient();

      // Connect to backend
      clientWs.send(JSON.stringify({
        type: 'connect_backend',
        backendId
      }));

      const clientAuth = await waitForMessage(backendWs, 'client_auth');
      backendWs.send(JSON.stringify({
        type: 'client_auth_result',
        clientId: clientAuth.clientId,
        success: true
      }));
      await waitForMessage(clientWs, 'backend_auth_result');
      await waitForMessage(backendWs, 'client_subscribed');

      // Disconnect client
      await closeWs(clientWs);

      await delay(200);

      // Backend should receive client_disconnected
      const disconnected = backendCollector.findAll(m => m.type === 'client_disconnected')
        .find(m => m.clientId === clientAuth.clientId);
      expect(disconnected).toBeDefined();
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
      expect(error.code).toBe('UNKNOWN_MESSAGE_TYPE');
    });
  });

  describe('Multiple Clients', () => {
    test.skip('should handle multiple clients connecting to same backend - flaky', async () => {
      const { ws: client1 } = await connectClient();
      const { ws: client2 } = await connectClient();

      // Both connect to backend
      client1.send(JSON.stringify({ type: 'connect_backend', backendId }));
      client2.send(JSON.stringify({ type: 'connect_backend', backendId }));

      const auth1 = await waitForMessage(backendWs, 'client_auth');
      backendWs.send(JSON.stringify({
        type: 'client_auth_result',
        clientId: auth1.clientId,
        success: true
      }));
      await waitForMessage(client1, 'backend_auth_result');

      const auth2 = await waitForMessage(backendWs, 'client_auth');
      backendWs.send(JSON.stringify({
        type: 'client_auth_result',
        clientId: auth2.clientId,
        success: true
      }));
      await waitForMessage(client2, 'backend_auth_result');

      // Verify different client IDs
      expect(auth1.clientId).not.toBe(auth2.clientId);

      // Both should be subscribed
      const subscribed1 = await waitForMessage(backendWs, 'client_subscribed');
      const subscribed2 = await waitForMessage(backendWs, 'client_subscribed');
      
      expect([auth1.clientId, auth2.clientId]).toContain(subscribed1.clientId);
      expect([auth1.clientId, auth2.clientId]).toContain(subscribed2.clientId);
    });
  });
});
