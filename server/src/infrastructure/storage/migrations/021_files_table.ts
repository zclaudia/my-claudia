import type { Migration } from './types.js';

export const migration: Migration = {
  name: '021_files_table',
  sql: `
        CREATE TABLE IF NOT EXISTS files (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
      `,
};
