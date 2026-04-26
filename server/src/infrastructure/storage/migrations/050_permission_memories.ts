import type { Migration } from './types.js';

export const migration: Migration = {
  name: '050_permission_memories',
  sql: `
        CREATE TABLE IF NOT EXISTS permission_memories (
          session_id TEXT NOT NULL,
          remember_key TEXT NOT NULL,
          decision TEXT CHECK(decision IN ('allow', 'deny')) NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (session_id, remember_key),
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_permission_memories_session_id ON permission_memories(session_id);
      `,
};
