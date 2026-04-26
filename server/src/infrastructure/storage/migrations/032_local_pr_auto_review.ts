import type { Migration } from './types.js';

export const migration: Migration = {
  name: '032_local_pr_auto_review',
  sql: `
        ALTER TABLE local_prs ADD COLUMN auto_review INTEGER NOT NULL DEFAULT 0;
      `,
};
