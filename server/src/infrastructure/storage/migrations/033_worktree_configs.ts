import type { Migration } from './types.js';

export const migration: Migration = {
  name: '033_worktree_configs',
  sql: `
        CREATE TABLE IF NOT EXISTS worktree_configs (
          project_id TEXT NOT NULL,
          worktree_path TEXT NOT NULL,
          auto_create_pr INTEGER NOT NULL DEFAULT 0,
          auto_review INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (project_id, worktree_path),
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
      `,
};
