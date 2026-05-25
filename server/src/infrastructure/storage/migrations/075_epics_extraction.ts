import type { Migration } from './types.js';

/**
 * C5 — extract `feature`-type LocalIssues into a dedicated `epics` table.
 *
 * Before C5:
 *   - LocalIssues with `type = 'feature'` were parent containers (3-state
 *     lifecycle, no SpecChange), linked from sub-issues via `parent_issue_id`.
 *
 * After C5:
 *   - New `epics` table holds those container records.
 *   - `local_issues.parent_issue_id` is renamed to `epic_id`; the column
 *     now references `epics(id)` instead of `local_issues(id)`.
 *   - `local_issues.type` CHECK constraint drops `'feature'`.
 *
 * Migration steps (atomic in one SQL transaction):
 *   1. CREATE TABLE epics.
 *   2. INSERT historical features → epics. Keep the same id so existing
 *      `parent_issue_id` values still resolve after the FK swap.
 *   3. Rebuild local_issues with: `epic_id` (renamed from parent_issue_id,
 *      FK now to epics), updated CHECK constraint excluding 'feature'.
 *   4. Re-create indexes.
 *
 * SQLite can't ALTER constraints in place; uses the same rebuild pattern
 * established in migrations 071 and 073.
 */
export const migration: Migration = {
  name: '075_epics_extraction',
  sql: `
    PRAGMA foreign_keys = OFF;

    -- 1. Create the standalone epics table.
    CREATE TABLE IF NOT EXISTS epics (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','closed','cancelled')),
      labels TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      closed_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_epics_project ON epics(project_id);
    CREATE INDEX IF NOT EXISTS idx_epics_status ON epics(status);

    -- 2. Migrate feature LocalIssues to Epics (preserve id so sub-issues'
    --    parent_issue_id references stay valid post-rename).
    INSERT INTO epics (
      id, project_id, title, description, status, labels,
      created_at, updated_at, closed_at
    )
    SELECT
      id, project_id, title, description,
      CASE status WHEN 'open' THEN 'open' WHEN 'closed' THEN 'closed' WHEN 'cancelled' THEN 'cancelled' ELSE 'open' END,
      labels, created_at, updated_at, closed_at
    FROM local_issues
    WHERE type = 'feature';

    -- 3. Rebuild local_issues: rename parent_issue_id → epic_id (FK now
    --    points at epics) and drop 'feature' from the type CHECK.
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
        CHECK (type IN ('implement','bug','enhancement','chore')),
      epic_id TEXT REFERENCES epics(id) ON DELETE SET NULL,
      spec_change_id TEXT,
      is_anonymous INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    INSERT INTO local_issues_new (
      id, project_id, title, description, status, priority, labels,
      created_at, updated_at, closed_at,
      type, epic_id, spec_change_id, is_anonymous
    )
    SELECT
      id, project_id, title, description, status, priority, labels,
      created_at, updated_at, closed_at,
      type, parent_issue_id, spec_change_id, is_anonymous
    FROM local_issues
    WHERE type != 'feature';

    DROP TABLE local_issues;
    ALTER TABLE local_issues_new RENAME TO local_issues;

    -- 4. Re-create indexes.
    CREATE INDEX IF NOT EXISTS idx_local_issues_project ON local_issues(project_id);
    CREATE INDEX IF NOT EXISTS idx_local_issues_status ON local_issues(status);
    CREATE INDEX IF NOT EXISTS idx_local_issues_epic ON local_issues(epic_id);
    CREATE INDEX IF NOT EXISTS idx_local_issues_type ON local_issues(project_id, type);

    PRAGMA foreign_keys = ON;
  `,
};
