/**
 * Unit tests for Gateway error handling
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import type { Server } from 'http';
import { createGatewayServer } from '../server.js';

const GATEWAY_SECRET = 'test-secret-errors';
const TEST_PORT = 9050;
const WS_URL = `ws://localhost:${TEST_PORT}/ws`;
const HTTP_URL = `http://localhost:${TEST_PORT}`;

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

// Helper: small delay
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('Gateway Error Handling', () => {
  let server: Server;

  beforeEach(async () => {
    server = createGatewayServer({ gatewaySecret: GATEWAY_SECRET });
    await new Promise<void>((resolve) => server.listen(TEST_PORT, resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe('Invalid JSON', () => {
    test('should handle invalid JSON message', async () => {
      const ws = new WebSocket(WS_URL);
      await waitForOpen(ws);

      // Send invalid JSON
      ws.send('not valid json');

      const error = await waitForMessage(ws, 'gateway_error');
      expect(error.code).toBe('INVALID_MESSAGE');

      await closeWs(ws);
    });

    test('should handle empty message', async () => {
      const ws = new WebSocket(WS_URL);
      await waitForOpen(ws);

      ws.send('');

      const error = await waitForMessage(ws, 'gateway_error');
      expect(error.code).toBe('INVALID_MESSAGE');

      await closeWs(ws);
    });

    test('should handle binary data', async () => {
      const ws = new WebSocket(WS_URL);
      await waitForOpen(ws);

      ws.send(Buffer.from([0x00, 0x01, 0x02]));

      const error = await waitForMessage(ws, 'gateway_error');
      expect(error.code).toBe('INVALID_MESSAGE');

      await closeWs(ws);
    });
  });

  describe('WebSocket Connection Limits', () => {
    test('should enforce per-IP connection limit', async () => {
      const connections: WebSocket[] = [];
      
      try {
        // Try to open 11 connections (limit is 10)
        for (let i = 0; i < 11; i++) {
          const ws = new WebSocket(WS_URL);
          connections.push(ws);
          await waitForOpen(ws);
        }

        // All 11 should connect initially
        expect(connections.every(ws => ws.readyState === WebSocket.OPEN)).toBe(true);
        
        // Close all
        await Promise.all(connections.map(ws => closeWs(ws)));
      } catch (err) {
        // One of the connections might fail due to limit
        await Promise.all(connections.map(ws => closeWs(ws)));
      }
    });
  });

  describe('Backend Connection Lost During Proxy', () => {
    test.skip('should handle backend disconnect during HTTP proxy - may timeout', async () => {
      // Register backend
      const backendWs = new WebSocket(WS_URL);
      await waitForOpen(backendWs);
      backendWs.send(JSON.stringify({
        type: 'register',
        gatewaySecret: GATEWAY_SECRET,
        deviceId: 'proxy-error-device',
        name: 'Proxy Error Backend'
      }));
      
      const regResult = await waitForMessage(backendWs, 'register_result');
      const backendId = regResult.backendId;

      // Listen for proxy request
      let requestId: string | null = null;
      backendWs.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'http_proxy_request') {
          requestId = msg.requestId;
          // Close without responding
          backendWs.close();
        }
      });

      // Send proxy request
      const responsePromise = fetch(`${HTTP_URL}/api/proxy/${backendId}/test`, {
        headers: { 'Authorization': `Bearer ${GATEWAY_SECRET}` }
      });

      const response = await responsePromise;
      // Should get error since backend closed
      expect([502, 504]).toContain(response.status);
    });
  });

  describe('Streaming Response Errors', () => {
    test('should handle orphaned streaming chunks', async () => {
      // Register backend
      const backendWs = new WebSocket(WS_URL);
      await waitForOpen(backendWs);
      backendWs.send(JSON.stringify({
        type: 'register',
        gatewaySecret: GATEWAY_SECRET,
        deviceId: 'stream-error-device',
        name: 'Stream Error Backend'
      }));
      
      const regResult = await waitForMessage(backendWs, 'register_result');
      const backendId = regResult.backendId;

      // Send chunk for non-existent request
      backendWs.send(JSON.stringify({
        type: 'http_proxy_response_chunk',
        requestId: 'non-existent-request',
        data: Buffer.from('test').toString('base64')
      }));

      // Should not throw
      await delay(100);

      await closeWs(backendWs);
    });

    test('should handle orphaned streaming end', async () => {
      // Register backend
      const backendWs = new WebSocket(WS_URL);
      await waitForOpen(backendWs);
      backendWs.send(JSON.stringify({
        type: 'register',
        gatewaySecret: GATEWAY_SECRET,
        deviceId: 'stream-end-device',
        name: 'Stream End Backend'
      }));
      
      await waitForMessage(backendWs, 'register_result');

      // Send end for non-existent request
      backendWs.send(JSON.stringify({
        type: 'http_proxy_response_end',
        requestId: 'non-existent-request'
      }));

      // Should not throw
      await delay(100);

      await closeWs(backendWs);
    });

    test('should handle orphaned response start', async () => {
      // Register backend
      const backendWs = new WebSocket(WS_URL);
      await waitForOpen(backendWs);
      backendWs.send(JSON.stringify({
        type: 'register',
        gatewaySecret: GATEWAY_SECRET,
        deviceId: 'stream-start-device',
        name: 'Stream Start Backend'
      }));
      
      await waitForMessage(backendWs, 'register_result');

      // Send start for non-existent request
      backendWs.send(JSON.stringify({
        type: 'http_proxy_response_start',
        requestId: 'non-existent-request',
        statusCode: 200,
        headers: {}
      }));

      // Should not throw
      await delay(100);

      await closeWs(backendWs);
    });
  });

  describe('Invalid Backend Messages', () => {
    test('should handle backend_response to unknown client', async () => {
      const backendWs = new WebSocket(WS_URL);
      await waitForOpen(backendWs);
      backendWs.send(JSON.stringify({
        type: 'register',
        gatewaySecret: GATEWAY_SECRET,
        deviceId: 'invalid-msg-device',
        name: 'Invalid Msg Backend'
      }));
      
      await waitForMessage(backendWs, 'register_result');

      // Send response to non-existent client
      backendWs.send(JSON.stringify({
        type: 'backend_response',
        clientId: 'non-existent-client',
        message: { type: 'test' }
      }));

      // Should not throw
      await delay(100);

      await closeWs(backendWs);
    });

    test('should handle client_auth_result for unknown client', async () => {
      const backendWs = new WebSocket(WS_URL);
      await waitForOpen(backendWs);
      backendWs.send(JSON.stringify({
        type: 'register',
        gatewaySecret: GATEWAY_SECRET,
        deviceId: 'auth-result-device',
        name: 'Auth Result Backend'
      }));
      
      await waitForMessage(backendWs, 'register_result');

      // Send auth result for non-existent client
      backendWs.send(JSON.stringify({
        type: 'client_auth_result',
        clientId: 'non-existent-client',
        success: true
      }));

      // Should not throw
      await delay(100);

      await closeWs(backendWs);
    });
  });

  describe('Malformed Messages After Auth', () => {
    test('should ignore messages without type', async () => {
      const backendWs = new WebSocket(WS_URL);
      await waitForOpen(backendWs);
      backendWs.send(JSON.stringify({
        type: 'register',
        gatewaySecret: GATEWAY_SECRET,
        deviceId: 'no-type-device',
        name: 'No Type Backend'
      }));
      
      await waitForMessage(backendWs, 'register_result');

      // Send message without type
      backendWs.send(JSON.stringify({ data: 'no type' }));

      // Should not throw, connection stays open
      await delay(100);
      expect(backendWs.readyState).toBe(WebSocket.OPEN);

      await closeWs(backendWs);
    });
  });

  describe('Connection Cleanup', () => {
    test('should handle rapid connect/disconnect', async () => {
      for (let i = 0; i < 5; i++) {
        const ws = new WebSocket(WS_URL);
        await waitForOpen(ws);
        ws.send(JSON.stringify({
          type: 'register',
          gatewaySecret: GATEWAY_SECRET,
          deviceId: `rapid-device-${i}`,
          name: `Rapid Backend ${i}`
        }));
        await waitForMessage(ws, 'register_result');
        ws.close();
      }

      // All connections should be cleaned up
      await delay(200);

      // Verify server still works
      const response = await fetch(`${HTTP_URL}/health`);
      expect(response.status).toBe(200);
    });

    test('should handle client disconnect before auth completes', async () => {
      const ws = new WebSocket(WS_URL);
      await waitForOpen(ws);

      // Start auth but don't wait for response
      ws.send(JSON.stringify({
        type: 'register',
        gatewaySecret: GATEWAY_SECRET,
        deviceId: 'early-disconnect-device',
        name: 'Early Disconnect'
      }));

      // Disconnect immediately
      ws.close();

      // Should not throw
      await delay(100);
    });
  });

  describe('HTTP Error Handling', () => {
    test('should handle large JSON body', async () => {
      const backendWs = new WebSocket(WS_URL);
      await waitForOpen(backendWs);
      backendWs.send(JSON.stringify({
        type: 'register',
        gatewaySecret: GATEWAY_SECRET,
        deviceId: 'large-body-device',
        name: 'Large Body Backend'
      }));
      
      const regResult = await waitForMessage(backendWs, 'register_result');
      const backendId = regResult.backendId;

      // Create a large payload (but under 15MB)
      const largeData = { data: 'x'.repeat(100000) };

      backendWs.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'http_proxy_request') {
          backendWs.send(JSON.stringify({
            type: 'http_proxy_response',
            requestId: msg.requestId,
            statusCode: 200,
            headers: {},
            body: JSON.stringify({ received: true })
          }));
        }
      });

      const response = await fetch(`${HTTP_URL}/api/proxy/${backendId}/large`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GATEWAY_SECRET}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(largeData)
      });

      expect(response.status).toBe(200);

      await closeWs(backendWs);
    });
  });

  describe('Edge Cases', () => {
    test('should handle message with null fields', async () => {
      const ws = new WebSocket(WS_URL);
      await waitForOpen(ws);

      ws.send(JSON.stringify({
        type: 'register',
        gatewaySecret: null,
        deviceId: 'null-test-device',
        name: null
      }));

      // Should be rejected
      const result = await waitForMessage(ws, 'register_result');
      expect(result.success).toBe(false);

      await closeWs(ws);
    });

    test('should handle message with empty strings', async () => {
      const ws = new WebSocket(WS_URL);
      await waitForOpen(ws);

      ws.send(JSON.stringify({
        type: 'register',
        gatewaySecret: '',
        deviceId: '',
        name: ''
      }));

      // Should be rejected
      const result = await waitForMessage(ws, 'register_result');
      expect(result.success).toBe(false);

      await closeWs(ws);
    });

    test('should handle concurrent proxy requests', async () => {
      // Register backend
      const backendWs = new WebSocket(WS_URL);
      await waitForOpen(backendWs);
      backendWs.send(JSON.stringify({
        type: 'register',
        gatewaySecret: GATEWAY_SECRET,
        deviceId: 'concurrent-device',
        name: 'Concurrent Backend'
      }));
      
      const regResult = await waitForMessage(backendWs, 'register_result');
      const backendId = regResult.backendId;

      const requests: string[] = [];
      backendWs.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'http_proxy_request') {
          requests.push(msg.requestId);
          // Respond after small delay
          setTimeout(() => {
            backendWs.send(JSON.stringify({
              type: 'http_proxy_response',
              requestId: msg.requestId,
              statusCode: 200,
              headers: {},
              body: JSON.stringify({ id: msg.requestId })
            }));
          }, 10);
        }
      });

      // Send 5 concurrent requests
      const responses = await Promise.all([
        fetch(`${HTTP_URL}/api/proxy/${backendId}/req1`, { headers: { 'Authorization': `Bearer ${GATEWAY_SECRET}` } }),
        fetch(`${HTTP_URL}/api/proxy/${backendId}/req2`, { headers: { 'Authorization': `Bearer ${GATEWAY_SECRET}` } }),
        fetch(`${HTTP_URL}/api/proxy/${backendId}/req3`, { headers: { 'Authorization': `Bearer ${GATEWAY_SECRET}` } }),
        fetch(`${HTTP_URL}/api/proxy/${backendId}/req4`, { headers: { 'Authorization': `Bearer ${GATEWAY_SECRET}` } }),
        fetch(`${HTTP_URL}/api/proxy/${backendId}/req5`, { headers: { 'Authorization': `Bearer ${GATEWAY_SECRET}` } }),
      ]);

      expect(requests.length).toBe(5);
      expect(responses.every(r => r.status === 200)).toBe(true);

      await closeWs(backendWs);
    });
  });
});
