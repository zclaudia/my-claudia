// server/src/domains/meta-workflow/__tests__/run-aggregate.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaWorkflowRunRepository } from '../repositories/meta-workflow-run-repository.js';
import { MetaWorkflowRunAggregate } from '../run-aggregate.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY);`);
  db.exec(m069.sql);
  db.prepare(`INSERT INTO projects (id) VALUES (?)`).run('proj-1');
  return db;
}

describe('MetaWorkflowRunAggregate', () => {
  let db: Database.Database;
  let agg: MetaWorkflowRunAggregate;

  beforeEach(() => {
    db = freshDb();
    agg = new MetaWorkflowRunAggregate(new MetaWorkflowRunRepository(db));
  });

  it('creates a run in requirement_draft', () => {
    const run = agg.create({ projectId: 'proj-1', title: 'Add billing' });
    expect(run.status).toBe('requirement_draft');
    expect(run.rejectCount).toBe(0);
  });

  it('submitRequirements moves draft → review', () => {
    const run = agg.create({ projectId: 'proj-1', title: 't' });
    const updated = agg.submitRequirements(run.id, 'design/requirements.md');
    expect(updated.status).toBe('requirement_review');
    expect(updated.requirementsPath).toBe('design/requirements.md');
  });

  it('approveRequirements moves review → splitting', () => {
    const run = agg.create({ projectId: 'proj-1', title: 't' });
    agg.submitRequirements(run.id, 'design/requirements.md');
    const updated = agg.approveRequirements(run.id);
    expect(updated.status).toBe('splitting');
  });

  it('rejectRequirements bumps counter and returns to draft', () => {
    const run = agg.create({ projectId: 'proj-1', title: 't' });
    agg.submitRequirements(run.id, 'r.md');
    const updated = agg.rejectRequirements(run.id);
    expect(updated.status).toBe('requirement_draft');
    expect(updated.rejectCount).toBe(1);
  });

  it('setPhasesJson stores serialized doc and moves splitting → executing', () => {
    const run = agg.create({ projectId: 'proj-1', title: 't' });
    agg.submitRequirements(run.id, 'r.md');
    agg.approveRequirements(run.id);
    const updated = agg.setPhasesJson(run.id, '{"version":"1","phases":[],"smokePath":[],"metadata":{"generatedAt":0,"requirementsPath":"r.md"}}');
    expect(updated.status).toBe('executing');
    expect(updated.phasesJson).toContain('"version":"1"');
  });

  it('complete from reviewing sets completedAt', () => {
    const run = agg.create({ projectId: 'proj-1', title: 't' });
    agg.submitRequirements(run.id, 'r.md');
    agg.approveRequirements(run.id);
    agg.setPhasesJson(run.id, '{"version":"1","phases":[],"smokePath":[],"metadata":{"generatedAt":0,"requirementsPath":"r.md"}}');
    agg.enterReviewing(run.id);
    const updated = agg.complete(run.id);
    expect(updated.status).toBe('completed');
    expect(updated.completedAt).toBeGreaterThan(0);
  });

  it('cancel from any non-terminal works', () => {
    const run = agg.create({ projectId: 'proj-1', title: 't' });
    const cancelled = agg.cancel(run.id);
    expect(cancelled.status).toBe('cancelled');
  });

  it('cannot reject in draft (only after submit)', () => {
    const run = agg.create({ projectId: 'proj-1', title: 't' });
    expect(() => agg.rejectRequirements(run.id)).toThrow(/Cannot reject requirements/);
  });
});
