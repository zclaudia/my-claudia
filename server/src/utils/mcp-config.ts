/**
 * Loads Claudia-managed MCP server configurations from the database.
 * Returns configs in a format compatible with the Claude SDK's `mcpServers` option.
 */

import type Database from 'better-sqlite3';
import type { McpStdioServerConfig } from './claude-config.js';

interface McpServerRow {
  name: string;
  command: string;
  args: string | null;
  env: string | null;
  provider_scope: string | null;
}

/**
 * Load enabled MCP servers from Claudia's DB, optionally filtered by provider type.
 */
export function loadMcpServersFromDb(
  db: Database.Database,
  providerType?: string
): Record<string, McpStdioServerConfig> {
  const rows = db.prepare(
    'SELECT name, command, args, env, provider_scope FROM mcp_servers WHERE enabled = 1'
  ).all() as McpServerRow[];

  const servers: Record<string, McpStdioServerConfig> = {};
  for (const row of rows) {
    // Filter by provider scope if specified
    if (providerType && row.provider_scope) {
      try {
        const scope = JSON.parse(row.provider_scope) as string[];
        if (!scope.includes(providerType)) continue;
      } catch {
        // Invalid JSON scope — skip filtering, include the server
      }
    }

    servers[row.name] = {
      command: row.command,
      ...(row.args && { args: JSON.parse(row.args) as string[] }),
      ...(row.env && { env: JSON.parse(row.env) as Record<string, string> }),
    };
  }

  if (Object.keys(servers).length > 0) {
    console.log(
      `[MCP Config] Loaded ${Object.keys(servers).length} MCP server(s) from DB` +
      (providerType ? ` for ${providerType}` : '') +
      `: ${Object.keys(servers).join(', ')}`
    );
  }

  return servers;
}
