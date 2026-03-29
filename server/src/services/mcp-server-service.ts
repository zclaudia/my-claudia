import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { McpServerConfig } from '@my-claudia/shared';
import { loadMcpServers } from '../utils/claude-config.js';

export interface McpServerRow {
  id: string;
  name: string;
  command: string;
  args: string | null;
  env: string | null;
  enabled: number;
  description: string | null;
  source: string;
  provider_scope: string | null;
  created_at: number;
  updated_at: number;
}

interface CreateMcpServerInput {
  name?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  description?: string;
  providerScope?: string[];
}

interface UpdateMcpServerInput {
  name?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  description?: string | null;
  providerScope?: string[] | null;
}

export class McpServerServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function rowToConfig(row: McpServerRow): McpServerConfig {
  return {
    id: row.id,
    name: row.name,
    command: row.command,
    args: row.args ? JSON.parse(row.args) : undefined,
    env: row.env ? JSON.parse(row.env) : undefined,
    enabled: row.enabled === 1,
    description: row.description || undefined,
    source: row.source as McpServerConfig['source'],
    providerScope: row.provider_scope ? JSON.parse(row.provider_scope) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class McpServerService {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => number = () => Date.now(),
    private readonly loadServers: typeof loadMcpServers = loadMcpServers,
  ) {}

  listServers(): McpServerConfig[] {
    const rows = this.db.prepare(`
      SELECT id, name, command, args, env, enabled, description,
             source, provider_scope, created_at, updated_at
      FROM mcp_servers ORDER BY name ASC
    `).all() as McpServerRow[];

    return rows.map(rowToConfig);
  }

  createServer(input: CreateMcpServerInput): McpServerConfig {
    if (!input.name || !input.command) {
      throw new McpServerServiceError(400, 'INVALID_INPUT', 'name and command are required');
    }

    const existing = this.db.prepare('SELECT id FROM mcp_servers WHERE name = ?').get(input.name);
    if (existing) {
      throw new McpServerServiceError(409, 'DUPLICATE', `MCP server "${input.name}" already exists`);
    }

    const id = uuidv4();
    const now = this.now();

    this.db.prepare(`
      INSERT INTO mcp_servers (id, name, command, args, env, enabled, description, source, provider_scope, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'user', ?, ?, ?)
    `).run(
      id,
      input.name,
      input.command,
      input.args ? JSON.stringify(input.args) : null,
      input.env ? JSON.stringify(input.env) : null,
      input.enabled !== false ? 1 : 0,
      input.description || null,
      input.providerScope ? JSON.stringify(input.providerScope) : null,
      now,
      now,
    );

    return this.requireServerById(id);
  }

  updateServer(id: string, input: UpdateMcpServerInput): McpServerConfig {
    this.assertExists(id);

    if (input.name) {
      const duplicate = this.db.prepare('SELECT id FROM mcp_servers WHERE name = ? AND id != ?').get(input.name, id);
      if (duplicate) {
        throw new McpServerServiceError(409, 'DUPLICATE', `MCP server "${input.name}" already exists`);
      }
    }

    this.db.prepare(`
      UPDATE mcp_servers SET
        name = COALESCE(?, name),
        command = COALESCE(?, command),
        args = ?,
        env = ?,
        enabled = COALESCE(?, enabled),
        description = ?,
        provider_scope = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      input.name || null,
      input.command || null,
      input.args !== undefined ? JSON.stringify(input.args) : null,
      input.env !== undefined ? JSON.stringify(input.env) : null,
      input.enabled !== undefined ? (input.enabled ? 1 : 0) : null,
      input.description !== undefined ? (input.description || null) : null,
      input.providerScope !== undefined ? (input.providerScope ? JSON.stringify(input.providerScope) : null) : null,
      this.now(),
      id,
    );

    return this.requireServerById(id);
  }

  deleteServer(id: string): void {
    const result = this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new McpServerServiceError(404, 'NOT_FOUND', 'MCP server not found');
    }
  }

  toggleServer(id: string): McpServerConfig {
    const row = this.db.prepare('SELECT id, enabled FROM mcp_servers WHERE id = ?').get(id) as
      | { id: string; enabled: number }
      | undefined;

    if (!row) {
      throw new McpServerServiceError(404, 'NOT_FOUND', 'MCP server not found');
    }

    const newEnabled = row.enabled === 1 ? 0 : 1;
    this.db.prepare('UPDATE mcp_servers SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(newEnabled, this.now(), id);

    return this.requireServerById(id);
  }

  importServers(): { imported: McpServerConfig[]; skipped: string[] } {
    const nativeServers = this.loadServers();
    const imported: McpServerConfig[] = [];
    const skipped: string[] = [];

    for (const [name, server] of Object.entries(nativeServers)) {
      const existing = this.db.prepare('SELECT id FROM mcp_servers WHERE name = ?').get(name);
      if (existing) {
        skipped.push(name);
        continue;
      }

      const id = uuidv4();
      const now = this.now();
      this.db.prepare(`
        INSERT INTO mcp_servers (id, name, command, args, env, enabled, description, source, provider_scope, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, NULL, 'imported', NULL, ?, ?)
      `).run(
        id,
        name,
        server.command,
        server.args ? JSON.stringify(server.args) : null,
        server.env ? JSON.stringify(server.env) : null,
        now,
        now,
      );

      imported.push(this.requireServerById(id));
    }

    return { imported, skipped };
  }

  private assertExists(id: string): void {
    const existing = this.db.prepare('SELECT id FROM mcp_servers WHERE id = ?').get(id);
    if (!existing) {
      throw new McpServerServiceError(404, 'NOT_FOUND', 'MCP server not found');
    }
  }

  private requireServerById(id: string): McpServerConfig {
    const row = this.db.prepare(`
      SELECT id, name, command, args, env, enabled, description,
             source, provider_scope, created_at, updated_at
      FROM mcp_servers WHERE id = ?
    `).get(id) as McpServerRow | undefined;

    if (!row) {
      throw new McpServerServiceError(404, 'NOT_FOUND', 'MCP server not found');
    }

    return rowToConfig(row);
  }
}
