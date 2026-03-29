import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Server } from 'http';
import WebSocket from 'ws';
import { createGatewayServer } from '../server.js';

const GATEWAY_SECRET = 'test-secret-handshake-v2';
const TEST_PORT = 9061;
const WS_URL = `ws://127.0.0.1:${TEST_PORT}/ws`;

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
}

function waitForMessage<T = unknown>(ws: WebSocket, type: string, timeoutMs = 1000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error(`Timeout waiting for message type: ${type}`));
    }, timeoutMs);

    const handler = (data: WebSocket.Data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type !== type) return;
      clearTimeout(timer);
      ws.off('message', handler);
      resolve(msg);
    };

    ws.on('message', handler);
  });
}

function waitForClose(ws: WebSocket, timeoutMs = 1000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for websocket close')), timeoutMs);
    ws.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
}

describe('Gateway handshake v2', () => {
  let server: Server;

  beforeEach(async () => {
    server = createGatewayServer({ gatewaySecret: GATEWAY_SECRET, authTimeoutMs: 500 });
    await new Promise<void>((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('closes malformed peer_hello instead of leaving the socket unauthenticated', async () => {
    const ws = new WebSocket(WS_URL);
    await waitForOpen(ws);

    ws.send(JSON.stringify({
      type: 'peer_hello',
      protocolVersion: 2,
      peerType: 'client+backend',
      gatewaySecret: null,
      identity: { deviceId: 'device-a', instanceId: 'instance-a' },
      backend: { visible: true, capabilities: [] },
    }));

    const error = await waitForMessage<{ type: 'gateway_error'; message: string }>(ws, 'gateway_error');
    expect(error.message).toContain('gatewaySecret');

    const close = await waitForClose(ws);
    expect(close.code).toBe(1008);
  });

  test('accepts valid peer_hello and replies with peer_ready', async () => {
    const ws = new WebSocket(WS_URL);
    await waitForOpen(ws);

    ws.send(JSON.stringify({
      type: 'peer_hello',
      protocolVersion: 2,
      peerType: 'client+backend',
      gatewaySecret: GATEWAY_SECRET,
      identity: {
        deviceId: 'device-valid',
        instanceId: 'instance-valid',
        channel: 'test',
        name: 'Valid Backend',
      },
      backend: { visible: true, capabilities: [] },
    }));

    const ready = await waitForMessage<{ type: 'peer_ready'; backend?: { backendId: string } }>(ws, 'peer_ready');
    expect(ready.backend?.backendId).toBeTruthy();

    ws.close();
    await waitForClose(ws);
  });
});
