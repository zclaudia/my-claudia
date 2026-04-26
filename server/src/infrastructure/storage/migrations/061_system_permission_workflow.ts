import type { Migration } from './types.js';

export const migration: Migration = {
  name: '061_system_permission_workflow',
  idempotent: true,
  sql: `
        ALTER TABLE workflows ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE workflows ADD COLUMN system_key TEXT;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_workflows_system_key
          ON workflows(system_key)
          WHERE system_key IS NOT NULL;
      `,
};
