import type { Migration } from './types.js';

export const migration: Migration = {
  name: '011_fix_orphaned_fts_rows',
  sql: `
        -- Clean up orphaned FTS rows left by the broken delete trigger (pre-009).
        -- The old trigger used the FTS5 'delete' command which stopped working in
        -- SQLite 3.49+, leaving FTS rows behind when messages were deleted.
        DELETE FROM messages_fts WHERE rowid NOT IN (SELECT rowid FROM messages);
      `,
};
