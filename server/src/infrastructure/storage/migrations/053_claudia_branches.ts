import type { Migration } from './types.js';

export const migration: Migration = {
  name: '053_claudia_branches',
  idempotent: true,
  sql: `
        CREATE TABLE IF NOT EXISTS claudia_branches (
          id TEXT PRIMARY KEY,
          host_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          active_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
          title TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_task_id TEXT REFERENCES orchestrator_tasks(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_claudia_branches_project ON claudia_branches(host_project_id);

        ALTER TABLE orchestrator_tasks ADD COLUMN branch_id TEXT REFERENCES claudia_branches(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_orch_tasks_branch ON orchestrator_tasks(branch_id);
      `,
};
