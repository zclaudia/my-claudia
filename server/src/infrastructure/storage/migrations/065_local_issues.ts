import type { Migration } from './types.js';

export const migration: Migration = {
  name: '065_local_issues',
  sql: `
        CREATE TABLE IF NOT EXISTS local_issues (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'open'
            CHECK (status IN ('open','in_progress','closed')),
          priority TEXT NOT NULL DEFAULT 'medium'
            CHECK (priority IN ('low','medium','high','critical')),
          labels TEXT DEFAULT '[]',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          closed_at INTEGER,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_local_issues_project ON local_issues(project_id);
        CREATE INDEX IF NOT EXISTS idx_local_issues_status ON local_issues(status);
      `,
};
