import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaWorkflowRunRepository } from '../repositories/meta-workflow-run-repository.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY);`);
  db.exec(m069.sql);
  db.prepare(`INSERT INTO projects (id) VALUES (?)`).run('proj-1');
  return db;
}

describe('MetaWorkflowRunRepository', () => {
  let db: Database.Database;
  let repo: MetaWorkflowRunRepository;

  beforeEach(() => {
    db = freshDb();
    repo = new MetaWorkflowRunRepository(db);
  });

  it('creates a run with defaults', () => {
    const now = Date.now();
    const run = repo.create({
      projectId: 'proj-1',
      title: 'Add billing',
      status: 'requirement_draft',
      rejectCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    expect(run.id).toBeTruthy();
    expect(run.title).toBe('Add billing');
    expect(run.status).toBe('requirement_draft');
    expect(run.rejectCount).toBe(0);
  });

  it('findById returns null for missing', () => {
    expect(repo.findById('missing')).toBeNull();
  });

  it('updates partial fields', () => {
    const now = Date.now();
    const created = repo.create({
      projectId: 'proj-1', title: 't', status: 'requirement_draft',
      rejectCount: 0, createdAt: now, updatedAt: now,
    });
    const updated = repo.update(created.id, { status: 'splitting', rejectCount: 1, updatedAt: now + 1 });
    expect(updated.status).toBe('splitting');
    expect(updated.rejectCount).toBe(1);
    expect(updated.title).toBe('t');
  });

  it('findByProject returns runs ordered by created_at desc', () => {
    repo.create({ projectId: 'proj-1', title: 'r1', status: 'requirement_draft',
                  rejectCount: 0, createdAt: 100, updatedAt: 100 });
    repo.create({ projectId: 'proj-1', title: 'r2', status: 'requirement_draft',
                  rejectCount: 0, createdAt: 200, updatedAt: 200 });
    const runs = repo.findByProject('proj-1');
    expect(runs.map((r) => r.title)).toEqual(['r2', 'r1']);
  });

  it('round-trips JSON config and phasesJson', () => {
    const now = Date.now();
    const created = repo.create({
      projectId: 'proj-1', title: 't', status: 'requirement_draft',
      rejectCount: 0, createdAt: now, updatedAt: now,
      config: { maxRequirementRejects: 5, maxParallelPhases: 3 },
      phasesJson: '{"version":"1","phases":[],"smokePath":[],"metadata":{"generatedAt":0,"requirementsPath":"x"}}',
    });
    const fetched = repo.findById(created.id);
    expect(fetched?.config).toEqual({ maxRequirementRejects: 5, maxParallelPhases: 3 });
    expect(fetched?.phasesJson).toContain('"version":"1"');
  });
});
