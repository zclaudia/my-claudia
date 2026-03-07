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

const SERVER_URL = process.env.CLAUDIA_BRIDGE_URL || 'http://127.0.0.1:3100';

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
    const raw = await httpGet('/api/plugins/tools');
    const data = JSON.parse(raw);
    return data.tools || [];
  } catch (error) {
    console.error('[MCP Bridge] Failed to list tools:', error);
    return [];
  }
}

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    const raw = await httpPost(`/api/plugins/tools/${encodeURIComponent(name)}/execute`, { arguments: args });
    const data = JSON.parse(raw);
    return data.result || JSON.stringify(data);
  } catch (error) {
    return JSON.stringify({ error: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}` });
  }
}

// ============================================
// JSON-RPC Handler
// ============================================

function send(response: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(response) + '\n');
}

function sendNotification(method: string, params?: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
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

rl.on('line', async (line: string) => {
  if (!line.trim()) return;

  try {
    const request = JSON.parse(line) as JsonRpcRequest;
    await handleRequest(request);
  } catch (error) {
    // Parse error
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      }) + '\n'
    );
  }
});

// Keep the process alive
process.stdin.resume();
