# Meta Workflow — Phase E2b: Hardening & Desktop Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 4 Phase E2a follow-ups (real git diff in `evaluateImpact`, real worktree release on run terminal, `EventDispatcher.off()` API, NewRunDropdown auto-select) and add vitest coverage for the 5 Phase E1 desktop screens that currently have zero unit tests.

**Architecture:** Each item is local; no new architectural concepts.
- `EventDispatcher.off()` / `.offAny()` mirror the existing `.on()` / `.onAny()` shape — straight addition.
- `WorktreeAllocator` interface grows a `releaseRun(runId)` method; the supervisor-backed implementation looks up the cached path, releases it back into the pool, and clears its `pathByRun` entry. `MetaWorkflowService.cancelRun` and a new internal `onRunCompleted` path both invoke it.
- `evaluateImpact` now acquires the persistent run worktree via `worktreeAllocator.acquire({ runId, phaseId, attempt:1 })` (which, after E2a, returns the cached run slot), runs `execFile('git', ['log', '--oneline', `${prev}..${cur}`], { cwd })` and `execFile('git', ['diff', '--stat', `${prev}..${cur}`], { cwd })`, then concatenates the output (truncated) into the AI prompt.
- `NewRunDropdown` flips a `pendingSelectForProject: Set<projectId>` flag in the store; `upsertRun` auto-promotes the next-arriving run for a flagged project into `selectedRunId` and clears the flag.
- Screen tests follow Vitest + React Testing Library + `vi.mock` for `../api`/`../store` (the pattern already used in `SupervisorWorkspacePanel.test.tsx`).

**Tech Stack:** TypeScript, vitest, `@testing-library/react`, `child_process.execFile`, `util.promisify`.

**Spec reference:** `docs/design/supervisor-meta-workflow.zh-CN.md` (§6.5 / §6.6 — the parts E2a left as MVP shortcuts).

**Phase E2a references:**
- `docs/impl/meta-workflow-phase-e2a-critical-backend.md`
- Tag `meta-workflow/phase-e2a-complete`
- Latest commit: `1fd4f39e`

---

## File Structure

```
server/src/domains/supervision/
└── event-dispatcher.ts                                            MODIFY (+ off / offAny)
server/src/domains/supervision/__tests__/
└── event-dispatcher.test.ts                                       NEW (or extend if exists)

server/src/domains/meta-workflow/
├── service.ts                                                     MODIFY (releaseRun wiring, real git diff)
├── repositories/                                                  (read-only)
server/src/domains/meta-workflow/__tests__/
├── service.test.ts                                                MODIFY (real-diff path test)
└── service-release.test.ts                                        NEW (release on terminal state)

server/src/application/bootstrap/
└── meta-workflow-allocator.ts                                     MODIFY (+ releaseRun)
server/src/application/bootstrap/__tests__/
└── meta-workflow-allocator.test.ts                                MODIFY (+ releaseRun tests)

apps/desktop/src/features/meta-workflow/
├── store.ts                                                       MODIFY (+ markPendingSelect, upsertRun auto-select)
├── components/NewRunDropdown.tsx                                  MODIFY (calls markPendingSelect)
├── screens/
│   ├── RequirementsScreen.tsx                                     (read)
│   ├── PhaseGraphScreen.tsx                                       (read)
│   ├── PhaseBoardScreen.tsx                                       (read)
│   ├── PhaseDetailScreen.tsx                                      (read)
│   └── PromotionDialog.tsx                                        (read)
└── __tests__/                                                     NEW dir
    ├── NewRunDropdown.test.tsx                                    NEW
    ├── PromotionDialog.test.tsx                                   NEW
    ├── RequirementsScreen.test.tsx                                NEW
    ├── PhaseDetailScreen.test.tsx                                 NEW
    ├── PhaseGraphScreen.test.tsx                                  NEW
    └── PhaseBoardScreen.test.tsx                                  NEW
```

9 tasks total.

```
Task 1 — EventDispatcher.off() / .offAny()                     ← independent
Task 2 — WorktreeAllocator.releaseRun(runId)                   ← independent
Task 3 — Wire releaseRun into MetaWorkflowService terminals    ← needs T2
Task 4 — Real git diff retrieval in evaluateImpact             ← independent (uses existing allocator)
Task 5 — NewRunDropdown auto-selects newly created run         ← independent
Task 6 — Vitest: NewRunDropdown + PromotionDialog              ← needs T5 (for upsertRun behavior)
Task 7 — Vitest: RequirementsScreen + PhaseDetailScreen        ← independent
Task 8 — Vitest: PhaseGraphScreen + PhaseBoardScreen           ← independent
Task 9 — Smoke + tag                                           ← final
```

---

## Task 1: `EventDispatcher.off()` / `.offAny()`

**Files:**
- Modify: `server/src/domains/supervision/event-dispatcher.ts`
- Create: `server/src/domains/supervision/__tests__/event-dispatcher.test.ts` (if not present; otherwise extend)

Current dispatcher has `on / onAny / dispatch / dispatchAll` only. Adding the symmetric removers is straight-forward: remove from the `handlers` map or the `wildcardHandlers` list by identity, then prune empty entries.

- [ ] **Step 1: Check if a test file already exists**

Run: `ls server/src/domains/supervision/__tests__/event-dispatcher.test.ts 2>/dev/null && echo EXISTS || echo MISSING`

If MISSING, create with full content in Step 2. If EXISTS, append the `off` / `offAny` tests in Step 2 to the existing file inside its existing `describe` block.

- [ ] **Step 2: Write the failing tests**

Add this content (full file if creating, or just the new `describe` block if extending):

```typescript
// server/src/domains/supervision/__tests__/event-dispatcher.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventDispatcher } from '../event-dispatcher.js';

interface Evt { type: string; payload?: unknown }

describe('EventDispatcher off / offAny', () => {
  it('off() removes a specific listener', () => {
    const d = new EventDispatcher<Evt>();
    const h1 = vi.fn();
    const h2 = vi.fn();
    d.on('foo', h1);
    d.on('foo', h2);
    d.off('foo', h1);
    d.dispatch({ type: 'foo' });
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('off() is idempotent for unknown handlers', () => {
    const d = new EventDispatcher<Evt>();
    const h = vi.fn();
    // Removing without prior on() must not throw.
    expect(() => d.off('foo', h)).not.toThrow();
  });

  it('off() prunes empty event lists', () => {
    const d = new EventDispatcher<Evt>();
    const h = vi.fn();
    d.on('foo', h);
    d.off('foo', h);
    d.dispatch({ type: 'foo' });
    expect(h).not.toHaveBeenCalled();
  });

  it('offAny() removes a wildcard listener', () => {
    const d = new EventDispatcher<Evt>();
    const w1 = vi.fn();
    const w2 = vi.fn();
    d.onAny(w1);
    d.onAny(w2);
    d.offAny(w1);
    d.dispatch({ type: 'foo' });
    expect(w1).not.toHaveBeenCalled();
    expect(w2).toHaveBeenCalledOnce();
  });

  it('offAny() is idempotent for unknown handlers', () => {
    const d = new EventDispatcher<Evt>();
    const w = vi.fn();
    expect(() => d.offAny(w)).not.toThrow();
  });
});
```

- [ ] **Step 3: Run, see failure**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/supervision/__tests__/event-dispatcher.test.ts`

Expected: 5 new tests fail with `dispatcher.off is not a function` / `dispatcher.offAny is not a function`.

- [ ] **Step 4: Implement `off` / `offAny`**

Replace the body of `server/src/domains/supervision/event-dispatcher.ts` with:

```typescript
export type EventHandler<E> = (event: E) => void;

export class EventDispatcher<E extends { type: string }> {
  private handlers = new Map<string, EventHandler<E>[]>();
  private wildcardHandlers: EventHandler<E>[] = [];

  on(eventType: string, handler: EventHandler<E>): void {
    const list = this.handlers.get(eventType) ?? [];
    list.push(handler);
    this.handlers.set(eventType, list);
  }

  onAny(handler: EventHandler<E>): void {
    this.wildcardHandlers.push(handler);
  }

  off(eventType: string, handler: EventHandler<E>): void {
    const list = this.handlers.get(eventType);
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx === -1) return;
    list.splice(idx, 1);
    if (list.length === 0) this.handlers.delete(eventType);
  }

  offAny(handler: EventHandler<E>): void {
    const idx = this.wildcardHandlers.indexOf(handler);
    if (idx === -1) return;
    this.wildcardHandlers.splice(idx, 1);
  }

  dispatch(event: E): void {
    const specific = this.handlers.get(event.type);
    if (specific) {
      for (const h of specific) {
        try { h(event); } catch (err) {
          console.error(`[EventDispatcher] Handler error for ${event.type}:`, err);
        }
      }
    }
    for (const h of this.wildcardHandlers) {
      try { h(event); } catch (err) {
        console.error(`[EventDispatcher] Wildcard handler error for ${event.type}:`, err);
      }
    }
  }

  dispatchAll(events: E[]): void {
    for (const event of events) {
      this.dispatch(event);
    }
  }
}
```

- [ ] **Step 5: Run, see green**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/supervision/__tests__/event-dispatcher.test.ts`

Expected: all green.

- [ ] **Step 6: Type-check**

Run: `pnpm --filter @my-claudia/server exec tsc --noEmit`

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add server/src/domains/supervision/event-dispatcher.ts \
        server/src/domains/supervision/__tests__/event-dispatcher.test.ts
git commit -m "feat(supervision): EventDispatcher off / offAny remove listeners"
```

---

## Task 2: `WorktreeAllocator.releaseRun(runId)`

**Files:**
- Modify: `server/src/domains/meta-workflow/service.ts` (extend the `WorktreeAllocator` interface)
- Modify: `server/src/application/bootstrap/meta-workflow-allocator.ts` (implement `releaseRun`)
- Modify: `server/src/application/bootstrap/__tests__/meta-workflow-allocator.test.ts` (add tests)

Today `release(path)` is a no-op (E2a left it that way). For Task 3 the service needs a way to say "this run is done — recycle its slot." Add `releaseRun(runId): Promise<void>` to the interface and implement it by:
1. Looking up the cached `Promise<string>` in `pathByRun`
2. Awaiting it (in case acquire is still in flight)
3. Calling the underlying `pool.release(path)`
4. Deleting the cache entry

Keep `release(_path)` as a no-op for backwards compatibility — Phase D callers still pass through it.

- [ ] **Step 1: Add failing tests**

Append to `server/src/application/bootstrap/__tests__/meta-workflow-allocator.test.ts`:

```typescript
  it('releaseRun returns the cached path to the pool and clears the entry', async () => {
    const releaseMock = vi.fn();
    const supervisorService = {
      getWorktreePoolIfExists: vi.fn().mockReturnValue({
        acquire: vi.fn().mockResolvedValue('/tmp/slot-x'),
        release: releaseMock,
      }),
    };
    const allocator = createWorktreeAllocatorFromSupervisor(supervisorService as never, 'proj-1');
    await allocator.acquire({ runId: 'run-A', phaseId: 'p1', attempt: 1 });
    await allocator.releaseRun('run-A');
    expect(releaseMock).toHaveBeenCalledWith('/tmp/slot-x');

    // Subsequent acquire for same runId triggers a fresh underlying acquire.
    await allocator.acquire({ runId: 'run-A', phaseId: 'p2', attempt: 1 });
    const pool = supervisorService.getWorktreePoolIfExists.mock.results.at(-1)!.value as { acquire: ReturnType<typeof vi.fn> };
    expect(pool.acquire).toHaveBeenCalledTimes(2);
  });

  it('releaseRun is a no-op for an unknown runId', async () => {
    const releaseMock = vi.fn();
    const supervisorService = {
      getWorktreePoolIfExists: vi.fn().mockReturnValue({
        acquire: vi.fn().mockResolvedValue('/tmp/slot'),
        release: releaseMock,
      }),
    };
    const allocator = createWorktreeAllocatorFromSupervisor(supervisorService as never, 'proj-1');
    await expect(allocator.releaseRun('never-acquired')).resolves.toBeUndefined();
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it('releaseRun awaits an in-flight acquire before releasing', async () => {
    let resolveAcquire: (p: string) => void;
    const acquirePromise = new Promise<string>((res) => { resolveAcquire = res; });
    const releaseMock = vi.fn();
    const supervisorService = {
      getWorktreePoolIfExists: vi.fn().mockReturnValue({
        acquire: vi.fn().mockReturnValue(acquirePromise),
        release: releaseMock,
      }),
    };
    const allocator = createWorktreeAllocatorFromSupervisor(supervisorService as never, 'proj-1');
    const acquired = allocator.acquire({ runId: 'run-A', phaseId: 'p1', attempt: 1 });
    const released = allocator.releaseRun('run-A');
    resolveAcquire!('/tmp/slot-y');
    await acquired;
    await released;
    expect(releaseMock).toHaveBeenCalledWith('/tmp/slot-y');
  });
```

- [ ] **Step 2: Run, see failures**

Run: `pnpm --filter @my-claudia/server exec vitest run src/application/bootstrap/__tests__/meta-workflow-allocator.test.ts`

Expected: 3 new tests fail (`allocator.releaseRun is not a function`).

- [ ] **Step 3: Extend the `WorktreeAllocator` interface**

In `server/src/domains/meta-workflow/service.ts`, find:

```typescript
export interface WorktreeAllocator {
  acquire(meta: { runId: string; phaseId: string; attempt: number }): Promise<string>;
  release(path: string): Promise<void>;
}
```

Replace with:

```typescript
export interface WorktreeAllocator {
  acquire(meta: { runId: string; phaseId: string; attempt: number }): Promise<string>;
  /** @deprecated kept for backwards-compat; Phase D callsites still invoke it. Use `releaseRun` instead. */
  release(path: string): Promise<void>;
  /** Release the worktree slot held for a run (idempotent). */
  releaseRun(runId: string): Promise<void>;
}
```

- [ ] **Step 4: Implement `releaseRun` in the allocator**

In `server/src/application/bootstrap/meta-workflow-allocator.ts`, find the returned object (after E2a Task 4 it has `acquire` + `release`). Add `releaseRun`:

```typescript
return {
  async acquire({ runId, attempt }) {
    /* (unchanged from E2a Task 4 — keep existing body) */
  },
  async release(_path) {
    // Phase E2b: deprecated path. Use `releaseRun` for actual recycling.
  },
  async releaseRun(runId) {
    const cached = pathByRun.get(runId);
    if (!cached) return;
    try {
      const path = await cached;
      const pool = supervisorService.getWorktreePoolIfExists(projectId);
      if (pool) pool.release(path);
    } finally {
      pathByRun.delete(runId);
    }
  },
};
```

- [ ] **Step 5: Run tests; verify green**

Run: `pnpm --filter @my-claudia/server exec vitest run src/application/bootstrap/__tests__/meta-workflow-allocator.test.ts`

Expected: 6/6 (3 existing + 3 new).

- [ ] **Step 6: Update existing `fakeAllocator` stubs in meta-workflow tests**

Search for any test fake that implements `WorktreeAllocator` and is missing `releaseRun`:

Run: `grep -rn "acquire:" server/src/domains/meta-workflow/__tests__/ | head`

Look at `service.test.ts` near line 51 / 177 / 212 (the `fakeAllocator` from Phase E2a Task 2). Add `releaseRun: vi.fn().mockResolvedValue(undefined)` to each fake. Typical change:

```typescript
const fakeAllocator: WorktreeAllocator = {
  acquire: vi.fn(...),
  release: vi.fn(...),
  releaseRun: vi.fn().mockResolvedValue(undefined),
};
```

- [ ] **Step 7: Full meta-workflow regression**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow src/application/bootstrap/__tests__/meta-workflow-allocator.test.ts`

Expected: all green.

- [ ] **Step 8: Type-check**

Run: `pnpm --filter @my-claudia/server exec tsc --noEmit`

Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add server/src/domains/meta-workflow/service.ts \
        server/src/application/bootstrap/meta-workflow-allocator.ts \
        server/src/application/bootstrap/__tests__/meta-workflow-allocator.test.ts \
        server/src/domains/meta-workflow/__tests__/service.test.ts
git commit -m "feat(meta-workflow): WorktreeAllocator.releaseRun recycles run slot"
```

---

## Task 3: Wire `releaseRun` into terminal state transitions

**Files:**
- Modify: `server/src/domains/meta-workflow/service.ts` (`cancelRun` calls `releaseRun`; add `completeRun` if it isn't already wired through `phase-executor`)
- Create: `server/src/domains/meta-workflow/__tests__/service-release.test.ts`

A run reaches a terminal state via:
- `cancelRun(runId)` → status `'cancelled'`
- The phase executor reaching the last phase successfully → status `'completed'` (look at `runAggregate.complete()` in `run-aggregate.ts` lines 77–93 and trace upward to find where it's called)

For both terminals, the allocator should release the slot.

- [ ] **Step 1: Identify completion call sites**

Run: `grep -n "runAggregate.complete\|runAggregate\.complete\|aggregate.complete" server/src/domains/meta-workflow/*.ts`

Record where the run is moved to `completed`. (Phase D wires this in `phase-executor.ts` after the last phase succeeds. Confirm before writing the test.)

If completion is automatic at the end of a phase chain, hook the release call there. If not, add the release call after `runAggregate.complete()` in whatever method calls it.

- [ ] **Step 2: Write the failing test**

```typescript
// server/src/domains/meta-workflow/__tests__/service-release.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { MetaWorkflowService, type WorktreeAllocator } from '../service.js';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { samplePhasesJson } from './fixtures.js'; // exists from Phase D/E2a

describe('MetaWorkflowService — releaseRun on terminal states', () => {
  let db: Database.Database;
  let allocator: WorktreeAllocator;
  let releaseRunMock: ReturnType<typeof vi.fn>;
  let service: MetaWorkflowService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare('INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('proj-1', 'P', 'code', 0, 0);
    releaseRunMock = vi.fn().mockResolvedValue(undefined);
    allocator = {
      acquire: vi.fn().mockResolvedValue('/tmp/slot'),
      release: vi.fn().mockResolvedValue(undefined),
      releaseRun: releaseRunMock,
    };
    service = new MetaWorkflowService({
      db,
      runEntityForWorkflow: vi.fn().mockResolvedValue({ exitOk: true }),
      runEntityForSubagent: vi.fn().mockResolvedValue({ exitOk: true }),
      worktreeAllocator: allocator,
    });
  });

  it('cancelRun releases the run slot', () => {
    const run = service.createRun({ projectId: 'proj-1', title: 't' });
    service.cancelRun(run.id);
    expect(releaseRunMock).toHaveBeenCalledWith(run.id);
  });

  it('completing the final phase releases the run slot', async () => {
    const run = service.createRun({ projectId: 'proj-1', title: 't' });
    service.submitRequirements(run.id, 'design/req.md');
    service.approveRequirements(run.id);
    service.setPhasesJson(run.id, samplePhasesJson);
    await service.runPhase(run.id, 'p1');
    expect(releaseRunMock).toHaveBeenCalledWith(run.id);
  });
});
```

> If `samplePhasesJson` exports already exist from Phase D/E2a tests (they do — Phase E2a Task 2 uses them), import from the right relative path. If not, inline a minimal phases JSON with a single phase `p1` of type `code-implement`.

- [ ] **Step 3: Run, see failures**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/service-release.test.ts`

Expected: 2 tests fail (`releaseRunMock` not called).

- [ ] **Step 4: Wire `releaseRun` into `cancelRun`**

In `service.ts`, locate `cancelRun`:

```typescript
cancelRun(runId: string): MetaWorkflowRun {
  return this.runAggregate.cancel(runId);
}
```

Replace with:

```typescript
cancelRun(runId: string): MetaWorkflowRun {
  const run = this.runAggregate.cancel(runId);
  // Recycle the worktree slot. Fire-and-forget; failures here should not abort cancellation.
  void this.opts.worktreeAllocator.releaseRun(runId).catch((err: unknown) => {
    console.error(`[MetaWorkflowService] releaseRun failed for ${runId}:`, err);
  });
  return run;
}
```

- [ ] **Step 5: Wire `releaseRun` into completion**

Find where the run transitions to `'completed'` (Step 1 result). Likely in `phase-executor.ts` after the final phase or in `runPhase` after the last successful gate. Add the same release pattern there:

```typescript
// After runAggregate.complete(runId):
void this.opts.worktreeAllocator.releaseRun(runId).catch((err: unknown) => {
  console.error(`[MetaWorkflowService] releaseRun failed for ${runId}:`, err);
});
```

> If `phase-executor.ts` doesn't have direct access to the allocator, the cleanest fix is to plumb a callback `onRunCompleted?: (runId: string) => void` through `PhaseExecutorOptions`, set in `service.ts` to invoke `releaseRun`. Use that pattern if direct access is awkward.

- [ ] **Step 6: Run tests; verify green**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/service-release.test.ts src/domains/meta-workflow`

Expected: all green (existing + 2 new).

- [ ] **Step 7: Type-check**

Run: `pnpm --filter @my-claudia/server exec tsc --noEmit`

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add server/src/domains/meta-workflow/service.ts \
        server/src/domains/meta-workflow/phase-executor.ts \
        server/src/domains/meta-workflow/__tests__/service-release.test.ts
git commit -m "feat(meta-workflow): release run worktree on cancel/complete"
```

(Include `phase-executor.ts` only if you modified it; omit otherwise.)

---

## Task 4: Real `git diff` retrieval in `evaluateImpact`

**Files:**
- Modify: `server/src/domains/meta-workflow/service.ts` (extend `evaluateImpact` to fetch diff text)
- Modify: `server/src/domains/meta-workflow/__tests__/service.test.ts` (cover the new branch)

After E2a Task 2, `evaluateImpact` passes commit SHAs to the AI as text. Now we collect actual `git log --oneline` and `git diff --stat` between the two SHAs and embed them (truncated to ~2KB) into the prompt for grounded reasoning.

Mirror the pattern in `server/src/domains/supervision/task-runner.ts:222–235`:

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileP = promisify(execFile);
```

- [ ] **Step 1: Add failing test (new branch)**

In `service.test.ts`, append a test that verifies the AI prompt includes the diff text. Use a custom git diff stub by mocking `node:child_process.execFile` via vitest:

```typescript
  it('evaluateImpact includes git log/diff text in the AI prompt when worktree is accessible', async () => {
    const promptCaptured: string[] = [];
    const aiRunPort = {
      startVirtualRun: vi.fn().mockImplementation(async (args: { input: string; onMessage?: (m: { kind: string; content?: string }) => void }) => {
        promptCaptured.push(args.input);
        args.onMessage?.({ kind: 'assistant', content: '{"kind":"minor-fix","reason":"Only logging changed."}' });
        args.onMessage?.({ kind: 'run_completed' });
      }),
    };

    // Mock execFile to return canned git output. We point execFile-promisified at a
    // controlled stub by intercepting via vi.mock at module level (see Step 3).
    // For this test we use the production code path; the mock returns:
    //   git log --oneline prev..cur → "abc1234 commit msg"
    //   git diff --stat prev..cur → " src/foo.ts | 2 +-"

    const allocatorPath = '/tmp/fake-worktree';
    const fakeAllocator: WorktreeAllocator = {
      acquire: vi.fn().mockResolvedValue(allocatorPath),
      release: vi.fn().mockResolvedValue(undefined),
      releaseRun: vi.fn().mockResolvedValue(undefined),
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
    ).run('art-extra', phase.id, 99, 'sha-cur', 'active', Date.now());

    const rec = await service2.evaluateImpact(run.id, 'p1');
    expect(rec.kind).toBe('minor-fix');
    // Prompt should mention the SHAs AND the git log/diff stub output.
    expect(promptCaptured[0]).toMatch(/sha-cur/);
    expect(promptCaptured[0]).toMatch(/git log/i);
  });
```

> The test above relies on `execFile` running successfully in the test environment. If the test infra runs in a real git working tree, `git log abc..def` for fake SHAs will fail — that's OK: the test expects the prompt to STILL include the section "git log:" with an empty/error stub, which we'll handle as a `try/catch` in production code (Step 3).

- [ ] **Step 2: Run, see failure**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/service.test.ts`

Expected: new test fails (prompt does not include "git log").

- [ ] **Step 3: Extend `evaluateImpact` to fetch diff**

At the top of `service.ts`, add:

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

async function collectGitContext(cwd: string, previousSha: string, currentSha: string): Promise<string> {
  const safe = async (cmd: string, args: string[]): Promise<string> => {
    try {
      const { stdout } = await execFileP(cmd, args, { cwd, maxBuffer: 1024 * 1024 });
      return stdout.slice(0, 2000);
    } catch (e) {
      return `(unavailable: ${e instanceof Error ? e.message : String(e)})`;
    }
  };
  const log = await safe('git', ['log', '--oneline', `${previousSha}..${currentSha}`]);
  const stat = await safe('git', ['diff', '--stat', `${previousSha}..${currentSha}`]);
  return `git log:\n${log.trim() || '(empty)'}\n\ngit diff --stat:\n${stat.trim() || '(empty)'}`;
}
```

Then inside `evaluateImpact`, between the "Build prompt" step and the AI call, acquire the run worktree path and call `collectGitContext`:

```typescript
// Try to fetch real git context (best-effort; on failure we still send SHAs alone).
let gitContext = '';
try {
  const cwd = await this.opts.worktreeAllocator.acquire({ runId, phaseId, attempt: 1 });
  gitContext = await collectGitContext(cwd, previousSha, currentSha);
} catch (e) {
  gitContext = `(git context unavailable: ${e instanceof Error ? e.message : String(e)})`;
}

const prompt = [
  `You are an impact-analysis assistant for a Meta Workflow run.`,
  `Phase ${phase.phaseId} (type ${phase.phaseType}) is currently STALE because its upstream phase ${upstreamPhase.phaseId} (type ${upstreamPhase.phaseType}) was re-run.`,
  `Upstream's previous commit: ${previousSha}`,
  `Upstream's current commit:  ${currentSha}`,
  ``,
  `Upstream change summary:`,
  gitContext,
  ``,
  `Decide whether the downstream phase should be re-run, ignored, or only requires a minor fix.`,
  `Reply with a single JSON object on its own line, exactly: {"kind":"rerun"|"ignore"|"minor-fix","reason":"<short reason>"}`,
  `Do not add any other text before or after the JSON.`,
].join('\n');
```

- [ ] **Step 4: Run tests; verify green**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/service.test.ts`

Expected: all green (13 existing + 1 new = 14).

- [ ] **Step 5: Type-check**

Run: `pnpm --filter @my-claudia/server exec tsc --noEmit`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add server/src/domains/meta-workflow/service.ts \
        server/src/domains/meta-workflow/__tests__/service.test.ts
git commit -m "feat(meta-workflow): evaluateImpact embeds real git log/diff context"
```

---

## Task 5: NewRunDropdown auto-selects newly created run

**Files:**
- Modify: `apps/desktop/src/features/meta-workflow/store.ts` (add `markPendingSelect` and modify `upsertRun`)
- Modify: `apps/desktop/src/features/meta-workflow/components/NewRunDropdown.tsx` (call `markPendingSelect` before send)

Today after "Create" is clicked, the new run lands via `upsertRun` but the view doesn't focus it. Fix: flag the project as "select the next arriving run" and let `upsertRun` auto-promote.

- [ ] **Step 1: Add `pendingSelectByProject` and modify `upsertRun`**

In `store.ts`, add a state field and a flag-setter action; then update `upsertRun` to consume the flag.

```typescript
// In MetaWorkflowStore interface:
  /** Projects waiting to auto-select the next created run */
  pendingSelectByProject: Record<ProjectId, true>;
  markPendingSelect: (projectId: ProjectId) => void;
```

```typescript
// In useMetaWorkflowStore body:
  pendingSelectByProject: {},

  markPendingSelect: (projectId) => {
    set((state) => ({
      pendingSelectByProject: { ...state.pendingSelectByProject, [projectId]: true },
    }));
  },

  upsertRun: (run) => {
    set((state) => {
      const list = state.runs[run.projectId] ?? [];
      const idx = list.findIndex((r) => r.id === run.id);
      const isNew = idx === -1;
      const nextList = isNew
        ? [run, ...list]
        : [...list.slice(0, idx), run, ...list.slice(idx + 1)];
      const update: Partial<MetaWorkflowStore> = {
        runs: { ...state.runs, [run.projectId]: nextList },
      };
      if (isNew && state.pendingSelectByProject[run.projectId]) {
        const currentView = state.viewByProject[run.projectId] ?? INITIAL_VIEW_STATE;
        update.viewByProject = {
          ...state.viewByProject,
          [run.projectId]: { ...currentView, selectedRunId: run.id, screen: 'requirements' },
        };
        const { [run.projectId]: _omit, ...restPending } = state.pendingSelectByProject;
        void _omit;
        update.pendingSelectByProject = restPending;
      }
      return update as MetaWorkflowStore;
    });
  },
```

> The cast `as MetaWorkflowStore` keeps Zustand's partial-state return typing happy without overhauling the store. If TS complains, narrow to `Partial<MetaWorkflowStore>` and let Zustand merge.

- [ ] **Step 2: Modify `NewRunDropdown` to call `markPendingSelect` BEFORE sending**

In `NewRunDropdown.tsx`, change `submitMeta`:

```typescript
const markPendingSelect = useMetaWorkflowStore((s) => s.markPendingSelect);

const submitMeta = () => {
  if (!titleInput.trim()) return;
  markPendingSelect(projectId);
  sendCreateRun(socket, { projectId, title: titleInput.trim() });
  setTitleInput('');
  setShowMetaForm(false);
  setOpen(false);
  // Once the WS response upserts the new run, the store will auto-promote it
  // into selectedRunId + switch the screen to 'requirements'.
};
```

Remove the prior `patchView(projectId, { screen: 'requirements' })` line — the store's auto-promotion handles screen switching.

- [ ] **Step 3: Add a focused unit test**

Create `apps/desktop/src/features/meta-workflow/__tests__/store.test.ts` (or extend existing if present):

```typescript
// apps/desktop/src/features/meta-workflow/__tests__/store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useMetaWorkflowStore } from '../store.js';

describe('useMetaWorkflowStore — pending-select auto-promotion', () => {
  beforeEach(() => {
    useMetaWorkflowStore.setState({
      runs: {},
      phases: {},
      recommendations: {},
      viewByProject: {},
      pendingSelectByProject: {},
    });
  });

  it('auto-selects the next-arriving run when project is flagged', () => {
    const s = useMetaWorkflowStore.getState();
    s.markPendingSelect('proj-1');
    s.upsertRun({ id: 'run-new', projectId: 'proj-1', title: 'T', status: 'draft', createdAt: 1, updatedAt: 1 } as never);
    const view = useMetaWorkflowStore.getState().viewByProject['proj-1'];
    expect(view.selectedRunId).toBe('run-new');
    expect(view.screen).toBe('requirements');
    expect(useMetaWorkflowStore.getState().pendingSelectByProject['proj-1']).toBeUndefined();
  });

  it('does nothing for upserts when no pending flag', () => {
    const s = useMetaWorkflowStore.getState();
    s.upsertRun({ id: 'run-x', projectId: 'proj-1', title: 'T', status: 'draft', createdAt: 1, updatedAt: 1 } as never);
    const view = useMetaWorkflowStore.getState().viewByProject['proj-1'];
    expect(view).toBeUndefined();
  });

  it('does not re-select on subsequent updates to the same run', () => {
    const s = useMetaWorkflowStore.getState();
    s.markPendingSelect('proj-1');
    s.upsertRun({ id: 'run-new', projectId: 'proj-1', title: 'T', status: 'draft', createdAt: 1, updatedAt: 1 } as never);
    // Manually change the selection away
    s.patchView('proj-1', { selectedRunId: undefined });
    // A status update for the same run must NOT re-select.
    s.upsertRun({ id: 'run-new', projectId: 'proj-1', title: 'T', status: 'requirements-approved', createdAt: 1, updatedAt: 2 } as never);
    const view = useMetaWorkflowStore.getState().viewByProject['proj-1'];
    expect(view.selectedRunId).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @my-claudia/desktop exec vitest run src/features/meta-workflow/__tests__/store.test.ts`

Expected: 3/3 green.

- [ ] **Step 5: Type-check desktop**

Run: `pnpm --filter @my-claudia/desktop exec tsc --noEmit`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/features/meta-workflow/store.ts \
        apps/desktop/src/features/meta-workflow/components/NewRunDropdown.tsx \
        apps/desktop/src/features/meta-workflow/__tests__/store.test.ts
git commit -m "feat(meta-workflow-ui): NewRunDropdown auto-selects newly created run"
```

---

## Task 6: Vitest — `NewRunDropdown` + `PromotionDialog`

**Files:**
- Create: `apps/desktop/src/features/meta-workflow/__tests__/NewRunDropdown.test.tsx`
- Create: `apps/desktop/src/features/meta-workflow/__tests__/PromotionDialog.test.tsx`

Both components are presentational + light store interaction. Follow the pattern in `apps/desktop/src/features/supervision/components/__tests__/SupervisorWorkspacePanel.test.tsx` for mocks.

- [ ] **Step 1: Read the existing reference test for style**

Read: `apps/desktop/src/features/supervision/components/__tests__/SupervisorWorkspacePanel.test.tsx`

Note its conventions: `vi.mock('../../api', ...)`, `userEvent.setup()`, `render(<Component ... />)`.

- [ ] **Step 2: Write `NewRunDropdown.test.tsx`**

```typescript
// apps/desktop/src/features/meta-workflow/__tests__/NewRunDropdown.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewRunDropdown } from '../components/NewRunDropdown.js';
import { useMetaWorkflowStore } from '../store.js';
import * as api from '../api.js';

describe('NewRunDropdown', () => {
  beforeEach(() => {
    useMetaWorkflowStore.setState({
      runs: {},
      phases: {},
      recommendations: {},
      viewByProject: {},
      pendingSelectByProject: {},
    });
    vi.restoreAllMocks();
  });

  it('renders the "New ▾" trigger', () => {
    render(<NewRunDropdown projectId="p1" socket={{ send: vi.fn() }} onNewClassicChange={() => {}} />);
    expect(screen.getByRole('button', { name: /^New/ })).toBeInTheDocument();
  });

  it('clicking "New Classic Change" invokes the callback and closes', async () => {
    const onNewClassic = vi.fn();
    const user = userEvent.setup();
    render(<NewRunDropdown projectId="p1" socket={{ send: vi.fn() }} onNewClassicChange={onNewClassic} />);
    await user.click(screen.getByRole('button', { name: /^New/ }));
    await user.click(screen.getByRole('button', { name: /New Classic Change/i }));
    expect(onNewClassic).toHaveBeenCalledOnce();
  });

  it('submitting the meta form marks pending select and sends create_run', async () => {
    const sendCreateRunSpy = vi.spyOn(api, 'sendCreateRun').mockImplementation(() => {});
    const user = userEvent.setup();
    const socket = { send: vi.fn() };
    render(<NewRunDropdown projectId="p1" socket={socket} onNewClassicChange={() => {}} />);
    await user.click(screen.getByRole('button', { name: /^New/ }));
    await user.click(screen.getByRole('button', { name: /New Meta Workflow Run/i }));
    await user.type(screen.getByPlaceholderText('Title'), 'My new run');
    await user.click(screen.getByRole('button', { name: /^Create$/ }));
    expect(sendCreateRunSpy).toHaveBeenCalledWith(socket, { projectId: 'p1', title: 'My new run' });
    expect(useMetaWorkflowStore.getState().pendingSelectByProject['p1']).toBe(true);
  });

  it('Create button is a no-op when title is empty/whitespace', async () => {
    const sendCreateRunSpy = vi.spyOn(api, 'sendCreateRun').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<NewRunDropdown projectId="p1" socket={{ send: vi.fn() }} onNewClassicChange={() => {}} />);
    await user.click(screen.getByRole('button', { name: /^New/ }));
    await user.click(screen.getByRole('button', { name: /New Meta Workflow Run/i }));
    await user.type(screen.getByPlaceholderText('Title'), '   ');
    await user.click(screen.getByRole('button', { name: /^Create$/ }));
    expect(sendCreateRunSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Write `PromotionDialog.test.tsx`**

First, read the component to understand its props + behavior:

```bash
cat apps/desktop/src/features/meta-workflow/screens/PromotionDialog.tsx
```

Then write tests that exercise:
- Open/closed state
- Form field inputs (kind, name, description, signature/template fields per `ReusablePoolItem`)
- "Promote" button calls the appropriate `sendPromote*` API
- Cancel closes without sending

```typescript
// apps/desktop/src/features/meta-workflow/__tests__/PromotionDialog.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PromotionDialog } from '../screens/PromotionDialog.js';
import * as api from '../api.js';

describe('PromotionDialog', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('does not render when closed', () => {
    render(<PromotionDialog open={false} onClose={() => {}} runId="r1" phaseId="p1" socket={{ send: vi.fn() }} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Cancel calls onClose without sending', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<PromotionDialog open onClose={onClose} runId="r1" phaseId="p1" socket={{ send: vi.fn() }} />);
    await user.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Promote button submits the configured payload', async () => {
    // Adjust this spy's target based on whatever helper PromotionDialog uses
    // (sendPromote / sendCreateReusablePoolItem / etc — check the component source).
    const spy = vi.spyOn(api, 'sendPromote' as never).mockImplementation((() => {}) as never);
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<PromotionDialog open onClose={onClose} runId="r1" phaseId="p1" socket={{ send: vi.fn() }} />);
    // Fill required form fields (adapt names/labels to actual component):
    const nameInput = screen.getByLabelText(/name/i);
    await user.type(nameInput, 'reusable-x');
    await user.click(screen.getByRole('button', { name: /^Promote$/i }));
    expect(spy).toHaveBeenCalled();
  });
});
```

> If `PromotionDialog`'s actual props/labels differ from the snippet above, adapt to match. The point is: render → interact → assert API call.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @my-claudia/desktop exec vitest run src/features/meta-workflow/__tests__/NewRunDropdown.test.tsx src/features/meta-workflow/__tests__/PromotionDialog.test.tsx`

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/meta-workflow/__tests__/NewRunDropdown.test.tsx \
        apps/desktop/src/features/meta-workflow/__tests__/PromotionDialog.test.tsx
git commit -m "test(meta-workflow-ui): cover NewRunDropdown + PromotionDialog"
```

---

## Task 7: Vitest — `RequirementsScreen` + `PhaseDetailScreen`

**Files:**
- Create: `apps/desktop/src/features/meta-workflow/__tests__/RequirementsScreen.test.tsx`
- Create: `apps/desktop/src/features/meta-workflow/__tests__/PhaseDetailScreen.test.tsx`

- [ ] **Step 1: Read the components**

Run:
```bash
cat apps/desktop/src/features/meta-workflow/screens/RequirementsScreen.tsx
cat apps/desktop/src/features/meta-workflow/screens/PhaseDetailScreen.tsx
```

Identify each screen's required props, store reads, and API calls.

- [ ] **Step 2: Write `RequirementsScreen.test.tsx`**

Tests to write (adapt selectors/labels to actual component):
- "renders empty state when no run is selected"
- "renders run title + requirements path when run has them"
- "Submit Requirements button invokes `sendSubmitRequirements`"
- "Approve button invokes `sendResolveRequirements` with kind='approve'"

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequirementsScreen } from '../screens/RequirementsScreen.js';
import { useMetaWorkflowStore } from '../store.js';
import * as api from '../api.js';

describe('RequirementsScreen', () => {
  beforeEach(() => {
    useMetaWorkflowStore.setState({
      runs: {},
      phases: {},
      recommendations: {},
      viewByProject: {},
      pendingSelectByProject: {},
    });
    vi.restoreAllMocks();
  });

  it('renders empty state when no run is selected', () => {
    render(<RequirementsScreen projectId="p1" socket={{ send: vi.fn() }} />);
    expect(screen.getByText(/select.+run|no run/i)).toBeInTheDocument();
  });

  it('Submit Requirements invokes the API', async () => {
    useMetaWorkflowStore.setState({
      runs: { p1: [{ id: 'r1', projectId: 'p1', title: 't', status: 'draft', createdAt: 0, updatedAt: 0 } as never] },
      viewByProject: { p1: { screen: 'requirements', selectedRunId: 'r1' } },
    });
    const spy = vi.spyOn(api, 'sendSubmitRequirements').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<RequirementsScreen projectId="p1" socket={{ send: vi.fn() }} />);
    const pathInput = screen.getByLabelText(/requirements path|path/i);
    await user.type(pathInput, 'design/req.md');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    expect(spy).toHaveBeenCalledWith(expect.anything(), { runId: 'r1', requirementsPath: 'design/req.md' });
  });
});
```

- [ ] **Step 3: Write `PhaseDetailScreen.test.tsx`**

Tests to write:
- "renders empty state when no phase is selected"
- "renders phase metadata + acceptance gates list"
- "Run Phase button invokes `sendRunPhase` with the correct runId/phaseId"
- "Cascade Re-run button shows confirmation, then calls `sendCascadeRerun`"

Use the same `vi.spyOn(api, ...)` + `useMetaWorkflowStore.setState(...)` pattern as Step 2.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @my-claudia/desktop exec vitest run src/features/meta-workflow/__tests__/RequirementsScreen.test.tsx src/features/meta-workflow/__tests__/PhaseDetailScreen.test.tsx`

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/meta-workflow/__tests__/RequirementsScreen.test.tsx \
        apps/desktop/src/features/meta-workflow/__tests__/PhaseDetailScreen.test.tsx
git commit -m "test(meta-workflow-ui): cover RequirementsScreen + PhaseDetailScreen"
```

---

## Task 8: Vitest — `PhaseGraphScreen` + `PhaseBoardScreen`

**Files:**
- Create: `apps/desktop/src/features/meta-workflow/__tests__/PhaseGraphScreen.test.tsx`
- Create: `apps/desktop/src/features/meta-workflow/__tests__/PhaseBoardScreen.test.tsx`

Same pattern as Task 7.

- [ ] **Step 1: Read the components**

```bash
cat apps/desktop/src/features/meta-workflow/screens/PhaseGraphScreen.tsx
cat apps/desktop/src/features/meta-workflow/screens/PhaseBoardScreen.tsx
```

- [ ] **Step 2: Write `PhaseGraphScreen.test.tsx`**

PhaseGraphScreen uses `@xyflow/react`. Mock `@xyflow/react` if needed (the real graph component is opaque to RTL):

```typescript
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes, edges }: { nodes: unknown[]; edges: unknown[] }) => (
    <div data-testid="reactflow" data-nodes={JSON.stringify(nodes)} data-edges={JSON.stringify(edges)} />
  ),
  Background: () => null,
  Controls: () => null,
}));
```

Tests:
- "renders empty graph when no phases"
- "renders one node per phase + edges from dependsOn"
- "clicking a node switches view to phase-detail with that phaseId"

- [ ] **Step 3: Write `PhaseBoardScreen.test.tsx`**

PhaseBoardScreen is a kanban-style status board.

Tests:
- "groups phases by status (pending / running / done / stale / failed)"
- "clicking a phase card switches view to phase-detail"

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @my-claudia/desktop exec vitest run src/features/meta-workflow/__tests__/PhaseGraphScreen.test.tsx src/features/meta-workflow/__tests__/PhaseBoardScreen.test.tsx`

Expected: green.

- [ ] **Step 5: Run the full desktop suite as a regression check**

Run: `pnpm --filter @my-claudia/desktop exec vitest run`

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/features/meta-workflow/__tests__/PhaseGraphScreen.test.tsx \
        apps/desktop/src/features/meta-workflow/__tests__/PhaseBoardScreen.test.tsx
git commit -m "test(meta-workflow-ui): cover PhaseGraphScreen + PhaseBoardScreen"
```

---

## Task 9: Smoke + Tag

- [ ] **Step 1: Build**

Run: `pnpm build`

Expected: all 4 packages clean.

- [ ] **Step 2: Run full server + desktop meta-workflow suites**

Run:
```bash
pnpm --filter @my-claudia/server exec vitest run
pnpm --filter @my-claudia/desktop exec vitest run
pnpm --filter @my-claudia/shared exec vitest run
```

Expected: all green. Approximate new counts:
- Server: +5 EventDispatcher + 3 allocator + 2 release + 1 evaluateImpact = +11
- Desktop: +3 store + 4 NewRunDropdown + ~3 PromotionDialog + ~2 RequirementsScreen + ~4 PhaseDetail + ~3 PhaseGraph + ~2 PhaseBoard = ~20+

- [ ] **Step 3: Tag**

```bash
git tag -a meta-workflow/phase-e2b-complete -m "Meta Workflow Phase E2b hardening + desktop test coverage landed"
```

---

## Phase E2b Acceptance Criteria

- [ ] All 9 tasks complete with individual commits.
- [ ] `pnpm build` passes.
- [ ] Server + desktop + shared vitest suites green.
- [ ] Phase E2a tag `meta-workflow/phase-e2a-complete` still reachable.

---

## What Phase E2b Deliberately Leaves to Phase E2c / F

| Item | Phase |
|------|-------|
| Drag-edit on PhaseGraphScreen | E2c |
| Sub-workflow run viewer embedded in PhaseDetail | E2c |
| Reuse-pool browser screen | E2c |
| Design polish (shadcn / MyClaudia UI kit alignment) | E2c |
| End-to-end smoke on a real Java/TS project | F |

---

*Plan version: 1 / 2026-05-19*
*Phase A-E2a: complete (latest tag `meta-workflow/phase-e2a-complete`, commit `1fd4f39e`)*
