import type { Migration } from './types.js';

export const migration: Migration = {
  name: '056_global_workflows',
  sql: `
        -- Make workflows.project_id nullable (SQLite requires table rebuild)
        PRAGMA foreign_keys = OFF;
        DROP TABLE IF EXISTS workflows_new;
        CREATE TABLE workflows_new AS SELECT * FROM workflows;
        DROP TABLE workflows;
        CREATE TABLE workflows (
          id TEXT PRIMARY KEY,
          project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'disabled', 'archived')),
          definition TEXT NOT NULL DEFAULT '{}',
          template_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        INSERT INTO workflows SELECT * FROM workflows_new;
        DROP TABLE workflows_new;
        CREATE INDEX IF NOT EXISTS idx_workflows_project ON workflows(project_id);

        -- Make workflow_runs.project_id nullable
        DROP TABLE IF EXISTS workflow_runs_new;
        CREATE TABLE workflow_runs_new AS SELECT * FROM workflow_runs;
        DROP TABLE workflow_runs;
        CREATE TABLE workflow_runs (
          id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL,
          project_id TEXT,
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
        INSERT INTO workflow_runs SELECT * FROM workflow_runs_new;
        DROP TABLE workflow_runs_new;
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id);
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
        PRAGMA foreign_keys = ON;
      `,
};
