#!/usr/bin/env node
/**
 * MCP bridge with auto-detecting stdio framing.
 *
 * Different CLI tools use different MCP transports:
 *   - Claude CLI: Content-Length framing (official MCP spec)
 *   - Kimi CLI:   newline-delimited JSON
 *
 * This bridge auto-detects the framing protocol from the first bytes received
 * and adapts both reading and writing accordingly.
 */

import * as http from 'http';
import { readFileSync } from 'fs';

const SERVER_URL = process.env.CLAUDIA_BRIDGE_URL || 'http://127.0.0.1:3100';
const STATIC_SESSION_ID = process.env.CLAUDIA_SESSION_ID || '';
const SESSION_ID_FILE = process.env.CLAUDIA_SESSION_ID_FILE || '';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

let inFlightRequests = 0;
let shuttingDown = false;
let shutdownCode = 0;
let readBuffer = Buffer.alloc(0);

function getSessionId(): string {
  if (SESSION_ID_FILE) {
    try {
      return readFileSync(SESSION_ID_FILE, 'utf-8').trim();
    } catch {
      return STATIC_SESSION_ID;
    }
  }
  return STATIC_SESSION_ID;
}

function log(message: string, extra?: unknown): void {
  if (extra !== undefined) {
    console.error(`[MCP Bridge] ${message}`, extra);
    return;
  }
  console.error(`[MCP Bridge] ${message}`);
}

function requestShutdown(reason: string, code = 0): void {
  if (!shuttingDown) {
    log(`shutdown requested: ${reason} (inFlight=${inFlightRequests})`);
  }
  shuttingDown = true;
  shutdownCode = Math.max(shutdownCode, code);
  if (inFlightRequests === 0) {
    process.exit(shutdownCode);
  }
}

function isBrokenPipe(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 'EPIPE' || code === 'ECONNRESET';
}

// Auto-detected framing protocol: null = not yet detected
let framingMode: 'content-length' | 'newline' | null = null;

function writeMessage(message: JsonRpcResponse | { jsonrpc: '2.0'; method: string; params?: Record<string, unknown> }): void {
  const json = JSON.stringify(message);
  try {
    if (framingMode === 'newline') {
      process.stdout.write(json + '\n');
    } else {
      // Default to Content-Length framing (official MCP spec)
      const body = Buffer.from(json, 'utf-8');
      const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf-8');
      process.stdout.write(Buffer.concat([header, body]));
    }
  } catch (error) {
    if (isBrokenPipe(error)) {
      requestShutdown(`stdout broken pipe during write (${String((error as { code?: unknown }).code || 'unknown')})`);
      return;
    }
    log('stdout write failed', error);
    requestShutdown('stdout write failure', 1);
  }
}

function send(response: JsonRpcResponse): void {
  writeMessage(response);
}

function sendNotification(method: string, params?: Record<string, unknown>): void {
  writeMessage({ jsonrpc: '2.0', method, params });
}

function detectFraming(): void {
  if (framingMode !== null || readBuffer.length === 0) return;

  // Peek at first non-whitespace byte to determine protocol
  const firstChar = readBuffer.toString('utf-8').trimStart()[0];
  if (firstChar === '{') {
    framingMode = 'newline';
    log('detected newline-delimited JSON framing');
  } else {
    framingMode = 'content-length';
    log('detected Content-Length framing');
  }
}

function parseNextMessage(): string | null {
  detectFraming();

  if (framingMode === 'newline') {
    return parseNewlineMessage();
  }
  return parseContentLengthMessage();
}

function parseNewlineMessage(): string | null {
  const newlineIdx = readBuffer.indexOf(0x0a); // \n
  if (newlineIdx === -1) return null;

  const line = readBuffer.subarray(0, newlineIdx).toString('utf-8').trim();
  readBuffer = readBuffer.subarray(newlineIdx + 1);

  if (!line) return parseNewlineMessage(); // skip empty lines
  return line;
}

function parseContentLengthMessage(): string | null {
  const separator = Buffer.from('\r\n\r\n');
  const headerEnd = readBuffer.indexOf(separator);
  if (headerEnd === -1) return null;

  const headerText = readBuffer.subarray(0, headerEnd).toString('utf-8');
  const contentLengthLine = headerText
    .split('\r\n')
    .find((line) => line.toLowerCase().startsWith('content-length:'));

  if (!contentLengthLine) {
    throw new Error('Missing Content-Length header');
  }

  const contentLength = Number.parseInt(contentLengthLine.split(':')[1]?.trim() || '', 10);
  if (!Number.isFinite(contentLength) || contentLength < 0) {
    throw new Error(`Invalid Content-Length header: ${contentLengthLine}`);
  }

  const messageStart = headerEnd + separator.length;
  const messageEnd = messageStart + contentLength;
  if (readBuffer.length < messageEnd) return null;

  const body = readBuffer.subarray(messageStart, messageEnd).toString('utf-8');
  readBuffer = readBuffer.subarray(messageEnd);
  return body;
}

function pumpMessages(): void {
  while (!shuttingDown) {
    let raw: string | null;
    try {
      raw = parseNextMessage();
    } catch (error) {
      log('frame parse error', error);
      send({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
      readBuffer = Buffer.alloc(0);
      return;
    }

    if (raw === null) return;

    inFlightRequests += 1;
    void (async () => {
      try {
        const request = JSON.parse(raw!) as JsonRpcRequest;
        await handleRequest(request);
      } catch (error) {
        send({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        });
        log('json parse error', error);
      } finally {
        inFlightRequests -= 1;
        if (shuttingDown && inFlightRequests === 0) {
          process.exit(shutdownCode);
        }
      }
    })();
  }
}

const HTTP_TIMEOUT_MS = 30_000;

function httpGet(urlPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, SERVER_URL);
    const req = http.get({ ...url, timeout: HTTP_TIMEOUT_MS }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new Error('HTTP GET timeout')); });
    req.on('error', reject);
  });
}

function httpPost(urlPath: string, body: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, SERVER_URL);
    const postData = JSON.stringify(body);
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      timeout: HTTP_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new Error('HTTP POST timeout')); });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function listTools(): Promise<McpTool[]> {
  try {
    const sessionId = getSessionId();
    const toolListPath = sessionId
      ? `/api/plugins/tools?sessionId=${encodeURIComponent(sessionId)}`
      : '/api/plugins/tools';
    log(`tools/list start session=${sessionId || 'none'}`);
    const raw = await httpGet(toolListPath);
    const data = JSON.parse(raw);
    const tools = data.tools || [];
    log(`tools/list ok count=${Array.isArray(tools) ? tools.length : 0}`);
    return tools;
  } catch (error) {
    log('tools/list failed', error);
    return [];
  }
}

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const sessionId = getSessionId();
  try {
    log(`tools/call start name=${name} session=${sessionId || 'none'} args=${Object.keys(args).join(',') || 'none'}`);
    const raw = await httpPost(`/api/plugins/tools/${encodeURIComponent(name)}/execute`, { arguments: args, sessionId });
    const data = JSON.parse(raw);
    const result = data.result || JSON.stringify(data);
    log(`tools/call ok name=${name} session=${sessionId || 'none'} resultLength=${String(result).length}`);
    return result;
  } catch (error) {
    log(`tools/call failed name=${name} session=${sessionId || 'none'}`, error);
    return JSON.stringify({ error: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}` });
  }
}

async function handleRequest(request: JsonRpcRequest): Promise<void> {
  if (request.id === undefined || request.id === null) {
    if (request.method === 'notifications/initialized') {
      return;
    }
    return;
  }

  switch (request.method) {
    case 'initialize': {
      // Echo back the client's protocol version for maximum compatibility
      const clientVersion = (request.params as { protocolVersion?: string })?.protocolVersion || '2024-11-05';
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: clientVersion,
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'claudia-plugin-bridge',
            version: '0.1.0',
          },
        },
      });
      break;
    }

    case 'tools/list': {
      const tools = await listTools();
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: { tools },
      });
      break;
    }

    case 'tools/call': {
      const params = request.params as { name: string; arguments?: Record<string, unknown> } | undefined;
      if (!params?.name) {
        send({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32602, message: 'Missing tool name' },
        });
        break;
      }
      const result = await callTool(params.name, params.arguments || {});
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [{ type: 'text', text: result }],
        },
      });
      break;
    }

    case 'ping':
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: {},
      });
      break;

    default:
      send({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: `Method not found: ${request.method}` },
      });
  }
}

process.stdout.on('error', (error) => {
  if (isBrokenPipe(error)) {
    requestShutdown(`stdout error ${(error as { code?: unknown }).code || 'unknown'}`);
    return;
  }
  log('stdout stream error', error);
  requestShutdown('stdout stream error', 1);
});

process.stdin.on('error', (error) => {
  if (isBrokenPipe(error)) {
    requestShutdown(`stdin error ${(error as { code?: unknown }).code || 'unknown'}`);
    return;
  }
  log('stdin stream error', error);
  requestShutdown('stdin stream error', 1);
});

process.stdin.on('data', (chunk: Buffer) => {
  if (shuttingDown) return;
  readBuffer = Buffer.concat([readBuffer, chunk]);
  pumpMessages();
});

process.stdin.on('end', () => {
  requestShutdown('stdin ended');
});

process.stdin.resume();
log('ready');
