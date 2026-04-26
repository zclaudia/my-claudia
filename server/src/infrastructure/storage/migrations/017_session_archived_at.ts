import type { Migration } from './types.js';

export const migration: Migration = {
  name: '017_session_archived_at',
  sql: `ALTER TABLE sessions ADD COLUMN archived_at INTEGER;`,
};
