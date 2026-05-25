import type { Migration } from './types.js';

/**
 * C1 — collapse `local_issues.status` from 7+1(legacy) states to 4 states.
 *
 * Old set (migration 071):
 *   open | planning | tasks_ready | executing | reviewing | closed | cancelled
 *   + legacy `in_progress`
 *
 * New set (shared/src/features/local-issue.ts LocalIssueStatus):
 *   open | tracked | closed | cancelled
 *
 * Mapping for existing rows:
 *   planning, tasks_ready, executing, reviewing, in_progress  →  tracked
 *   open, closed, cancelled                                    →  unchanged
 *
 * Rationale: the intermediate workflow states (planning/tasks_ready/executing/
 * reviewing) duplicated state the SpecChange already owns. The UI projects
 * SpecChange.status when the issue carries a `spec_change_id`; Issue itself
 * just needs to record "in progress" (`tracked`).
 *
 * SQLite cannot ALTER an existing CHECK constraint in place; the table is
 * rebuilt via the "create new, copy, drop, rename" pattern, with the
 * backfill applied during the INSERT ... SELECT step.
 */
export const migration: Migration = {
  name: '073_local_issues_status_collapse',
  sql: `
    PRAGMA foreign_keys = OFF;

    CREATE TABLE local_issues_new (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','tracked','closed','cancelled')),
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
      id, project_id, title, description,
      CASE status
        WHEN 'planning'    THEN 'tracked'
        WHEN 'tasks_ready' THEN 'tracked'
        WHEN 'executing'   THEN 'tracked'
        WHEN 'reviewing'   THEN 'tracked'
        WHEN 'in_progress' THEN 'tracked'
        ELSE status
      END,
      priority, labels,
      created_at, updated_at, closed_at,
      type, parent_issue_id, spec_change_id, is_anonymous
    FROM local_issues;

    DROP TABLE local_issues;
    ALTER TABLE local_issues_new RENAME TO local_issues;

    CREATE INDEX IF NOT EXISTS idx_local_issues_project ON local_issues(project_id);
    CREATE INDEX IF NOT EXISTS idx_local_issues_status ON local_issues(status);
    CREATE INDEX IF NOT EXISTS idx_local_issues_parent ON local_issues(parent_issue_id);
    CREATE INDEX IF NOT EXISTS idx_local_issues_type ON local_issues(project_id, type);

    PRAGMA foreign_keys = ON;
  `,
};
