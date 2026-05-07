import type { Migration } from './types.js';

export const migration: Migration = {
  name: '066_attachments',
  sql: `
        CREATE TABLE IF NOT EXISTS attachments (
          id TEXT PRIMARY KEY,
          owner_kind TEXT NOT NULL,
          owner_id TEXT NOT NULL,
          storage_key TEXT NOT NULL,
          name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size INTEGER NOT NULL,
          kind TEXT NOT NULL DEFAULT 'file'
            CHECK (kind IN ('image','video','audio','document','file')),
          sha256 TEXT,
          width INTEGER,
          height INTEGER,
          created_by TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_attachments_owner
          ON attachments(owner_kind, owner_id);
        CREATE INDEX IF NOT EXISTS idx_attachments_created
          ON attachments(created_at);
      `,
};
