import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import {
  createOpencodeClient,
  type OpencodeClient,
} from '@opencode-ai/sdk';
import { sanitizeInheritedProviderEnv } from '../../utils/startup-env.js';
import { getGlobalProcessSupervisor } from '../services/process-supervisor.js';
import { buildMcpBridgeEntry } from '../../utils/mcp-bridge-launch.js';
import type { OpenCodeRunOptions } from './opencode-sdk.js';

// ============================================
// Types
// ============================================

export interface OpenCodeServer {
  process: ChildProcess;
  port: number;
  baseUrl: string;
  cwd: string;
  ready: boolean;
  client: OpencodeClient;
}

export interface OpenCodeHttpResult<T> {
  ok: boolean;
  status: number;
  url: string;
  data?: T;
  error?: string;
}

export interface OpenCodeServerWithBridge extends OpenCodeServer {
  mcpBridgeInjected?: boolean;
  sessionIdFile?: string;
}

// ============================================
// Session-to-server tracking
// ============================================

export interface SessionServerEntry { baseUrl: string; updatedAt: number; }
export const sessionServerMap = new Map<string, SessionServerEntry>();
export const SESSION_MAP_STALE_MS = 60 * 60 * 1000; // 1 hour

// ============================================
// MCP Bridge injection
// ============================================

const mcpBridgeInjected = new Set<string>();

export async function injectMcpBridge(server: OpenCodeServer, options: OpenCodeRunOptions): Promise<void> {
  if (mcpBridgeInjected.has(server.baseUrl)) return;

  const configDir = path.join(tmpdir(), 'my-claudia-mcp');
  mkdirSync(configDir, { recursive: true });
  const sessionIdFile = path.join(configDir, `opencode-session-${server.port}.txt`);
  if (options.claudiaSessionId) {
    writeFileSync(sessionIdFile, options.claudiaSessionId);
  }
  (server as OpenCodeServerWithBridge).sessionIdFile = sessionIdFile;

  const bridgeEntry = buildMcpBridgeEntry(options.serverPort!, undefined, sessionIdFile);
  if (!bridgeEntry) return;

  try {
    const result = await server.client.mcp.add({
      body: {
        name: 'claudia-plugins',
        config: {
          type: 'local',
          command: [bridgeEntry.command, ...bridgeEntry.args],
          environment: bridgeEntry.env,
          enabled: true,
          timeout: 15000,
        },
      },
      query: {
        directory: server.cwd,
      },
    });

    const status = result.data?.['claudia-plugins'];
    if (result.error) {
      console.warn(`[OpenCode] Failed to inject MCP bridge: ${JSON.stringify(result.error)}`);
      return;
    }

    if (!status || status.status !== 'connected') {
      console.warn(`[OpenCode] MCP bridge added but not connected: ${JSON.stringify(status)}`);
      try {
        await server.client.mcp.disconnect({
          path: { name: 'claudia-plugins' },
          query: { directory: server.cwd },
        });
      } catch {
        // Ignore cleanup failures
      }
      return;
    }

    mcpBridgeInjected.add(server.baseUrl);
    console.log(`[OpenCode] Injected MCP bridge on ${server.baseUrl}`);
  } catch (err) {
    console.warn(`[OpenCode] Failed to inject MCP bridge: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ============================================
// OpenCode Server Manager
// ============================================

class OpenCodeServerManager {
  private servers = new Map<string, OpenCodeServer>();
  private starting = new Map<string, Promise<OpenCodeServer>>();

  async ensureServer(cwd: string, options: { cliPath?: string; env?: Record<string, string>; sessionId?: string }): Promise<OpenCodeServer> {
    const existing = this.servers.get(cwd);
    if (existing && existing.ready) {
      try {
        const response = await fetch(`${existing.baseUrl}/global/health`);
        if (response.ok) return existing;
      } catch {
        this.servers.delete(cwd);
      }
    }

    const startingPromise = this.starting.get(cwd);
    if (startingPromise) return startingPromise;

    const promise = this.startServer(cwd, options);
    this.starting.set(cwd, promise);
    try {
      const server = await promise;
      return server;
    } finally {
      this.starting.delete(cwd);
    }
  }

  private async startServer(cwd: string, options: { cliPath?: string; env?: Record<string, string>; sessionId?: string }): Promise<OpenCodeServer> {
    const cliPath = options.cliPath || 'opencode';
    const port = 10000 + Math.floor(Math.random() * 50000);
    const baseUrl = `http://127.0.0.1:${port}`;

    console.log(`[OpenCode] Starting server on port ${port} for ${cwd}`);

    const baseEnv = { ...process.env };
    sanitizeInheritedProviderEnv(baseEnv);
    const childEnv = { ...baseEnv, ...(options.env || {}) };

    const child = spawn(cliPath, ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
      cwd,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    getGlobalProcessSupervisor()?.observeChildProcess({
      source: 'provider_run',
      command: cliPath,
      args: ['serve', '--port', String(port), '--hostname', '127.0.0.1'],
      cwd,
      owner: {
        sessionId: options.sessionId,
      },
      tags: ['provider:opencode', 'server'],
    }, child);

    child.stderr?.on('data', (chunk: Buffer) => {
      console.log(`[OpenCode:${port}] stderr:`, chunk.toString().trim());
    });

    await this.waitForReady(baseUrl, 30000);

    const client = createOpencodeClient({
      baseUrl,
      directory: cwd,
    });

    const server: OpenCodeServer = {
      process: child,
      port,
      baseUrl,
      cwd,
      ready: true,
      client,
    };

    child.on('exit', (code) => {
      console.log(`[OpenCode:${port}] Process exited with code ${code}`);
      server.ready = false;
      this.servers.delete(cwd);
    });

    child.on('error', (err) => {
      console.error(`[OpenCode:${port}] Process error:`, err.message);
      server.ready = false;
      this.servers.delete(cwd);
    });

    this.servers.set(cwd, server);
    console.log(`[OpenCode] Server ready on ${baseUrl}`);
    return server;
  }

  private async waitForReady(baseUrl: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const response = await fetch(`${baseUrl}/global/health`);
        if (response.ok) return;
      } catch {
        // Not ready yet
      }
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`OpenCode server failed to start within ${timeoutMs}ms`);
  }

  async stopServer(cwd: string): Promise<void> {
    const server = this.servers.get(cwd);
    if (server) {
      console.log(`[OpenCode] Stopping server on port ${server.port}`);
      server.process.kill('SIGTERM');
      server.ready = false;
      this.servers.delete(cwd);
      mcpBridgeInjected.delete(server.baseUrl);
      for (const [sid, entry] of sessionServerMap) {
        if (entry.baseUrl === server.baseUrl) sessionServerMap.delete(sid);
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const [cwd] of this.servers) {
      await this.stopServer(cwd);
    }
    sessionServerMap.clear();
    mcpBridgeInjected.clear();
  }

  getServer(cwd: string): OpenCodeServer | undefined {
    return this.servers.get(cwd);
  }
}

export const openCodeServerManager = new OpenCodeServerManager();

// ============================================
// HTTP helper
// ============================================

export async function openCodeJsonRequest<T>(
  server: OpenCodeServer,
  method: 'GET' | 'POST',
  pathname: string,
  options?: {
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
    expectedStatus?: number | number[];
  },
): Promise<OpenCodeHttpResult<T>> {
  const url = new URL(pathname, server.baseUrl);
  url.searchParams.set('directory', server.cwd);
  for (const [key, value] of Object.entries(options?.query || {})) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      'x-opencode-directory': encodeURIComponent(server.cwd),
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
  });

  const text = await response.text();
  let data: T | undefined;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch (error) {
      const snippet = text.slice(0, 200).replace(/\s+/g, ' ');
      const warnMsg = `[OpenCode] Non-JSON response from ${method} ${url.pathname} (status=${response.status}): ${snippet}`;
      console.warn(warnMsg);
    }
  }

  const expected = Array.isArray(options?.expectedStatus)
    ? options.expectedStatus
    : options?.expectedStatus !== undefined
      ? [options.expectedStatus]
      : [200];

  if (!expected.includes(response.status)) {
    return {
      ok: false,
      status: response.status,
      url: url.toString(),
      data,
      error: data ? JSON.stringify(data) : text || `HTTP ${response.status}`,
    };
  }

  return {
    ok: true,
    status: response.status,
    url: url.toString(),
    data,
  };
}
