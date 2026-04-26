import type { Migration } from './types.js';

export const migration: Migration = {
  name: '064_supervisor_changes_v1',
  idempotent: true,
  sql: `
        CREATE TABLE IF NOT EXISTS project_changes (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          slug TEXT NOT NULL,
          title TEXT NOT NULL,
          summary TEXT NOT NULL,
          motivation TEXT,
          non_goals TEXT,
          scope TEXT,
          acceptance_criteria TEXT,
          status TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 0,
          baseline_version TEXT,
          design_approved_at INTEGER,
          execution_approved_at INTEGER,
          sync_approved_at INTEGER,
          worktree_id TEXT,
          local_pr_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          completed_at INTEGER,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_project_changes_project_slug
          ON project_changes(project_id, slug);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_project_changes_single_active
          ON project_changes(project_id)
          WHERE active = 1;

        CREATE TABLE IF NOT EXISTS change_gate_reviews (
          id TEXT PRIMARY KEY,
          change_id TEXT NOT NULL,
          gate_type TEXT NOT NULL,
          status TEXT NOT NULL,
          decision TEXT,
          notes TEXT,
          reviewer_user_id TEXT,
          created_at INTEGER NOT NULL,
          resolved_at INTEGER,
          FOREIGN KEY (change_id) REFERENCES project_changes(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_change_gate_reviews_change
          ON change_gate_reviews(change_id, gate_type, created_at DESC);

        CREATE TABLE IF NOT EXISTS change_sync_runs (
          id TEXT PRIMARY KEY,
          change_id TEXT NOT NULL,
          status TEXT NOT NULL,
          summary TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          applied_at INTEGER,
          FOREIGN KEY (change_id) REFERENCES project_changes(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_change_sync_runs_change
          ON change_sync_runs(change_id, created_at DESC);

        ALTER TABLE supervision_tasks ADD COLUMN change_id TEXT;
        ALTER TABLE supervision_tasks ADD COLUMN change_task_ref TEXT;
        ALTER TABLE supervision_tasks ADD COLUMN phase_id TEXT;
        CREATE INDEX IF NOT EXISTS idx_supervision_tasks_change ON supervision_tasks(change_id);
      `,
};
