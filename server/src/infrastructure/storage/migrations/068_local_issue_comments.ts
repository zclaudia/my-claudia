import type { Migration } from './types.js';

export const migration: Migration = {
  name: '068_local_issue_comments',
  sql: `
    CREATE TABLE IF NOT EXISTS local_issue_comments (
      id         TEXT PRIMARY KEY,
      issue_id   TEXT NOT NULL,
      body       TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (issue_id) REFERENCES local_issues(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_local_issue_comments_issue
      ON local_issue_comments(issue_id, created_at);
  `,
};
