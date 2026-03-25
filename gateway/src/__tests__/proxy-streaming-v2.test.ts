import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Server } from 'http';
import WebSocket from 'ws';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createGatewayServer } from '../server.js';

const GATEWAY_SECRET = 'test-secret-stream-v2';
const TEST_PORT = 9060;
const WS_URL = `ws://127.0.0.1:${TEST_PORT}/ws`;
const HTTP_URL = `http://127.0.0.1:${TEST_PORT}`;

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
}

function closeWs(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    ws.once('close', () => resolve());
    ws.close();
  });
}

function waitForMessage<T = any>(ws: WebSocket, type: string, timeoutMs = 1000): Promise<T> {
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

async function registerBackend(ws: WebSocket, name: string) {
  ws.send(JSON.stringify({
    type: 'peer_hello',
    protocolVersion: 2,
    peerType: 'client+backend',
    gatewaySecret: GATEWAY_SECRET,
    identity: {
      deviceId: `device-${name}`,
      instanceId: `instance-${name}`,
      channel: 'test',
      name,
    },
    backend: {
      visible: true,
      capabilities: [],
    },
  }));

  const ready = await waitForMessage<{
    type: 'peer_ready';
    backend?: { backendId: string };
  }>(ws, 'peer_ready');

  expect(ready.backend?.backendId).toBeTruthy();
  return ready.backend!.backendId;
}

describe('Gateway Proxy Streaming V2', () => {
  let server: Server;
  let dataDir: string;
  let previousDataDir: string | undefined;

  beforeEach(async () => {
    previousDataDir = process.env.MY_CLAUDIA_DATA_DIR;
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-proxy-v2-'));
    process.env.MY_CLAUDIA_DATA_DIR = dataDir;
    server = createGatewayServer({ gatewaySecret: GATEWAY_SECRET });
    await new Promise<void>((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousDataDir === undefined) {
      delete process.env.MY_CLAUDIA_DATA_DIR;
    } else {
      process.env.MY_CLAUDIA_DATA_DIR = previousDataDir;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('does not return 502 after http_proxy_response_start begins streaming', async () => {
    const backendWs = new WebSocket(WS_URL);
    await waitForOpen(backendWs);
    const backendId = await registerBackend(backendWs, 'stream-backend');

    backendWs.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type !== 'http_proxy_request') return;

      backendWs.send(JSON.stringify({
        type: 'http_proxy_response_start',
        requestId: msg.requestId,
        statusCode: 200,
        headers: {
          'content-type': 'text/plain',
        },
      }));
      backendWs.send(JSON.stringify({
        type: 'http_proxy_response_chunk',
        requestId: msg.requestId,
        data: Buffer.from('Hello ').toString('base64'),
      }));
      backendWs.send(JSON.stringify({
        type: 'http_proxy_response_chunk',
        requestId: msg.requestId,
        data: Buffer.from('Gateway').toString('base64'),
      }));
      backendWs.send(JSON.stringify({
        type: 'http_proxy_response_end',
        requestId: msg.requestId,
      }));
    });

    const response = await fetch(`${HTTP_URL}/api/proxy/${backendId}/stream`, {
      headers: { Authorization: `Bearer ${GATEWAY_SECRET}` },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Hello Gateway');

    await closeWs(backendWs);
  });

  test('preserves attachment headers and binary body for streamed downloads', async () => {
    const backendWs = new WebSocket(WS_URL);
    await waitForOpen(backendWs);
    const backendId = await registerBackend(backendWs, 'download-backend');

    backendWs.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type !== 'http_proxy_request') return;

      backendWs.send(JSON.stringify({
        type: 'http_proxy_response_start',
        requestId: msg.requestId,
        statusCode: 200,
        headers: {
          'content-type': 'application/octet-stream',
          'content-disposition': 'attachment; filename="archive.bin"',
        },
      }));
      backendWs.send(JSON.stringify({
        type: 'http_proxy_response_chunk',
        requestId: msg.requestId,
        data: Buffer.from([0x00, 0x01, 0xfe]).toString('base64'),
      }));
      backendWs.send(JSON.stringify({
        type: 'http_proxy_response_chunk',
        requestId: msg.requestId,
        data: Buffer.from([0xff, 0x41]).toString('base64'),
      }));
      backendWs.send(JSON.stringify({
        type: 'http_proxy_response_end',
        requestId: msg.requestId,
      }));
    });

    const response = await fetch(`${HTTP_URL}/api/proxy/${backendId}/download`, {
      headers: { Authorization: `Bearer ${GATEWAY_SECRET}` },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="archive.bin"');
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([0x00, 0x01, 0xfe, 0xff, 0x41])
    );

    await closeWs(backendWs);
  });

  test('preserves binary request bodies when proxying uploads', async () => {
    const backendWs = new WebSocket(WS_URL);
    await waitForOpen(backendWs);
    const backendId = await registerBackend(backendWs, 'upload-backend');

    const requestPromise = waitForMessage<{
      type: 'http_proxy_request';
      bodyEncoding?: 'utf8' | 'base64';
      body?: string;
    }>(backendWs, 'http_proxy_request');

    const uploadBody = new Uint8Array([0x00, 0x01, 0xfe, 0xff, 0x41]);
    const responsePromise = fetch(`${HTTP_URL}/api/proxy/${backendId}/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GATEWAY_SECRET}`,
        'content-type': 'application/octet-stream',
      },
      body: uploadBody,
    });

    const request = await requestPromise;
    expect(request.bodyEncoding).toBe('base64');
    expect(request.body).toBe(Buffer.from(uploadBody).toString('base64'));

    backendWs.send(JSON.stringify({
      type: 'http_proxy_response',
      requestId: request.requestId,
      statusCode: 204,
      headers: {},
      bodyEncoding: 'utf8',
      body: '',
    }));

    const response = await responsePromise;
    expect(response.status).toBe(204);

    await closeWs(backendWs);
  });
});
