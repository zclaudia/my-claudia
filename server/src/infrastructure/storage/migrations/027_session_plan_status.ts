import type { Migration } from './types.js';

export const migration: Migration = {
  name: '027_session_plan_status',
  sql: `
        ALTER TABLE sessions ADD COLUMN plan_status TEXT;
        ALTER TABLE sessions ADD COLUMN is_read_only INTEGER DEFAULT 0;
      `,
};
