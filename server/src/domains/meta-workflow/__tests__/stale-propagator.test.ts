// server/src/domains/meta-workflow/__tests__/stale-propagator.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaWorkflowPhaseRepository } from '../repositories/meta-workflow-phase-repository.js';
import { MetaWorkflowArtifactRepository } from '../repositories/meta-workflow-artifact-repository.js';
import { MetaWorkflowPhaseAggregate } from '../phase-aggregate.js';
import { StalePropagator } from '../stale-propagator.js';
import type { PhasesDoc, PhaseDef } from '@my-claudia/shared/features/meta-workflow';

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

function basePhase(id: string, deps: string[] = []): PhaseDef {
  return {
    id, name: id, description: '',
    phaseType: 'code-implement', dependsOn: deps,
    inputs: [], outputs: [], acceptanceGates: [{ id: 'g', description: 'g', command: 'true', expect: { exitCode: 0 } }],
  };
}

describe('StalePropagator', () => {
  let db: Database.Database;
  let phaseRepo: MetaWorkflowPhaseRepository;
  let artifactRepo: MetaWorkflowArtifactRepository;
  let phaseAggregate: MetaWorkflowPhaseAggregate;
  let propagator: StalePropagator;

  const phasesDoc: PhasesDoc = {
    version: '1',
    phases: [basePhase('A'), basePhase('B', ['A']), basePhase('C', ['B'])],
    smokePath: ['A', 'B', 'C'],
    metadata: { generatedAt: 0, requirementsPath: 'r.md' },
  };

  beforeEach(() => {
    db = freshDb();
    phaseRepo = new MetaWorkflowPhaseRepository(db);
    artifactRepo = new MetaWorkflowArtifactRepository(db);
    phaseAggregate = new MetaWorkflowPhaseAggregate(phaseRepo);
    propagator = new StalePropagator({ phaseRepo, artifactRepo, phaseAggregate });

    for (const def of phasesDoc.phases) {
      phaseAggregate.instantiate('run-1', def);
    }
  });

  function bringToDone(phaseId: string) {
    const phase = phaseRepo.findByRunAndPhaseId('run-1', phaseId)!;
    phaseAggregate.enterSearchingReuse(phase.id);
    phaseAggregate.enterReadyToRun(phase.id);
    phaseAggregate.enterRunning(phase.id);
    phaseAggregate.enterVerifyingGates(phase.id);
    phaseAggregate.markDone(phase.id);
  }

  it('marks direct downstream stale (Lazy)', () => {
    bringToDone('A');
    bringToDone('B');
    bringToDone('C');
    propagator.propagateUpstreamRerun('run-1', 'A', phasesDoc);
    const b = phaseRepo.findByRunAndPhaseId('run-1', 'B')!;
    const c = phaseRepo.findByRunAndPhaseId('run-1', 'C')!;
    expect(b.status).toBe('stale');
    // Lazy: do NOT cascade past B.
    expect(c.status).toBe('done');
  });

  it('flips downstream artifacts active → stale', () => {
    bringToDone('A');
    bringToDone('B');
    const b = phaseRepo.findByRunAndPhaseId('run-1', 'B')!;
    artifactRepo.create({
      phaseRecordId: b.id, version: 1, status: 'active', createdAt: Date.now(),
    });
    propagator.propagateUpstreamRerun('run-1', 'A', phasesDoc);
    const artifacts = artifactRepo.findByPhase(b.id);
    expect(artifacts.every((a) => a.status === 'stale')).toBe(true);
  });

  it('skips pending downstreams (no flag needed)', () => {
    bringToDone('A');
    // B and C left pending
    propagator.propagateUpstreamRerun('run-1', 'A', phasesDoc);
    const b = phaseRepo.findByRunAndPhaseId('run-1', 'B')!;
    expect(b.status).toBe('pending'); // no change
  });

  it('no-op when source phase has no downstream', () => {
    bringToDone('A');
    bringToDone('B');
    bringToDone('C');
    propagator.propagateUpstreamRerun('run-1', 'C', phasesDoc);
    // All still done.
    const a = phaseRepo.findByRunAndPhaseId('run-1', 'A')!;
    const b = phaseRepo.findByRunAndPhaseId('run-1', 'B')!;
    expect(a.status).toBe('done');
    expect(b.status).toBe('done');
  });
});
