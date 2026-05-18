# Meta Workflow — Phase D: Production Wiring + Stale Propagation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Replace Phase C's stubs/polling/temp-dirs with real integrations into the existing server runtime (event listener, WorktreeManager, workflowAiRunPort); (2) wire Meta Workflow into the application bootstrap so the HTTP routes + WS handlers actually serve requests; (3) implement artifact versioning + Stale propagation (Lazy + Soft) + the four user actions on stale phases (Re-run / Ignore / Evaluate / Cascade).

**Architecture:** Phase D touches existing server code for the first time. Two verticals share this Phase:
- **Production wiring (Tasks 1-6)**: cleanup, real workflow run-entity via dispatcher subscription, real subagent run-entity via `workflowAiRunPort`, WorktreeManager-backed worktree allocation, register.ts factory updates, and bootstrap mounting in `domain-bootstrap.ts`.
- **Stale + artifact (Tasks 7-11)**: `MetaPhaseExecutor` writes `MetaWorkflowArtifact` on done/failed, a stale-propagator service implements the Lazy+Soft algorithm, four user actions on `MetaWorkflowService`, new CRUD ClientMessages + WS handlers for stale actions.

**Tech Stack:** TypeScript, the existing `WorkflowEngine` event dispatcher (`server/src/domains/workflows/engine.ts:55`), existing `WorktreePool` (`server/src/domains/supervision/worktree-pool.ts:62`), existing `workflowAiRunPort.startVirtualRun()` (`server/src/application/bootstrap/domain-ports.ts:76-89`).

**Spec reference:** `docs/design/supervisor-meta-workflow.zh-CN.md` (sections §6.4 阶段执行 lifecycle, §6.6 Stale 传播, §10 数据模型 artifact versioning).

**Phase A-C references:**
- A: `docs/impl/meta-workflow-phase-a-foundation.md` (foundation + types, complete)
- B: `docs/impl/meta-workflow-phase-b-core-domain.md` (aggregates + synthesizers + executor stub, complete)
- C: `docs/impl/meta-workflow-phase-c-reuse-and-runtime.md` (reuse pool + runtime adapters + routes + handlers, complete)
- Latest tag: `meta-workflow/phase-c-complete` (commit `1c3d1106`)

---

## File Structure

```
server/src/domains/meta-workflow/
├── index.ts                                                       MODIFY (add new exports)
├── register.ts                                                    MODIFY (real factory signature)
├── service.ts                                                     MODIFY (add stale + artifact + 4 actions methods)
├── phase-executor.ts                                              MODIFY (write artifact on done/failed)
├── stale-propagator.ts                                            NEW
├── run-entities/
│   ├── workflow-run-entity.ts                                     MODIFY (event listener replaces polling)
│   └── subagent-run-entity.ts                                     MODIFY (RunVirtualClient real wiring)
└── __tests__/
    ├── stale-propagator.test.ts                                   NEW
    ├── workflow-run-entity.test.ts                                MODIFY (event listener path)
    ├── service.test.ts                                            MODIFY (add stale + artifact + 4 actions)
    └── phase-executor.test.ts                                     MODIFY (artifact write)

server/src/application/conversation/handlers/
└── meta-workflow.ts                                               MODIFY (add 4 stale-action handlers)

server/src/application/conversation/handlers/__tests__/
└── meta-workflow.test.ts                                          MODIFY (4 new stale-action tests + cleanup beforeEach)

server/src/application/bootstrap/
└── domain-bootstrap.ts                                            MODIFY (call registerMetaWorkflow)

server/src/application/conversation/transport/
└── (existing message router or similar)                           MODIFY (dispatch new ClientMessages)

shared/src/protocol/messages/
├── meta-workflow.ts                                               MODIFY (4 new stale-action ClientMessages)
└── index.ts                                                       MODIFY (extend ClientMessage union)
```

12 tasks total. Verticals:

```
Production wiring (Tasks 1-6) — all touch existing server code, integration-heavy
  Task 1 (cleanup Phase C nits)               ← independent
  Task 2 (workflow-run-entity event listener) ← needs no other Phase D task
  Task 3 (subagent-run-entity real wiring)    ← independent
  Task 4 (WorktreeManager integration)        ← needs 3 (subagent acquires too)
  Task 5 (register.ts updates)                ← needs 2, 3, 4
  Task 6 (bootstrap mounting)                 ← needs 5

Stale + artifact (Tasks 7-11)
  Task 7 (artifact creation in executor)      ← independent
  Task 8 (stale-propagator service)           ← needs none
  Task 9 (4 user actions on Service)          ← needs 8
  Task 10 (CRUD msgs + WS handlers)           ← needs 9
  Task 11 (cross-component integration test)  ← needs 7, 8, 9

Task 12 (smoke + tag) ← final
```

---

## Task 1: Phase C Cleanup Follow-ups

**Files:**
- Modify: `server/src/application/conversation/handlers/__tests__/meta-workflow.test.ts`
- Modify: `server/src/domains/meta-workflow/service.ts`

Two minor cleanups flagged by Phase C reviewer.

- [ ] **Step 1: Remove unused `beforeEach` from handler test import**

Open `server/src/application/conversation/handlers/__tests__/meta-workflow.test.ts`. Find the line starting with `import { describe, it, expect, vi, beforeEach }` (approximately line 1-2). Remove `beforeEach` from the import list.

Final import line should look like:

```typescript
import { describe, it, expect, vi } from 'vitest';
```

(If `beforeEach` was the only unused name and there are other unused names too, drop them. Otherwise keep all the others.)

- [ ] **Step 2: Add Phase D placeholder comment for `artifactRepo` in service**

Open `server/src/domains/meta-workflow/service.ts`. Find the line `private artifactRepo: MetaWorkflowArtifactRepository;` (line ~36). Right before it, add a comment:

```typescript
// Used by `runPhase` once Phase D Task 7 wires artifact creation into the executor.
private artifactRepo: MetaWorkflowArtifactRepository;
```

This is purely documentation — no behavior change.

- [ ] **Step 3: Run all tests to confirm no regressions**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow src/application/conversation/handlers/__tests__/meta-workflow.test.ts`

Expected: 121 + 8 = 129 tests pass (same as Phase C end).

- [ ] **Step 4: Commit**

```bash
git add server/src/application/conversation/handlers/__tests__/meta-workflow.test.ts \
        server/src/domains/meta-workflow/service.ts
git commit -m "chore(meta-workflow): clean up Phase C minor follow-ups"
```

---

## Task 2: Workflow Run-Entity — Replace Polling with Event Listener

**Files:**
- Modify: `server/src/domains/meta-workflow/run-entities/workflow-run-entity.ts`
- Modify: `server/src/domains/meta-workflow/__tests__/workflow-run-entity.test.ts`

Phase C used 200ms polling on `runRepo.findById()`. Phase D subscribes to `engine.dispatcher` and resolves on the first terminal event. Polling still works as a backup timeout safety net.

Existing engine dispatcher API (`server/src/domains/workflows/engine.ts:55-72`):
- `engine.dispatcher.on(eventType, handler)` — subscribe to specific event
- `engine.dispatcher.onAny(handler)` — subscribe to all events
- Event types include `run_started`, `step_started`, `step_completed`, `run_completed`, `run_failed` (use `git grep` to confirm exact strings if needed)

EventDispatcher has no `off`/unsubscribe API yet (research flagged this as a risk). For Phase D, register a handler that **self-removes** after seeing the terminal event by holding a `processed` flag — the handler still gets called for future events but no-ops.

- [ ] **Step 1: Modify the test to cover event-listener path**

Replace the existing 4 tests in `workflow-run-entity.test.ts` with these 5 tests (the new fifth one exercises the listener path):

```typescript
// server/src/domains/meta-workflow/__tests__/workflow-run-entity.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createWorkflowRunEntity } from '../run-entities/workflow-run-entity.js';
import type { WorkflowRun } from '@my-claudia/shared/features/workflows';

function makeFakeDispatcher() {
  type Handler = (e: { runId: string; type: string }) => void;
  const handlers: Handler[] = [];
  return {
    onAny: (h: Handler) => { handlers.push(h); },
    dispatch: (e: { runId: string; type: string }) => { for (const h of handlers) h(e); },
  };
}

describe('workflow run-entity adapter', () => {
  it('resolves exitOk=true when run_completed event arrives', async () => {
    const dispatcher = makeFakeDispatcher();
    const engine = {
      dispatcher,
      startRun: vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' } as WorkflowRun),
    };
    const runRepo = {
      findById: vi.fn().mockReturnValue({ id: 'run-1', status: 'completed' }),
    };
    const runEntity = createWorkflowRunEntity({
      engine: engine as never,
      runRepo: runRepo as never,
      projectId: 'p1',
      pollIntervalMs: 1,
      timeoutMs: 1000,
    });

    const outcomeP = runEntity(
      { kind: 'workflow', workflow: { nodes: [], edges: [], entryNodeId: '', triggers: [] }, workflowId: 'wf-1' },
      { worktreePath: '/tmp/wt' },
    );
    // simulate engine emitting completion event
    setTimeout(() => dispatcher.dispatch({ runId: 'run-1', type: 'run_completed' }), 0);
    const outcome = await outcomeP;
    expect(outcome.exitOk).toBe(true);
  });

  it('resolves exitOk=false when run_failed event arrives', async () => {
    const dispatcher = makeFakeDispatcher();
    const engine = {
      dispatcher,
      startRun: vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' } as WorkflowRun),
    };
    const runRepo = {
      findById: vi.fn().mockReturnValue({ id: 'run-1', status: 'failed' }),
    };
    const runEntity = createWorkflowRunEntity({
      engine: engine as never,
      runRepo: runRepo as never,
      projectId: 'p1',
      pollIntervalMs: 1,
      timeoutMs: 1000,
    });

    const outcomeP = runEntity(
      { kind: 'workflow', workflow: { nodes: [], edges: [], entryNodeId: '', triggers: [] }, workflowId: 'wf-1' },
      { worktreePath: '/tmp/wt' },
    );
    setTimeout(() => dispatcher.dispatch({ runId: 'run-1', type: 'run_failed' }), 0);
    const outcome = await outcomeP;
    expect(outcome.exitOk).toBe(false);
  });

  it('falls back to polling when no events arrive but the run already finished', async () => {
    const dispatcher = makeFakeDispatcher();
    const engine = {
      dispatcher,
      startRun: vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' } as WorkflowRun),
    };
    const runRepo = {
      findById: vi.fn()
        .mockReturnValueOnce({ id: 'run-1', status: 'running' })
        .mockReturnValueOnce({ id: 'run-1', status: 'completed' }),
    };
    const runEntity = createWorkflowRunEntity({
      engine: engine as never,
      runRepo: runRepo as never,
      projectId: 'p1',
      pollIntervalMs: 1,
      timeoutMs: 1000,
    });
    const outcome = await runEntity(
      { kind: 'workflow', workflow: { nodes: [], edges: [], entryNodeId: '', triggers: [] }, workflowId: 'wf-1' },
      { worktreePath: '/tmp/wt' },
    );
    expect(outcome.exitOk).toBe(true);
  });

  it('times out and returns exitOk=false', async () => {
    const dispatcher = makeFakeDispatcher();
    const engine = {
      dispatcher,
      startRun: vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' } as WorkflowRun),
    };
    const runRepo = {
      findById: vi.fn().mockReturnValue({ id: 'run-1', status: 'running' }),
    };
    const runEntity = createWorkflowRunEntity({
      engine: engine as never,
      runRepo: runRepo as never,
      projectId: 'p1',
      pollIntervalMs: 1,
      timeoutMs: 5,
    });
    const outcome = await runEntity(
      { kind: 'workflow', workflow: { nodes: [], edges: [], entryNodeId: '', triggers: [] }, workflowId: 'wf-1' },
      { worktreePath: '/tmp/wt' },
    );
    expect(outcome.exitOk).toBe(false);
  });

  it('rejects non-workflow kind', async () => {
    const runEntity = createWorkflowRunEntity({
      engine: { dispatcher: makeFakeDispatcher() } as never,
      runRepo: {} as never,
      projectId: 'p1',
    });
    await expect(runEntity(
      { kind: 'subagent', subagent: {} as never },
      { worktreePath: '/tmp/wt' },
    )).rejects.toThrow(/workflow/i);
  });
});
```

- [ ] **Step 2: Run test to see which assertions break**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/workflow-run-entity.test.ts`

Expected: 3 of 5 fail because the current implementation doesn't subscribe to the dispatcher.

- [ ] **Step 3: Rewrite the implementation to use event listener + polling fallback**

Replace `server/src/domains/meta-workflow/run-entities/workflow-run-entity.ts` with:

```typescript
// server/src/domains/meta-workflow/run-entities/workflow-run-entity.ts
import type { WorkflowEngine } from '../../workflows/engine.js';
import type { WorkflowRunRepository } from '../../workflows/workflow-run-repository.js';
import type { WorkflowRun } from '@my-claudia/shared/features/workflows';
import type {
  RunEntity,
  SynthesizedEntity,
  RunEntityOutcome,
} from '../phase-executor.js';

export interface CreateWorkflowRunEntityOptions {
  engine: WorkflowEngine;
  runRepo: WorkflowRunRepository;
  projectId: string;
  /** Backup polling interval (event listener is primary). Defaults to 1 s. */
  pollIntervalMs?: number;
  timeoutMs?: number;
}

const DEFAULT_POLL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const TERMINAL_EVENT_TYPES = new Set(['run_completed', 'run_failed', 'run_cancelled']);
const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'cancelled'] as const;

function isTerminalRun(run: WorkflowRun): boolean {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(run.status);
}

export function createWorkflowRunEntity(opts: CreateWorkflowRunEntityOptions): RunEntity {
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (entity: SynthesizedEntity, _ctx): Promise<RunEntityOutcome> => {
    if (entity.kind !== 'workflow') {
      throw new Error(`workflow run-entity received non-workflow kind: ${entity.kind}`);
    }
    const run = await opts.engine.startRun(
      entity.workflowId,
      opts.projectId,
      entity.workflow,
      'manual',
    );

    return new Promise<RunEntityOutcome>((resolve) => {
      let settled = false;
      const finish = (outcome: RunEntityOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(poller);
        resolve(outcome);
      };

      // Primary: event listener.
      opts.engine.dispatcher.onAny((event: { runId: string; type: string }) => {
        if (event.runId !== run.id) return;
        if (!TERMINAL_EVENT_TYPES.has(event.type)) return;
        const fresh = opts.runRepo.findById(run.id);
        finish({ exitOk: fresh?.status === 'completed' });
      });

      // Fallback: polling.
      const poller = setInterval(() => {
        const fresh = opts.runRepo.findById(run.id);
        if (fresh && isTerminalRun(fresh)) {
          finish({ exitOk: fresh.status === 'completed' });
        }
      }, pollIntervalMs);

      // Hard timeout.
      const timer = setTimeout(() => finish({ exitOk: false }), timeoutMs);
    });
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/workflow-run-entity.test.ts`

Expected: 5/5 pass.

- [ ] **Step 5: tsc check**

Run: `pnpm --filter @my-claudia/server exec tsc --noEmit`

Expected: clean.

> **NOTE on event type names**: If `'run_completed'` / `'run_failed'` are not the actual event strings used by `WorkflowEngine` (check `server/src/domains/workflows/run-events.ts`), adapt the `TERMINAL_EVENT_TYPES` set. The test fakes dispatch and uses these exact strings, so test + impl must agree.

- [ ] **Step 6: Commit**

```bash
git add server/src/domains/meta-workflow/run-entities/workflow-run-entity.ts \
        server/src/domains/meta-workflow/__tests__/workflow-run-entity.test.ts
git commit -m "feat(meta-workflow): workflow run-entity uses event listener with polling fallback"
```

---

## Task 3: Subagent Run-Entity — Real Multi-turn Wiring

**Files:**
- Modify: `server/src/domains/meta-workflow/run-entities/subagent-run-entity.ts`
- Modify: `server/src/domains/meta-workflow/__tests__/subagent-run-entity.test.ts`

Phase C used a stub `RunVirtualClient` callable. Phase D defines what the **real** `RunVirtualClient` must do: invoke `workflowAiRunPort.startVirtualRun()` and wait for the conversation to complete, collecting AI messages along the way.

**Phase D MVP scope for subagent multi-turn**: a single round-trip through `workflowAiRunPort` with `args.systemPrompt` as the initial user input. The AI's response is collected via `onMessage` callback. When `onMessage` receives a message with `kind === 'run_completed'` (or similar — research the actual event/message shape), the runner resolves with `output = concatenated assistant content`.

Phase D does NOT implement true autonomous multi-turn looping (where the subagent decides to continue). That's Phase E.

The strategy: keep the `RunVirtualClient` interface from Phase C unchanged (`(args) => Promise<{ ok, output? }>`). Phase D ships an implementation adapter `createRunVirtualClientFromAiRunPort(aiRunPort, sessionRepo)` that bridges to the real port.

- [ ] **Step 1: Add a new test confirming the adapter calls the AI run port and collects output**

Append these tests to `subagent-run-entity.test.ts` (existing 6 tests stay; these are *additional* tests proving the new factory):

```typescript
// Additional Phase D tests for the AI-runport adapter
import { createRunVirtualClientFromAiRunPort } from '../run-entities/subagent-run-entity.js';

describe('createRunVirtualClientFromAiRunPort', () => {
  it('invokes the AI run port with system prompt as input', async () => {
    const startVirtualRun = vi.fn().mockImplementation(async (input: { onMessage?: (m: { kind: string; content?: string }) => void }) => {
      // Simulate the port emitting an assistant message and then completion.
      input.onMessage?.({ kind: 'assistant_message', content: 'analysis result' });
      input.onMessage?.({ kind: 'run_completed' });
    });
    const runVirtualClient = createRunVirtualClientFromAiRunPort({
      aiRunPort: { startVirtualRun } as never,
      defaultProviderId: 'provider-x',
      timeoutMs: 1000,
    });
    const result = await runVirtualClient({
      systemPrompt: 'You investigate.',
      allowedTools: ['Read'],
      maxTurns: 5,
      cwd: '/tmp',
    });
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/analysis result/);
    expect(startVirtualRun).toHaveBeenCalledOnce();
  });

  it('returns ok=false when the port throws', async () => {
    const startVirtualRun = vi.fn().mockRejectedValue(new Error('boom'));
    const runVirtualClient = createRunVirtualClientFromAiRunPort({
      aiRunPort: { startVirtualRun } as never,
      defaultProviderId: 'provider-x',
      timeoutMs: 1000,
    });
    const result = await runVirtualClient({
      systemPrompt: 'p', allowedTools: [], maxTurns: 5, cwd: '/tmp',
    });
    expect(result.ok).toBe(false);
  });

  it('times out and returns ok=false when no completion is seen', async () => {
    const startVirtualRun = vi.fn().mockImplementation(async () => {
      // Never sends a completion event.
    });
    const runVirtualClient = createRunVirtualClientFromAiRunPort({
      aiRunPort: { startVirtualRun } as never,
      defaultProviderId: 'provider-x',
      timeoutMs: 5,
    });
    const result = await runVirtualClient({
      systemPrompt: 'p', allowedTools: [], maxTurns: 5, cwd: '/tmp',
    });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to see failures**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/subagent-run-entity.test.ts`

Expected: 6 existing tests still pass, 3 new tests fail (`createRunVirtualClientFromAiRunPort` doesn't exist yet).

- [ ] **Step 3: Add the adapter factory to subagent-run-entity.ts**

Append the following to `server/src/domains/meta-workflow/run-entities/subagent-run-entity.ts` (after the existing `createSubagentRunEntity` export):

```typescript
// ── Real AI-runport adapter (Phase D) ────────────────────────────

export interface AiRunPortStartArgs {
  clientId?: string;
  sessionId?: string;
  input: string;
  workingDirectory?: string;
  providerId?: string;
  systemContext?: string;
  onMessage?: (m: { kind: string; content?: string }) => void;
}

export interface AiRunPort {
  startVirtualRun(args: AiRunPortStartArgs): Promise<void>;
}

export interface CreateRunVirtualClientFromAiRunPortOptions {
  aiRunPort: AiRunPort;
  defaultProviderId?: string;
  /** Total time to wait for `run_completed` before giving up. Defaults to 5 min. */
  timeoutMs?: number;
}

const COMPLETED_KINDS = new Set(['run_completed', 'completed', 'final']);

export function createRunVirtualClientFromAiRunPort(
  opts: CreateRunVirtualClientFromAiRunPortOptions,
): RunVirtualClient {
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  return async (args: VirtualClientArgs): Promise<VirtualClientResult> => {
    let collected = '';
    let resolved = false;

    const completion = new Promise<boolean>((resolveComplete) => {
      const finish = (ok: boolean) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        resolveComplete(ok);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);

      opts.aiRunPort.startVirtualRun({
        input: args.systemPrompt,
        workingDirectory: args.cwd,
        providerId: opts.defaultProviderId,
        onMessage: (m) => {
          if (m.content) collected += m.content;
          if (COMPLETED_KINDS.has(m.kind)) finish(true);
        },
      }).catch(() => finish(false));
    });

    const ok = await completion;
    return ok ? { ok: true, output: collected } : { ok: false };
  };
}
```

- [ ] **Step 4: Run test to verify passes**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/subagent-run-entity.test.ts`

Expected: 9/9 pass (6 existing + 3 new).

> **NOTE on AI run port shape**: If the actual `workflowAiRunPort.startVirtualRun()` signature differs (e.g., needs `clientId` + `sessionId` as mandatory non-optional args, or expects `onMessage` to receive different event shapes), adapt the `AiRunPortStartArgs` interface and the `startVirtualRun` call at the bridge site. The tests fake the port; real wiring is exercised in Task 5 (register.ts) and Task 6 (bootstrap).

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/meta-workflow/run-entities/subagent-run-entity.ts \
        server/src/domains/meta-workflow/__tests__/subagent-run-entity.test.ts
git commit -m "feat(meta-workflow): real subagent runner via AI run port adapter"
```

---

## Task 4: WorktreeManager Integration

**Files:**
- Modify: `server/src/domains/meta-workflow/service.ts` (accept a `WorktreeAllocator` port)
- Modify: `server/src/domains/meta-workflow/__tests__/service.test.ts` (test allocator usage)
- Modify: `server/src/application/conversation/handlers/meta-workflow.ts` (remove `mkdtempSync`)
- Modify: `server/src/application/conversation/handlers/__tests__/meta-workflow.test.ts` (update test)

Phase C's `handleRunMetaWorkflowPhase` used `mkdtempSync(join(tmpdir(), 'meta-phase-'))` for a per-phase worktree. Phase D wires through to `WorktreePool.acquire(taskId, attempt)`. The service accepts a **port** (interface, not a direct WorktreeManager dependency) so unit tests stay simple:

```typescript
interface WorktreeAllocator {
  acquire(meta: { runId: string; phaseId: string; attempt: number }): Promise<string>;
  release(path: string): Promise<void>;
}
```

`MetaWorkflowService.runPhase(...)` calls `allocator.acquire()` to get the worktree path (replacing the previous `worktreePath` argument) and `allocator.release(path)` afterwards. The handler stops creating temp dirs.

- [ ] **Step 1: Modify `service.test.ts` to test the allocator port path**

Find the existing `beforeEach` of the `MetaWorkflowService` describe block; modify the service construction to provide a fake allocator:

```typescript
const fakeAllocator = {
  acquire: vi.fn().mockResolvedValue(workdir),
  release: vi.fn().mockResolvedValue(undefined),
};
service = new MetaWorkflowService({
  db,
  runEntityForWorkflow: vi.fn().mockResolvedValue({ exitOk: true }),
  runEntityForSubagent: vi.fn().mockResolvedValue({ exitOk: true }),
  worktreeAllocator: fakeAllocator,
});
```

Add a new test in the same describe block:

```typescript
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
```

Existing `runPhase drives executor and reaches done` test also needs an update: remove the `workdir` argument from `service.runPhase(run.id, 'p1', workdir)` — should now be `service.runPhase(run.id, 'p1')`.

- [ ] **Step 2: Run test to see failures**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/service.test.ts`

Expected: failures because (a) constructor doesn't accept `worktreeAllocator`, (b) `runPhase` still expects `worktreePath`.

- [ ] **Step 3: Modify `MetaWorkflowService` to accept and use the allocator**

In `server/src/domains/meta-workflow/service.ts`:

1. Add this interface near the top of the file (before `MetaWorkflowServiceOptions`):

```typescript
export interface WorktreeAllocator {
  acquire(meta: { runId: string; phaseId: string; attempt: number }): Promise<string>;
  release(path: string): Promise<void>;
}
```

2. Extend `MetaWorkflowServiceOptions`:

```typescript
export interface MetaWorkflowServiceOptions {
  db: Database;
  runEntityForWorkflow: RunEntity;
  runEntityForSubagent: RunEntity;
  worktreeAllocator: WorktreeAllocator;
}
```

3. Change `runPhase` signature and body:

```typescript
async runPhase(runId: string, phaseId: string): Promise<PhaseExecutionResult> {
  const phase = this.phaseRepo.findByRunAndPhaseId(runId, phaseId);
  if (!phase) throw new Error(`Phase not found: run=${runId} phase=${phaseId}`);

  const run = this.runRepo.findById(runId);
  if (!run?.phasesJson) throw new Error(`Run ${runId} has no phases.json`);

  const validation = validatePhasesJson(run.phasesJson);
  if (!validation.ok) throw new Error('Run has invalid phasesJson');
  const phaseDef = validation.doc.phases.find((p) => p.id === phaseId);
  if (!phaseDef) throw new Error(`Phase def not in phases.json: ${phaseId}`);

  const worktreePath = await this.opts.worktreeAllocator.acquire({
    runId, phaseId, attempt: phase.attempt + 1,
  });
  try {
    const executor = new MetaPhaseExecutor({
      aggregate: this.phaseAggregate,
      runEntity: async (entity, ctx) => {
        if (entity.kind === 'workflow') return this.opts.runEntityForWorkflow(entity, ctx);
        return this.opts.runEntityForSubagent(entity, ctx);
      },
    });
    return await executor.execute(phase.id, phaseDef, worktreePath);
  } finally {
    await this.opts.worktreeAllocator.release(worktreePath);
  }
}
```

- [ ] **Step 4: Modify the WS handler to drop `mkdtempSync`**

In `server/src/application/conversation/handlers/meta-workflow.ts`, remove the `mkdtempSync(...)` line in `handleRunMetaWorkflowPhase` and stop passing `worktreePath` to `service.runPhase(...)`. The new call:

```typescript
const result = await service.runPhase(msg.runId, msg.phaseId);
```

Also remove the now-unused `import { mkdtempSync }` / `tmpdir` / `join` imports.

- [ ] **Step 5: Update the handler test (`meta-workflow.test.ts`)**

The existing test `handleRunMetaWorkflowPhase awaits service.runPhase` asserts `service.runPhase` called with `expect.any(String)`. Change it to `service.runPhase` called with 2 args (`'r1', 'p1'`):

```typescript
expect(service.runPhase).toHaveBeenCalledWith('r1', 'p1');
```

- [ ] **Step 6: Run all affected tests**

```bash
pnpm --filter @my-claudia/server exec vitest run \
  src/domains/meta-workflow/__tests__/service.test.ts \
  src/application/conversation/handlers/__tests__/meta-workflow.test.ts
```

Expected: both files green.

- [ ] **Step 7: Commit**

```bash
git add server/src/domains/meta-workflow/service.ts \
        server/src/domains/meta-workflow/__tests__/service.test.ts \
        server/src/application/conversation/handlers/meta-workflow.ts \
        server/src/application/conversation/handlers/__tests__/meta-workflow.test.ts
git commit -m "feat(meta-workflow): inject WorktreeAllocator port; drop mkdtempSync"
```

---

## Task 5: register.ts — Real Factory Signature

**Files:**
- Modify: `server/src/domains/meta-workflow/register.ts`

The Phase C `RegisterMetaWorkflowOptions` accepted a `runVirtualClient` callable directly. Phase D's `register.ts` accepts a real `aiRunPort` (workflowAiRunPort) and a `worktreeAllocator` factory, and internally constructs the real `RunVirtualClient`.

- [ ] **Step 1: Modify `register.ts`**

Replace the file body with:

```typescript
// server/src/domains/meta-workflow/register.ts
import type { Database } from 'better-sqlite3';
import type { Router } from 'express';
import type { WorkflowEngine } from '../workflows/engine.js';
import type { WorkflowRunRepository } from '../workflows/workflow-run-repository.js';
import { MetaWorkflowService, type WorktreeAllocator } from './service.js';
import { createMetaWorkflowRoutes } from './routes.js';
import { createWorkflowRunEntity } from './run-entities/workflow-run-entity.js';
import {
  createSubagentRunEntity,
  createRunVirtualClientFromAiRunPort,
  type AiRunPort,
} from './run-entities/subagent-run-entity.js';

export interface RegisterMetaWorkflowOptions {
  db: Database;
  workflowEngine: WorkflowEngine;
  workflowRunRepository: WorkflowRunRepository;
  aiRunPort: AiRunPort;
  worktreeAllocator: WorktreeAllocator;
  defaultProjectId: string;
  defaultProviderId?: string;
}

export interface RegisteredMetaWorkflow {
  service: MetaWorkflowService;
  routes: Router;
}

export function registerMetaWorkflow(opts: RegisterMetaWorkflowOptions): RegisteredMetaWorkflow {
  const runEntityForWorkflow = createWorkflowRunEntity({
    engine: opts.workflowEngine,
    runRepo: opts.workflowRunRepository,
    projectId: opts.defaultProjectId,
  });
  const runVirtualClient = createRunVirtualClientFromAiRunPort({
    aiRunPort: opts.aiRunPort,
    defaultProviderId: opts.defaultProviderId,
  });
  const runEntityForSubagent = createSubagentRunEntity({
    runVirtualClient,
  });

  const service = new MetaWorkflowService({
    db: opts.db,
    runEntityForWorkflow,
    runEntityForSubagent,
    worktreeAllocator: opts.worktreeAllocator,
  });
  const routes = createMetaWorkflowRoutes(service);

  return { service, routes };
}
```

- [ ] **Step 2: tsc compiles**

Run: `pnpm --filter @my-claudia/server exec tsc --noEmit`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add server/src/domains/meta-workflow/register.ts
git commit -m "feat(meta-workflow): register.ts wires aiRunPort + worktreeAllocator"
```

---

## Task 6: Bootstrap Mounting

**Files:**
- Modify: `server/src/application/bootstrap/domain-bootstrap.ts` (call `registerMetaWorkflow`, mount routes, return service)
- Modify: WS dispatch (the file where ClientMessage types are dispatched to handlers — typically `server.ts:_handleClientMessage()` or a centralized router file. Search with `grep -rn 'create_meta_workflow_run\|run_meta_workflow_phase' server/src` to confirm none exist; then find the dispatcher pattern by grepping for `'create_supervision_task'` or similar existing CRUD ClientMessage handler dispatches.)

This task is **integration-heavy** — it touches the real server bootstrap. It does NOT add unit tests; correctness is exercised by Task 12's end-to-end smoke through the built dist.

- [ ] **Step 1: Add `registerMetaWorkflow` call to `domain-bootstrap.ts`**

Open `server/src/application/bootstrap/domain-bootstrap.ts`. Find `registerFeatureDomains()` (around line 116-132). After the workflow domain is registered (look for `registerWorkflows(...)`), add a Meta Workflow registration:

```typescript
import { registerMetaWorkflow } from '../../domains/meta-workflow/register.js';

// ... inside registerFeatureDomains() or equivalent, after workflows registered ...

const metaWorkflow = registerMetaWorkflow({
  db,
  workflowEngine: workflows.engine,
  workflowRunRepository: workflows.runRepository,
  aiRunPort: workflowAiRunPort,
  worktreeAllocator: createWorktreeAllocatorFromManager(supervisionWorktreeManager),
  defaultProjectId: defaultProjectId,
});
app.use('/api/meta-workflow', metaWorkflow.routes);
```

The exact names (`workflows.engine`, `workflows.runRepository`, `supervisionWorktreeManager`, `defaultProjectId`) depend on the local variable names in `domain-bootstrap.ts`. Use what already exists; don't invent new globals. Read the surrounding code first to find the right variable names.

- [ ] **Step 2: Add a small `createWorktreeAllocatorFromManager` helper**

In the same file (or a new file `server/src/application/bootstrap/meta-workflow-allocator.ts`):

```typescript
import type { WorktreeManager } from '../../domains/supervision/worktree-manager.js';
import type { WorktreeAllocator } from '../../domains/meta-workflow/service.js';

export function createWorktreeAllocatorFromManager(
  manager: WorktreeManager,
  projectId: string,
): WorktreeAllocator {
  return {
    async acquire({ runId, phaseId, attempt }) {
      const pool = manager.getWorktreePool(projectId);
      await pool.ensurePoolInitialized(projectId);
      return pool.acquire(`meta-${runId}-${phaseId}`, attempt);
    },
    async release(_path) {
      // WorktreePool.release accepts the task id, not the path. For Phase D MVP
      // we don't release explicitly (Worktree pool auto-recycles slots). Phase E
      // will add a proper release once we wire phase teardown.
    },
  };
}
```

> **NOTE**: `WorktreePool.acquire(taskId, attempt)` returns a path. Release semantics differ — `releaseTaskWorktree(task)` accepts a task object. For Phase D the simple approach is acquire-only; the pool naturally recycles slots when their tasks are done. Phase E refines this.

- [ ] **Step 3: Wire WS handlers into the message dispatcher**

Find where Phase C-defined ClientMessages would be dispatched (search `grep -rn 'AddSupervisionTaskMessage\|create_supervision_task' server/src`). The likely location is `server.ts:_handleClientMessage()` or a router file that switches on `message.type`. Add 6 new case branches:

```typescript
case 'create_meta_workflow_run':
  handleCreateMetaWorkflowRun(client, message, metaWorkflowService);
  break;
case 'submit_meta_workflow_requirements':
  handleSubmitMetaWorkflowRequirements(client, message, metaWorkflowService);
  break;
case 'resolve_meta_workflow_requirements':
  handleResolveMetaWorkflowRequirements(client, message, metaWorkflowService);
  break;
case 'set_meta_workflow_phases':
  handleSetMetaWorkflowPhases(client, message, metaWorkflowService);
  break;
case 'cancel_meta_workflow_run':
  handleCancelMetaWorkflowRun(client, message, metaWorkflowService);
  break;
case 'run_meta_workflow_phase':
  await handleRunMetaWorkflowPhase(client, message, metaWorkflowService);
  break;
```

For the dispatcher to have access to `metaWorkflowService`, the bootstrap needs to pass it through. If the dispatcher is constructed via a function, add a `metaWorkflowService` parameter.

- [ ] **Step 4: tsc + full build**

```bash
pnpm --filter @my-claudia/server exec tsc --noEmit
pnpm build
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/application/bootstrap/domain-bootstrap.ts
# plus whatever other files you modified:
git add server/src/application/conversation/transport/... # whatever the dispatcher path is
git add server/src/application/bootstrap/meta-workflow-allocator.ts  # if created
git commit -m "feat(meta-workflow): mount routes + WS handlers in application bootstrap"
```

> **EXPECT FRICTION HERE**: This is the riskiest task. The exact bootstrap variable names and the WS dispatcher location depend on the live server code. If you can't find a clean `registerFeatureDomains()` spot or the dispatcher is harder than expected, report DONE_WITH_CONCERNS and describe the friction so the controller can adapt.

---

## Task 7: Artifact Creation in MetaPhaseExecutor

**Files:**
- Modify: `server/src/domains/meta-workflow/phase-executor.ts` (add artifact write on done/failed)
- Modify: `server/src/domains/meta-workflow/__tests__/phase-executor.test.ts` (verify artifact write)
- Modify: `server/src/domains/meta-workflow/service.ts` (pass artifactRepo to executor)
- Modify: `server/src/domains/meta-workflow/__tests__/service.test.ts` (verify artifact created)

The `MetaPhaseExecutor` currently transitions the phase to done/failed but writes nothing to `meta_workflow_artifacts`. Phase D wires this: on every terminal transition (`done` or `failed`), write an artifact row with `version = (latest version for phase) + 1`, `status = 'active'`, and the `gateResults`.

- [ ] **Step 1: Modify executor test to verify artifact write**

Add this `it` block to `phase-executor.test.ts` inside the describe:

```typescript
  it('writes a versioned artifact on done', async () => {
    const phase = agg.instantiate('run-1', phaseDef);
    const artifactRepo = {
      findLatestByPhase: vi.fn().mockReturnValue(null),
      create: vi.fn().mockImplementation((data) => ({ id: 'a1', ...data })),
    };
    const executor = new MetaPhaseExecutor({
      aggregate: agg,
      runEntity: async () => ({ exitOk: true }),
      artifactRepo: artifactRepo as never,
    });
    await executor.execute(phase.id, phaseDef, workdir);
    expect(artifactRepo.create).toHaveBeenCalled();
    const createdArg = artifactRepo.create.mock.calls[0][0];
    expect(createdArg.phaseRecordId).toBe(phase.id);
    expect(createdArg.version).toBe(1);
    expect(createdArg.status).toBe('active');
    expect(Array.isArray(createdArg.gateResults)).toBe(true);
  });

  it('writes artifact with status=stale when phase fails', async () => {
    const failPhase = {
      ...phaseDef,
      acceptanceGates: [{ id: 'g1', description: 'no', command: 'false', expect: { exitCode: 0 } }],
    };
    const phase = agg.instantiate('run-1', failPhase);
    const artifactRepo = {
      findLatestByPhase: vi.fn().mockReturnValue(null),
      create: vi.fn().mockImplementation((data) => ({ id: 'a1', ...data })),
    };
    const executor = new MetaPhaseExecutor({
      aggregate: agg,
      runEntity: async () => ({ exitOk: true }),
      artifactRepo: artifactRepo as never,
    });
    await executor.execute(phase.id, failPhase, workdir);
    expect(artifactRepo.create).toHaveBeenCalled();
    const createdArg = artifactRepo.create.mock.calls[0][0];
    expect(createdArg.status).toBe('stale');
  });
```

- [ ] **Step 2: Run test to see failures**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/phase-executor.test.ts`

Expected: 2 new tests fail (executor doesn't accept `artifactRepo`).

- [ ] **Step 3: Modify the executor to write artifacts**

In `server/src/domains/meta-workflow/phase-executor.ts`:

1. Add `artifactRepo` to `MetaPhaseExecutorOptions` (optional — keep Phase B/C tests that don't pass it green):

```typescript
import type { MetaWorkflowArtifactRepository } from './repositories/meta-workflow-artifact-repository.js';

export interface MetaPhaseExecutorOptions {
  aggregate: MetaWorkflowPhaseAggregate;
  runEntity: RunEntity;
  artifactRepo?: MetaWorkflowArtifactRepository;
}
```

2. In `execute()` method, replace the final transition block (currently `aggregate.markDone(...)` / `aggregate.markFailed(...)`) with:

```typescript
const allPassed = gateResults.every((r) => r.passed);
const phase = allPassed
  ? aggregate.markDone(phaseRecordId)
  : aggregate.markFailed(phaseRecordId, 'one or more acceptance gates failed');

if (this.opts.artifactRepo) {
  const latest = this.opts.artifactRepo.findLatestByPhase(phaseRecordId);
  const version = (latest?.version ?? 0) + 1;
  this.opts.artifactRepo.create({
    phaseRecordId,
    version,
    gateResults,
    status: allPassed ? 'active' : 'stale',
    createdAt: Date.now(),
  });
}

return { phase, gateResults };
```

3. Also write artifact for the early-failure path where the entity runner fails:

```typescript
if (!runOutcome.exitOk) {
  const phase = aggregate.markFailed(phaseRecordId, 'entity runner reported failure');
  if (this.opts.artifactRepo) {
    const latest = this.opts.artifactRepo.findLatestByPhase(phaseRecordId);
    const version = (latest?.version ?? 0) + 1;
    this.opts.artifactRepo.create({
      phaseRecordId, version, gateResults: [], status: 'stale', createdAt: Date.now(),
    });
  }
  return { phase, gateResults: [] };
}
```

- [ ] **Step 4: Pass `artifactRepo` from `MetaWorkflowService` to the executor**

In `server/src/domains/meta-workflow/service.ts` `runPhase()`, change the executor construction:

```typescript
const executor = new MetaPhaseExecutor({
  aggregate: this.phaseAggregate,
  artifactRepo: this.artifactRepo,
  runEntity: async (entity, ctx) => {
    if (entity.kind === 'workflow') return this.opts.runEntityForWorkflow(entity, ctx);
    return this.opts.runEntityForSubagent(entity, ctx);
  },
});
```

This activates the unused-field flagged in Phase C — drop the placeholder comment from Task 1 here too.

- [ ] **Step 5: Add a service-level test confirming artifact is created**

Add to `service.test.ts`:

```typescript
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
```

- [ ] **Step 6: Run all phase-executor + service tests**

```bash
pnpm --filter @my-claudia/server exec vitest run \
  src/domains/meta-workflow/__tests__/phase-executor.test.ts \
  src/domains/meta-workflow/__tests__/service.test.ts
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add server/src/domains/meta-workflow/phase-executor.ts \
        server/src/domains/meta-workflow/__tests__/phase-executor.test.ts \
        server/src/domains/meta-workflow/service.ts \
        server/src/domains/meta-workflow/__tests__/service.test.ts
git commit -m "feat(meta-workflow): write versioned artifacts on phase completion"
```

---

## Task 8: Stale Propagator Service

**Files:**
- Create: `server/src/domains/meta-workflow/stale-propagator.ts`
- Test: `server/src/domains/meta-workflow/__tests__/stale-propagator.test.ts`

Lazy + Soft algorithm:
- When phase A re-runs successfully (or with new artifact), find all phases in the same run whose `dependsOn` includes A's `phaseId`.
- For each direct downstream B:
  - If B.status === 'done' → call `phaseAggregate.markStale(B.id, sourcePhaseId=A.phaseId)`
  - If B.status === 'running' → DON'T abort; let it finish, then mark stale (Phase D MVP: skip — propagator is invoked when the upstream finishes, so it can mark any 'done' downstream; 'running' downstreams happen separately and will be picked up next propagation cycle).
  - Otherwise skip (pending phases naturally read fresh upstream artifacts).
- Also call `artifactRepo.markAllStaleForPhase(B.id)` to flip B's artifacts from 'active' to 'stale'.

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/stale-propagator.test.ts`

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

```typescript
// server/src/domains/meta-workflow/stale-propagator.ts
import type { PhasesDoc } from '@my-claudia/shared/features/meta-workflow';
import type { MetaWorkflowPhaseRepository } from './repositories/meta-workflow-phase-repository.js';
import type { MetaWorkflowArtifactRepository } from './repositories/meta-workflow-artifact-repository.js';
import type { MetaWorkflowPhaseAggregate } from './phase-aggregate.js';

export interface StalePropagatorOptions {
  phaseRepo: MetaWorkflowPhaseRepository;
  artifactRepo: MetaWorkflowArtifactRepository;
  phaseAggregate: MetaWorkflowPhaseAggregate;
}

export class StalePropagator {
  constructor(private opts: StalePropagatorOptions) {}

  /**
   * Lazy + Soft: when `sourcePhaseId` has finished a new run (with possibly
   * changed artifact), mark every DIRECT downstream phase that is currently
   * `done` as stale, and flip its artifacts active → stale. Pending downstreams
   * are skipped — they will naturally pick up the fresh upstream artifact
   * when they eventually run.
   */
  propagateUpstreamRerun(runId: string, sourcePhaseId: string, phasesDoc: PhasesDoc): void {
    const downstreamIds = phasesDoc.phases
      .filter((p) => p.dependsOn.includes(sourcePhaseId))
      .map((p) => p.id);

    for (const phaseId of downstreamIds) {
      const phaseRecord = this.opts.phaseRepo.findByRunAndPhaseId(runId, phaseId);
      if (!phaseRecord) continue;
      if (phaseRecord.status !== 'done') continue;

      this.opts.phaseAggregate.markStale(phaseRecord.id, sourcePhaseId);
      this.opts.artifactRepo.markAllStaleForPhase(phaseRecord.id);
    }
  }
}
```

- [ ] **Step 4: Run test**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/stale-propagator.test.ts`

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/meta-workflow/stale-propagator.ts \
        server/src/domains/meta-workflow/__tests__/stale-propagator.test.ts
git commit -m "feat(meta-workflow): add Lazy+Soft stale propagator"
```

---

## Task 9: Four User Actions on MetaWorkflowService

**Files:**
- Modify: `server/src/domains/meta-workflow/service.ts`
- Modify: `server/src/domains/meta-workflow/__tests__/service.test.ts`

Add four methods:
- `rerunPhase(runId, phaseId)` — re-runs the phase (after resetting stale to pending if applicable), then propagates stale to downstream
- `ignoreStale(runId, phaseId)` — clears the stale flag using `phaseAggregate.clearStale`
- `evaluateImpact(runId, phaseId)` — returns a recommendation `{ kind: 'rerun' | 'ignore' | 'minor-fix'; reason: string }`. Phase D MVP: heuristic based on number of changed lines in upstream commit (or a static "needs human judgment"). True AI-driven evaluation is Phase E.
- `cascadeRerun(runId, phaseId)` — reruns the phase AND every transitive downstream

Tests cover each.

- [ ] **Step 1: Write failing tests**

Add these tests to `service.test.ts`:

```typescript
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

  it('evaluateImpact returns a recommendation object', async () => {
    const run = service.createRun({ projectId: 'proj-1', title: 't' });
    service.submitRequirements(run.id, 'design/req.md');
    service.approveRequirements(run.id);
    service.setPhasesJson(run.id, samplePhasesJson);
    await service.runPhase(run.id, 'p1');

    const rec = await service.evaluateImpact(run.id, 'p1');
    expect(['rerun', 'ignore', 'minor-fix']).toContain(rec.kind);
    expect(typeof rec.reason).toBe('string');
  });
```

(Cascade-rerun would need a more complex phasesDoc with downstream phases; for Phase D MVP we'll defer the test to Task 11's integration test.)

- [ ] **Step 2: Run tests; see failures**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/service.test.ts`

Expected: 3 new tests fail.

- [ ] **Step 3: Add the methods to `MetaWorkflowService`**

In `server/src/domains/meta-workflow/service.ts`, add after the existing methods:

```typescript
import { StalePropagator } from './stale-propagator.js';

// In constructor, add:
// this.propagator = new StalePropagator({
//   phaseRepo: this.phaseRepo,
//   artifactRepo: this.artifactRepo,
//   phaseAggregate: this.phaseAggregate,
// });
//
// Add the field too:
// private propagator: StalePropagator;

  async rerunPhase(runId: string, phaseId: string): Promise<PhaseExecutionResult> {
    const phase = this.phaseRepo.findByRunAndPhaseId(runId, phaseId);
    if (!phase) throw new Error(`Phase not found: run=${runId} phase=${phaseId}`);
    if (phase.status === 'stale' || phase.status === 'failed') {
      this.phaseAggregate.resetToPending(phase.id);
    }
    const result = await this.runPhase(runId, phaseId);
    // Propagate stale to direct downstreams.
    const run = this.runRepo.findById(runId);
    if (run?.phasesJson) {
      const validation = validatePhasesJson(run.phasesJson);
      if (validation.ok) this.propagator.propagateUpstreamRerun(runId, phaseId, validation.doc);
    }
    return result;
  }

  ignoreStale(runId: string, phaseId: string) {
    const phase = this.phaseRepo.findByRunAndPhaseId(runId, phaseId);
    if (!phase) throw new Error(`Phase not found: run=${runId} phase=${phaseId}`);
    return this.phaseAggregate.clearStale(phase.id);
  }

  async evaluateImpact(_runId: string, _phaseId: string): Promise<{ kind: 'rerun' | 'ignore' | 'minor-fix'; reason: string }> {
    // Phase D MVP: a static recommendation. Phase E will compute a real
    // diff-based recommendation through an AI step.
    return {
      kind: 'rerun',
      reason: 'Upstream changed; defaulting to re-run. Detailed diff analysis lands in Phase E.',
    };
  }

  async cascadeRerun(runId: string, phaseId: string): Promise<PhaseExecutionResult[]> {
    const results: PhaseExecutionResult[] = [];
    const run = this.runRepo.findById(runId);
    if (!run?.phasesJson) throw new Error(`Run has no phasesJson`);
    const validation = validatePhasesJson(run.phasesJson);
    if (!validation.ok) throw new Error(`phasesJson invalid`);

    // Topological order from phaseId downward.
    const queue: string[] = [phaseId];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next || visited.has(next)) continue;
      visited.add(next);
      results.push(await this.rerunPhase(runId, next));
      const directDown = validation.doc.phases
        .filter((p) => p.dependsOn.includes(next))
        .map((p) => p.id);
      queue.push(...directDown);
    }
    return results;
  }
```

Don't forget to add `propagator: StalePropagator` as a class field and instantiate it in the constructor.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/service.test.ts`

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/meta-workflow/service.ts \
        server/src/domains/meta-workflow/__tests__/service.test.ts
git commit -m "feat(meta-workflow): add four stale-action methods (rerun / ignore / evaluate / cascade)"
```

---

## Task 10: Protocol Messages + WS Handlers for Stale Actions

**Files:**
- Modify: `shared/src/protocol/messages/meta-workflow.ts` (add 4 new ClientMessage interfaces)
- Modify: `shared/src/protocol/messages/index.ts` (extend ClientMessage union)
- Modify: `server/src/application/conversation/handlers/meta-workflow.ts` (4 new handlers)
- Modify: `server/src/application/conversation/handlers/__tests__/meta-workflow.test.ts` (4 new tests)

ClientMessages to add:
- `rerun_meta_workflow_phase` → `RerunMetaWorkflowPhaseMessage` (runId, phaseId)
- `ignore_meta_workflow_phase_stale` → `IgnoreMetaWorkflowPhaseStaleMessage`
- `evaluate_meta_workflow_phase_impact` → `EvaluateMetaWorkflowPhaseImpactMessage`
- `cascade_rerun_meta_workflow_phase` → `CascadeRerunMetaWorkflowPhaseMessage`

- [ ] **Step 1: Extend `shared/src/protocol/messages/meta-workflow.ts`**

Append after the existing 6 CRUD ClientMessages:

```typescript
// Client → Server: rerun a single phase (clears stale/failed first)
export interface RerunMetaWorkflowPhaseMessage {
  type: 'rerun_meta_workflow_phase';
  runId: string;
  phaseId: string;
}

// Client → Server: clear the stale flag on a phase
export interface IgnoreMetaWorkflowPhaseStaleMessage {
  type: 'ignore_meta_workflow_phase_stale';
  runId: string;
  phaseId: string;
}

// Client → Server: ask for an impact recommendation
export interface EvaluateMetaWorkflowPhaseImpactMessage {
  type: 'evaluate_meta_workflow_phase_impact';
  runId: string;
  phaseId: string;
}

// Client → Server: rerun a phase and all transitive downstreams
export interface CascadeRerunMetaWorkflowPhaseMessage {
  type: 'cascade_rerun_meta_workflow_phase';
  runId: string;
  phaseId: string;
}

// Server → Client: response to impact evaluation
export interface MetaWorkflowImpactRecommendationMessage {
  type: 'meta_workflow_impact_recommendation';
  runId: string;
  phaseId: string;
  recommendation: { kind: 'rerun' | 'ignore' | 'minor-fix'; reason: string };
}
```

- [ ] **Step 2: Wire all 5 into `shared/src/protocol/messages/index.ts`**

In the `ClientMessage` union (after the existing Meta Workflow group), add:

```typescript
  | RerunMetaWorkflowPhaseMessage
  | IgnoreMetaWorkflowPhaseStaleMessage
  | EvaluateMetaWorkflowPhaseImpactMessage
  | CascadeRerunMetaWorkflowPhaseMessage
```

In the `ServerMessage` union, append:

```typescript
  | MetaWorkflowImpactRecommendationMessage
```

Plus the import block updates for these new types.

- [ ] **Step 3: Add 4 new WS handlers**

In `server/src/application/conversation/handlers/meta-workflow.ts`, append:

```typescript
export async function handleRerunMetaWorkflowPhase(
  client: ConnectedClient,
  msg: RerunMetaWorkflowPhaseMessage,
  service: MetaWorkflowService,
): Promise<void> {
  try {
    const result = await service.rerunPhase(msg.runId, msg.phaseId);
    const run = service.getRun(msg.runId);
    if (run) broadcastPhase(client, run.projectId, msg.runId, result.phase);
  } catch (e) {
    sendError(client, e);
  }
}

export function handleIgnoreMetaWorkflowPhaseStale(
  client: ConnectedClient,
  msg: IgnoreMetaWorkflowPhaseStaleMessage,
  service: MetaWorkflowService,
): void {
  try {
    const phase = service.ignoreStale(msg.runId, msg.phaseId);
    const run = service.getRun(msg.runId);
    if (run) broadcastPhase(client, run.projectId, msg.runId, phase);
  } catch (e) {
    sendError(client, e);
  }
}

export async function handleEvaluateMetaWorkflowPhaseImpact(
  client: ConnectedClient,
  msg: EvaluateMetaWorkflowPhaseImpactMessage,
  service: MetaWorkflowService,
): Promise<void> {
  try {
    const recommendation = await service.evaluateImpact(msg.runId, msg.phaseId);
    send(client, {
      type: 'meta_workflow_impact_recommendation',
      runId: msg.runId,
      phaseId: msg.phaseId,
      recommendation,
    });
  } catch (e) {
    sendError(client, e);
  }
}

export async function handleCascadeRerunMetaWorkflowPhase(
  client: ConnectedClient,
  msg: CascadeRerunMetaWorkflowPhaseMessage,
  service: MetaWorkflowService,
): Promise<void> {
  try {
    const results = await service.cascadeRerun(msg.runId, msg.phaseId);
    const run = service.getRun(msg.runId);
    if (run) {
      for (const r of results) {
        broadcastPhase(client, run.projectId, msg.runId, r.phase);
      }
    }
  } catch (e) {
    sendError(client, e);
  }
}
```

- [ ] **Step 4: Add 4 handler tests**

Append tests to `server/src/application/conversation/handlers/__tests__/meta-workflow.test.ts`:

```typescript
  it('handleRerunMetaWorkflowPhase calls service.rerunPhase + broadcasts updated phase', async () => {
    const { client, sent } = makeClient();
    const service = {
      rerunPhase: vi.fn().mockResolvedValue({
        phase: { id: 'pr1', runId: 'r1', phaseId: 'p1', status: 'done', executeEntity: 'workflow',
                 phaseType: 'code-implement', attempt: 2, maxRetries: 3, createdAt: 0 },
        gateResults: [],
      }),
      getRun: vi.fn().mockReturnValue({ projectId: 'p' }),
    };
    await handleRerunMetaWorkflowPhase(client, {
      type: 'rerun_meta_workflow_phase', runId: 'r1', phaseId: 'p1',
    }, service as never);
    expect(service.rerunPhase).toHaveBeenCalledWith('r1', 'p1');
    expect(sent[0]).toMatchObject({ type: 'meta_workflow_phase_update', phase: { status: 'done' } });
  });

  it('handleIgnoreMetaWorkflowPhaseStale clears stale and broadcasts', () => {
    const { client, sent } = makeClient();
    const service = {
      ignoreStale: vi.fn().mockReturnValue({ id: 'pr1', status: 'done', executeEntity: 'workflow',
                                              runId: 'r1', phaseId: 'p1', phaseType: 'code-implement',
                                              attempt: 1, maxRetries: 3, createdAt: 0 }),
      getRun: vi.fn().mockReturnValue({ projectId: 'p' }),
    };
    handleIgnoreMetaWorkflowPhaseStale(client, {
      type: 'ignore_meta_workflow_phase_stale', runId: 'r1', phaseId: 'p1',
    }, service as never);
    expect(service.ignoreStale).toHaveBeenCalledWith('r1', 'p1');
    expect(sent[0]).toMatchObject({ type: 'meta_workflow_phase_update' });
  });

  it('handleEvaluateMetaWorkflowPhaseImpact returns recommendation message', async () => {
    const { client, sent } = makeClient();
    const service = {
      evaluateImpact: vi.fn().mockResolvedValue({ kind: 'rerun', reason: 'changed' }),
    };
    await handleEvaluateMetaWorkflowPhaseImpact(client, {
      type: 'evaluate_meta_workflow_phase_impact', runId: 'r1', phaseId: 'p1',
    }, service as never);
    expect(sent[0]).toMatchObject({
      type: 'meta_workflow_impact_recommendation',
      recommendation: { kind: 'rerun' },
    });
  });

  it('handleCascadeRerunMetaWorkflowPhase calls cascadeRerun and broadcasts each phase', async () => {
    const { client, sent } = makeClient();
    const service = {
      cascadeRerun: vi.fn().mockResolvedValue([
        { phase: { id: 'pr1', runId: 'r1', phaseId: 'p1', status: 'done', executeEntity: 'workflow',
                   phaseType: 'code-implement', attempt: 1, maxRetries: 3, createdAt: 0 }, gateResults: [] },
        { phase: { id: 'pr2', runId: 'r1', phaseId: 'p2', status: 'done', executeEntity: 'workflow',
                   phaseType: 'code-implement', attempt: 1, maxRetries: 3, createdAt: 0 }, gateResults: [] },
      ]),
      getRun: vi.fn().mockReturnValue({ projectId: 'p' }),
    };
    await handleCascadeRerunMetaWorkflowPhase(client, {
      type: 'cascade_rerun_meta_workflow_phase', runId: 'r1', phaseId: 'p1',
    }, service as never);
    expect(service.cascadeRerun).toHaveBeenCalledWith('r1', 'p1');
    expect(sent.length).toBe(2);
  });
```

- [ ] **Step 5: Update the bootstrap dispatcher (from Task 6)**

Add cases for the 4 new ClientMessage types in the WS message dispatcher (wherever Phase D Task 6 wired the 6 CRUD messages).

- [ ] **Step 6: Run tests + tsc**

```bash
pnpm --filter @my-claudia/shared exec vitest run src/features/__tests__/meta-workflow-protocol.test.ts
pnpm --filter @my-claudia/server exec vitest run src/application/conversation/handlers/__tests__/meta-workflow.test.ts
pnpm --filter @my-claudia/shared build
pnpm --filter @my-claudia/server exec tsc --noEmit
pnpm --filter @my-claudia/desktop exec tsc --noEmit
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add shared/src/protocol/messages/meta-workflow.ts \
        shared/src/protocol/messages/index.ts \
        server/src/application/conversation/handlers/meta-workflow.ts \
        server/src/application/conversation/handlers/__tests__/meta-workflow.test.ts
# Plus the bootstrap dispatcher file you edited
git commit -m "feat(meta-workflow): add 4 stale-action protocol messages + WS handlers"
```

---

## Task 11: Cross-Component Integration Test

**Files:**
- Create: `server/src/domains/meta-workflow/__tests__/integration-stale.test.ts`

A single test that exercises the full Phase D flow end-to-end without any HTTP/WS layer:
1. Create run.
2. Submit + approve requirements.
3. setPhasesJson with `[A, B(deps A), C(deps B)]`.
4. Run all three phases — all should complete.
5. Rerun A.
6. Verify B becomes stale (Lazy).
7. Rerun B (via rerunPhase).
8. Verify C also becomes stale (next-level lazy propagation).
9. cascadeRerun on B → both B and C re-run.

- [ ] **Step 1: Write the test**

```typescript
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
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/integration-stale.test.ts`

Expected: 2/2 pass. If `rerunPhase` doesn't reset properly through phase status machine (due to phase being in `done` state, not `stale`/`failed`), adapt `rerunPhase` to also accept `done → pending` transition; or add a `forceRerun` flag.

- [ ] **Step 3: Commit**

```bash
git add server/src/domains/meta-workflow/__tests__/integration-stale.test.ts
git commit -m "test(meta-workflow): cross-component integration test for stale + cascade"
```

---

## Task 12: Final Smoke + Tag

- [ ] **Step 1: Build all packages**

Run: `pnpm build`

Expected: clean.

- [ ] **Step 2: Run all meta-workflow tests**

```bash
pnpm --filter @my-claudia/server exec vitest run \
  src/domains/meta-workflow \
  src/application/conversation/handlers/__tests__/meta-workflow.test.ts \
  src/infrastructure/storage/migrations/__tests__/069_meta_workflow.test.ts

pnpm --filter @my-claudia/shared exec vitest run \
  src/features/__tests__/meta-workflow.test.ts \
  src/features/__tests__/meta-workflow-protocol.test.ts
```

Expected: ~170-180 tests pass (Phase C's 152 + Phase D's ~25 new).

- [ ] **Step 3: E2E programmatic smoke**

Adapt the Phase C smoke script to use Phase D's signature (no worktreePath argument; provide allocator instead). Run a 2-phase chain with rerun to verify stale propagation. Expected output should contain `Phase D smoke: PASS`.

- [ ] **Step 4: Tag**

```bash
git tag -a meta-workflow/phase-d-complete -m "Meta Workflow Phase D production wiring + stale propagation landed"
```

---

## Phase D Acceptance Criteria

- [ ] All 12 tasks complete and individually committed.
- [ ] `pnpm build` passes.
- [ ] All meta-workflow tests pass (~175 total).
- [ ] Phase A/B/C regression tests still pass.
- [ ] Programmatic smoke shows stale + cascade flow working.
- [ ] No regressions in pre-existing tests outside the meta-workflow scope.

---

## What Phase D Deliberately Leaves to Phase E+

| Item | Phase |
|------|-------|
| Real diff-based impact evaluation (AI-driven) | Phase E |
| True multi-turn autonomous subagent (subagent decides to continue) | Phase E |
| Proper worktree release semantics (tied to phase teardown, not pool recycling) | Phase E |
| EventDispatcher unsubscribe/off API | Phase E |
| All UI screens | Phase E |
| End-to-end smoke on real Java/TS project | Phase F |
| Persistent run worktree (workspace-level) vs per-phase worktree | Phase E |

---

*Plan version: 1 / 2026-05-18*
*Spec reference: `docs/design/supervisor-meta-workflow.zh-CN.md`*
*Phase A/B/C: complete (tags `meta-workflow/phase-{a,b,c}-complete`)*
