import type { Migration } from './types.js';

export const migration: Migration = {
  name: '009_fix_messages_fts_triggers',
  sql: `
        -- Fix messages_fts triggers: SQLite 3.49+ broke the special 'delete' command
        -- for regular (non-content-synced) FTS5 tables. Use standard DELETE instead.

        DROP TRIGGER IF EXISTS messages_fts_delete;
        CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
          DELETE FROM messages_fts WHERE rowid = OLD.rowid;
        END;

        DROP TRIGGER IF EXISTS messages_fts_update;
        CREATE TRIGGER messages_fts_update AFTER UPDATE ON messages BEGIN
          DELETE FROM messages_fts WHERE rowid = OLD.rowid;
          INSERT INTO messages_fts(rowid, content, session_id, role)
            VALUES (NEW.rowid, NEW.content, NEW.session_id, NEW.role);
        END;
      `,
};
