import type { Migration } from './types.js';

export const migration: Migration = {
  name: '005_messages_fts',
  sql: `
        -- FTS5 virtual table for full-text search on messages
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
          content,
          session_id UNINDEXED,
          role UNINDEXED
        );

        -- Populate FTS from existing messages
        INSERT INTO messages_fts(rowid, content, session_id, role)
          SELECT rowid, content, session_id, role FROM messages;

        -- Trigger: keep FTS in sync on INSERT
        CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(rowid, content, session_id, role)
            VALUES (NEW.rowid, NEW.content, NEW.session_id, NEW.role);
        END;

        -- Trigger: keep FTS in sync on DELETE
        CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content, session_id, role)
            VALUES ('delete', OLD.rowid, OLD.content, OLD.session_id, OLD.role);
        END;

        -- Trigger: keep FTS in sync on UPDATE
        CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content, session_id, role)
            VALUES ('delete', OLD.rowid, OLD.content, OLD.session_id, OLD.role);
          INSERT INTO messages_fts(rowid, content, session_id, role)
            VALUES (NEW.rowid, NEW.content, NEW.session_id, NEW.role);
        END;
      `,
};
