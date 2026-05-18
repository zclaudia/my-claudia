// server/src/domains/meta-workflow/__tests__/phase-aggregate.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaWorkflowPhaseRepository } from '../repositories/meta-workflow-phase-repository.js';
import { MetaWorkflowPhaseAggregate } from '../phase-aggregate.js';
import type { PhaseDef } from '@my-claudia/shared/features/meta-workflow';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY);`);
  db.exec(m069.sql);
  db.prepare(`INSERT INTO projects (id) VALUES (?)`).run('proj-1');
  db.prepare(
    `INSERT INTO meta_workflow_runs (id, project_id, title, status, reject_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('run-1', 'proj-1', 't', 'executing', 0, 0, 0);
  return db;
}

const phaseDef: PhaseDef = {
  id: 'p1',
  name: 'Impl X',
  description: 'Implement X',
  phaseType: 'code-implement',
  dependsOn: [],
  inputs: [],
  outputs: [{ kind: 'commit', description: 'commit' }],
  acceptanceGates: [{
    id: 'compile', description: 'compile', command: 'mvn compile', expect: { exitCode: 0 },
  }],
};

describe('MetaWorkflowPhaseAggregate', () => {
  let db: Database.Database;
  let agg: MetaWorkflowPhaseAggregate;

  beforeEach(() => {
    db = freshDb();
    agg = new MetaWorkflowPhaseAggregate(new MetaWorkflowPhaseRepository(db));
  });

  it('instantiates phase in pending with snapshot fields', () => {
    const phase = agg.instantiate('run-1', phaseDef);
    expect(phase.status).toBe('pending');
    expect(phase.attempt).toBe(0);
    expect(phase.maxRetries).toBe(3);
    expect(phase.executeEntity).toBe('workflow');
    expect(phase.inputsSnapshot).toEqual([]);
    expect(phase.gatesSnapshot?.[0].command).toBe('mvn compile');
  });

  it('subagent default for investigation phaseType', () => {
    const inv: PhaseDef = { ...phaseDef, id: 'p-inv', phaseType: 'investigation' };
    const phase = agg.instantiate('run-1', inv);
    expect(phase.executeEntity).toBe('subagent');
  });

  it('phase progression pending → done', () => {
    const phase = agg.instantiate('run-1', phaseDef);
    agg.enterSearchingReuse(phase.id);
    agg.enterGenerating(phase.id);
    agg.enterReadyToRun(phase.id);
    agg.enterRunning(phase.id);
    agg.enterVerifyingGates(phase.id);
    const done = agg.markDone(phase.id);
    expect(done.status).toBe('done');
    expect(done.completedAt).toBeGreaterThan(0);
  });

  it('markFailed from running', () => {
    const phase = agg.instantiate('run-1', phaseDef);
    agg.enterSearchingReuse(phase.id);
    agg.enterReadyToRun(phase.id);
    agg.enterRunning(phase.id);
    const failed = agg.markFailed(phase.id, 'compile fail');
    expect(failed.status).toBe('failed');
  });

  it('markStale from done', () => {
    const phase = agg.instantiate('run-1', phaseDef);
    agg.enterSearchingReuse(phase.id);
    agg.enterReadyToRun(phase.id);
    agg.enterRunning(phase.id);
    agg.enterVerifyingGates(phase.id);
    agg.markDone(phase.id);
    const stale = agg.markStale(phase.id, 'p-upstream');
    expect(stale.status).toBe('stale');
    expect(stale.staleSourcePhaseId).toBe('p-upstream');
    expect(stale.staleSince).toBeGreaterThan(0);
  });

  it('clearStale returns stale → done', () => {
    const phase = agg.instantiate('run-1', phaseDef);
    agg.enterSearchingReuse(phase.id);
    agg.enterReadyToRun(phase.id);
    agg.enterRunning(phase.id);
    agg.enterVerifyingGates(phase.id);
    agg.markDone(phase.id);
    agg.markStale(phase.id, 'p-upstream');
    const cleared = agg.clearStale(phase.id);
    expect(cleared.status).toBe('done');
    expect(cleared.staleSince).toBeUndefined();
  });

  it('forbids invalid transitions', () => {
    const phase = agg.instantiate('run-1', phaseDef);
    expect(() => agg.markDone(phase.id)).toThrow(/Invalid phase transition/);
  });

  it('reuse-hit path: searching_reuse → ready_to_run skipping generating', () => {
    const phase = agg.instantiate('run-1', phaseDef);
    agg.enterSearchingReuse(phase.id);
    const updated = agg.enterReadyToRun(phase.id, {
      reusedFromPoolId: 'pool-item-1',
      generatedWorkflowId: 'wf-existing',
    });
    expect(updated.status).toBe('ready_to_run');
    expect(updated.reusedFromPoolId).toBe('pool-item-1');
    expect(updated.generatedWorkflowId).toBe('wf-existing');
  });
});
