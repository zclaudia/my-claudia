import type { Migration } from './types.js';

export const migration: Migration = {
  name: '055_claudia_task_metadata',
  idempotent: true,
  sql: `
        ALTER TABLE orchestrator_tasks ADD COLUMN branch_action TEXT;
        ALTER TABLE orchestrator_tasks ADD COLUMN context_reset INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE orchestrator_tasks ADD COLUMN response_text TEXT;
        ALTER TABLE orchestrator_tasks ADD COLUMN tool_count INTEGER;
      `,
};
