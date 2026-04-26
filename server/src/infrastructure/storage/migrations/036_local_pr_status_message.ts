import type { Migration } from './types.js';

export const migration: Migration = {
  name: '036_local_pr_status_message',
  idempotent: true,
  sql: `
        -- no-op: status_message already defined in 030_local_pr_workflow CREATE TABLE
        SELECT 1;
      `,
};
