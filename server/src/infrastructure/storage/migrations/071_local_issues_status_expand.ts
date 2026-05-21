import type { Migration } from './types.js';

/**
 * G3 prerequisite — expand the `local_issues.status` CHECK constraint to cover
 * the full sub-issue lifecycle introduced by the OpenSpec integration.
 *
 * Original (migration 065) constraint allowed only:
 *   open | in_progress | closed
 *
 * New status machine (shared/src/features/local-issue.ts LocalIssueStatus):
 *   open | planning | tasks_ready | executing | reviewing | closed | cancelled
 *   plus 'in_progress' kept as a legacy fallback.
 *
 * SQLite cannot ALTER an existing CHECK constraint in place; the table is
 * rebuilt via the documented "create new, copy, drop, rename" pattern. All
 * G1 columns (`type`, `parent_issue_id`, `spec_change_id`, `is_anonymous`)
 * are preserved.
 */
export const migration: Migration = {
  name: '071_local_issues_status_expand',
  sql: `
    -- Defer FK checks while we swap tables. FK to projects(id) is restored
    -- on the rebuilt table; rows referencing local_issues (e.g.
    -- local_issue_comments.issue_id, parent_issue_id self-FK) survive the
    -- rename via the foreign_key_check at COMMIT.
    PRAGMA foreign_keys = OFF;

    CREATE TABLE local_issues_new (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','planning','tasks_ready','executing','reviewing','closed','cancelled','in_progress')),
      priority TEXT NOT NULL DEFAULT 'medium'
        CHECK (priority IN ('low','medium','high','critical')),
      labels TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      closed_at INTEGER,
      type TEXT NOT NULL DEFAULT 'implement'
        CHECK (type IN ('feature','implement','bug','enhancement','chore')),
      parent_issue_id TEXT REFERENCES local_issues_new(id) ON DELETE SET NULL,
      spec_change_id TEXT,
      is_anonymous INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    INSERT INTO local_issues_new (
      id, project_id, title, description, status, priority, labels,
      created_at, updated_at, closed_at,
      type, parent_issue_id, spec_change_id, is_anonymous
    )
    SELECT
      id, project_id, title, description, status, priority, labels,
      created_at, updated_at, closed_at,
      type, parent_issue_id, spec_change_id, is_anonymous
    FROM local_issues;

    DROP TABLE local_issues;
    ALTER TABLE local_issues_new RENAME TO local_issues;

    -- Re-create indexes dropped with the original table.
    CREATE INDEX IF NOT EXISTS idx_local_issues_project ON local_issues(project_id);
    CREATE INDEX IF NOT EXISTS idx_local_issues_status ON local_issues(status);
    CREATE INDEX IF NOT EXISTS idx_local_issues_parent ON local_issues(parent_issue_id);
    CREATE INDEX IF NOT EXISTS idx_local_issues_type ON local_issues(project_id, type);

    PRAGMA foreign_keys = ON;
  `,
};
