import type { Migration } from './types.js';

export const migration: Migration = {
  name: '035_workflows',
  sql: `
        CREATE TABLE IF NOT EXISTS workflows (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'disabled', 'archived')),
          definition TEXT NOT NULL DEFAULT '{}',
          template_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_workflows_project ON workflows(project_id);

        CREATE TABLE IF NOT EXISTS workflow_runs (
          id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
          trigger_source TEXT NOT NULL DEFAULT 'manual'
            CHECK (trigger_source IN ('manual', 'schedule', 'event')),
          trigger_detail TEXT,
          current_step_id TEXT,
          started_at INTEGER NOT NULL,
          completed_at INTEGER,
          error TEXT,
          FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id);
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);

        CREATE TABLE IF NOT EXISTS workflow_step_runs (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          step_id TEXT NOT NULL,
          step_type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped', 'waiting')),
          input TEXT,
          output TEXT,
          error TEXT,
          attempt INTEGER NOT NULL DEFAULT 1,
          session_id TEXT,
          started_at INTEGER,
          completed_at INTEGER,
          FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_step_runs_run ON workflow_step_runs(run_id);

        CREATE TABLE IF NOT EXISTS workflow_schedules (
          id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL UNIQUE,
          trigger_index INTEGER NOT NULL DEFAULT 0,
          next_run INTEGER,
          enabled INTEGER NOT NULL DEFAULT 1,
          FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_workflow_schedules_next ON workflow_schedules(enabled, next_run);
      `,
};
