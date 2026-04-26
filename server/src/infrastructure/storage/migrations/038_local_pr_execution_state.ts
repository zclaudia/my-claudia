import type { Migration } from './types.js';

export const migration: Migration = {
  name: '038_local_pr_execution_state',
  sql: `
        ALTER TABLE local_prs ADD COLUMN execution_state TEXT NOT NULL DEFAULT 'idle'
          CHECK (execution_state IN ('idle', 'queued', 'running', 'failed'));
        ALTER TABLE local_prs ADD COLUMN pending_action TEXT NOT NULL DEFAULT 'none'
          CHECK (pending_action IN ('none', 'review', 'merge', 'resolve_conflict'));
        ALTER TABLE local_prs ADD COLUMN execution_error TEXT;
      `,
};
