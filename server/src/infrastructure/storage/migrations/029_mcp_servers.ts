import type { Migration } from './types.js';

export const migration: Migration = {
  name: '029_mcp_servers',
  sql: `
        CREATE TABLE IF NOT EXISTS mcp_servers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          command TEXT NOT NULL,
          args TEXT,
          env TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          description TEXT,
          source TEXT NOT NULL DEFAULT 'user',
          provider_scope TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled ON mcp_servers(enabled);
        CREATE INDEX IF NOT EXISTS idx_mcp_servers_name ON mcp_servers(name);
      `,
};
