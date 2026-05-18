// server/src/domains/meta-workflow/__tests__/service.test.ts
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

const samplePhasesJson = JSON.stringify({
  version: '1',
  phases: [{
    id: 'p1', name: 'Echo', description: 'echo something',
    phaseType: 'code-implement',
    dependsOn: [], inputs: [],
    outputs: [{ kind: 'commit', description: 'commit' }],
    acceptanceGates: [{
      id: 'g1', description: 'ok', command: 'true', expect: { exitCode: 0 },
    }],
  }],
  smokePath: ['p1'],
  metadata: { generatedAt: 0, requirementsPath: 'design/req.md' },
});

describe('MetaWorkflowService', () => {
  let db: Database.Database;
  let service: MetaWorkflowService;
  let workdir: string;
  let fakeAllocator: { acquire: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    db = freshDb();
    workdir = mkdtempSync(join(tmpdir(), 'meta-service-'));
    fakeAllocator = {
      acquire: vi.fn().mockResolvedValue(workdir),
      release: vi.fn().mockResolvedValue(undefined),
    };
    service = new MetaWorkflowService({
      db,
      runEntityForWorkflow: vi.fn().mockResolvedValue({ exitOk: true }),
      runEntityForSubagent: vi.fn().mockResolvedValue({ exitOk: true }),
      worktreeAllocator: fakeAllocator,
    });
  });

  it('createRun returns a run in requirement_draft', () => {
    const run = service.createRun({ projectId: 'proj-1', title: 't' });
    expect(run.status).toBe('requirement_draft');
  });

  it('full happy path: submit → approve → setPhasesJson instantiates phases', () => {
    const run = service.createRun({ projectId: 'proj-1', title: 't' });
    service.submitRequirements(run.id, 'design/req.md');
    service.approveRequirements(run.id);
    service.setPhasesJson(run.id, samplePhasesJson);

    const phases = service.listPhases(run.id);
    expect(phases).toHaveLength(1);
    expect(phases[0].phaseId).toBe('p1');
    expect(phases[0].status).toBe('pending');
  });

  it('setPhasesJson rejects invalid JSON', () => {
    const run = service.createRun({ projectId: 'proj-1', title: 't' });
    service.submitRequirements(run.id, 'design/req.md');
    service.approveRequirements(run.id);
    expect(() => service.setPhasesJson(run.id, '{not json')).toThrow(/JSON|Invalid/);
  });

  it('runPhase drives executor and reaches done when runners + gates succeed', async () => {
    const run = service.createRun({ projectId: 'proj-1', title: 't' });
    service.submitRequirements(run.id, 'design/req.md');
    service.approveRequirements(run.id);
    service.setPhasesJson(run.id, samplePhasesJson);
    const result = await service.runPhase(run.id, 'p1');
    expect(result.phase.status).toBe('done');
  });

  it('runPhase acquires and releases a worktree via the allocator', async () => {
    const run = service.createRun({ projectId: 'proj-1', title: 't' });
    service.submitRequirements(run.id, 'design/req.md');
    service.approveRequirements(run.id);
    service.setPhasesJson(run.id, samplePhasesJson);
    await service.runPhase(run.id, 'p1');
    expect(fakeAllocator.acquire).toHaveBeenCalledWith({
      runId: run.id, phaseId: 'p1', attempt: expect.any(Number),
    });
    expect(fakeAllocator.release).toHaveBeenCalledWith(workdir);
  });

  it('rejectRequirements bumps counter and returns to draft', () => {
    const run = service.createRun({ projectId: 'proj-1', title: 't' });
    service.submitRequirements(run.id, 'design/req.md');
    const after = service.rejectRequirements(run.id);
    expect(after.status).toBe('requirement_draft');
    expect(after.rejectCount).toBe(1);
  });

  it('cancelRun transitions to cancelled', () => {
    const run = service.createRun({ projectId: 'proj-1', title: 't' });
    const after = service.cancelRun(run.id);
    expect(after.status).toBe('cancelled');
  });

  it('runPhase writes an artifact row on done', async () => {
    const run = service.createRun({ projectId: 'proj-1', title: 't' });
    service.submitRequirements(run.id, 'design/req.md');
    service.approveRequirements(run.id);
    service.setPhasesJson(run.id, samplePhasesJson);
    await service.runPhase(run.id, 'p1');
    const phase = service.listPhases(run.id)[0];
    const artifacts = db.prepare(
      `SELECT * FROM meta_workflow_artifacts WHERE phase_record_id = ?`,
    ).all(phase.id);
    expect(artifacts.length).toBeGreaterThan(0);
  });
});
