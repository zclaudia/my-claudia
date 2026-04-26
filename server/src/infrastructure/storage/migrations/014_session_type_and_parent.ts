import type { Migration } from './types.js';

export const migration: Migration = {
  name: '014_session_type_and_parent',
  sql: `
        ALTER TABLE sessions ADD COLUMN type TEXT CHECK(type IN ('regular', 'background')) DEFAULT 'regular';
        ALTER TABLE sessions ADD COLUMN parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL;
      `,
};
