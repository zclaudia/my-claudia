// server/src/domains/meta-workflow/__tests__/e2e-stale-cascade.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildHarness, buildLinearPhasesJson, type Harness } from './e2e-harness.js';

async function runEachOf(h: Harness, runId: string, phaseIds: string[]): Promise<void> {
  for (const id of phaseIds) {
    await h.service.runPhase(runId, id);
  }
}

describe('Phase F e2e — stale propagation + cascade + impact', () => {
  let h: Harness;

  beforeEach(() => {
    // evaluateImpact queues: first call → 'minor-fix', second → 'rerun', then fallback.
    // Subagent/workflow runEntity in the harness short-circuits to {exitOk:true} without
    // calling startVirtualRun, so the queue only drains when evaluateImpact runs.
    h = buildHarness({
      aiResponses: [
        { fragments: ['{"kind":"minor-fix","reason":"only comment changed"}'], terminalKind: 'run_completed' },
        { fragments: ['{"kind":"rerun","reason":"behavior change"}'], terminalKind: 'run_completed' },
      ],
      fallbackResponse: { fragments: ['{"kind":"rerun","reason":"fallback default"}'], terminalKind: 'run_completed' },
    });
  });

  afterEach(() => {
    h.cleanup();
  });

  it('rerunPhase on A marks B stale (lazy propagation — direct downstream only)', async () => {
    const run = h.service.createRun({ projectId: 'proj-1', title: 'F-stale' });
    h.service.submitRequirements(run.id, 'design/requirements.md');
    h.service.approveRequirements(run.id);
    h.service.setPhasesJson(run.id, buildLinearPhasesJson(3));

    await runEachOf(h, run.id, ['A', 'B', 'C']);
    expect(h.service.listPhases(run.id).every((p) => p.status === 'done')).toBe(true);

    // Rerun A. Stale propagation is "lazy + soft" (see stale-propagator.ts):
    // only DIRECT downstream phases of A that are currently 'done' get marked stale.
    // C only depends on B (not A directly), so C remains 'done' — it will pick up
    // the fresh artifact whenever it's eventually re-run.
    await h.service.rerunPhase(run.id, 'A');
    const phases = h.service.listPhases(run.id);
    const byId = Object.fromEntries(phases.map((p) => [p.phaseId, p]));
    expect(byId.A.status).toBe('done');
    expect(byId.B.status).toBe('stale');
    expect(byId.C.status).toBe('done'); // lazy: not cascaded transitively
    expect(byId.B.staleSourcePhaseId).toBe('A');
  });

  it('cascadeRerun from B reruns B and C, both end in done', async () => {
    const run = h.service.createRun({ projectId: 'proj-1', title: 'F-cascade' });
    h.service.submitRequirements(run.id, 'design/requirements.md');
    h.service.approveRequirements(run.id);
    h.service.setPhasesJson(run.id, buildLinearPhasesJson(3));

    await runEachOf(h, run.id, ['A', 'B', 'C']);

    // cascadeRerun returns PhaseExecutionResult[] (Phase F Task 2 verified shape:
    // { phase, gateResults } per entry; no top-level `ok`). Success = phase.status === 'done'.
    const results = await h.service.cascadeRerun(run.id, 'B');
    expect(results.length).toBe(2); // B and C
    expect(results.every((r) => r.phase.status === 'done')).toBe(true);

    const phases = h.service.listPhases(run.id);
    const byId = Object.fromEntries(phases.map((p) => [p.phaseId, p]));
    expect(byId.A.status).toBe('done');
    expect(byId.B.status).toBe('done');
    expect(byId.C.status).toBe('done');
  });

  it('evaluateImpact returns a valid kind based on the canned AI response', async () => {
    const run = h.service.createRun({ projectId: 'proj-1', title: 'F-impact' });
    h.service.submitRequirements(run.id, 'design/requirements.md');
    h.service.approveRequirements(run.id);
    h.service.setPhasesJson(run.id, buildLinearPhasesJson(2));

    await runEachOf(h, run.id, ['A', 'B']);
    await h.service.rerunPhase(run.id, 'A'); // marks B stale, sets B.staleSourcePhaseId = 'A'

    // Phase A now has 2 artifact versions (initial + rerun). evaluateImpact
    // fetches them, sends them to the mock AI, and returns the canned response.
    const rec = await h.service.evaluateImpact(run.id, 'B');
    expect(['minor-fix', 'rerun', 'ignore']).toContain(rec.kind);
    expect(typeof rec.reason).toBe('string');
    expect(rec.reason.length).toBeGreaterThan(0);
  });
});
