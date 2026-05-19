// server/src/domains/meta-workflow/__tests__/integration-stale.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaWorkflowService } from '../service.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY);`);
  db.exec(m069.sql);
  db.prepare(`INSERT INTO projects (id) VALUES (?)`).run('proj-1');
  return db;
}

const threePhases = JSON.stringify({
  version: '1',
  phases: [
    {
      id: 'A', name: 'A', description: 'A',
      phaseType: 'code-implement', dependsOn: [], inputs: [],
      outputs: [{ kind: 'commit', description: 'a' }],
      acceptanceGates: [{ id: 'g', description: 'g', command: 'true', expect: { exitCode: 0 } }],
    },
    {
      id: 'B', name: 'B', description: 'B',
      phaseType: 'code-implement', dependsOn: ['A'], inputs: [],
      outputs: [{ kind: 'commit', description: 'b' }],
      acceptanceGates: [{ id: 'g', description: 'g', command: 'true', expect: { exitCode: 0 } }],
    },
    {
      id: 'C', name: 'C', description: 'C',
      phaseType: 'code-implement', dependsOn: ['B'], inputs: [],
      outputs: [{ kind: 'commit', description: 'c' }],
      acceptanceGates: [{ id: 'g', description: 'g', command: 'true', expect: { exitCode: 0 } }],
    },
  ],
  smokePath: ['A', 'B', 'C'],
  metadata: { generatedAt: 0, requirementsPath: 'r.md' },
});

describe('Phase D integration: stale propagation through full flow', () => {
  let db: Database.Database;
  let service: MetaWorkflowService;
  let workdir: string;

  beforeEach(() => {
    db = freshDb();
    workdir = mkdtempSync(join(tmpdir(), 'meta-int-'));
    service = new MetaWorkflowService({
      db,
      runEntityForWorkflow: vi.fn().mockResolvedValue({ exitOk: true }),
      runEntityForSubagent: vi.fn().mockResolvedValue({ exitOk: true }),
      worktreeAllocator: {
        acquire: vi.fn().mockResolvedValue(workdir),
        release: vi.fn().mockResolvedValue(undefined),
        releaseRun: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('runs A→B→C, then A re-run marks B stale (lazy)', async () => {
    const run = service.createRun({ projectId: 'proj-1', title: 'int' });
    service.submitRequirements(run.id, 'r.md');
    service.approveRequirements(run.id);
    service.setPhasesJson(run.id, threePhases);

    await service.runPhase(run.id, 'A');
    await service.runPhase(run.id, 'B');
    await service.runPhase(run.id, 'C');

    let phases = service.listPhases(run.id);
    expect(phases.every((p) => p.status === 'done')).toBe(true);

    await service.rerunPhase(run.id, 'A');
    phases = service.listPhases(run.id);
    const b = phases.find((p) => p.phaseId === 'B')!;
    const c = phases.find((p) => p.phaseId === 'C')!;
    expect(b.status).toBe('stale');
    expect(c.status).toBe('done'); // lazy: not cascaded
  });

  it('cascadeRerun from B reruns both B and C', async () => {
    const run = service.createRun({ projectId: 'proj-1', title: 'int' });
    service.submitRequirements(run.id, 'r.md');
    service.approveRequirements(run.id);
    service.setPhasesJson(run.id, threePhases);

    await service.runPhase(run.id, 'A');
    await service.runPhase(run.id, 'B');
    await service.runPhase(run.id, 'C');

    const results = await service.cascadeRerun(run.id, 'B');
    expect(results.length).toBeGreaterThanOrEqual(2);
    const ids = results.map((r) => r.phase.phaseId);
    expect(ids).toContain('B');
    expect(ids).toContain('C');
  });
});
