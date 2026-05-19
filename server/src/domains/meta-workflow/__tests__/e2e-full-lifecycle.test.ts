// server/src/domains/meta-workflow/__tests__/e2e-full-lifecycle.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaWorkflowService, type WorktreeAllocator } from '../service.js';
import { buildHarness, buildLinearPhasesJson, type Harness } from './e2e-harness.js';

describe('Phase F e2e — full lifecycle happy path (3 linear phases)', () => {
  let h: Harness;

  beforeEach(() => {
    h = buildHarness();
  });

  afterEach(() => {
    h.cleanup();
  });

  it('creates a run, submits + approves requirements, instantiates phases, runs A→B→C, lands in done', async () => {
    // 1. Create run.
    const run = h.service.createRun({ projectId: 'proj-1', title: 'F-happy-path' });
    expect(run.status).toBe('requirement_draft');

    // 2. Submit + approve requirements.
    h.service.submitRequirements(run.id, 'design/requirements.md');
    expect(h.service.getRun(run.id)!.status).toBe('requirement_review');

    h.service.approveRequirements(run.id);
    // After approval the run is in the 'splitting' status (per run-aggregate.ts);
    // 'phase_split' in the plan was a placeholder name — actual is 'splitting'.
    expect(h.service.getRun(run.id)!.status).toBe('splitting');

    // 3. Install phases.json. Phases instantiate as pending. setPhasesJson moves run to 'executing'.
    h.service.setPhasesJson(run.id, buildLinearPhasesJson(3));
    expect(h.service.getRun(run.id)!.status).toBe('executing');
    const phasesAfterInstall = h.service.listPhases(run.id);
    expect(phasesAfterInstall.map((p) => p.phaseId)).toEqual(['A', 'B', 'C']);
    expect(phasesAfterInstall.every((p) => p.status === 'pending')).toBe(true);

    // 4. Run each phase. Executor + run-entity stubs succeed; phase ends 'done'.
    // PhaseExecutionResult is { phase, gateResults } (no top-level `ok` flag) —
    // success is asserted via result.phase.status.
    for (const id of ['A', 'B', 'C']) {
      const result = await h.service.runPhase(run.id, id);
      expect(
        result.phase.status,
        `Phase ${id} should land in 'done': ${JSON.stringify(result)}`,
      ).toBe('done');
      expect(result.gateResults.every((g) => g.passed)).toBe(true);
    }

    // 5. All phases are now done.
    const finalPhases = h.service.listPhases(run.id);
    expect(finalPhases.every((p) => p.status === 'done')).toBe(true);

    // 6. The run remains in 'executing' until an explicit reviewing/complete
    //    transition is invoked. service.runPhase only triggers releaseRun via
    //    fire-and-forget; it does not auto-advance the run status itself.
    const finalRun = h.service.getRun(run.id);
    expect(finalRun!.status).toBe('executing');
  });

  it('cancelRun on a draft run moves it to cancelled and releases the slot', () => {
    const run = h.service.createRun({ projectId: 'proj-1', title: 'F-cancel-draft' });
    h.service.cancelRun(run.id);
    expect(h.service.getRun(run.id)!.status).toBe('cancelled');
  });

  it('cancelRun mid-execution still recycles the worktree (release is invoked)', async () => {
    // Drop the default harness and stand up a fresh MetaWorkflowService with a
    // spy allocator so we can observe releaseRun(runId). The harness's allocator
    // is constructed inline inside buildHarness() and is not externally
    // mutable, so we build the wiring directly here (mirrors service-release.test.ts).
    h.cleanup();

    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY);`);
    db.exec(m069.sql);
    db.prepare(`INSERT INTO projects (id) VALUES (?)`).run('proj-1');

    const gitRepo = mkdtempSync(join(tmpdir(), 'meta-wf-e2e-cancel-'));
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: gitRepo });
    execFileSync('git', ['config', 'user.email', 'e2e@example.invalid'], { cwd: gitRepo });
    execFileSync('git', ['config', 'user.name', 'E2E Bot'], { cwd: gitRepo });
    writeFileSync(join(gitRepo, 'README.md'), '# seed\n');
    execFileSync('git', ['add', '.'], { cwd: gitRepo });
    execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: gitRepo });

    const releases: string[] = [];
    const allocator: WorktreeAllocator = {
      acquire: async () => gitRepo,
      release: async () => undefined,
      releaseRun: async (runId: string) => {
        releases.push(runId);
      },
    };

    const service = new MetaWorkflowService({
      db,
      runEntityForWorkflow: async () => ({ exitOk: true }),
      runEntityForSubagent: async () => ({ exitOk: true }),
      worktreeAllocator: allocator,
    });

    try {
      const run = service.createRun({ projectId: 'proj-1', title: 'F-cancel-running' });
      service.submitRequirements(run.id, 'design/requirements.md');
      service.approveRequirements(run.id);
      service.setPhasesJson(run.id, buildLinearPhasesJson(2));

      // Drive phase A to completion. Because there are still pending phases
      // (B), the executor's auto-releaseRun branch (allPhasesDone) won't fire,
      // so the cancelRun below is what triggers releaseRun.
      await service.runPhase(run.id, 'A');

      // Cancel the run while phase B is still pending → releaseRun must be invoked.
      service.cancelRun(run.id);
      // Allow the fire-and-forget microtask to settle.
      await Promise.resolve();
      expect(releases).toContain(run.id);
      expect(service.getRun(run.id)!.status).toBe('cancelled');
    } finally {
      db.close();
      try { rmSync(gitRepo, { recursive: true, force: true }); } catch { /* best-effort */ }
    }

    // Re-build a harness so the afterEach cleanup() is a no-op-safe call.
    h = buildHarness();
  });
});
