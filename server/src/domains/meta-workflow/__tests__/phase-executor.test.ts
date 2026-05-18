// server/src/domains/meta-workflow/__tests__/phase-executor.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaWorkflowPhaseRepository } from '../repositories/meta-workflow-phase-repository.js';
import { MetaWorkflowPhaseAggregate } from '../phase-aggregate.js';
import { MetaPhaseExecutor } from '../phase-executor.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  id: 'p1', name: 'Echo', description: 'echo something',
  phaseType: 'code-implement',
  dependsOn: [],
  inputs: [],
  outputs: [{ kind: 'commit', description: 'commit' }],
  acceptanceGates: [
    { id: 'g1', description: 'ok', command: 'true', expect: { exitCode: 0 } },
  ],
};

describe('MetaPhaseExecutor', () => {
  let db: Database.Database;
  let agg: MetaWorkflowPhaseAggregate;
  let workdir: string;

  beforeEach(() => {
    db = freshDb();
    agg = new MetaWorkflowPhaseAggregate(new MetaWorkflowPhaseRepository(db));
    workdir = mkdtempSync(join(tmpdir(), 'phase-exec-'));
  });

  it('drives a workflow phase to done when gates pass', async () => {
    const phase = agg.instantiate('run-1', phaseDef);
    const executor = new MetaPhaseExecutor({
      aggregate: agg,
      runEntity: async () => ({ exitOk: true }),  // pretend the workflow ran fine
    });
    const result = await executor.execute(phase.id, phaseDef, workdir);
    expect(result.phase.status).toBe('done');
    expect(result.gateResults[0].passed).toBe(true);
  });

  it('marks failed when gate command fails', async () => {
    const failPhase: PhaseDef = {
      ...phaseDef,
      acceptanceGates: [{ id: 'g1', description: 'no', command: 'false', expect: { exitCode: 0 } }],
    };
    const phase = agg.instantiate('run-1', failPhase);
    const executor = new MetaPhaseExecutor({
      aggregate: agg,
      runEntity: async () => ({ exitOk: true }),
    });
    const result = await executor.execute(phase.id, failPhase, workdir);
    expect(result.phase.status).toBe('failed');
    expect(result.gateResults[0].passed).toBe(false);
  });

  it('marks failed when entity runner reports failure (skips gates)', async () => {
    const phase = agg.instantiate('run-1', phaseDef);
    const executor = new MetaPhaseExecutor({
      aggregate: agg,
      runEntity: async () => ({ exitOk: false }),
    });
    const result = await executor.execute(phase.id, phaseDef, workdir);
    expect(result.phase.status).toBe('failed');
    expect(result.gateResults).toEqual([]);
  });

  it('persists generatedWorkflowId after synthesizing a workflow', async () => {
    const phase = agg.instantiate('run-1', phaseDef);
    const executor = new MetaPhaseExecutor({
      aggregate: agg,
      runEntity: async () => ({ exitOk: true }),
    });
    await executor.execute(phase.id, phaseDef, workdir);
    const final = agg['repo'].findById(phase.id);
    expect(final?.generatedWorkflowId).toBeTruthy();
  });

  it('uses subagent path for investigation phaseType', async () => {
    const invDef: PhaseDef = { ...phaseDef, id: 'p2', phaseType: 'investigation',
                               outputs: [{ kind: 'file', path: 'rep.md', description: 'rep' }] };
    const phase = agg.instantiate('run-1', invDef);
    let seenEntityKind: string | undefined;
    const executor = new MetaPhaseExecutor({
      aggregate: agg,
      runEntity: async (entity) => { seenEntityKind = entity.kind; return { exitOk: true }; },
    });
    await executor.execute(phase.id, invDef, workdir);
    expect(seenEntityKind).toBe('subagent');
    const final = agg['repo'].findById(phase.id);
    expect(final?.generatedSubagentId).toBeTruthy();
    expect(final?.generatedWorkflowId).toBeUndefined();
  });
});
