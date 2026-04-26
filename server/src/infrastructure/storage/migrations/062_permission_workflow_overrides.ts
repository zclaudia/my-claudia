import type { Migration } from './types.js';

export const migration: Migration = {
  name: '062_permission_workflow_overrides',
  idempotent: true,
  sql: `
        ALTER TABLE projects ADD COLUMN permission_workflow_override_id TEXT REFERENCES workflows(id) ON DELETE SET NULL;
        ALTER TABLE agent_config ADD COLUMN permission_workflow_override_id TEXT REFERENCES workflows(id) ON DELETE SET NULL;
      `,
};
