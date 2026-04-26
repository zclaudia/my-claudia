import type { Migration } from './types.js';

export const migration: Migration = {
  name: '040_session_drafts',
  sql: `
        CREATE TABLE IF NOT EXISTS session_drafts (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL UNIQUE,
          content TEXT NOT NULL DEFAULT '',
          editing_by TEXT,
          editing_at INTEGER,
          updated_at INTEGER NOT NULL,
          archived_at INTEGER,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_session_drafts_session ON session_drafts(session_id);
      `,
};
