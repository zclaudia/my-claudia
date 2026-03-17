#!/usr/bin/env node
/**
 * MCP Bridge - Stdio MCP server that proxies plugin tools from the main server.
 *
 * This script implements the Model Context Protocol (MCP) over stdio,
 * acting as a bridge between the Claude Code SDK and the main server's
 * tool registry. It is spawned as a child process by the Claude SDK.
 *
 * Environment variables:
 *   CLAUDIA_BRIDGE_URL - Base URL of the main server (e.g., http://127.0.0.1:3100)
 */

import * as readline from 'readline';
import * as http from 'http';
import { readFileSync } from 'fs';

const SERVER_URL = process.env.CLAUDIA_BRIDGE_URL || 'http://127.0.0.1:3100';
const STATIC_SESSION_ID = process.env.CLAUDIA_SESSION_ID || '';
const SESSION_ID_FILE = process.env.CLAUDIA_SESSION_ID_FILE || '';

/**
 * Get current session ID.
 * If SESSION_ID_FILE is set, read from file each time (for persistent bridge processes
 * where session changes between runs, e.g. OpenCode).
 * Otherwise use the static env value (for ephemeral bridge processes, e.g. Claude/Codex).
 */
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

// ============================================
// JSON-RPC Types
// ============================================

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

// ============================================
// HTTP Helpers
// ============================================

function httpGet(urlPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, SERVER_URL);
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
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
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ============================================
// Tool Operations
// ============================================

async function listTools(): Promise<McpTool[]> {
  try {
    log(`tools/list start session=${getSessionId() || 'none'}`);
    const raw = await httpGet('/api/plugins/tools');
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

// ============================================
// JSON-RPC Handler
// ============================================

function send(response: JsonRpcResponse): void {
  writeLine(JSON.stringify(response));
}

function sendNotification(method: string, params?: Record<string, unknown>): void {
  writeLine(JSON.stringify({ jsonrpc: '2.0', method, params }));
}

function isBrokenPipe(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 'EPIPE' || code === 'ECONNRESET';
}

function writeLine(line: string): void {
  try {
    process.stdout.write(line + '\n');
  } catch (error) {
    if (isBrokenPipe(error)) {
      requestShutdown(`stdout broken pipe during write (${String((error as { code?: unknown }).code || 'unknown')})`);
      return;
    }
    log('stdout write failed', error);
    requestShutdown('stdout write failure', 1);
  }
}

async function handleRequest(request: JsonRpcRequest): Promise<void> {
  // Notifications (no id) don't get responses
  if (request.id === undefined || request.id === null) {
    // Handle notification methods
    if (request.method === 'notifications/initialized') {
      // Client confirmed initialization — nothing to do
    }
    return;
  }

  switch (request.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2024-11-05',
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

// ============================================
// Main Loop
// ============================================

const rl = readline.createInterface({
  input: process.stdin,
  terminal: false,
});

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

rl.on('line', async (line: string) => {
  if (!line.trim()) return;
  if (shuttingDown) {
    log('ignoring request after shutdown started');
    return;
  }

  inFlightRequests += 1;

  try {
    const request = JSON.parse(line) as JsonRpcRequest;
    await handleRequest(request);
  } catch (error) {
    // Parse error
    writeLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      })
    );
    log('parse error', error);
  } finally {
    inFlightRequests -= 1;
    if (shuttingDown && inFlightRequests === 0) {
      process.exit(shutdownCode);
    }
  }
});

rl.on('close', () => {
  requestShutdown('stdin closed');
});

// Keep the process alive
process.stdin.resume();
