import type { Migration } from './types.js';

export const migration: Migration = {
  name: '069_meta_workflow',
  idempotent: true,
  sql: `
    CREATE TABLE IF NOT EXISTS meta_workflow_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      requirements_path TEXT,
      phases_json TEXT,
      smoke_path_run_id TEXT,
      reject_count INTEGER NOT NULL DEFAULT 0,
      default_provider_id TEXT,
      config TEXT,
      worktree_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_meta_runs_project
      ON meta_workflow_runs(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_meta_runs_status
      ON meta_workflow_runs(status);

    CREATE TABLE IF NOT EXISTS meta_workflow_phases (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      phase_id TEXT NOT NULL,
      phase_type TEXT NOT NULL,
      status TEXT NOT NULL,
      execute_entity TEXT NOT NULL,
      reused_from_pool_id TEXT,
      generated_workflow_id TEXT,
      generated_subagent_id TEXT,
      current_run_id TEXT,
      worktree_path TEXT,
      stale_since INTEGER,
      stale_source_phase_id TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      inputs_snapshot TEXT,
      outputs_snapshot TEXT,
      gates_snapshot TEXT,
      execute_config_snapshot TEXT,
      synthesizer_provider_id TEXT,
      runtime_provider_id TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      FOREIGN KEY (run_id) REFERENCES meta_workflow_runs(id) ON DELETE CASCADE,
      UNIQUE (run_id, phase_id)
    );
    CREATE INDEX IF NOT EXISTS idx_meta_phases_run
      ON meta_workflow_phases(run_id, status);
    CREATE INDEX IF NOT EXISTS idx_meta_phases_status
      ON meta_workflow_phases(status);

    CREATE TABLE IF NOT EXISTS meta_workflow_artifacts (
      id TEXT PRIMARY KEY,
      phase_record_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      commit_sha TEXT,
      artifact_files TEXT,
      gate_results TEXT,
      ai_review_notes_path TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (phase_record_id) REFERENCES meta_workflow_phases(id) ON DELETE CASCADE,
      UNIQUE (phase_record_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_meta_artifacts_phase
      ON meta_workflow_artifacts(phase_record_id, version DESC);
    CREATE INDEX IF NOT EXISTS idx_meta_artifacts_status
      ON meta_workflow_artifacts(status);

    CREATE TABLE IF NOT EXISTS meta_workflow_reuse_pool (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      phase_type TEXT NOT NULL,
      description TEXT,
      tags TEXT,
      source_type TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      archived_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_meta_reuse_phase_type
      ON meta_workflow_reuse_pool(phase_type, source_type);
    CREATE INDEX IF NOT EXISTS idx_meta_reuse_kind
      ON meta_workflow_reuse_pool(kind);
    CREATE INDEX IF NOT EXISTS idx_meta_reuse_entity
      ON meta_workflow_reuse_pool(entity_id);

    CREATE TABLE IF NOT EXISTS meta_subagent_templates (
      id TEXT PRIMARY KEY,
      name TEXT,
      system_prompt TEXT NOT NULL,
      allowed_tools TEXT NOT NULL,
      max_turns INTEGER NOT NULL DEFAULT 30,
      termination_condition TEXT NOT NULL,
      source_type TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `,
};
