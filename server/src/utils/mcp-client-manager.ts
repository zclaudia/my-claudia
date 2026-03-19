/**
 * MCP Client Manager — connection pool for MCP server processes.
 *
 * Caches McpClient instances by server name.
 * Idle connections are automatically closed after 60 seconds.
 */

import { McpClient, type McpToolDefinition, type McpToolResult } from './mcp-client.js';

interface CachedClient {
  client: McpClient;
  configKey: string;
  lastUsed: number;
  idleTimer: NodeJS.Timeout;
}

const IDLE_TIMEOUT_MS = 60_000; // 60 seconds

export class McpClientManager {
  private clients = new Map<string, CachedClient>();
  /** Deduplicates concurrent getClient() calls for the same server. */
  private connecting = new Map<string, Promise<McpClient>>();

  private buildConfigKey(config: { command: string; args?: string[]; env?: Record<string, string> }): string {
    const sortedEnv = Object.entries(config.env || {}).sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify({
      command: config.command,
      args: config.args || [],
      env: sortedEnv,
    });
  }

  /**
   * Get or create an McpClient for the given MCP server.
   * Concurrent calls for the same serverName are deduplicated.
   */
  async getClient(
    serverName: string,
    config: { command: string; args?: string[]; env?: Record<string, string> },
  ): Promise<McpClient> {
    const configKey = this.buildConfigKey(config);
    const cached = this.clients.get(serverName);
    if (cached?.client.isConnected && cached.configKey === configKey) {
      cached.lastUsed = Date.now();
      this.resetIdleTimer(serverName, cached);
      return cached.client;
    }

    // Deduplicate concurrent connection attempts for the same server
    const pending = this.connecting.get(serverName);
    if (pending) return pending;

    const promise = this.createClient(serverName, configKey, config);
    this.connecting.set(serverName, promise);
    try {
      return await promise;
    } finally {
      this.connecting.delete(serverName);
    }
  }

  private async createClient(
    serverName: string,
    configKey: string,
    config: { command: string; args?: string[]; env?: Record<string, string> },
  ): Promise<McpClient> {
    // Clean up stale entry, including config changes for the same server name.
    const cached = this.clients.get(serverName);
    if (cached) {
      await this.evict(serverName);
    }

    const client = new McpClient(config.command, config.args || [], config.env);
    await client.connect();

    const entry: CachedClient = {
      client,
      configKey,
      lastUsed: Date.now(),
      idleTimer: setTimeout(() => this.evict(serverName), IDLE_TIMEOUT_MS),
    };
    this.clients.set(serverName, entry);

    return client;
  }

  /**
   * Call a tool on a named MCP server.
   */
  async callTool(
    serverName: string,
    config: { command: string; args?: string[]; env?: Record<string, string> },
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    const client = await this.getClient(serverName, config);
    return client.callTool(toolName, args);
  }

  /**
   * List tools on a named MCP server.
   */
  async listTools(
    serverName: string,
    config: { command: string; args?: string[]; env?: Record<string, string> },
  ): Promise<McpToolDefinition[]> {
    const client = await this.getClient(serverName, config);
    return client.listTools();
  }

  /**
   * Shutdown all cached connections.
   */
  async shutdown(): Promise<void> {
    const names = [...this.clients.keys()];
    await Promise.all(names.map(name => this.evict(name)));
  }

  private resetIdleTimer(name: string, entry: CachedClient): void {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => this.evict(name), IDLE_TIMEOUT_MS);
  }

  private async evict(name: string): Promise<void> {
    const entry = this.clients.get(name);
    if (!entry) return;

    clearTimeout(entry.idleTimer);
    this.clients.delete(name);

    try {
      await entry.client.disconnect();
      console.log(`[McpClientManager] Disconnected idle MCP server: ${name}`);
    } catch (err) {
      console.error(`[McpClientManager] Error disconnecting ${name}:`, err);
    }
  }
}

/** Singleton instance */
export const mcpClientManager = new McpClientManager();
