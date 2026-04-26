import type { Migration } from './types.js';

export const migration: Migration = {
  name: '030_local_pr_workflow',
  sql: `
        ALTER TABLE projects ADD COLUMN review_provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL;

        CREATE TABLE IF NOT EXISTS local_prs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          worktree_path TEXT NOT NULL,
          branch_name TEXT NOT NULL,
          base_branch TEXT NOT NULL DEFAULT 'master',
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'open'
            CHECK (status IN ('open','reviewing','review_failed','approved','merging','merged','conflict','closed')),
          commits TEXT,
          diff_summary TEXT,
          review_session_id TEXT,
          conflict_session_id TEXT,
          review_notes TEXT,
          status_message TEXT,
          auto_triggered INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          merged_at INTEGER,
          merged_commit_sha TEXT,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_local_prs_project ON local_prs(project_id);
        CREATE INDEX IF NOT EXISTS idx_local_prs_status ON local_prs(status);
        CREATE INDEX IF NOT EXISTS idx_local_prs_worktree ON local_prs(worktree_path);
      `,
};
