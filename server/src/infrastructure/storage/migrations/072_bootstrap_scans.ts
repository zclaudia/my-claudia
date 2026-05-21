import type { Migration } from './types.js';

/**
 * Phase G4 Task 1 — bootstrap scan + review item tables.
 *
 * `bootstrap_scans` tracks each AI-driven explore-and-merge pass over a
 * project's existing source. ADDED requirements are auto-applied; MODIFY /
 * REMOVE operations are deferred to `bootstrap_review_items` for explicit
 * human approval before they touch the corpus.
 *
 * Cascade delete from projects → scans → review items keeps the tables in
 * sync when a project is dropped. CHECK constraints on `status` and
 * `operation` guard the small finite state spaces used by the
 * BootstrapService / BootstrapReviewService state machines.
 */
export const migration: Migration = {
  name: '072_bootstrap_scans',
  sql: `
    CREATE TABLE IF NOT EXISTS bootstrap_scans (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running','awaiting_review','completed','failed','cancelled')),
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      applied_count INTEGER NOT NULL DEFAULT 0,
      pending_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_bootstrap_scans_project ON bootstrap_scans(project_id, status);

    CREATE TABLE IF NOT EXISTS bootstrap_review_items (
      id TEXT PRIMARY KEY,
      scan_id TEXT NOT NULL,
      capability TEXT NOT NULL,
      operation TEXT NOT NULL
        CHECK (operation IN ('modify','remove')),
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','rejected')),
      created_at INTEGER NOT NULL,
      resolved_at INTEGER,
      FOREIGN KEY (scan_id) REFERENCES bootstrap_scans(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_bootstrap_review_items_scan ON bootstrap_review_items(scan_id, status);
  `,
};
