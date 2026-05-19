# Meta Workflow — Phase E2a: Critical Backend Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 3 Phase D MVP shortcuts with real implementations to make Meta Workflow actually useful:
1. `evaluateImpact` no longer returns static text — uses real artifact history + AI to produce variable, evidence-based recommendations.
2. Subagent termination is checked incrementally during the AI conversation stream (not only at `run_completed`) — investigation phases terminate as soon as the report file is produced.
3. Worktree is persisted per RUN (not per PHASE) — phases in the same run share filesystem state, so phase B can read phase A's commits.

**Architecture:** Three independent improvements; all touch existing Phase D code paths but add no new architectural concepts.
- `evaluateImpact` enhancement requires injecting `aiRunPort` into `MetaWorkflowService` (Phase D's service only sees runEntities). Real diff retrieval uses `execFile('git', ['log', '--oneline', `${prev}..${cur}`], { cwd })`, matching the pattern in `server/src/domains/supervision/task-runner.ts:222-230`.
- Subagent multi-turn improvement modifies `createRunVirtualClientFromAiRunPort` in-place to check termination on **every** `onMessage`, not just on the final `run_completed`.
- Persistent run worktree changes the `WorktreeAllocator` implementation in `server/src/application/bootstrap/meta-workflow-allocator.ts` to cache `runId → path` so all phases in a run share a slot.

**Tech Stack:** TypeScript, vitest, the existing `workflowAiRunPort` (Phase D Task 6 wiring), the existing `WorktreePool` (Phase D Task 4), Node's `child_process.execFile` via `util.promisify`.

**Spec reference:** `docs/design/supervisor-meta-workflow.zh-CN.md` (§6.6 Stale 传播 evaluateImpact, §6.5 子 workflow 调度).

**Phase D references:**
- `docs/impl/meta-workflow-phase-d-production-and-stale.md`
- Tag `meta-workflow/phase-d-complete`
- Latest commit: `f16a7c33` (AskUserQuestion refactor — does not interact)

---

## File Structure

```
server/src/domains/meta-workflow/
├── service.ts                                                     MODIFY (inject aiRunPort, real evaluateImpact)
├── run-entities/subagent-run-entity.ts                            MODIFY (incremental termination)
├── register.ts                                                    MODIFY (pass aiRunPort to service)
└── __tests__/
    ├── service.test.ts                                            MODIFY (new evaluateImpact test)
    └── subagent-run-entity.test.ts                                MODIFY (incremental termination test)

server/src/application/bootstrap/
└── meta-workflow-allocator.ts                                     MODIFY (persistent run worktree)

server/src/application/bootstrap/__tests__/                        NEW dir
└── meta-workflow-allocator.test.ts                                NEW

server/src/application/bootstrap/feature-domains.ts                MODIFY (pass aiRunPort into registerMetaWorkflow opts)
```

5 tasks total.

```
Task 1 — Inject aiRunPort into MetaWorkflowService (refactor)  ← needs no other E2a task
Task 2 — Real evaluateImpact AI implementation                  ← needs T1
Task 3 — Subagent incremental termination check                 ← independent
Task 4 — Persistent run worktree (allocator cache)              ← independent
Task 5 — Smoke + tag                                            ← final
```

---

## Task 1: Inject `aiRunPort` into `MetaWorkflowService`

**Files:**
- Modify: `server/src/domains/meta-workflow/service.ts` (constructor accepts optional aiRunPort)
- Modify: `server/src/domains/meta-workflow/register.ts` (pass aiRunPort to service)
- Modify: `server/src/application/bootstrap/feature-domains.ts` (the inline AiRunPort bridge in `registerMetaWorkflow` already exists from Phase D; just confirm it's piped through)

`MetaWorkflowService` currently doesn't have access to the AI run port — Task 2 needs it. This task is a small structural refactor.

- [ ] **Step 1: Add `aiRunPort?: AiRunPort` to `MetaWorkflowServiceOptions`**

In `server/src/domains/meta-workflow/service.ts`, find `MetaWorkflowServiceOptions`. Add the optional field:

```typescript
import type { AiRunPort } from './run-entities/subagent-run-entity.js';

export interface MetaWorkflowServiceOptions {
  db: Database;
  runEntityForWorkflow: RunEntity;
  runEntityForSubagent: RunEntity;
  worktreeAllocator: WorktreeAllocator;
  /** Optional — used by `evaluateImpact` once Task 2 lands. Service still works without it (static fallback). */
  aiRunPort?: AiRunPort;
}
```

`AiRunPort` is already exported from `subagent-run-entity.ts` (Phase D Task 3 commit `b84c50d8`).

No call-site changes needed for the service itself — the field is optional and Task 2 will reference `this.opts.aiRunPort` directly.

- [ ] **Step 2: Update `register.ts` to pipe `aiRunPort` through**

In `server/src/domains/meta-workflow/register.ts`, find the `new MetaWorkflowService({...})` call. Add `aiRunPort: opts.aiRunPort` to it:

```typescript
const service = new MetaWorkflowService({
  db: opts.db,
  runEntityForWorkflow,
  runEntityForSubagent,
  worktreeAllocator: opts.worktreeAllocator,
  aiRunPort: opts.aiRunPort,
});
```

`opts.aiRunPort` is the existing required field on `RegisterMetaWorkflowOptions` (Phase D Task 5).

- [ ] **Step 3: Verify `feature-domains.ts` passes the inline `aiRunPort` bridge through to register**

Open `server/src/application/bootstrap/feature-domains.ts`. The `registerMetaWorkflow({...})` call already passes `aiRunPort` (Phase D Task 6 wiring at `feature-domains.ts:378` area). Verify the inline bridge object IS being passed; no change needed if so. If for some reason Phase D's wiring didn't reach the bridge here, fix it by adding `aiRunPort` to the call.

- [ ] **Step 4: Verify all existing tests still pass**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow src/application/conversation/handlers/__tests__/meta-workflow.test.ts`

Expected: all green (no behavior change yet — only an optional field added).

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/meta-workflow/service.ts \
        server/src/domains/meta-workflow/register.ts \
        server/src/application/bootstrap/feature-domains.ts
git commit -m "refactor(meta-workflow): inject aiRunPort into MetaWorkflowService"
```

---

## Task 2: Real AI-Driven `evaluateImpact`

**Files:**
- Modify: `server/src/domains/meta-workflow/service.ts` (rewrite `evaluateImpact`)
- Modify: `server/src/domains/meta-workflow/__tests__/service.test.ts` (cover new behavior)

Phase D's `evaluateImpact` returns a constant `{ kind: 'rerun', reason: '...Phase E' }`. Phase E2a uses **artifact history + AI** to produce variable recommendations:

1. Locate the phase record by `(runId, phaseId)`.
2. Find upstream phase: `phase.staleSourcePhaseId` (the phaseId of whatever upstream caused this phase to go stale). If missing, fall back to "rerun" with descriptive reason.
3. Look up upstream's artifact history: `artifactRepo.findByPhase(upstreamPhase.id)` returns records sorted by version DESC. Take the top 2 (current = [0], previous = [1]).
4. If fewer than 2 artifacts exist (upstream never re-ran), fall back to "rerun" with reason "no prior upstream version".
5. Build a structured prompt with the upstream + downstream phase metadata and the two commit SHAs.
6. Call `aiRunPort.startVirtualRun({ input: prompt, onMessage, workingDirectory: undefined, providerId: opts.defaultProviderId })`. Collect content. Wait for `run_completed` or timeout (60 s).
7. Parse response — expect JSON `{ kind: 'rerun' | 'ignore' | 'minor-fix', reason: string }`. If parsing fails, fall back to "rerun" with reason "AI returned unparseable response (raw: …)".

The git diff itself is **out of scope for Phase E2a MVP** — the AI gets commit SHAs + textual descriptions but not the raw diff. Phase E2b/c can add `execFile('git', ['log', ...])` to retrieve actual content. The commit SHAs alone give the AI enough context to reason about "did anything actually change?" since identical SHAs ⇒ no change.

- [ ] **Step 1: Add the new test**

In `service.test.ts`, replace the existing `evaluateImpact returns a recommendation object` test (which only checks `['rerun', 'ignore', 'minor-fix'].includes(rec.kind)`) with these two:

```typescript
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
```

- [ ] **Step 2: Run test, see failures**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/service.test.ts`

Expected: 3 new tests fail.

- [ ] **Step 3: Rewrite `evaluateImpact` in `service.ts`**

Replace the existing `evaluateImpact` body with:

```typescript
async evaluateImpact(
  runId: string,
  phaseId: string,
): Promise<{ kind: 'rerun' | 'ignore' | 'minor-fix'; reason: string }> {
  const phase = this.phaseRepo.findByRunAndPhaseId(runId, phaseId);
  if (!phase) throw new Error(`Phase not found: run=${runId} phase=${phaseId}`);

  if (!this.opts.aiRunPort) {
    return {
      kind: 'rerun',
      reason: 'No aiRunPort configured — defaulting to re-run (static fallback).',
    };
  }

  // Find upstream phase + its two latest artifacts.
  const upstreamPhaseId = phase.staleSourcePhaseId;
  if (!upstreamPhaseId) {
    return {
      kind: 'rerun',
      reason: 'No staleSourcePhaseId recorded — defaulting to re-run.',
    };
  }
  const upstreamPhase = this.phaseRepo.findByRunAndPhaseId(runId, upstreamPhaseId);
  if (!upstreamPhase) {
    return {
      kind: 'rerun',
      reason: `Upstream phase ${upstreamPhaseId} not found — defaulting to re-run.`,
    };
  }
  const upstreamArtifacts = this.artifactRepo.findByPhase(upstreamPhase.id);
  if (upstreamArtifacts.length < 2) {
    return {
      kind: 'rerun',
      reason: 'Upstream has fewer than 2 artifact versions — no prior to compare against.',
    };
  }
  const currentSha = upstreamArtifacts[0].commitSha ?? '(no commit)';
  const previousSha = upstreamArtifacts[1].commitSha ?? '(no commit)';
  if (currentSha === previousSha) {
    return {
      kind: 'ignore',
      reason: 'Upstream re-ran but produced the same commit — no impact.',
    };
  }

  // Build prompt + call AI.
  const prompt = [
    `You are an impact-analysis assistant for a Meta Workflow run.`,
    `Phase ${phase.phaseId} (type ${phase.phaseType}) is currently STALE because its upstream phase ${upstreamPhase.phaseId} (type ${upstreamPhase.phaseType}) was re-run.`,
    `Upstream's previous commit: ${previousSha}`,
    `Upstream's current commit:  ${currentSha}`,
    ``,
    `Decide whether the downstream phase should be re-run, ignored, or only requires a minor fix.`,
    `Reply with a single JSON object on its own line, exactly: {"kind":"rerun"|"ignore"|"minor-fix","reason":"<short reason>"}`,
    `Do not add any other text before or after the JSON.`,
  ].join('\n');

  let collected = '';
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), 60_000);
    this.opts.aiRunPort!.startVirtualRun({
      input: prompt,
      onMessage: (m) => {
        if (m.content) collected += m.content;
        if (m.kind === 'run_completed' || m.kind === 'completed' || m.kind === 'final') {
          clearTimeout(timer);
          resolve();
        }
      },
    }).catch(() => {
      clearTimeout(timer);
      resolve();
    });
  });

  // Try to extract JSON.
  const match = collected.match(/\{[^{}]*"kind"\s*:\s*"(rerun|ignore|minor-fix)"[^{}]*\}/);
  if (!match) {
    return {
      kind: 'rerun',
      reason: `AI returned unparseable response (raw: ${collected.slice(0, 200) || '(empty)'})`,
    };
  }
  try {
    const parsed = JSON.parse(match[0]) as { kind: 'rerun' | 'ignore' | 'minor-fix'; reason: string };
    if (typeof parsed.reason !== 'string' || parsed.reason.length === 0) {
      throw new Error('reason missing');
    }
    return parsed;
  } catch {
    return {
      kind: 'rerun',
      reason: `AI returned unparseable response (raw: ${collected.slice(0, 200)})`,
    };
  }
},
```

- [ ] **Step 4: Run tests; verify green**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/service.test.ts`

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/meta-workflow/service.ts \
        server/src/domains/meta-workflow/__tests__/service.test.ts
git commit -m "feat(meta-workflow): real AI-driven evaluateImpact using artifact history"
```

---

## Task 3: Subagent Incremental Termination Check

**Files:**
- Modify: `server/src/domains/meta-workflow/run-entities/subagent-run-entity.ts` (`createRunVirtualClientFromAiRunPort`)
- Modify: `server/src/domains/meta-workflow/__tests__/subagent-run-entity.test.ts` (new test for incremental termination)

Phase D's adapter only finishes when an `onMessage` event matches `COMPLETED_KINDS` (`run_completed | completed | final`). If the AI produces the report file at turn 3 of 30, Phase D still waits until the SDK conversation ends naturally (could be 5+ more turns of irrelevant chatter). Phase E2a checks termination on **every** `onMessage`:

- If `args.terminationCondition.kind === 'output-file'`: check `existsSync(args.cwd + cond.target)` after every message
- If `args.terminationCondition.kind === 'output-keyword'`: check `collected.includes(cond.target)` after every message

If either matches, finish early with `{ ok: true, output: collected }`.

Phase E2a does **not** terminate the SDK conversation when finishing early — the AI may continue running until naturally completing. The adapter just resolves its own Promise; the caller (`MetaPhaseExecutor`) moves on.

**Subtle change**: this means `createRunVirtualClientFromAiRunPort` must accept the termination condition (currently it doesn't — only the subagent template does, and we don't pass it through). The function signature needs to evolve.

Looking at the current code: the `RunVirtualClient` callable takes `VirtualClientArgs` which already has `terminationCondition` … wait, let me re-check.

Actually `VirtualClientArgs` has `systemPrompt`, `allowedTools`, `maxTurns`, `cwd` only — no `terminationCondition`. The `terminationCondition` is on `MetaSubagentTemplate`. The `createSubagentRunEntity` (different function) reads it from the template. The `createRunVirtualClientFromAiRunPort` (the adapter) doesn't see it.

For incremental termination check to work, the **caller** of `runVirtualClient` (which is `createSubagentRunEntity`) needs to push the termination condition INTO the args. We'll:

1. Add `terminationCondition?: MetaSubagentTerminationCondition` to `VirtualClientArgs`.
2. Have `createSubagentRunEntity` pass `subagent.terminationCondition` in the args.
3. Have `createRunVirtualClientFromAiRunPort` check the condition incrementally.

This is the right place for the change because the AI port adapter is what knows about the conversation stream.

- [ ] **Step 1: Add the failing test**

In `subagent-run-entity.test.ts`, append (after the existing 9 tests):

```typescript
describe('createRunVirtualClientFromAiRunPort — incremental termination', () => {
  it('resolves ok=true early when output-file appears mid-conversation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'subagent-incr-'));
    let messagesSent = 0;
    const startVirtualRun = vi.fn().mockImplementation(async (input: { onMessage?: (m: { kind: string; content?: string }) => void }) => {
      input.onMessage?.({ kind: 'assistant_message', content: 'thinking...' });
      messagesSent += 1;
      // create the report file mid-conversation
      writeFileSync(join(dir, 'report.md'), 'done');
      input.onMessage?.({ kind: 'assistant_message', content: 'wrote report' });
      messagesSent += 1;
      // simulate that more messages follow (which we should ignore once terminated)
      input.onMessage?.({ kind: 'tool_use', content: 'still chatting' });
      messagesSent += 1;
      // The adapter should resolve before run_completed fires.
    });
    const runVirtualClient = createRunVirtualClientFromAiRunPort({
      aiRunPort: { startVirtualRun } as never,
      timeoutMs: 1000,
    });
    const result = await runVirtualClient({
      systemPrompt: 'investigate',
      allowedTools: ['Read'],
      maxTurns: 30,
      cwd: dir,
      terminationCondition: { kind: 'output-file', target: 'report.md' },
    });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('thinking');
    expect(messagesSent).toBe(3);  // all 3 events fired before we resolved
  });

  it('resolves ok=true early when output-keyword appears mid-conversation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'subagent-incr-'));
    const startVirtualRun = vi.fn().mockImplementation(async (input: { onMessage?: (m: { kind: string; content?: string }) => void }) => {
      input.onMessage?.({ kind: 'assistant_message', content: 'still thinking' });
      input.onMessage?.({ kind: 'assistant_message', content: '[INVESTIGATION_COMPLETE]' });
    });
    const runVirtualClient = createRunVirtualClientFromAiRunPort({
      aiRunPort: { startVirtualRun } as never,
      timeoutMs: 1000,
    });
    const result = await runVirtualClient({
      systemPrompt: 'investigate',
      allowedTools: ['Read'],
      maxTurns: 30,
      cwd: dir,
      terminationCondition: { kind: 'output-keyword', target: '[INVESTIGATION_COMPLETE]' },
    });
    expect(result.ok).toBe(true);
  });

  it('still resolves at run_completed when no terminationCondition supplied', async () => {
    // Backward compatibility — Phase D callers that don't pass terminationCondition still work.
    const startVirtualRun = vi.fn().mockImplementation(async (input: { onMessage?: (m: { kind: string; content?: string }) => void }) => {
      input.onMessage?.({ kind: 'assistant_message', content: 'hi' });
      input.onMessage?.({ kind: 'run_completed' });
    });
    const runVirtualClient = createRunVirtualClientFromAiRunPort({
      aiRunPort: { startVirtualRun } as never,
      timeoutMs: 1000,
    });
    const result = await runVirtualClient({
      systemPrompt: 'p', allowedTools: [], maxTurns: 5, cwd: '/tmp',
    });
    expect(result.ok).toBe(true);
  });
});
```

You will also need to add `terminationCondition?: MetaSubagentTerminationCondition` to the `VirtualClientArgs` type — see Step 3.

- [ ] **Step 2: Run test, see failures**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/subagent-run-entity.test.ts`

Expected: first 2 of the 3 new tests fail (`terminationCondition` type missing + no incremental check).

- [ ] **Step 3: Add `terminationCondition` to `VirtualClientArgs` and implement incremental check**

Open `server/src/domains/meta-workflow/run-entities/subagent-run-entity.ts`. Modify `VirtualClientArgs`:

```typescript
import { existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';

export interface VirtualClientArgs {
  systemPrompt: string;
  allowedTools: string[];
  maxTurns: number;
  cwd: string;
  /** Optional — when supplied, the adapter resolves as soon as it's met. */
  terminationCondition?: MetaSubagentTerminationCondition;
}
```

`MetaSubagentTerminationCondition` is already imported from `@my-claudia/shared/features/meta-workflow`.

Modify `createRunVirtualClientFromAiRunPort` to check incrementally:

```typescript
export function createRunVirtualClientFromAiRunPort(
  opts: CreateRunVirtualClientFromAiRunPortOptions,
): RunVirtualClient {
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  return async (args: VirtualClientArgs): Promise<VirtualClientResult> => {
    let collected = '';
    let resolved = false;

    const checkTermination = (): boolean => {
      const cond = args.terminationCondition;
      if (!cond) return false;
      if (cond.kind === 'output-file') {
        const p = isAbsolute(cond.target) ? cond.target : join(args.cwd, cond.target);
        return existsSync(p);
      }
      if (cond.kind === 'output-keyword') {
        return collected.includes(cond.target);
      }
      return false;
    };

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
          // Phase E2a: check termination on every message, not just completion.
          if (checkTermination()) {
            finish(true);
            return;
          }
          if (COMPLETED_KINDS.has(m.kind)) finish(true);
        },
      }).catch(() => finish(false));
    });

    const ok = await completion;
    return ok ? { ok: true, output: collected } : { ok: false };
  };
}
```

Also update `createSubagentRunEntity` to forward the termination condition into `VirtualClientArgs`:

```typescript
export function createSubagentRunEntity(opts: CreateSubagentRunEntityOptions): RunEntity {
  return async (entity: SynthesizedEntity, ctx): Promise<RunEntityOutcome> => {
    if (entity.kind !== 'subagent') {
      throw new Error(`subagent run-entity received non-subagent kind: ${entity.kind}`);
    }
    const tmpl = entity.subagent;
    const result = await opts.runVirtualClient({
      systemPrompt: tmpl.systemPrompt,
      allowedTools: tmpl.allowedTools,
      maxTurns: tmpl.maxTurns,
      cwd: ctx.worktreePath,
      terminationCondition: tmpl.terminationCondition,
    });
    if (!result.ok) return { exitOk: false };
    return { exitOk: checkTermination(tmpl, ctx.worktreePath, result.output) };
  };
}
```

(`checkTermination` is the existing helper for the post-completion check; keep it because the runtime adapter may resolve without the termination condition being met — e.g., on `run_completed` from a non-AI port stub — and we still need to verify before declaring success.)

- [ ] **Step 4: Add `writeFileSync` import to the test file**

In `subagent-run-entity.test.ts`'s import block (top of file), if `writeFileSync` is not already imported, add it:

```typescript
import { mkdtempSync, writeFileSync } from 'node:fs';
```

- [ ] **Step 5: Run tests; verify 12/12 pass (9 existing + 3 new)**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/subagent-run-entity.test.ts`

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add server/src/domains/meta-workflow/run-entities/subagent-run-entity.ts \
        server/src/domains/meta-workflow/__tests__/subagent-run-entity.test.ts
git commit -m "feat(meta-workflow): subagent terminates incrementally when output condition met"
```

---

## Task 4: Persistent Run Worktree

**Files:**
- Modify: `server/src/application/bootstrap/meta-workflow-allocator.ts`
- Create: `server/src/application/bootstrap/__tests__/meta-workflow-allocator.test.ts`

Phase D's allocator calls `pool.acquire('meta-${runId}-${phaseId}', attempt)` — distinct taskId per phase. Result: each phase gets its own worktree slot, no shared state. Phase E2a: cache `runId → path` so all phases in a run share one slot.

Per research, `WorktreePool.acquire(sameTaskId, attempt)` will reuse the slot only if the previous one wasn't released; in practice it grabs the FIRST FREE slot, ignoring taskId. So we must cache at the allocator layer, not rely on the pool.

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/application/bootstrap/__tests__/meta-workflow-allocator.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createWorktreeAllocatorFromSupervisor } from '../meta-workflow-allocator.js';

describe('meta-workflow-allocator persistent per-run worktree', () => {
  it('returns the same path for two acquires with the same runId', async () => {
    const acquireMock = vi.fn().mockResolvedValue('/tmp/worktree-slot-1');
    const ensurePoolInitMock = vi.fn().mockResolvedValue(undefined);
    const supervisorService = {
      getWorktreePoolIfExists: vi.fn().mockReturnValue({
        acquire: acquireMock,
        ensurePoolInitialized: ensurePoolInitMock,
      }),
    };
    const allocator = createWorktreeAllocatorFromSupervisor(supervisorService as never, 'proj-1');

    const p1 = await allocator.acquire({ runId: 'run-A', phaseId: 'p1', attempt: 1 });
    const p2 = await allocator.acquire({ runId: 'run-A', phaseId: 'p2', attempt: 1 });
    expect(p1).toBe('/tmp/worktree-slot-1');
    expect(p2).toBe('/tmp/worktree-slot-1');
    expect(acquireMock).toHaveBeenCalledOnce();
  });

  it('returns different paths for different runIds', async () => {
    let counter = 0;
    const acquireMock = vi.fn().mockImplementation(async () => `/tmp/slot-${++counter}`);
    const supervisorService = {
      getWorktreePoolIfExists: vi.fn().mockReturnValue({
        acquire: acquireMock,
        ensurePoolInitialized: vi.fn().mockResolvedValue(undefined),
      }),
    };
    const allocator = createWorktreeAllocatorFromSupervisor(supervisorService as never, 'proj-1');

    const a = await allocator.acquire({ runId: 'run-A', phaseId: 'p1', attempt: 1 });
    const b = await allocator.acquire({ runId: 'run-B', phaseId: 'p1', attempt: 1 });
    expect(a).not.toBe(b);
    expect(acquireMock).toHaveBeenCalledTimes(2);
  });

  it('release is a no-op (Phase E2a does not release per-phase)', async () => {
    const supervisorService = {
      getWorktreePoolIfExists: vi.fn().mockReturnValue({
        acquire: vi.fn().mockResolvedValue('/tmp/slot'),
        ensurePoolInitialized: vi.fn().mockResolvedValue(undefined),
      }),
    };
    const allocator = createWorktreeAllocatorFromSupervisor(supervisorService as never, 'proj-1');
    await allocator.acquire({ runId: 'run-A', phaseId: 'p1', attempt: 1 });
    await expect(allocator.release('/tmp/slot')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test, see failures**

Run: `pnpm --filter @my-claudia/server exec vitest run src/application/bootstrap/__tests__/meta-workflow-allocator.test.ts`

Expected: first test fails (`acquireMock` is called twice, paths differ).

- [ ] **Step 3: Add the per-run cache to the allocator**

Open `server/src/application/bootstrap/meta-workflow-allocator.ts`. Modify `createWorktreeAllocatorFromSupervisor` (or whatever the exported function is — Phase D Task 6 named it this way). Wrap with a `Map<runId, Promise<string>>` to:
- Prevent duplicate acquire calls for same runId (use Promise so concurrent acquires await the same in-flight call)
- Return cached path for subsequent acquires

```typescript
// (preserve existing imports)
import type { WorktreeAllocator } from '../../domains/meta-workflow/service.js';

export function createWorktreeAllocatorFromSupervisor(
  supervisorService: { getWorktreePoolIfExists: (projectId: string) => undefined | { acquire: (taskId: string, attempt: number) => Promise<string>; ensurePoolInitialized: (projectId: string) => Promise<void> } },
  projectId: string,
): WorktreeAllocator {
  // Phase E2a: persistent per-run worktree — all phases in the same run share one slot.
  const pathByRun = new Map<string, Promise<string>>();

  return {
    async acquire({ runId, phaseId, attempt }) {
      const existing = pathByRun.get(runId);
      if (existing) return existing;
      const pool = supervisorService.getWorktreePoolIfExists(projectId);
      if (!pool) {
        throw new Error(`Worktree pool for project ${projectId} not initialized`);
      }
      const acquirePromise = (async () => {
        await pool.ensurePoolInitialized(projectId);
        return pool.acquire(`meta-${runId}`, attempt);
      })();
      pathByRun.set(runId, acquirePromise);
      try {
        return await acquirePromise;
      } catch (e) {
        // Allow retry on next acquire
        pathByRun.delete(runId);
        throw e;
      }
    },
    async release(_path) {
      // Phase E2a: release is a no-op per phase. Run-level release lands in
      // Phase E2b/F when phase teardown is wired (currently the pool slot
      // recycles naturally when the supervisor task completes).
    },
  };
}
```

> **NOTE**: The exact signature of `getWorktreePoolIfExists` here is approximated. Read the current `meta-workflow-allocator.ts` to get the real type and adapt. If Phase D's allocator used different parameter names, preserve them.

- [ ] **Step 4: Run test; verify all 3 pass**

Run: `pnpm --filter @my-claudia/server exec vitest run src/application/bootstrap/__tests__/meta-workflow-allocator.test.ts`

Expected: green.

- [ ] **Step 5: Run full meta-workflow regression to make sure cross-component flows still work**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow`

Expected: all green (the allocator change is internal to bootstrap; existing tests stub their own allocator so they're unaffected).

- [ ] **Step 6: Commit**

```bash
git add server/src/application/bootstrap/meta-workflow-allocator.ts \
        server/src/application/bootstrap/__tests__/meta-workflow-allocator.test.ts
git commit -m "feat(meta-workflow): persistent per-run worktree (allocator caches runId→path)"
```

---

## Task 5: Smoke + Tag

- [ ] **Step 1: Build**

Run: `pnpm build`

Expected: all 4 packages clean.

- [ ] **Step 2: Run all meta-workflow tests**

Run:
```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow src/application/conversation/handlers/__tests__/meta-workflow.test.ts src/application/bootstrap/__tests__/meta-workflow-allocator.test.ts
pnpm --filter @my-claudia/shared exec vitest run src/features/__tests__/meta-workflow.test.ts src/features/__tests__/meta-workflow-protocol.test.ts
```

Expected: all green. Approximate counts: Phase D's 170 + 3 new allocator tests + 3 new evaluateImpact tests + 3 new incremental termination tests = ~180.

- [ ] **Step 3: Quick programmatic smoke that exercises the new evaluateImpact path**

```bash
cd /Users/haozhang/SourceCode/zhvala/my-claudia && node --input-type=module -e "
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrations } from './server/dist/infrastructure/storage/migrations/index.js';
import { MetaWorkflowService } from './server/dist/domains/meta-workflow/service.js';

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
for (const m of migrations) {
  try { db.exec(m.sql); } catch (e) {
    if (m.idempotent && /duplicate column|already exists/i.test(e.message)) continue;
    throw e;
  }
}
db.prepare(\"INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)\")
  .run('proj-1', 'Smoke', 'code', 0, 0);

const workdir = mkdtempSync(join(tmpdir(), 'phase-e2a-smoke-'));
const aiCalls = [];
const service = new MetaWorkflowService({
  db,
  runEntityForWorkflow: async () => ({ exitOk: true }),
  runEntityForSubagent: async () => ({ exitOk: true }),
  worktreeAllocator: { acquire: async () => workdir, release: async () => {} },
  aiRunPort: {
    startVirtualRun: async (args) => {
      aiCalls.push(args.input.slice(0, 80));
      args.onMessage?.({ kind: 'assistant', content: '{\"kind\":\"minor-fix\",\"reason\":\"Only a comment changed.\"}' });
      args.onMessage?.({ kind: 'run_completed' });
    },
  },
});

const run = service.createRun({ projectId: 'proj-1', title: 'E2a smoke' });
service.submitRequirements(run.id, 'design/req.md');
service.approveRequirements(run.id);
service.setPhasesJson(run.id, JSON.stringify({
  version: '1',
  phases: [
    { id: 'A', name: 'A', description: '', phaseType: 'code-implement', dependsOn: [], inputs: [],
      outputs: [{kind:'commit',description:'a'}],
      acceptanceGates: [{id:'g',description:'g',command:'true',expect:{exitCode:0}}] },
  ],
  smokePath: ['A'],
  metadata: { generatedAt: 0, requirementsPath: 'design/req.md' },
}));
await service.runPhase(run.id, 'A');

// Force phase A into stale state with itself as source + add a 2nd artifact version.
const phase = service.listPhases(run.id)[0];
db.prepare(\"UPDATE meta_workflow_phases SET status='stale', stale_source_phase_id='A' WHERE id=?\").run(phase.id);
db.prepare(\"INSERT INTO meta_workflow_artifacts (id, phase_record_id, version, commit_sha, status, created_at) VALUES (?, ?, ?, ?, ?, ?)\")
  .run('art-extra', phase.id, 99, 'sha-current', 'active', Date.now());

const rec = await service.evaluateImpact(run.id, 'A');
console.log('Recommendation:', rec);
if (rec.kind !== 'minor-fix') { console.error('Expected minor-fix from AI'); process.exit(1); }
if (aiCalls.length !== 1) { console.error('Expected 1 AI call'); process.exit(1); }
console.log('Phase E2a smoke: PASS');
"
```

Expected output: `Recommendation: { kind: 'minor-fix', reason: 'Only a comment changed.' }` followed by `Phase E2a smoke: PASS`.

- [ ] **Step 4: Tag**

```bash
git tag -a meta-workflow/phase-e2a-complete -m "Meta Workflow Phase E2a critical backend hardening landed"
```

---

## Phase E2a Acceptance Criteria

- [ ] All 5 tasks complete and individually committed.
- [ ] `pnpm build` passes.
- [ ] All meta-workflow tests pass (~180 total).
- [ ] Phase A-E1 regression tests still pass.
- [ ] Programmatic smoke shows AI-driven recommendation.

---

## What Phase E2a Deliberately Leaves to Phase E2b / E2c / F

| Item | Phase |
|------|-------|
| Real `git log/diff` retrieval (currently AI only sees commit SHAs as text) | E2b |
| WorktreeAllocator real release semantics (tied to run cancel/complete) | E2b |
| `EventDispatcher.off()` API | E2b |
| Drag-edit on PhaseGraphScreen | E2c |
| Sub-workflow run viewer embedded in PhaseDetail | E2c |
| Reuse-pool browser screen | E2c |
| Design polish (shadcn / MyClaudia UI kit) | E2c |
| Vitest tests for Phase E1 screen components | E2c |
| End-to-end smoke on a real Java/TS project | F |

---

*Plan version: 1 / 2026-05-19*
*Phase A-E1 + WIP fixes: complete (latest commit `f16a7c33`)*
