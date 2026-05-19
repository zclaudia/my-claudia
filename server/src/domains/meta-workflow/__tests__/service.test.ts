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

  it('rerunPhase resets stale phase and reruns', async () => {
    const run = service.createRun({ projectId: 'proj-1', title: 't' });
    service.submitRequirements(run.id, 'design/req.md');
    service.approveRequirements(run.id);
    service.setPhasesJson(run.id, samplePhasesJson);
    await service.runPhase(run.id, 'p1');

    // Force the phase to stale state
    const phase = service.listPhases(run.id)[0];
    db.prepare(`UPDATE meta_workflow_phases SET status='stale' WHERE id=?`).run(phase.id);

    const result = await service.rerunPhase(run.id, 'p1');
    expect(result.phase.status).toBe('done');
  });

  it('ignoreStale clears the stale flag', async () => {
    const run = service.createRun({ projectId: 'proj-1', title: 't' });
    service.submitRequirements(run.id, 'design/req.md');
    service.approveRequirements(run.id);
    service.setPhasesJson(run.id, samplePhasesJson);
    await service.runPhase(run.id, 'p1');
    const phase = service.listPhases(run.id)[0];
    db.prepare(`UPDATE meta_workflow_phases SET status='stale' WHERE id=?`).run(phase.id);

    const after = service.ignoreStale(run.id, 'p1');
    expect(after.status).toBe('done');
  });

  it('evaluateImpact returns static fallback when no aiRunPort is provided', async () => {
    const run = service.createRun({ projectId: 'proj-1', title: 't' });
    service.submitRequirements(run.id, 'design/req.md');
    service.approveRequirements(run.id);
    service.setPhasesJson(run.id, samplePhasesJson);
    await service.runPhase(run.id, 'p1');
    const rec = await service.evaluateImpact(run.id, 'p1');
    expect(rec.kind).toBe('rerun');
    expect(rec.reason).toMatch(/no aiRunPort|fallback/i);
  });

  it('evaluateImpact uses aiRunPort to produce a variable recommendation', async () => {
    const aiRunPort = {
      startVirtualRun: vi.fn().mockImplementation(async (args: { onMessage?: (m: { kind: string; content?: string }) => void }) => {
        args.onMessage?.({ kind: 'assistant', content: '{"kind":"ignore","reason":"Upstream change is comment-only and does not affect downstream behavior."}' });
        args.onMessage?.({ kind: 'run_completed' });
      }),
    };
    const service2 = new MetaWorkflowService({
      db,
      runEntityForWorkflow: vi.fn().mockResolvedValue({ exitOk: true }),
      runEntityForSubagent: vi.fn().mockResolvedValue({ exitOk: true }),
      worktreeAllocator: fakeAllocator,
      aiRunPort,
    });
    const run = service2.createRun({ projectId: 'proj-1', title: 't' });
    service2.submitRequirements(run.id, 'design/req.md');
    service2.approveRequirements(run.id);
    service2.setPhasesJson(run.id, samplePhasesJson);
    await service2.runPhase(run.id, 'p1');

    // Force phase into stale state with a staleSourcePhaseId, and create 2 artifacts for the source.
    // For this test we use 'p1' as its own stale source (single-phase setup); both artifacts under p1.
    const phase = service2.listPhases(run.id)[0];
    db.prepare(`UPDATE meta_workflow_phases SET status='stale', stale_source_phase_id='p1' WHERE id=?`).run(phase.id);
    db.prepare(
      `INSERT INTO meta_workflow_artifacts (id, phase_record_id, version, commit_sha, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('art-extra', phase.id, 99, 'sha-current', 'active', Date.now());

    const rec = await service2.evaluateImpact(run.id, 'p1');
    expect(aiRunPort.startVirtualRun).toHaveBeenCalledOnce();
    expect(rec.kind).toBe('ignore');
    expect(rec.reason).toMatch(/comment-only/);
  });

  it('evaluateImpact falls back when AI returns unparseable output', async () => {
    const aiRunPort = {
      startVirtualRun: vi.fn().mockImplementation(async (args: { onMessage?: (m: { kind: string; content?: string }) => void }) => {
        args.onMessage?.({ kind: 'assistant', content: 'I think you should rerun, definitely.' });
        args.onMessage?.({ kind: 'run_completed' });
      }),
    };
    const service2 = new MetaWorkflowService({
      db,
      runEntityForWorkflow: vi.fn().mockResolvedValue({ exitOk: true }),
      runEntityForSubagent: vi.fn().mockResolvedValue({ exitOk: true }),
      worktreeAllocator: fakeAllocator,
      aiRunPort,
    });
    const run = service2.createRun({ projectId: 'proj-1', title: 't' });
    service2.submitRequirements(run.id, 'design/req.md');
    service2.approveRequirements(run.id);
    service2.setPhasesJson(run.id, samplePhasesJson);
    await service2.runPhase(run.id, 'p1');
    const phase = service2.listPhases(run.id)[0];
    db.prepare(`UPDATE meta_workflow_phases SET status='stale', stale_source_phase_id='p1' WHERE id=?`).run(phase.id);
    db.prepare(
      `INSERT INTO meta_workflow_artifacts (id, phase_record_id, version, commit_sha, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('art-extra', phase.id, 99, 'sha-current', 'active', Date.now());

    const rec = await service2.evaluateImpact(run.id, 'p1');
    expect(rec.kind).toBe('rerun');
    expect(rec.reason).toMatch(/unparseable|raw:/i);
  });
});
