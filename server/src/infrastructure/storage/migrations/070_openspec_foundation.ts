import type { Migration } from './types.js';

export const migration: Migration = {
  name: '070_openspec_foundation',
  sql: `
    -- SpecChange (1:1 with sub-issue)
    CREATE TABLE IF NOT EXISTS spec_changes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      sub_issue_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'drafting'
        CHECK (status IN ('drafting','proposing','designing','tasks_ready','archived','cancelled')),
      proposal_path TEXT NOT NULL,
      design_path TEXT NOT NULL,
      tasks_path TEXT NOT NULL,
      delta_spec_paths TEXT NOT NULL DEFAULT '[]',
      delta_pending_merge INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (sub_issue_id) REFERENCES local_issues(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_spec_changes_project ON spec_changes(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_spec_changes_sub_issue ON spec_changes(sub_issue_id);

    -- ExecutorInstance (abstraction layer)
    CREATE TABLE IF NOT EXISTS executor_instances (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      spec_change_id TEXT NOT NULL,
      type TEXT NOT NULL
        CHECK (type IN ('classic','meta-workflow','manual','superpowers')),
      underlying_id TEXT,
      status_summary TEXT NOT NULL DEFAULT 'pending'
        CHECK (status_summary IN ('pending','executing','paused','completed','failed','cancelled')),
      progress_json TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (spec_change_id) REFERENCES spec_changes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_executor_instances_spec_change ON executor_instances(spec_change_id);
    CREATE INDEX IF NOT EXISTS idx_executor_instances_status ON executor_instances(project_id, status_summary);

    -- Spec corpus metadata cache (optional; populated by G4 bootstrap)
    CREATE TABLE IF NOT EXISTS project_spec_corpus_meta (
      project_id TEXT PRIMARY KEY,
      initialized INTEGER NOT NULL DEFAULT 0,
      last_bootstrap_at INTEGER,
      capabilities_json TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- LocalIssue extension
    ALTER TABLE local_issues ADD COLUMN type TEXT NOT NULL DEFAULT 'implement'
      CHECK (type IN ('feature','implement','bug','enhancement','chore'));
    ALTER TABLE local_issues ADD COLUMN parent_issue_id TEXT
      REFERENCES local_issues(id) ON DELETE SET NULL;
    ALTER TABLE local_issues ADD COLUMN spec_change_id TEXT;
    ALTER TABLE local_issues ADD COLUMN is_anonymous INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX IF NOT EXISTS idx_local_issues_parent ON local_issues(parent_issue_id);
    CREATE INDEX IF NOT EXISTS idx_local_issues_type ON local_issues(project_id, type);
  `,
};
