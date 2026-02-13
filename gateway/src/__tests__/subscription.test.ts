/**
 * Unit tests for Gateway session subscription mechanism
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import WebSocket from 'ws';
import type {
  GatewayClientAuthMessage,
  GatewayToBackendMessage,
  BackendToGatewayMessage,
  GatewayBroadcastSessionEventMessage,
  GatewayClientSubscribedMessage,
} from '@my-claudia/shared';

// Mock WebSocket server setup
describe('Gateway Session Subscription', () => {
  let gatewayWs: WebSocket.Server;
  let backendWs: WebSocket | null = null;
  let clientWsA: WebSocket | null = null;
  let clientWsB: WebSocket | null = null;

  const GATEWAY_PORT = 9001;
  const GATEWAY_SECRET = 'test-secret';

  beforeEach((done) => {
    // Start a mock gateway server
    gatewayWs = new WebSocket.Server({ port: GATEWAY_PORT });

    gatewayWs.on('listening', () => {
      done();
    });
  });

  afterEach((done) => {
    // Cleanup
    if (backendWs) {
      backendWs.close();
      backendWs = null;
    }
    if (clientWsA) {
      clientWsA.close();
      clientWsA = null;
    }
    if (clientWsB) {
      clientWsB.close();
      clientWsB = null;
    }

    gatewayWs.close(() => {
      done();
    });
  });

  test('should auto-subscribe client on successful authentication', (done) => {
    const backendId = 'test-backend-1';
    const clientId = 'test-client-1';
    let backendReceived: any[] = [];
    let clientReceived: any[] = [];

    gatewayWs.on('connection', (ws, req) => {
      const url = req.url || '';

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());

        // Backend registration
        if (message.type === 'register') {
          ws.send(JSON.stringify({
            type: 'register_result',
            success: true,
            backendId
          }));
        }

        // Client auth
        if (message.type === 'gateway_auth') {
          // Forward to backend
          const authMsg: GatewayClientAuthMessage = {
            type: 'client_auth',
            clientId: message.clientId,
            apiKey: message.apiKey
          };

          // Mock backend auth response
          setTimeout(() => {
            ws.send(JSON.stringify({
              type: 'client_auth_result',
              clientId,
              success: true,
              features: []
            }));
          }, 10);
        }
      });
    });

    // Connect backend
    backendWs = new WebSocket(`ws://localhost:${GATEWAY_PORT}/ws`);
    backendWs.on('open', () => {
      backendWs!.send(JSON.stringify({
        type: 'register',
        gatewaySecret: GATEWAY_SECRET,
        deviceId: 'device-1',
        visible: true
      }));
    });

    backendWs.on('message', (data) => {
      const message = JSON.parse(data.toString());
      backendReceived.push(message);

      // Check for client_subscribed message
      if (message.type === 'client_subscribed') {
        expect(message.clientId).toBe(clientId);
        done();
      }
    });

    // Connect client after backend is ready
    setTimeout(() => {
      clientWsA = new WebSocket(`ws://localhost:${GATEWAY_PORT}/ws`);
      clientWsA.on('open', () => {
        clientWsA!.send(JSON.stringify({
          type: 'gateway_auth',
          clientId,
          backendId,
          apiKey: 'test-key'
        }));
      });
    }, 100);
  }, 10000);

  test('should broadcast session event to all subscribed clients', (done) => {
    const backendId = 'test-backend-2';
    const clientIdA = 'test-client-a';
    const clientIdB = 'test-client-b';
    const sessionData = {
      id: 'session-1',
      projectId: 'proj-1',
      name: 'Test Session',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isActive: true
    };

    let clientAReceived = false;
    let clientBReceived = false;

    const subscriptions = new Map<string, Set<string>>();

    gatewayWs.on('connection', (ws, req) => {
      let connectedBackendId: string | null = null;
      let connectedClientId: string | null = null;

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());

        // Backend registration
        if (message.type === 'register') {
          connectedBackendId = backendId;
          ws.send(JSON.stringify({
            type: 'register_result',
            success: true,
            backendId
          }));
        }

        // Client auth
        if (message.type === 'gateway_auth') {
          connectedClientId = message.clientId;

          // Add to subscriptions
          if (!subscriptions.has(backendId)) {
            subscriptions.set(backendId, new Set());
          }
          subscriptions.get(backendId)!.add(message.clientId);

          ws.send(JSON.stringify({
            type: 'client_auth_result',
            clientId: message.clientId,
            success: true,
            features: []
          }));
        }

        // Broadcast session event
        if (message.type === 'broadcast_session_event') {
          const broadcastMsg: GatewayBroadcastSessionEventMessage = message;
          const subscribers = subscriptions.get(backendId);

          if (subscribers) {
            // Broadcast to all subscribed clients
            gatewayWs.clients.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                  type: 'backend_session_event',
                  backendId,
                  eventType: broadcastMsg.eventType,
                  session: broadcastMsg.session
                }));
              }
            });
          }
        }
      });
    });

    // Connect backend
    backendWs = new WebSocket(`ws://localhost:${GATEWAY_PORT}/ws`);
    backendWs.on('open', () => {
      backendWs!.send(JSON.stringify({
        type: 'register',
        gatewaySecret: GATEWAY_SECRET,
        deviceId: 'device-2',
        visible: true
      }));

      // Connect clients after backend
      setTimeout(() => {
        // Client A
        clientWsA = new WebSocket(`ws://localhost:${GATEWAY_PORT}/ws`);
        clientWsA.on('open', () => {
          clientWsA!.send(JSON.stringify({
            type: 'gateway_auth',
            clientId: clientIdA,
            backendId,
            apiKey: 'test-key'
          }));
        });
        clientWsA.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'backend_session_event') {
            expect(msg.session.id).toBe(sessionData.id);
            clientAReceived = true;
            if (clientBReceived) done();
          }
        });

        // Client B
        clientWsB = new WebSocket(`ws://localhost:${GATEWAY_PORT}/ws`);
        clientWsB.on('open', () => {
          clientWsB!.send(JSON.stringify({
            type: 'gateway_auth',
            clientId: clientIdB,
            backendId,
            apiKey: 'test-key'
          }));
        });
        clientWsB.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'backend_session_event') {
            expect(msg.session.id).toBe(sessionData.id);
            clientBReceived = true;
            if (clientAReceived) done();
          }
        });
      }, 100);
    });

    // Broadcast event after clients connected
    setTimeout(() => {
      backendWs!.send(JSON.stringify({
        type: 'broadcast_session_event',
        eventType: 'created',
        session: sessionData
      }));
    }, 500);
  }, 10000);

  test('should cleanup subscriptions on client disconnect', (done) => {
    const backendId = 'test-backend-3';
    const clientId = 'test-client-disconnect';
    const subscriptions = new Map<string, Set<string>>();

    gatewayWs.on('connection', (ws, req) => {
      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());

        if (message.type === 'register') {
          ws.send(JSON.stringify({
            type: 'register_result',
            success: true,
            backendId
          }));
        }

        if (message.type === 'gateway_auth') {
          if (!subscriptions.has(backendId)) {
            subscriptions.set(backendId, new Set());
          }
          subscriptions.get(backendId)!.add(message.clientId);

          ws.send(JSON.stringify({
            type: 'client_auth_result',
            clientId: message.clientId,
            success: true,
            features: []
          }));
        }
      });

      ws.on('close', () => {
        // Cleanup subscriptions
        subscriptions.forEach((subscribers, bid) => {
          if (subscribers.has(clientId)) {
            subscribers.delete(clientId);
            if (subscribers.size === 0) {
              subscriptions.delete(bid);
            }
          }
        });
      });
    });

    // Connect backend
    backendWs = new WebSocket(`ws://localhost:${GATEWAY_PORT}/ws`);
    backendWs.on('open', () => {
      backendWs!.send(JSON.stringify({
        type: 'register',
        gatewaySecret: GATEWAY_SECRET,
        deviceId: 'device-3',
        visible: true
      }));

      setTimeout(() => {
        // Connect client
        clientWsA = new WebSocket(`ws://localhost:${GATEWAY_PORT}/ws`);
        clientWsA.on('open', () => {
          clientWsA!.send(JSON.stringify({
            type: 'gateway_auth',
            clientId,
            backendId,
            apiKey: 'test-key'
          }));

          // Verify subscription exists
          setTimeout(() => {
            expect(subscriptions.has(backendId)).toBe(true);
            expect(subscriptions.get(backendId)?.has(clientId)).toBe(true);

            // Disconnect client
            clientWsA!.close();

            // Verify cleanup
            setTimeout(() => {
              if (subscriptions.has(backendId)) {
                expect(subscriptions.get(backendId)?.has(clientId)).toBe(false);
              }
              done();
            }, 100);
          }, 100);
        });
      }, 100);
    });
  }, 10000);
});
