import type { Migration } from './types.js';

export const migration: Migration = {
  name: '012_agent_config',
  sql: `
        -- agent_config: singleton table for agent assistant settings
        CREATE TABLE IF NOT EXISTS agent_config (
          id INTEGER PRIMARY KEY CHECK(id = 1),
          enabled INTEGER NOT NULL DEFAULT 1,
          project_id TEXT,
          session_id TEXT,
          permission_policy TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO agent_config (id, enabled, created_at, updated_at)
        VALUES (1, 1, strftime('%s','now')*1000, strftime('%s','now')*1000);
      `,
};
