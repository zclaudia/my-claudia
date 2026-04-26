import type { Migration } from './types.js';

export const migration: Migration = {
  name: '042_rename_supervision_logs',
  sql: `
        ALTER TABLE supervision_v2_logs RENAME TO supervision_logs;
        DROP INDEX IF EXISTS idx_sv2_logs_project;
        DROP INDEX IF EXISTS idx_sv2_logs_task;
        CREATE INDEX IF NOT EXISTS idx_supervision_logs_project ON supervision_logs(project_id);
        CREATE INDEX IF NOT EXISTS idx_supervision_logs_task ON supervision_logs(task_id);
      `,
};
