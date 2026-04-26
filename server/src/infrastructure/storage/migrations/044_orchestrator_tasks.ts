import type { Migration } from './types.js';

export const migration: Migration = {
  name: '044_orchestrator_tasks',
  sql: `
        CREATE TABLE IF NOT EXISTS orchestrator_tasks (
          id TEXT PRIMARY KEY,
          parent_task_id TEXT REFERENCES orchestrator_tasks(id) ON DELETE SET NULL,
          root_task_id TEXT REFERENCES orchestrator_tasks(id) ON DELETE SET NULL,
          project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
          session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
          branch_id TEXT REFERENCES claudia_branches(id) ON DELETE SET NULL,
          branch_action TEXT,
          context_reset INTEGER NOT NULL DEFAULT 0,
          kind TEXT NOT NULL,
          context_template TEXT NOT NULL DEFAULT 'coding',
          status TEXT NOT NULL DEFAULT 'queued',
          task TEXT NOT NULL,
          external_id TEXT,
          schedule_type TEXT,
          schedule_config TEXT,
          depends_on TEXT,
          provider_id TEXT,
          retry_count INTEGER NOT NULL DEFAULT 0,
          max_retries INTEGER NOT NULL DEFAULT 0,
          result_summary TEXT,
          error_summary TEXT,
          response_text TEXT,
          tool_count INTEGER,
          created_at INTEGER NOT NULL,
          started_at INTEGER,
          completed_at INTEGER,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_orch_tasks_project ON orchestrator_tasks(project_id);
        CREATE INDEX IF NOT EXISTS idx_orch_tasks_status ON orchestrator_tasks(status);
        CREATE INDEX IF NOT EXISTS idx_orch_tasks_parent ON orchestrator_tasks(parent_task_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_orch_tasks_external
          ON orchestrator_tasks(kind, external_id)
          WHERE external_id IS NOT NULL;
      `,
};
