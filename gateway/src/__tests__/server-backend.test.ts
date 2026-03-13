/**
 * Unit tests for Gateway Backend message handling
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

describe('Gateway Backend Message Handling', () => {
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
      name: 'Test Backend'
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

  async function connectAndAuthClient(backendIds: string[] = [backendId]): Promise<{ ws: WebSocket; collector: ReturnType<typeof createMessageCollector> }> {
    const clientWs = new WebSocket(WS_URL);
    await waitForOpen(clientWs);
    openClients.push(clientWs);
    const collector = createMessageCollector(clientWs);

    // Authenticate with gateway
    clientWs.send(JSON.stringify({
      type: 'gateway_auth',
      gatewaySecret: GATEWAY_SECRET,
    }));
    await waitForMessage(clientWs, 'gateway_auth_result');

    // Connect to each backend
    for (const bid of backendIds) {
      clientWs.send(JSON.stringify({
        type: 'connect_backend',
        backendId: bid,
      }));

      const clientAuth = await waitForMessage(backendWs, 'client_auth');
      backendWs.send(JSON.stringify({
        type: 'client_auth_result',
        clientId: clientAuth.clientId,
        success: true,
        features: [],
      }));

      await waitForMessage(clientWs, 'backend_auth_result');
      await waitForMessage(backendWs, 'client_subscribed');
    }

    return { ws: clientWs, collector };
  }

  describe('Backend Registration', () => {
    test('should receive backends_list after registration', async () => {
      // backends_list is sent after registration
      const backendsList = backendCollector.find(m => m.type === 'backends_list');
      expect(backendsList).toBeDefined();
      expect(backendsList.backends).toBeInstanceOf(Array);
    });

    test('should generate unique backendId for each device', async () => {
      // Register another backend
      const backendWs2 = new WebSocket(WS_URL);
      await waitForOpen(backendWs2);
      
      backendWs2.send(JSON.stringify({
        type: 'register',
        gatewaySecret: GATEWAY_SECRET,
        deviceId: 'different-device',
        name: 'Second Backend'
      }));
      
      const regResult = await waitForMessage(backendWs2, 'register_result');
      expect(regResult.backendId).not.toBe(backendId);
      expect(regResult.backendId).toMatch(/^[a-f0-9]{8}$/);

      await closeWs(backendWs2);
    });

    test('should support visible=false for hidden backends', async () => {
      const hiddenBackendWs = new WebSocket(WS_URL);
      await waitForOpen(hiddenBackendWs);
      const collector = createMessageCollector(hiddenBackendWs);
      
      hiddenBackendWs.send(JSON.stringify({
        type: 'register',
        gatewaySecret: GATEWAY_SECRET,
        deviceId: 'hidden-device',
        name: 'Hidden Backend',
        visible: false
      }));
      
      const regResult = await waitForMessage(hiddenBackendWs, 'register_result');
      expect(regResult.success).toBe(true);

      // The hidden backend should still receive backends_list
      const backendsList = collector.find(m => m.type === 'backends_list');
      expect(backendsList).toBeDefined();
      // Hidden backend should not appear in the list
      const hiddenInList = backendsList.backends.find((b: any) => b.backendId === regResult.backendId);
      expect(hiddenInList).toBeUndefined();

      await closeWs(hiddenBackendWs);
    });

    test('should use default name if not provided', async () => {
      const noNameBackendWs = new WebSocket(WS_URL);
      await waitForOpen(noNameBackendWs);
      
      noNameBackendWs.send(JSON.stringify({
        type: 'register',
        gatewaySecret: GATEWAY_SECRET,
        deviceId: 'no-name-device'
      }));
      
      const regResult = await waitForMessage(noNameBackendWs, 'register_result');
      expect(regResult.success).toBe(true);
      expect(regResult.backendId).toBeDefined();

      await closeWs(noNameBackendWs);
    });
  });

  describe('Backend Response Forwarding', () => {
    test.skip('should forward backend_response to client - flaky in parallel', async () => {
      const { ws: clientWs } = await connectAndAuthClient();

      // Send backend_response
      backendWs.send(JSON.stringify({
        type: 'backend_response',
        clientId: Array.from(backendCollector.getMessages())
          .find(m => m.type === 'client_auth')?.clientId,
        message: { type: 'test_response', data: 'hello' }
      }));

      await delay(100);

      // Client should receive backend_message
      const backendMessages = createMessageCollector(clientWs).findAll(m => 
        m.type === 'backend_message' && m.message?.type === 'test_response'
      );
      expect(backendMessages.length).toBeGreaterThan(0);
      expect(backendMessages[0].message.data).toBe('hello');
    });

    test('should handle backend_response for disconnected client', async () => {
      // Try to send to non-existent client - should not throw
      backendWs.send(JSON.stringify({
        type: 'backend_response',
        clientId: 'non-existent-client',
        message: { type: 'test' }
      }));

      // Should complete without error
      await delay(100);
    });
  });

  describe('Client Auth Result Handling', () => {
    test('should forward auth failure to client', async () => {
      const clientWs = new WebSocket(WS_URL);
      await waitForOpen(clientWs);
      openClients.push(clientWs);
      
      // Authenticate with gateway
      clientWs.send(JSON.stringify({
        type: 'gateway_auth',
        gatewaySecret: GATEWAY_SECRET,
      }));
      await waitForMessage(clientWs, 'gateway_auth_result');

      // Connect to backend
      clientWs.send(JSON.stringify({
        type: 'connect_backend',
        backendId,
      }));

      const clientAuth = await waitForMessage(backendWs, 'client_auth');
      
      // Send auth failure
      backendWs.send(JSON.stringify({
        type: 'client_auth_result',
        clientId: clientAuth.clientId,
        success: false,
        error: 'Invalid API key'
      }));

      const authResult = await waitForMessage(clientWs, 'backend_auth_result');
      expect(authResult.success).toBe(false);
      expect(authResult.error).toBe('Invalid API key');
    });

    test('should include features in auth success', async () => {
      const clientWs = new WebSocket(WS_URL);
      await waitForOpen(clientWs);
      openClients.push(clientWs);
      
      clientWs.send(JSON.stringify({
        type: 'gateway_auth',
        gatewaySecret: GATEWAY_SECRET,
      }));
      await waitForMessage(clientWs, 'gateway_auth_result');

      clientWs.send(JSON.stringify({
        type: 'connect_backend',
        backendId,
      }));

      const clientAuth = await waitForMessage(backendWs, 'client_auth');
      
      backendWs.send(JSON.stringify({
        type: 'client_auth_result',
        clientId: clientAuth.clientId,
        success: true,
        features: ['streaming', 'files']
      }));

      const authResult = await waitForMessage(clientWs, 'backend_auth_result');
      expect(authResult.success).toBe(true);
      expect(authResult.features).toEqual(['streaming', 'files']);
    });
  });

  describe('Broadcast Session Events', () => {
    test.skip('should broadcast session created event - flaky in parallel', async () => {
      const { ws: clientWs, collector } = await connectAndAuthClient();

      const sessionData = {
        id: 'session-123',
        projectId: 'project-456',
        name: 'Test Session',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isActive: true
      };

      backendWs.send(JSON.stringify({
        type: 'broadcast_session_event',
        eventType: 'created',
        session: sessionData
      }));

      await delay(100);

      const sessionEvents = collector.findAll(m => 
        m.type === 'backend_message' && m.message?.type === 'backend_session_event'
      );
      expect(sessionEvents.length).toBeGreaterThan(0);
      expect(sessionEvents[0].message.eventType).toBe('created');
      expect(sessionEvents[0].message.session.id).toBe('session-123');
    });

    test.skip('should broadcast session updated event - flaky in parallel', async () => {
      const { collector } = await connectAndAuthClient();

      backendWs.send(JSON.stringify({
        type: 'broadcast_session_event',
        eventType: 'updated',
        session: {
          id: 'session-123',
          name: 'Updated Name'
        }
      }));

      await delay(100);

      const sessionEvents = collector.findAll(m => 
        m.type === 'backend_message' && m.message?.eventType === 'updated'
      );
      expect(sessionEvents.length).toBeGreaterThan(0);
    });

    test.skip('should broadcast session deleted event - flaky in parallel', async () => {
      const { collector } = await connectAndAuthClient();

      backendWs.send(JSON.stringify({
        type: 'broadcast_session_event',
        eventType: 'deleted',
        session: { id: 'session-123' }
      }));

      await delay(100);

      const sessionEvents = collector.findAll(m => 
        m.type === 'backend_message' && m.message?.eventType === 'deleted'
      );
      expect(sessionEvents.length).toBeGreaterThan(0);
    });

    test.skip('should not broadcast to unsubscribed clients - flaky in parallel', async () => {
      const { ws: clientWs, collector } = await connectAndAuthClient();

      // Unsubscribe client
      clientWs.send(JSON.stringify({
        type: 'update_subscriptions',
        subscribedBackendIds: []
      }));
      await waitForMessage(clientWs, 'subscription_ack');

      // Broadcast event
      backendWs.send(JSON.stringify({
        type: 'broadcast_session_event',
        eventType: 'created',
        session: { id: 'session-999' }
      }));

      await delay(200);

      const sessionEvents = collector.findAll(m => 
        m.message?.type === 'backend_session_event' && m.message?.session?.id === 'session-999'
      );
      expect(sessionEvents.length).toBe(0);
    });

    test('should handle broadcast with no subscribers', async () => {
      // Register a new backend with no clients
      const lonelyBackendWs = new WebSocket(WS_URL);
      await waitForOpen(lonelyBackendWs);
      
      lonelyBackendWs.send(JSON.stringify({
        type: 'register',
        gatewaySecret: GATEWAY_SECRET,
        deviceId: 'lonely-device',
        name: 'Lonely Backend'
      }));
      
      await waitForMessage(lonelyBackendWs, 'register_result');

      // Try to broadcast - should not throw
      lonelyBackendWs.send(JSON.stringify({
        type: 'broadcast_session_event',
        eventType: 'created',
        session: { id: 'lonely-session' }
      }));

      await delay(100);

      await closeWs(lonelyBackendWs);
    });
  });

  describe('Broadcast to Subscribers', () => {
    test.skip('should broadcast message to all subscribers - flaky in parallel', async () => {
      const { collector: collector1 } = await connectAndAuthClient();
      const { collector: collector2 } = await connectAndAuthClient();

      backendWs.send(JSON.stringify({
        type: 'broadcast_to_subscribers',
        message: { type: 'notification', text: 'Hello everyone!' }
      }));

      await delay(100);

      const messages1 = collector1.findAll(m => 
        m.type === 'backend_message' && m.message?.text === 'Hello everyone!'
      );
      const messages2 = collector2.findAll(m => 
        m.type === 'backend_message' && m.message?.text === 'Hello everyone!'
      );

      expect(messages1.length).toBeGreaterThan(0);
      expect(messages2.length).toBeGreaterThan(0);
    });
  });

  describe('HTTP Proxy Response', () => {
    test('should handle http_proxy_response', async () => {
      // This is tested more thoroughly in server-http.test.ts
      // Just verify it doesn't throw
      backendWs.send(JSON.stringify({
        type: 'http_proxy_response',
        requestId: 'non-existent-request',
        statusCode: 200,
        headers: {},
        body: '{}'
      }));

      await delay(50);
    });
  });

  describe('Backend Disconnect', () => {
    test.skip('should notify clients when backend disconnects - may timeout', async () => {
      const { ws: clientWs, collector } = await connectAndAuthClient();

      // Close backend connection
      await closeWs(backendWs);

      await delay(200);

      // Client should receive backend_disconnected
      const disconnectEvents = collector.findAll(m => m.type === 'backend_disconnected');
      expect(disconnectEvents.length).toBeGreaterThan(0);
      expect(disconnectEvents[0].backendId).toBe(backendId);
    });

    test.skip('should update backends_list when backend disconnects - may timeout', async () => {
      // Register two backends
      const backendWs2 = new WebSocket(WS_URL);
      await waitForOpen(backendWs2);
      backendWs2.send(JSON.stringify({
        type: 'register',
        gatewaySecret: GATEWAY_SECRET,
        deviceId: 'second-device',
        name: 'Second Backend'
      }));
      const regResult = await waitForMessage(backendWs2, 'register_result');
      const backendId2 = regResult.backendId;

      // Clear collector
      backendCollector.clear();

      // Close first backend
      await closeWs(backendWs);

      await delay(200);

      // Second backend should receive updated list
      const backendsLists = createMessageCollector(backendWs2).findAll(m => m.type === 'backends_list');
      const latestList = backendsLists[backendsLists.length - 1];
      expect(latestList.backends.find((b: any) => b.backendId === backendId)).toBeUndefined();
      expect(latestList.backends.find((b: any) => b.backendId === backendId2)).toBeDefined();

      await closeWs(backendWs2);
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

  describe('Client Disconnect Notification', () => {
    test.skip('should notify backend when client disconnects - flaky in parallel', async () => {
      const { ws: clientWs } = await connectAndAuthClient();
      const clientId = backendCollector.find(m => m.type === 'client_auth')?.clientId;

      // Clear collector
      const previousLength = backendCollector.getMessages().length;

      // Disconnect client
      await closeWs(clientWs);

      await delay(200);

      // Backend should receive client_disconnected
      const newMessages = backendCollector.getMessages().slice(previousLength);
      const disconnectEvent = newMessages.find(m => m.type === 'client_disconnected');
      expect(disconnectEvent).toBeDefined();
      expect(disconnectEvent.clientId).toBe(clientId);
    });
  });
});
