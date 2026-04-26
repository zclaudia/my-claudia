import type { Migration } from './types.js';

export const migration: Migration = {
  name: '025_supervision_v2',
  sql: `
        -- supervision_tasks: v2 task management
        CREATE TABLE IF NOT EXISTS supervision_tasks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'agent_discovered')),
          session_id TEXT,
          status TEXT NOT NULL,
          priority INTEGER NOT NULL DEFAULT 0,
          dependencies TEXT,
          dependency_mode TEXT DEFAULT 'all',
          relevant_doc_ids TEXT,
          task_specific_context TEXT,
          scope TEXT,
          acceptance_criteria TEXT,
          max_retries INTEGER DEFAULT 2,
          attempt INTEGER NOT NULL DEFAULT 1,
          base_commit TEXT,
          result TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          started_at INTEGER,
          completed_at INTEGER,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_supervision_tasks_project ON supervision_tasks(project_id);
        CREATE INDEX IF NOT EXISTS idx_supervision_tasks_status ON supervision_tasks(status);
        CREATE INDEX IF NOT EXISTS idx_supervision_tasks_session ON supervision_tasks(session_id);

        -- supervision logs (renamed to supervision_logs in migration 042)
        CREATE TABLE IF NOT EXISTS supervision_v2_logs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          task_id TEXT,
          event TEXT NOT NULL,
          detail TEXT,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_sv2_logs_project ON supervision_v2_logs(project_id);
        CREATE INDEX IF NOT EXISTS idx_sv2_logs_task ON supervision_v2_logs(task_id);

        -- Extend projects table
        ALTER TABLE projects ADD COLUMN agent TEXT;
        ALTER TABLE projects ADD COLUMN context_sync_status TEXT NOT NULL DEFAULT 'synced';

        -- Extend sessions table
        ALTER TABLE sessions ADD COLUMN project_role TEXT;
        ALTER TABLE sessions ADD COLUMN task_id TEXT;
      `,
};
