import type { Migration } from './types.js';

export const migration: Migration = {
  name: '039_task_runs',
  sql: `
        CREATE TABLE IF NOT EXISTS task_runs (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          task_source TEXT NOT NULL CHECK (task_source IN ('user', 'system')),
          status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
          started_at INTEGER NOT NULL,
          completed_at INTEGER,
          duration_ms INTEGER,
          result TEXT,
          error TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs(task_id, started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_task_runs_created ON task_runs(created_at);
      `,
};
