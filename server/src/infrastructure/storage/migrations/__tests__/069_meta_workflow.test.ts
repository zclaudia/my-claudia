import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { migration as m069 } from '../069_meta_workflow.js';

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

describe('migration 069 — meta workflow tables', () => {
  function freshDb() {
    const db = new Database(':memory:');
    // Minimal prerequisite: projects.id is referenced by FK
    db.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY
      );
    `);
    return db;
  }

  function cols(db: Database.Database, table: string): ColumnInfo[] {
    return db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
  }

  it('creates all five tables', () => {
    const db = freshDb();
    db.exec(m069.sql);

    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    ).all() as { name: string }[];
    const names = tables.map((t) => t.name);

    expect(names).toContain('meta_workflow_runs');
    expect(names).toContain('meta_workflow_phases');
    expect(names).toContain('meta_workflow_artifacts');
    expect(names).toContain('meta_workflow_reuse_pool');
    expect(names).toContain('meta_subagent_templates');
  });

  it('meta_workflow_runs has expected columns', () => {
    const db = freshDb();
    db.exec(m069.sql);
    const names = cols(db, 'meta_workflow_runs').map((c) => c.name);
    for (const expected of [
      'id', 'project_id', 'title', 'description', 'status',
      'requirements_path', 'phases_json', 'smoke_path_run_id',
      'reject_count', 'default_provider_id', 'config',
      'worktree_id', 'created_at', 'updated_at', 'completed_at',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('meta_workflow_phases has provider override columns', () => {
    const db = freshDb();
    db.exec(m069.sql);
    const names = cols(db, 'meta_workflow_phases').map((c) => c.name);
    for (const expected of [
      'id', 'run_id', 'phase_id', 'phase_type', 'status',
      'execute_entity', 'reused_from_pool_id',
      'generated_workflow_id', 'generated_subagent_id',
      'current_run_id', 'worktree_path',
      'stale_since', 'stale_source_phase_id',
      'attempt', 'max_retries',
      'inputs_snapshot', 'outputs_snapshot', 'gates_snapshot',
      'execute_config_snapshot',
      'synthesizer_provider_id', 'runtime_provider_id',
      'created_at', 'started_at', 'completed_at',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('meta_workflow_artifacts has version field', () => {
    const db = freshDb();
    db.exec(m069.sql);
    const names = cols(db, 'meta_workflow_artifacts').map((c) => c.name);
    expect(names).toContain('version');
    expect(names).toContain('commit_sha');
    expect(names).toContain('status');
  });

  it('meta_workflow_reuse_pool supports both kinds (workflow / subagent)', () => {
    const db = freshDb();
    db.exec(m069.sql);
    const names = cols(db, 'meta_workflow_reuse_pool').map((c) => c.name);
    expect(names).toContain('kind');
    expect(names).toContain('entity_id');
    expect(names).toContain('source_type');
  });

  it('meta_subagent_templates has prompt + tools + termination fields', () => {
    const db = freshDb();
    db.exec(m069.sql);
    const names = cols(db, 'meta_subagent_templates').map((c) => c.name);
    expect(names).toContain('system_prompt');
    expect(names).toContain('allowed_tools');
    expect(names).toContain('termination_condition');
  });

  it('is idempotent (running twice does not throw)', () => {
    const db = freshDb();
    db.exec(m069.sql);
    expect(() => db.exec(m069.sql)).not.toThrow();
  });

  it('unique (run_id, phase_id) on meta_workflow_phases', () => {
    const db = freshDb();
    db.exec(m069.sql);
    db.prepare(`INSERT INTO projects (id) VALUES (?)`).run('proj-1');
    db.prepare(
      `INSERT INTO meta_workflow_runs (id, project_id, title, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('run-1', 'proj-1', 'T', 'requirement_draft', 0, 0);
    db.prepare(
      `INSERT INTO meta_workflow_phases (id, run_id, phase_id, phase_type, status, execute_entity, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('p-1', 'run-1', 'phase-x', 'code-implement', 'pending', 'workflow', 0);

    expect(() =>
      db.prepare(
        `INSERT INTO meta_workflow_phases (id, run_id, phase_id, phase_type, status, execute_entity, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('p-2', 'run-1', 'phase-x', 'code-implement', 'pending', 'workflow', 0),
    ).toThrow(/UNIQUE/);
  });
});
