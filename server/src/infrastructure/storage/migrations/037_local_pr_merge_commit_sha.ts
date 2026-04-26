import type { Migration } from './types.js';

export const migration: Migration = {
  name: '037_local_pr_merge_commit_sha',
  idempotent: true,
  sql: `
        -- no-op: merged_commit_sha already defined in 030_local_pr_workflow CREATE TABLE
        SELECT 1;
      `,
};
