/**
 * Unit tests for Gateway authentication and rate limiting
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import type { Server } from 'http';
import { createGatewayServer } from '../server.js';

const GATEWAY_SECRET = 'test-secret-auth';
const TEST_PORT = 9010;
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

describe('Gateway Authentication', () => {
  let server: Server;

  beforeEach(async () => {
    server = createGatewayServer({ gatewaySecret: GATEWAY_SECRET });
    await new Promise<void>((resolve) => server.listen(TEST_PORT, resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe('Backend Registration', () => {
    test('should reject backend registration with invalid secret', async () => {
      const ws = new WebSocket(WS_URL);
      await waitForOpen(ws);

      ws.send(JSON.stringify({
        type: 'register',
        gatewaySecret: 'wrong-secret',
        deviceId: 'test-device',
        name: 'Test Backend'
      }));

      const result = await waitForMessage(ws, 'register_result');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid');

      await closeWs(ws);
    });

    test('should accept backend registration with valid secret', async () => {
      const ws = new WebSocket(WS_URL);
      await waitForOpen(ws);

      ws.send(JSON.stringify({
        type: 'register',
        gatewaySecret: GATEWAY_SECRET,
        deviceId: 'test-device-valid',
        name: 'Test Backend'
      }));

      const result = await waitForMessage(ws, 'register_result');
      expect(result.success).toBe(true);
      expect(result.backendId).toMatch(/^[a-f0-9]{8}$/);

      await closeWs(ws);
    });

    test('should handle backend reconnection', async () => {
      const ws1 = new WebSocket(WS_URL);
      await waitForOpen(ws1);

      ws1.send(JSON.stringify({
        type: 'register',
        gatewaySecret: GATEWAY_SECRET,
        deviceId: 'test-device-reconnect',
        name: 'Test Backend'
      }));

      const result1 = await waitForMessage(ws1, 'register_result');
      expect(result1.success).toBe(true);
      const backendId = result1.backendId;

      // Connect second WebSocket with same deviceId
      const ws2 = new WebSocket(WS_URL);
      await waitForOpen(ws2);

      ws2.send(JSON.stringify({
        type: 'register',
        gatewaySecret: GATEWAY_SECRET,
        deviceId: 'test-device-reconnect',
        name: 'Test Backend'
      }));

      const result2 = await waitForMessage(ws2, 'register_result');
      expect(result2.success).toBe(true);
      expect(result2.backendId).toBe(backendId);

      // First connection should be closed
      await new Promise<void>((resolve) => {
        ws1.on('close', () => resolve());
      });

      await closeWs(ws2);
    });

    test('should reject non-string secrets in safeCompare', async () => {
      const ws = new WebSocket(WS_URL);
      await waitForOpen(ws);

      // Send registration with null secret (will be parsed as string "null" in JSON)
      ws.send(JSON.stringify({
        type: 'register',
        gatewaySecret: null,
        deviceId: 'test-device-null',
        name: 'Test Backend'
      }));

      const result = await waitForMessage(ws, 'register_result');
      expect(result.success).toBe(false);

      await closeWs(ws);
    });
  });

  describe('Client Authentication', () => {
    test('should reject client with invalid gateway secret', async () => {
      const ws = new WebSocket(WS_URL);
      await waitForOpen(ws);

      ws.send(JSON.stringify({
        type: 'gateway_auth',
        gatewaySecret: 'wrong-secret'
      }));

      const result = await waitForMessage(ws, 'gateway_auth_result');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid');

      await closeWs(ws);
    });

    test('should accept client with valid gateway secret', async () => {
      const ws = new WebSocket(WS_URL);
      await waitForOpen(ws);

      ws.send(JSON.stringify({
        type: 'gateway_auth',
        gatewaySecret: GATEWAY_SECRET
      }));

      const result = await waitForMessage(ws, 'gateway_auth_result');
      expect(result.success).toBe(true);
      expect(result.backends).toBeDefined();

      await closeWs(ws);
    });
  });

  describe('HTTP Authentication', () => {
    test('should reject request without authorization header', async () => {
      const response = await fetch(`${HTTP_URL}/api/proxy/test-id/some-path`);
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    test('should reject request with invalid bearer token', async () => {
      const response = await fetch(`${HTTP_URL}/api/proxy/test-id/some-path`, {
        headers: {
          'Authorization': 'Bearer wrong-secret'
        }
      });
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    test('should reject request with invalid authorization format', async () => {
      const response = await fetch(`${HTTP_URL}/api/proxy/test-id/some-path`, {
        headers: {
          'Authorization': 'Basic wrong-format'
        }
      });
      expect(response.status).toBe(401);
    });

    test('should accept request with valid bearer token', async () => {
      // First register a backend
      const backendWs = new WebSocket(WS_URL);
      await waitForOpen(backendWs);
      backendWs.send(JSON.stringify({
        type: 'register',
        gatewaySecret: GATEWAY_SECRET,
        deviceId: 'http-test-device',
        name: 'HTTP Test Backend'
      }));
      const regResult = await waitForMessage(backendWs, 'register_result');
      const backendId = regResult.backendId;

      // Handle proxy request - respond immediately
      backendWs.once('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'http_proxy_request') {
          backendWs.send(JSON.stringify({
            type: 'http_proxy_response',
            requestId: msg.requestId,
            statusCode: 200,
            headers: {},
            body: JSON.stringify({ success: true })
          }));
        }
      });

      // Now try HTTP proxy
      const response = await fetch(`${HTTP_URL}/api/proxy/${backendId}/test-path`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GATEWAY_SECRET}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ test: 'data' })
      });

      expect(response.status).toBe(200);

      await closeWs(backendWs);
    });

    test.skip('should accept clientId:gatewaySecret format - has side effects', async () => {
      // Skipped due to test isolation issues
    });
  });
});

describe('Gateway Rate Limiting', () => {
  let server: Server;

  beforeEach(async () => {
    server = createGatewayServer({ gatewaySecret: GATEWAY_SECRET });
    await new Promise<void>((resolve) => server.listen(TEST_PORT + 1, resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('should rate limit after 10 failed attempts', async () => {
    const testPort = 9011;
    const testUrl = `http://localhost:${testPort}`;
    
    // Make 10 failed requests first
    for (let i = 0; i < 10; i++) {
      const response = await fetch(`${testUrl}/api/proxy/test-id/path`, {
        headers: {
          'Authorization': 'Bearer wrong-secret'
        }
      });
      expect(response.status).toBe(401);
    }

    // 11th request should be rate limited
    const response = await fetch(`${testUrl}/api/proxy/test-id/path`, {
      headers: {
        'Authorization': 'Bearer wrong-secret'
      }
    });
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error.code).toBe('RATE_LIMITED');
  });
});

describe('Invalid First Messages', () => {
  let server: Server;

  beforeEach(async () => {
    server = createGatewayServer({ gatewaySecret: GATEWAY_SECRET });
    await new Promise<void>((resolve) => server.listen(TEST_PORT + 2, resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('should reject unknown first message type', async () => {
    const ws = new WebSocket(`ws://localhost:9012/ws`);
    await waitForOpen(ws);

    ws.send(JSON.stringify({
      type: 'unknown_type'
    }));

    const error = await waitForMessage(ws, 'gateway_error');
    expect(error.code).toBe('INVALID_FIRST_MESSAGE');

    await closeWs(ws);
  });

  test('should close connection after invalid first message', async () => {
    const ws = new WebSocket(`ws://localhost:9012/ws`);
    await waitForOpen(ws);

    ws.send(JSON.stringify({
      type: 'invalid'
    }));

    await new Promise<void>((resolve) => {
      ws.on('close', () => resolve());
    });
  });
});

describe('Connection Timeout', () => {
  let server: Server;

  beforeEach(async () => {
    server = createGatewayServer({ gatewaySecret: GATEWAY_SECRET });
    await new Promise<void>((resolve) => server.listen(TEST_PORT + 3, resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test.skip('should close unauthenticated connection after timeout - requires 10s', async () => {});
});
