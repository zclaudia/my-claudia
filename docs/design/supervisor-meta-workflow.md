# Supervisor Meta Workflow

> Concise English version. Full design lives in `supervisor-meta-workflow.zh-CN.md`.

## Overview

**Meta Workflow** is a **second run mode** under MyClaudia Supervisor, sitting alongside the existing **Classic Change** (as described in `supervisor-spec-driven-workflow-v1`). The two modes **share the Supervisor navigation entry and project binding**; everything else — data model, state machine, runtime, UI cards — is **independent**.

The product value of Meta Workflow is **meta-programming for long-running project work**:

- a user's vague intent is automatically decomposed into a phase graph;
- each phase **dynamically generates** either a reusable workflow (DAG) or a subagent (prompt + tool set), driven by the engine;
- phases support re-entry, parallelism, and mechanical verification gates;
- generated entities flow into a **reuse pool** — future similar phases hit the pool before generating from scratch.

Meta Workflow does **not** replace Classic Change. It does **not** evolve `SupervisionTask` / `TaskExecution` / `task-prompt`. It opens a new mode next to them.

## Relationship to existing surfaces

```
Supervisor (entry, project binding, worktree, baseline)
  ├── Classic Change     (v1 mode, unchanged)
  └── Meta Workflow Run  (this document)
       │
       └── shares underlying: Workflow Runtime / Worktree Manager / Generator
```

Coexistence: a single project can host N Classic Changes + M Meta Workflow Runs at the same time; they don't see each other and arbitrate worktree contention through the shared pool.

## Four Core Capabilities

1. **Dynamic generation** — Each phase produces either a workflow (DAG) or a subagent at runtime; users don't author them.
2. **Reuse pool** — Generated entities are pooled. Before generation, a semantic search runs; on a hit the user can adopt the existing entity. Users can **promote** any auto-generated entity into the main tool list.
3. **Re-entry / partial execution** — Smoke path lets users prove the meta workflow skeleton first; phases are re-runnable; upstream changes mark direct downstream stale (Lazy + Soft).
4. **Mechanical verification** — Phase completion is decided by `acceptanceGates`: shell command + `expect` (exitCode / stdout / fileExists / ...). LLM review is advisory only.

## User Journey

```
[ + New ▾ ]
   ├─ Classic Change
   └─ Meta Workflow Run   ← entering here triggers the 5-stage flow
```

5-stage flow:

1. **Requirements** — dialog brainstorm → `design/requirements.md`; approve / reject / challenge loop with bounded reject count + escape hatch
2. **Decomposition** — single AI step writes `phases.json`; user can drag-edit the phase graph
3. **Execution** — each phase: `searching_reuse → generating → ready_to_run → running → verifying_gates → done | failed | stale`
4. **Re-entry / stale handling** — Lazy + Soft propagation; four user actions per stale phase
5. **Completion** — all phases done + no stale; user picks: merge / leave PR / archive

## Sub-Workflow Skeleton + Slot

When a phase's `executeEntity = 'workflow'`, the engine generates a workflow that **must** contain these five skeleton nodes in this order:

```
context_load → plan → execute → verify → commit
```

The skeleton is non-bypassable; the engine refuses to register a generated workflow that violates it. This encodes Superpowers' "evidence before assertion" discipline at the engine layer.

**Execute slot patterns**: `single-shot` / `multi-step` / `self-healing` (default for most code phases). Self-healing reuses the runtime's existing `loop` / `loop_exhausted` edges.

**Two layers of verify**: inner verify inside the self-healing loop is the LLM's self-correction feedback channel; outer verify slot runs `phase.acceptanceGates` and is the **only authoritative judgement**.

## Subagent as a First-Class Execute Entity

When a phase's `executeEntity = 'subagent'` (default for `investigation`), the engine generates an **independent conversation context + restricted tool set + termination condition**. Trade-offs:

| | Workflow | Subagent |
|---|---|---|
| Mid-state observable | Yes (per-node I/O) | No (long conversation) |
| User intervention mid-run | Yes | Only kill |
| Expressiveness | Bounded by step types | Any tool, any path |
| Reuse value | High (templates) | Medium (prompt+tools) |
| Debugging | Node-level trace | Full conversation log |

Subagents also flow into the reuse pool: `systemPrompt + allowedTools + terminationCondition` form a reusable "research template". Acceptance is still mechanical (e.g., "must produce `investigation-report.md`").

## Six phaseTypes

| phaseType | Use case | Default entity | Default pattern | Default plan | Verify focus |
|-----------|----------|---------------|-----------------|--------------|--------------|
| `code-implement` | New feature / interface / class | workflow | self-healing | on | compile + new tests + no regression |
| `code-refactor` | Behavior-preserving refactor | workflow | self-healing | on | **tests unchanged** + diff scope |
| `code-test-write` | Tests for existing impl | workflow | multi-step | off | new tests pass + coverage threshold |
| `design-doc` | API spec / contract docs | workflow | single-shot | off | doc non-empty + schema valid + user approve |
| `dep-update` | Dependency / build script changes | workflow | self-healing | on | build + tests + no new security alerts |
| `investigation` | Research / perf analysis | **subagent** | — | — | report file + user approve summary |

## `phases.json` Schema (essentials)

```typescript
interface PhaseDef {
  id: string;
  name: string;
  description: string;
  phaseType: 'code-implement' | 'code-refactor' | 'code-test-write'
           | 'design-doc' | 'dep-update' | 'investigation';
  executeEntity?: 'workflow' | 'subagent';
  dependsOn: string[];
  inputs:  { kind: 'commit' | 'file'; source: string; description?: string }[];
  outputs: { kind: 'commit' | 'file'; path?: string; description: string }[];
  acceptanceGates: {
    id: string;
    description: string;
    command: string;
    cwd?: string;
    expect: {
      exitCode?: number;
      stdoutMatches?: string;
      stderrMatches?: string;
      fileExists?: string[];
      fileNotExists?: string[];
      durationMaxMs?: number;
    };
  }[];
  executeConfig?: { pattern?, planRequired?, aiReviewBlocking?, maxLoopIterations?, maxSubagentTurns? };
  synthesizerProviderId?: string;    // see "Provider Selection Strategy" section
  runtimeProviderId?: string;
  worktreeStrategy?: 'isolated' | 'shared';
  estimatedComplexity?: 'small' | 'medium' | 'large';
}
```

Validation: JSON + schema match; `dependsOn` references exist; DAG acyclic; at least one root; `smokePath` is a valid path; every `acceptanceGate.command` non-empty; `phaseType` in enum.

## Stale Propagation (Lazy + Soft)

Upstream re-run marks **direct** downstream stale (lazy). Stale is a soft warning, never blocks. Running downstreams are **not aborted** — they finish, then get marked. Four user actions:

- **Re-run** — rerun this phase
- **Ignore stale** — clear the flag, status returns to done
- **Evaluate impact** — AI diff analysis emits a *recommendation* (advisory only)
- **Cascade re-run** — rerun self + all downstreams

Artifacts version-preserved: old commit stays; new run lands on a new commit; the artifact index tracks `{ phaseId, version, commitSha, status: 'active' | 'stale' }`.

## Provider Selection Strategy

Every AI invocation in Meta Workflow resolves its provider through a **three-tier fallback**, matching MyClaudia's existing `OrchestratorTask.providerId` / `ai_prompt step.providerId` model:

```
Run-level default provider   (chosen at Run creation)
  ↓ fallback if unset
Phase-level provider         (field on the PhaseDef in phases.json)
  ↓ fallback if unset
Node-level provider          (field inside the generated workflow/subagent definition)
```

**Synthesizer vs Runtime separation**. Each phase carries **two independent provider fields**:

```typescript
synthesizerProviderId?: string;   // used when generating the phase's execution entity
runtimeProviderId?: string;       // used when the entity actually runs (further overridable per node)
```

Rationale: generation is a one-shot high-value action; execution is repeated work. Common configuration: Opus for synthesis, Sonnet for runtime nodes.

**All AI invocation points and where their provider comes from**:

| Invocation point | Provider source |
|------------------|-----------------|
| Requirements dialog (stage 1) | Run-level default |
| Decomposition AI step (stage 2) | Run-level default |
| Synthesizing a sub-workflow / subagent | `Phase.synthesizerProviderId` → Run-level default |
| Sub-workflow nodes (`context_load` / `plan` / `execute` ai_prompts) | Node-level → `Phase.runtimeProviderId` → Run-level default |
| Verify-slot `ai_review` advisory | Node-level (defaults to `Phase.runtimeProviderId`) |
| Subagent execution | `Phase.runtimeProviderId` → Run-level default |
| Stale "Evaluate impact" diff analysis | Run-level default |
| Reuse-pool v2 embedding search | **Independent embedding provider config** (not under Run-level) |

**Reuse-pool entity provider preference**. When a phase hits the reuse pool, the entity's own provider preference is used as the default; the user can still override at phase level. This keeps "the original author's tuning" as a sensible default without being a hard constraint.

**Schema additions**:

```sql
meta_workflow_runs   ADD COLUMN default_provider_id TEXT;
meta_workflow_phases ADD COLUMN synthesizer_provider_id TEXT;
meta_workflow_phases ADD COLUMN runtime_provider_id     TEXT;
```

`meta_subagent_templates` and generated workflow definitions already carry provider fields inside their existing schemas.

## Reuse Pool (first-class)

Every auto-generated workflow / subagent enters the pool with default tags `auto-generated:run-{runId}:phase-{phaseId}`; not surfaced in the main tool list until **promoted** by the user. Promotion drops the `auto-*` tags and flips `sourceType: auto → user`. v1 search: tag filter + keyword (BM25). v2: embeddings (deferred).

Cleanup: unsplit auto-generated entities are archived 30 days after run completes; physical delete 60 days later.

## Data Model (new tables)

```sql
meta_workflow_runs        -- run-level container; tracks status, phases.json snapshot, smoke path, reject counter
meta_workflow_phases      -- per-phase record; status machine; references generated workflow/subagent id
meta_workflow_artifacts   -- versioned artifact index; commit SHA + gate results + AI review notes
meta_workflow_reuse_pool  -- shared pool for both workflows and subagents
meta_subagent_templates   -- subagent definitions (peer to WorkflowDefinition)
```

No mutations to `project_changes` / `supervision_tasks` / `change_execution_plans` etc. Meta Workflow only references `project_agents.id`.

## What's Shared from Underlying Infrastructure

Workflow Runtime, Workflow Generator (programmatic invocation), Worktree Manager / Pool, Conversation / Session, the `ai_prompt` / `shell` / `condition` / `loop` / `git_commit` step types — all directly reused.

**Not reused** (the firewall against re-merging with Supervision): `TaskExecution` / `TaskScheduler` / `TaskAggregate` / `task-prompt` / `ChangeExecutionPlan` lifecycle / Design-Execution-Acceptance Gate / `ReviewEngine`. Meta Workflow has its own equivalents in its own domain.

## Superpowers Discipline Folded into the Engine

| Ref | Discipline | Engine enforcement |
|-----|------------|-------------------|
| R1 | Per-phase checklist | PhaseDetail UI auto-generates a todo from the 5 skeleton nodes; engine forbids skipping nodes |
| R2 | Evidence before assertion (no LLM self-grading) | `AcceptanceGate.command + expect` mandatory; gate failure blocks commit |
| R3 | Per-phase context isolation | Each phase gets an independent conversation; run trunk only stores high-level decisions + artifact pointers |
| R4 | Search reuse pool before generating | `searching_reuse` state precedes `generating` |
| R5 | "Challenge" alongside approve/reject | Requirements approval and post-phase review surface a Challenge action; bounded by max-challenge counter |
| R6 | Multi-option finish | At `done`: proceed / leave stale / promote / discard. At run completion: merge / leave PR / archive |

## Rollout Phases (coarse)

- **A** — schema (5 new tables) + shared types + 6 phaseType template stubs
- **B** — meta-workflow domain: aggregates, synthesizers (workflow + subagent), phases.json validator, MetaPhaseExecutor
- **C** — reuse pool: repository + search (v1 tags+keyword) + promotion flow
- **D** — stale propagator + four user actions + artifact versioning
- **E** — UI: dropdown "New", RequirementsScreen, PhaseGraphScreen, PhaseBoardScreen, PhaseDetailScreen, PromotionDialog
- **F** — E2E: smoke-first on a small Java/TS project; stale propagation; reuse across two similar runs

Each phase ships with a smoke test and an independent PR.

## Open Questions

1. Whether Baseline plays a role in Meta Workflow (Classic Change uses it). Default: not in v1; investigation phases may reference baseline contents but no hard dependency.
2. Whether Meta Workflow Run and Classic Change can reference each other (e.g., a Classic Change invoking a Meta Workflow). Default: no, future work.
3. Who decides a subagent's `allowedTools`? Default: template + user-editable on promotion.
4. Per-phase conversation isolation: new `sessionId` per phase. Lean: yes.
5. Max parallel phases. Default: `MetaWorkflowConfig.maxParallelPhases = 3`, configurable.
6. Embedding model for v2 reuse search. Decide at implementation.
7. Need a global scheduler or self-tick? Lean: self-tick, avoid contention with Classic.
8. Going back to requirements analysis after some phases done — full stale or user-picked? Lean: user-picked (with AI impact analysis as guide).
9. `phases.json` history snapshots per run. Lean: small `meta_workflow_phases_history` table.
10. Subagent progress visualisation: stream + collapsed by default; user can expand.
11. Should `phaseType` templates preset a provider preference (e.g. Opus for `investigation`, Sonnet for `code-implement`)? Default: no presets in v1; rely on the Run-level default. Templates may suggest but not hard-code.
12. Should per-node provider override (each `ai_prompt` node) be surfaced as a UI editor in v1, or remain read-only with hand-edit via `phases.json`? Default: v1 read-only + hand-edit; build an editor when users actually need per-node tuning.

---

*Version: v1 / 2026-05-18*
*Authors: Claudia + zhvala*
*Related: `supervisor-spec-driven-workflow-v1.md` (Classic Change mode, coexists)*
