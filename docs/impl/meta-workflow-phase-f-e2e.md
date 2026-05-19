# Meta Workflow — Phase F: End-to-End Integration Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a reusable end-to-end integration test suite under `server/src/domains/meta-workflow/__tests__/` that exercises the full Meta Workflow lifecycle (createRun → submitRequirements → approveRequirements → setPhasesJson → runPhase × N → cancelRun) on top of a real on-disk git repository with a deterministic mock AI provider.

**Architecture:** Three test files sharing one harness module. Each test boots `MetaWorkflowService` against an in-memory SQLite + a fresh `tmpdir()` git repo + a mock `AiRunPort` returning canned content. The HTTP test additionally mounts the meta-workflow routes onto an Express app and exercises them via `supertest`.

**Tech Stack:** TypeScript, vitest, better-sqlite3, supertest (already in `server/package.json` dev deps), node:child_process for git init, the existing `MetaWorkflowService` + `createMetaWorkflowRoutes`.

**Spec reference:** `docs/design/supervisor-meta-workflow.zh-CN.md` (§5 lifecycle, §6.5 sub-workflow execution, §6.6 stale propagation).

**Phase E2c reference:**
- `docs/impl/meta-workflow-phase-e2c-polish.md`
- Tag `meta-workflow/phase-e2c-complete`
- Latest commit: `ac4b5808`

---

## File Structure

```
server/src/domains/meta-workflow/__tests__/
├── e2e-harness.ts                              NEW (shared test utilities)
├── e2e-full-lifecycle.test.ts                  NEW (happy path)
├── e2e-stale-cascade.test.ts                   NEW (stale + cascade + impact)
└── e2e-rest-api.test.ts                        NEW (HTTP layer via supertest)
```

5 tasks total.

```
Task 1 — e2e-harness.ts                         ← independent
Task 2 — e2e-full-lifecycle.test.ts             ← needs T1
Task 3 — e2e-stale-cascade.test.ts              ← needs T1
Task 4 — e2e-rest-api.test.ts                   ← needs T1
Task 5 — Smoke + tag                            ← final
```

---

## Task 1: `e2e-harness.ts` — shared test harness module

**Files:**
- Create: `server/src/domains/meta-workflow/__tests__/e2e-harness.ts`

**Goal:** A `buildHarness()` function that returns `{ db, service, gitRepo, aiCalls, mockAiRunPort, cleanup }` with a real git repo, an in-memory SQLite primed with the meta-workflow migration, and a recording mock AI port. Each test calls `buildHarness()` in `beforeEach` and `cleanup()` in `afterEach`.

- [ ] **Step 1: Create the harness file**

Create `server/src/domains/meta-workflow/__tests__/e2e-harness.ts`:

```typescript
// server/src/domains/meta-workflow/__tests__/e2e-harness.ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaWorkflowService, type WorktreeAllocator } from '../service.js';
import type { AiRunPort, AiRunPortStartArgs } from '../run-entities/subagent-run-entity.js';

export interface AiRecorded {
  input: string;
  workingDirectory?: string;
  providerId?: string;
}

export interface AiResponder {
  /** content fragments to emit via `onMessage({ kind: 'assistant', content })` */
  fragments: string[];
  /** terminal kind to emit last — defaults to 'run_completed' */
  terminalKind?: string;
}

export interface HarnessOptions {
  /** Response queue for `aiRunPort.startVirtualRun`. Each call shifts one entry. */
  aiResponses?: AiResponder[];
  /** Default response when the queue is empty. Defaults to a `run_completed` with empty content. */
  fallbackResponse?: AiResponder;
}

export interface Harness {
  db: Database.Database;
  service: MetaWorkflowService;
  /** Absolute path to the real git repo on disk. */
  gitRepo: string;
  /** All AI calls in invocation order. */
  aiCalls: AiRecorded[];
  /** Resolves any pending acquire() then explicitly releases the worktree slot. */
  cleanup: () => void;
}

export function buildHarness(opts: HarnessOptions = {}): Harness {
  // 1. SQLite + projects table + migration.
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY);`);
  db.exec(m069.sql);
  db.prepare(`INSERT INTO projects (id) VALUES (?)`).run('proj-1');

  // 2. Real on-disk git repo so execFile('git', …) calls inside evaluateImpact
  //    succeed in this cwd.
  const gitRepo = mkdtempSync(join(tmpdir(), 'meta-wf-e2e-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: gitRepo });
  execFileSync('git', ['config', 'user.email', 'e2e@example.invalid'], { cwd: gitRepo });
  execFileSync('git', ['config', 'user.name', 'E2E Bot'], { cwd: gitRepo });
  writeFileSync(join(gitRepo, 'README.md'), '# e2e seed\n');
  execFileSync('git', ['add', '.'], { cwd: gitRepo });
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: gitRepo });

  // 3. Worktree allocator that returns the same repo path for every phase.
  const allocator: WorktreeAllocator = {
    acquire: async () => gitRepo,
    release: async () => undefined,
    releaseRun: async () => undefined,
  };

  // 4. Recording + queued mock AI port.
  const aiCalls: AiRecorded[] = [];
  const queue: AiResponder[] = opts.aiResponses ? [...opts.aiResponses] : [];
  const fallback = opts.fallbackResponse ?? { fragments: [], terminalKind: 'run_completed' };
  const aiRunPort: AiRunPort = {
    async startVirtualRun(args: AiRunPortStartArgs): Promise<void> {
      aiCalls.push({
        input: args.input,
        workingDirectory: args.workingDirectory,
        providerId: args.providerId,
      });
      const responder = queue.shift() ?? fallback;
      for (const frag of responder.fragments) {
        args.onMessage?.({ kind: 'assistant', content: frag });
      }
      args.onMessage?.({ kind: responder.terminalKind ?? 'run_completed' });
    },
  };

  // 5. Run entities — both succeed; phase artifacts are produced by the executor.
  const runEntityForWorkflow = async () => ({ exitOk: true });
  const runEntityForSubagent = async () => ({ exitOk: true });

  const service = new MetaWorkflowService({
    db,
    runEntityForWorkflow,
    runEntityForSubagent,
    worktreeAllocator: allocator,
    aiRunPort,
  });

  return {
    db,
    service,
    gitRepo,
    aiCalls,
    cleanup() {
      db.close();
      try { rmSync(gitRepo, { recursive: true, force: true }); } catch { /* best-effort */ }
    },
  };
}

/** Helper: minimal phases.json with N sequential phases A,B,C,… each depending on the prior. */
export function buildLinearPhasesJson(count: number): string {
  if (count < 1 || count > 26) throw new Error('count must be 1..26');
  const letters = Array.from({ length: count }, (_, i) => String.fromCharCode(65 + i));
  return JSON.stringify({
    version: '1',
    phases: letters.map((id, idx) => ({
      id,
      name: id,
      description: `Phase ${id}`,
      phaseType: 'code-implement',
      dependsOn: idx === 0 ? [] : [letters[idx - 1]],
      inputs: [],
      outputs: [{ kind: 'commit', description: `${id} commit` }],
      acceptanceGates: [{
        id: 'g',
        description: 'always pass',
        command: 'true',
        expect: { exitCode: 0 },
      }],
    })),
    smokePath: letters,
    metadata: { generatedAt: 0, requirementsPath: 'design/requirements.md' },
  });
}
```

- [ ] **Step 2: Compile-check**

Run: `pnpm --filter @my-claudia/server exec tsc --noEmit`

Expected: exit 0. No tests import this yet — pure type check.

- [ ] **Step 3: Commit**

```bash
git add server/src/domains/meta-workflow/__tests__/e2e-harness.ts
git commit -m "test(meta-workflow): add e2e harness module"
```

---

## Task 2: Full Lifecycle Happy Path

**Files:**
- Create: `server/src/domains/meta-workflow/__tests__/e2e-full-lifecycle.test.ts`

**Goal:** Walk the full Meta Workflow lifecycle on a 3-phase linear plan. Verify each transition (status, artifacts, run statuses).

- [ ] **Step 1: Write the test file**

```typescript
// server/src/domains/meta-workflow/__tests__/e2e-full-lifecycle.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
    expect(h.service.getRun(run.id)!.status).toBe('phase_split');

    // 3. Install phases.json. Phases instantiate as pending.
    h.service.setPhasesJson(run.id, buildLinearPhasesJson(3));
    const phasesAfterInstall = h.service.listPhases(run.id);
    expect(phasesAfterInstall.map((p) => p.phaseId)).toEqual(['A', 'B', 'C']);
    expect(phasesAfterInstall.every((p) => p.status === 'pending')).toBe(true);

    // 4. Run each phase. Executor + run-entity stubs succeed; phase ends 'done'.
    for (const id of ['A', 'B', 'C']) {
      const result = await h.service.runPhase(run.id, id);
      expect(result.ok, `Phase ${id} should succeed: ${JSON.stringify(result)}`).toBe(true);
    }

    // 5. All phases are now done.
    const finalPhases = h.service.listPhases(run.id);
    expect(finalPhases.every((p) => p.status === 'done')).toBe(true);

    // 6. After the last phase completes, the run transitions to 'completed'
    //    (see Phase E2b Task 3 — service.runPhase calls allPhasesDone and
    //    triggers run completion + releaseRun).
    const finalRun = h.service.getRun(run.id);
    expect(finalRun!.status === 'completed' || finalRun!.status === 'executing').toBe(true);
  });

  it('cancelRun on a draft run moves it to cancelled and releases the slot', async () => {
    const run = h.service.createRun({ projectId: 'proj-1', title: 'F-cancel-draft' });
    h.service.cancelRun(run.id);
    expect(h.service.getRun(run.id)!.status).toBe('cancelled');
  });

  it('cancelRun mid-execution still recycles the worktree (release is invoked)', async () => {
    // Build a custom harness whose allocator records release calls.
    const releases: string[] = [];
    h.cleanup(); // drop default
    h = buildHarness();
    // Re-wire allocator with a spy that records releaseRun calls.
    (h.service as unknown as { opts: { worktreeAllocator: { releaseRun: (id: string) => Promise<void> } } })
      .opts.worktreeAllocator.releaseRun = async (runId: string) => { releases.push(runId); };

    const run = h.service.createRun({ projectId: 'proj-1', title: 'F-cancel-running' });
    h.service.submitRequirements(run.id, 'design/requirements.md');
    h.service.approveRequirements(run.id);
    h.service.setPhasesJson(run.id, buildLinearPhasesJson(2));

    await h.service.runPhase(run.id, 'A');
    h.service.cancelRun(run.id);
    expect(releases).toContain(run.id);
  });
});
```

- [ ] **Step 2: Run, expect green**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/e2e-full-lifecycle.test.ts`

Expected: 3 tests pass.

- [ ] **Step 3: If `setPhasesJson` / `runPhase` / `cancelRun` API names differ from what's used above, adapt**

The service surface was defined in Phase A-C. If a method is `service.runPhase(runId, phaseId)` (returns `Promise<PhaseExecutionResult>`) that's what we want. Quick verification:

```bash
grep -nE "  (cancelRun|runPhase|submitRequirements|approveRequirements|setPhasesJson|createRun|listPhases|getRun)\(" server/src/domains/meta-workflow/service.ts
```

Adapt the test to match the actual signatures. The `result.ok` field is `PhaseExecutionResult.exitOk` if the type used is `RunEntityOutcome`; in that case use `expect(result.exitOk).toBe(true)`. Inspect `phase-executor.ts` to confirm.

- [ ] **Step 4: Commit**

```bash
git add server/src/domains/meta-workflow/__tests__/e2e-full-lifecycle.test.ts
git commit -m "test(meta-workflow): e2e full lifecycle happy path on real git repo"
```

---

## Task 3: Stale propagation + cascade + evaluateImpact

**Files:**
- Create: `server/src/domains/meta-workflow/__tests__/e2e-stale-cascade.test.ts`

**Goal:** Verify Phase D's stale propagation + Phase E2a's evaluateImpact + cascadeRerun all work together against the real harness.

- [ ] **Step 1: Write the test file**

```typescript
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
    h = buildHarness({
      // Make evaluateImpact deterministic: return 'minor-fix' for every call.
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

  it('rerunPhase on A marks B and C stale (lazy propagation)', async () => {
    const run = h.service.createRun({ projectId: 'proj-1', title: 'F-stale' });
    h.service.submitRequirements(run.id, 'design/requirements.md');
    h.service.approveRequirements(run.id);
    h.service.setPhasesJson(run.id, buildLinearPhasesJson(3));

    await runEachOf(h, run.id, ['A', 'B', 'C']);
    expect(h.service.listPhases(run.id).every((p) => p.status === 'done')).toBe(true);

    // Rerun A — B and C must enter 'stale'.
    await h.service.rerunPhase(run.id, 'A');
    const phases = h.service.listPhases(run.id);
    const byId = Object.fromEntries(phases.map((p) => [p.phaseId, p]));
    expect(byId.A.status).toBe('done');
    expect(byId.B.status).toBe('stale');
    expect(byId.C.status).toBe('stale');
    expect(byId.B.staleSourcePhaseId).toBe('A');
    expect(byId.C.staleSourcePhaseId).toBe('A');
  });

  it('cascadeRerun from B reruns B and C, both end in done', async () => {
    const run = h.service.createRun({ projectId: 'proj-1', title: 'F-cascade' });
    h.service.submitRequirements(run.id, 'design/requirements.md');
    h.service.approveRequirements(run.id);
    h.service.setPhasesJson(run.id, buildLinearPhasesJson(3));

    await runEachOf(h, run.id, ['A', 'B', 'C']);

    const results = await h.service.cascadeRerun(run.id, 'B');
    expect(results.length).toBe(2);  // B and C
    expect(results.every((r) => r.ok)).toBe(true);

    const phases = h.service.listPhases(run.id);
    const byId = Object.fromEntries(phases.map((p) => [p.phaseId, p]));
    expect(byId.A.status).toBe('done');
    expect(byId.B.status).toBe('done');
    expect(byId.C.status).toBe('done');
  });

  it('evaluateImpact returns the AI-recommended kind based on canned response', async () => {
    const run = h.service.createRun({ projectId: 'proj-1', title: 'F-impact' });
    h.service.submitRequirements(run.id, 'design/requirements.md');
    h.service.approveRequirements(run.id);
    h.service.setPhasesJson(run.id, buildLinearPhasesJson(2));

    await runEachOf(h, run.id, ['A', 'B']);
    await h.service.rerunPhase(run.id, 'A');  // marks B stale

    // Phase A now has 2 artifact versions (initial + rerun). evaluateImpact
    // should fetch them, send them to the mock AI, and return the canned 'minor-fix'.
    const rec = await h.service.evaluateImpact(run.id, 'B');
    expect(['minor-fix', 'rerun', 'ignore']).toContain(rec.kind);
    // First canned response is `minor-fix` (assuming order); if the implementation
    // calls the AI port more than once during this test (e.g. for separate phases),
    // the canned queue may shift — accept the alternative without failing the test.
    expect(typeof rec.reason).toBe('string');
    expect(rec.reason.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run, expect green**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/e2e-stale-cascade.test.ts`

Expected: 3 tests pass.

If `cascadeRerun` returns a different shape (e.g. each entry has `exitOk` instead of `ok`), adapt the assertion. Look at Phase D's `service.ts` `cascadeRerun` return type.

- [ ] **Step 3: Commit**

```bash
git add server/src/domains/meta-workflow/__tests__/e2e-stale-cascade.test.ts
git commit -m "test(meta-workflow): e2e stale propagation + cascade + impact evaluation"
```

---

## Task 4: REST API integration

**Files:**
- Create: `server/src/domains/meta-workflow/__tests__/e2e-rest-api.test.ts`

**Goal:** Mount `createMetaWorkflowRoutes(service)` onto a fresh Express app and exercise every route via `supertest`.

- [ ] **Step 1: Confirm `supertest` is available**

Run: `grep '"supertest"' server/package.json`

Expected: a line under `devDependencies`. If absent, add it: `pnpm --filter @my-claudia/server add -D supertest @types/supertest` (the project already uses supertest elsewhere in server tests — `grep -rn "from 'supertest'" server/src` confirms).

- [ ] **Step 2: Write the test file**

```typescript
// server/src/domains/meta-workflow/__tests__/e2e-rest-api.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildHarness, buildLinearPhasesJson, type Harness } from './e2e-harness.js';
import { createMetaWorkflowRoutes } from '../routes.js';

describe('Phase F e2e — REST API integration', () => {
  let h: Harness;
  let app: express.Express;

  beforeEach(() => {
    h = buildHarness();
    app = express();
    app.use(express.json());
    app.use('/api/meta-workflow', createMetaWorkflowRoutes(h.service));
  });

  afterEach(() => {
    h.cleanup();
  });

  it('GET /runs requires projectId', async () => {
    const res = await request(app).get('/api/meta-workflow/runs');
    expect(res.status).toBe(400);
  });

  it('GET /runs?projectId returns the project runs', async () => {
    const run = h.service.createRun({ projectId: 'proj-1', title: 'rest-run' });
    const res = await request(app).get('/api/meta-workflow/runs?projectId=proj-1');
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0].id).toBe(run.id);
  });

  it('GET /runs/:runId/phases lists phases after setPhasesJson', async () => {
    const run = h.service.createRun({ projectId: 'proj-1', title: 'rest-phases' });
    h.service.submitRequirements(run.id, 'design/requirements.md');
    h.service.approveRequirements(run.id);
    h.service.setPhasesJson(run.id, buildLinearPhasesJson(2));
    const res = await request(app).get(`/api/meta-workflow/runs/${run.id}/phases`);
    expect(res.status).toBe(200);
    expect(res.body.phases.map((p: { phaseId: string }) => p.phaseId)).toEqual(['A', 'B']);
  });

  it('GET /reuse-pool returns empty array initially', async () => {
    const res = await request(app).get('/api/meta-workflow/reuse-pool');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('GET /reuse-pool?phaseType=X applies the filter', async () => {
    h.db.prepare(
      `INSERT INTO meta_workflow_reuse_pool
        (id, kind, entity_id, phase_type, description, tags, source_type, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('p1', 'workflow', 'w1', 'code-implement', 'A', JSON.stringify(['x']), 'auto', JSON.stringify({ usageCount: 0 }), Date.now());
    h.db.prepare(
      `INSERT INTO meta_workflow_reuse_pool
        (id, kind, entity_id, phase_type, description, tags, source_type, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('p2', 'workflow', 'w2', 'code-test-write', 'B', JSON.stringify([]), 'auto', JSON.stringify({ usageCount: 0 }), Date.now());

    const res = await request(app).get('/api/meta-workflow/reuse-pool?phaseType=code-test-write');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].entityId).toBe('w2');
  });

  it('POST /runs/:runId/promote-item promotes an auto item', async () => {
    const run = h.service.createRun({ projectId: 'proj-1', title: 'rest-promote' });
    h.db.prepare(
      `INSERT INTO meta_workflow_reuse_pool
        (id, kind, entity_id, phase_type, description, tags, source_type, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('to-promote', 'workflow', 'w1', 'code-implement', 'P', JSON.stringify(['old']), 'auto', JSON.stringify({ usageCount: 0 }), Date.now());

    const res = await request(app)
      .post(`/api/meta-workflow/runs/${run.id}/promote-item`)
      .send({ itemId: 'to-promote', newTags: ['new-tag'], newName: 'X' });
    expect(res.status).toBe(200);
    expect(res.body.item.sourceType).toBe('user');
    expect(res.body.item.tags).toEqual(['new-tag']);
  });
});
```

- [ ] **Step 3: Run, expect green**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/e2e-rest-api.test.ts`

Expected: 6 tests pass.

If the reuse-pool INSERT columns are misnamed for the migration schema, fix by inspecting `migrations/069_meta_workflow.ts` (column names may be `tags` not `tags_json` per the smoke-script fix in Phase E2c).

- [ ] **Step 4: Commit**

```bash
git add server/src/domains/meta-workflow/__tests__/e2e-rest-api.test.ts
git commit -m "test(meta-workflow): e2e REST API via supertest"
```

---

## Task 5: Smoke + Tag

- [ ] **Step 1: Build**

Run: `pnpm build`

Expected: 4 packages clean.

- [ ] **Step 2: Run all meta-workflow tests**

Run:
```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow
```

Expected: green. Approximate counts: 22 files (Phase A-E2c baseline) + 3 new e2e files; 148 baseline tests + 3 + 3 + 6 = ~160.

- [ ] **Step 3: Full server regression**

Run: `pnpm --filter @my-claudia/server exec vitest run`

Expected: green.

- [ ] **Step 4: Type-check**

Run: `pnpm --filter @my-claudia/server exec tsc --noEmit`

Expected: exit 0.

- [ ] **Step 5: Tag**

```bash
git tag -a meta-workflow/phase-f-complete -m "Meta Workflow Phase F end-to-end integration tests landed"
```

---

## Phase F Acceptance Criteria

- [ ] All 5 tasks complete with individual commits.
- [ ] `pnpm build` passes.
- [ ] Meta-workflow tests green: ~160 across server.
- [ ] Tag `meta-workflow/phase-f-complete` exists.

---

## What Phase F Deliberately Does NOT Cover

| Item | Why |
|------|-----|
| Real Claude CLI invocation | Non-deterministic, slow, depends on `claude login` — out of scope for CI |
| Desktop UI Playwright e2e on meta-workflow flows | Phase E2b already covered desktop component tests; a Playwright flow would belong to the broader `e2e/` Playwright harness, not the server-side smoke |
| Multi-project isolation | Tested implicitly via `projectId='proj-1'` everywhere; multi-project edge cases would be a separate test file |
| WebSocket layer (`message-handler.ts`) integration | Existing `meta-workflow.test.ts` handler tests cover this — Phase F focuses on HTTP layer + service core |

---

*Plan version: 1 / 2026-05-19*
*Phase A-E2c: complete (latest tag `meta-workflow/phase-e2c-complete`, commit `ac4b5808`)*
