import type { Migration } from './types.js';

/**
 * Spec Corpus Init Bootstrap — bootstrap candidates table + init_phase column.
 *
 * `bootstrap_candidates` records per-capability rows produced by the two-phase
 * AI flow over a project. Each row tracks selection state, the generation
 * phase it belongs to, and any generated markdown payload. The new
 * `init_phase` column on `bootstrap_scans` tracks which phase of the
 * init bootstrap state machine the scan is currently in.
 */
export const migration: Migration = {
  name: '076_bootstrap_candidates',
  sql: `
    CREATE TABLE bootstrap_candidates (
      id              TEXT PRIMARY KEY,
      scan_id         TEXT NOT NULL REFERENCES bootstrap_scans(id) ON DELETE CASCADE,
      capability      TEXT NOT NULL,
      title           TEXT NOT NULL,
      description     TEXT NOT NULL,
      source          TEXT NOT NULL,
      selected        INTEGER NOT NULL DEFAULT 1,
      phase           TEXT NOT NULL,
      generated_md    TEXT,
      generation_attempts INTEGER NOT NULL DEFAULT 0,
      error_message   TEXT,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      UNIQUE (scan_id, capability)
    );

    CREATE INDEX idx_candidates_scan ON bootstrap_candidates(scan_id);
    CREATE INDEX idx_candidates_scan_phase ON bootstrap_candidates(scan_id, phase);

    ALTER TABLE bootstrap_scans ADD COLUMN init_phase TEXT;
  `,
};
