import type { Migration } from './types.js';

export const migration: Migration = {
  name: '034_session_run_status',
  sql: `
        ALTER TABLE sessions ADD COLUMN last_run_status TEXT
          CHECK(last_run_status IN ('running', 'waiting', 'interrupted'));
      `,
};
