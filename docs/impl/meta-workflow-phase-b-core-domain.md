# Meta Workflow — Phase B: Core Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core meta-workflow domain logic on top of Phase A's schema and types — repositories, aggregates with state-machine guards, phases.json validator, workflow/subagent synthesizers, acceptance-gate runner, and the orchestrating `MetaPhaseExecutor`. Phase B's deliverable is "a single `code-implement` phase can be driven end-to-end by code (not yet by UI)".

**Architecture:** Repositories extend `BaseRepository<T,Create,Update>` (matching project pattern). Aggregates wrap repositories + a status-machine module that enforces legal transitions. The `MetaPhaseExecutor` is the orchestrator: it looks up a phase, invokes the appropriate synthesizer (workflow or subagent), drives execution through the existing Workflow Runtime, runs `acceptanceGates` via `gate-runner`, then transitions the phase to done or failed. Phase B introduces no HTTP routes and no UI — just programmatic surface.

**Tech Stack:** TypeScript, better-sqlite3, Vitest, the existing `WorkflowGeneratorService` and Workflow Runtime, Node.js `child_process` for gate command execution. **No new external dependencies** (validator is hand-written; no zod / typebox added).

**Spec reference:** `docs/design/supervisor-meta-workflow.zh-CN.md` (sections "核心抽象详解" + "数据模型" + "Provider 选择策略").

**Phase A reference:** `docs/impl/meta-workflow-phase-a-foundation.md`; commits `30dc4e5d` through `aa0b58fb`.

---

## File Structure

```
server/src/domains/meta-workflow/
├── index.ts                                          MODIFY (export new modules)
├── status-machine.ts                                 NEW (run + phase transitions)
├── repositories/
│   ├── meta-workflow-run-repository.ts               NEW
│   ├── meta-workflow-phase-repository.ts             NEW
│   └── meta-workflow-artifact-repository.ts          NEW
├── run-aggregate.ts                                  NEW
├── phase-aggregate.ts                                NEW
├── phases-json-validator.ts                          NEW (hand-written)
├── workflow-synthesizer.ts                           NEW
├── subagent-synthesizer.ts                           NEW
├── gate-runner.ts                                    NEW
├── phase-executor.ts                                 NEW (orchestrator)
├── phase-templates/
│   ├── code-implement.ts                             MODIFY (add prompt + gates)
│   ├── code-refactor.ts                              MODIFY
│   ├── code-test-write.ts                            MODIFY
│   ├── design-doc.ts                                 MODIFY
│   ├── dep-update.ts                                 MODIFY
│   ├── investigation.ts                              MODIFY
│   └── types.ts                                      MODIFY (extend PhaseTemplate)
└── __tests__/
    ├── status-machine.test.ts                        NEW
    ├── meta-workflow-run-repository.test.ts          NEW
    ├── meta-workflow-phase-repository.test.ts        NEW
    ├── meta-workflow-artifact-repository.test.ts     NEW
    ├── run-aggregate.test.ts                         NEW
    ├── phase-aggregate.test.ts                       NEW
    ├── phases-json-validator.test.ts                 NEW
    ├── workflow-synthesizer.test.ts                  NEW
    ├── subagent-synthesizer.test.ts                  NEW
    ├── gate-runner.test.ts                           NEW
    └── phase-executor.test.ts                        NEW

shared/src/protocol/messages/meta-workflow.ts         MODIFY (add CRUD ClientMessages)
shared/src/protocol/messages/index.ts                 MODIFY (extend ClientMessage union)
```

13 tasks total. Each is independently committable. Dependencies (must execute in order):

```
Task 1 (status-machine) ──┐
Task 2 (RunRepo) ────────────┐
Task 3 (PhaseRepo) ──────────┤
Task 4 (ArtifactRepo) ───────┘
                              │
Task 5 (RunAggregate) ←──── needs 1, 2
Task 6 (PhaseAggregate) ←── needs 1, 3
Task 7 (validator) — independent
Task 8 (templates expand) — independent
Task 9 (workflow-synthesizer) ←── needs 8
Task 10 (subagent-synthesizer) ←── needs 8
Task 11 (gate-runner) — independent
Task 12 (phase-executor) ←── needs 6, 9, 10, 11
Task 13 (CRUD messages) — independent
Task 14 (smoke verify) ←── final
```

---

## Task 1: Status Machine

**Files:**
- Create: `server/src/domains/meta-workflow/status-machine.ts`
- Test: `server/src/domains/meta-workflow/__tests__/status-machine.test.ts`

Pure functions that encode legal status transitions for both `MetaWorkflowRun` and `MetaWorkflowPhase`. No DB. No side effects.

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/domains/meta-workflow/__tests__/status-machine.test.ts
import { describe, it, expect } from 'vitest';
import {
  assertRunTransition,
  assertPhaseTransition,
  assertRunStatusIn,
  assertPhaseStatusIn,
  TERMINAL_RUN_STATUSES,
  TERMINAL_PHASE_STATUSES,
} from '../status-machine.js';

describe('meta-workflow status machine', () => {
  it('allows run requirement_draft → requirement_review', () => {
    expect(() => assertRunTransition('requirement_draft', 'requirement_review')).not.toThrow();
  });

  it('rejects run completed → requirement_draft', () => {
    expect(() => assertRunTransition('completed', 'requirement_draft')).toThrow(/Invalid run transition/);
  });

  it('same-status is always allowed', () => {
    expect(() => assertRunTransition('executing', 'executing')).not.toThrow();
    expect(() => assertPhaseTransition('running', 'running')).not.toThrow();
  });

  it('phase pending → searching_reuse is allowed', () => {
    expect(() => assertPhaseTransition('pending', 'searching_reuse')).not.toThrow();
  });

  it('phase done → running is forbidden (must re-enter via stale)', () => {
    expect(() => assertPhaseTransition('done', 'running')).toThrow(/Invalid phase transition/);
  });

  it('phase done → stale is allowed (lazy propagation)', () => {
    expect(() => assertPhaseTransition('done', 'stale')).not.toThrow();
  });

  it('phase stale → pending is allowed (cascade or manual rerun)', () => {
    expect(() => assertPhaseTransition('stale', 'pending')).not.toThrow();
  });

  it('phase stale → done is allowed (upstream re-run produced identical artifact)', () => {
    expect(() => assertPhaseTransition('stale', 'done')).not.toThrow();
  });

  it('TERMINAL sets are correct', () => {
    expect(TERMINAL_RUN_STATUSES).toEqual(['completed', 'cancelled']);
    expect(TERMINAL_PHASE_STATUSES).toEqual(['done', 'failed']);
  });

  it('assertRunStatusIn throws on disallowed', () => {
    expect(() => assertRunStatusIn('completed', ['executing'], 'kick off')).toThrow(/Cannot kick off run/);
  });

  it('assertPhaseStatusIn throws on disallowed', () => {
    expect(() => assertPhaseStatusIn('done', ['running'], 'mark failed')).toThrow(/Cannot mark failed phase/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/status-machine.test.ts`

Expected: FAIL with "Cannot find module '../status-machine.js'".

- [ ] **Step 3: Write the implementation**

```typescript
// server/src/domains/meta-workflow/status-machine.ts
import type {
  MetaWorkflowRunStatus,
  MetaWorkflowPhaseStatus,
} from '@my-claudia/shared/features/meta-workflow';

export const TERMINAL_RUN_STATUSES: MetaWorkflowRunStatus[] = ['completed', 'cancelled'];
export const TERMINAL_PHASE_STATUSES: MetaWorkflowPhaseStatus[] = ['done', 'failed'];

const RUN_TRANSITIONS: Record<MetaWorkflowRunStatus, MetaWorkflowRunStatus[]> = {
  requirement_draft: ['requirement_review', 'cancelled'],
  requirement_review: ['requirement_draft', 'splitting', 'cancelled'],
  splitting: ['executing', 'requirement_draft', 'cancelled'],
  executing: ['reviewing', 'splitting', 'cancelled'],
  reviewing: ['executing', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

const PHASE_TRANSITIONS: Record<MetaWorkflowPhaseStatus, MetaWorkflowPhaseStatus[]> = {
  pending: ['searching_reuse', 'stale'],
  searching_reuse: ['generating', 'ready_to_run', 'failed'],
  generating: ['ready_to_run', 'failed', 'pending'],
  ready_to_run: ['running', 'failed'],
  running: ['verifying_gates', 'failed'],
  verifying_gates: ['done', 'failed'],
  done: ['stale'],
  failed: ['pending'],
  stale: ['pending', 'done'],   // 'done' supports clearStale when upstream re-run produced identical artifact
};

export function assertRunTransition(
  from: MetaWorkflowRunStatus,
  to: MetaWorkflowRunStatus,
): void {
  if (from === to) return;
  if (!RUN_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Invalid run transition: '${from}' -> '${to}'`);
  }
}

export function assertPhaseTransition(
  from: MetaWorkflowPhaseStatus,
  to: MetaWorkflowPhaseStatus,
): void {
  if (from === to) return;
  if (!PHASE_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Invalid phase transition: '${from}' -> '${to}'`);
  }
}

export function assertRunStatusIn(
  status: MetaWorkflowRunStatus,
  allowed: MetaWorkflowRunStatus[],
  action: string,
): void {
  if (!allowed.includes(status)) {
    throw new Error(`Cannot ${action} run in status '${status}'`);
  }
}

export function assertPhaseStatusIn(
  status: MetaWorkflowPhaseStatus,
  allowed: MetaWorkflowPhaseStatus[],
  action: string,
): void {
  if (!allowed.includes(status)) {
    throw new Error(`Cannot ${action} phase in status '${status}'`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/status-machine.test.ts`

Expected: PASS (11 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/meta-workflow/status-machine.ts \
        server/src/domains/meta-workflow/__tests__/status-machine.test.ts
git commit -m "feat(meta-workflow): status machine for run + phase transitions"
```

---

## Task 2: MetaWorkflowRunRepository

**Files:**
- Create: `server/src/domains/meta-workflow/repositories/meta-workflow-run-repository.ts`
- Test: `server/src/domains/meta-workflow/__tests__/meta-workflow-run-repository.test.ts`

Repository for `meta_workflow_runs` table. Extends `BaseRepository<MetaWorkflowRun, ..., ...>`.

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/domains/meta-workflow/__tests__/meta-workflow-run-repository.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaWorkflowRunRepository } from '../repositories/meta-workflow-run-repository.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY);`);
  db.exec(m069.sql);
  db.prepare(`INSERT INTO projects (id) VALUES (?)`).run('proj-1');
  return db;
}

describe('MetaWorkflowRunRepository', () => {
  let db: Database.Database;
  let repo: MetaWorkflowRunRepository;

  beforeEach(() => {
    db = freshDb();
    repo = new MetaWorkflowRunRepository(db);
  });

  it('creates a run with defaults', () => {
    const now = Date.now();
    const run = repo.create({
      projectId: 'proj-1',
      title: 'Add billing',
      status: 'requirement_draft',
      rejectCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    expect(run.id).toBeTruthy();
    expect(run.title).toBe('Add billing');
    expect(run.status).toBe('requirement_draft');
    expect(run.rejectCount).toBe(0);
  });

  it('findById returns null for missing', () => {
    expect(repo.findById('missing')).toBeNull();
  });

  it('updates partial fields', () => {
    const now = Date.now();
    const created = repo.create({
      projectId: 'proj-1', title: 't', status: 'requirement_draft',
      rejectCount: 0, createdAt: now, updatedAt: now,
    });
    const updated = repo.update(created.id, { status: 'splitting', rejectCount: 1, updatedAt: now + 1 });
    expect(updated.status).toBe('splitting');
    expect(updated.rejectCount).toBe(1);
    expect(updated.title).toBe('t');
  });

  it('findByProject returns runs ordered by created_at desc', () => {
    repo.create({ projectId: 'proj-1', title: 'r1', status: 'requirement_draft',
                  rejectCount: 0, createdAt: 100, updatedAt: 100 });
    repo.create({ projectId: 'proj-1', title: 'r2', status: 'requirement_draft',
                  rejectCount: 0, createdAt: 200, updatedAt: 200 });
    const runs = repo.findByProject('proj-1');
    expect(runs.map((r) => r.title)).toEqual(['r2', 'r1']);
  });

  it('round-trips JSON config and phasesJson', () => {
    const now = Date.now();
    const created = repo.create({
      projectId: 'proj-1', title: 't', status: 'requirement_draft',
      rejectCount: 0, createdAt: now, updatedAt: now,
      config: { maxRequirementRejects: 5, maxParallelPhases: 3 },
      phasesJson: '{"version":"1","phases":[],"smokePath":[],"metadata":{"generatedAt":0,"requirementsPath":"x"}}',
    });
    const fetched = repo.findById(created.id);
    expect(fetched?.config).toEqual({ maxRequirementRejects: 5, maxParallelPhases: 3 });
    expect(fetched?.phasesJson).toContain('"version":"1"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/meta-workflow-run-repository.test.ts`

Expected: FAIL with "Cannot find module ../repositories/meta-workflow-run-repository.js".

- [ ] **Step 3: Write the implementation**

```typescript
// server/src/domains/meta-workflow/repositories/meta-workflow-run-repository.ts
import { BaseRepository } from '../../../infrastructure/repositories/base.js';
import type { Database } from 'better-sqlite3';
import type {
  MetaWorkflowRun,
  MetaWorkflowRunStatus,
  MetaWorkflowConfig,
} from '@my-claudia/shared/features/meta-workflow';
import { v4 as uuidv4 } from 'uuid';

type Create = Omit<MetaWorkflowRun, 'id' | 'completedAt'>;
type Update = Partial<Omit<MetaWorkflowRun, 'id' | 'projectId' | 'createdAt'>>;

export class MetaWorkflowRunRepository extends BaseRepository<MetaWorkflowRun, Create, Update> {
  constructor(db: Database) {
    super(db, 'meta_workflow_runs');
  }

  mapRow(raw: unknown): MetaWorkflowRun {
    const row = raw as Record<string, unknown>;
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      title: row.title as string,
      description: (row.description as string) || undefined,
      status: row.status as MetaWorkflowRunStatus,
      requirementsPath: (row.requirements_path as string) || undefined,
      phasesJson: (row.phases_json as string) || undefined,
      smokePathRunId: (row.smoke_path_run_id as string) || undefined,
      rejectCount: row.reject_count as number,
      defaultProviderId: (row.default_provider_id as string) || undefined,
      config: row.config ? (JSON.parse(row.config as string) as MetaWorkflowConfig) : undefined,
      worktreeId: (row.worktree_id as string) || undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      completedAt: (row.completed_at as number) || undefined,
    };
  }

  createQuery(data: Create): { sql: string; params: unknown[] } {
    const id = uuidv4();
    return {
      sql: `INSERT INTO meta_workflow_runs (
        id, project_id, title, description, status,
        requirements_path, phases_json, smoke_path_run_id,
        reject_count, default_provider_id, config, worktree_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id, data.projectId, data.title, data.description ?? null, data.status,
        data.requirementsPath ?? null, data.phasesJson ?? null, data.smokePathRunId ?? null,
        data.rejectCount, data.defaultProviderId ?? null,
        data.config ? JSON.stringify(data.config) : null,
        data.worktreeId ?? null,
        data.createdAt, data.updatedAt,
      ],
    };
  }

  updateQuery(id: string, data: Update): { sql: string; params: unknown[] } {
    const sets: string[] = [];
    const params: unknown[] = [];

    const map: Array<[keyof Update, string, (v: unknown) => unknown]> = [
      ['title', 'title', (v) => v],
      ['description', 'description', (v) => v ?? null],
      ['status', 'status', (v) => v],
      ['requirementsPath', 'requirements_path', (v) => v ?? null],
      ['phasesJson', 'phases_json', (v) => v ?? null],
      ['smokePathRunId', 'smoke_path_run_id', (v) => v ?? null],
      ['rejectCount', 'reject_count', (v) => v],
      ['defaultProviderId', 'default_provider_id', (v) => v ?? null],
      ['config', 'config', (v) => (v ? JSON.stringify(v) : null)],
      ['worktreeId', 'worktree_id', (v) => v ?? null],
      ['updatedAt', 'updated_at', (v) => v],
      ['completedAt', 'completed_at', (v) => v ?? null],
    ];

    for (const [key, col, transform] of map) {
      if (data[key] !== undefined) {
        sets.push(`${col} = ?`);
        params.push(transform(data[key]));
      }
    }

    if (sets.length === 0) {
      return { sql: `SELECT 1 FROM meta_workflow_runs WHERE id = ?`, params: [id] };
    }
    params.push(id);
    return {
      sql: `UPDATE meta_workflow_runs SET ${sets.join(', ')} WHERE id = ?`,
      params,
    };
  }

  findByProject(projectId: string, limit = 50): MetaWorkflowRun[] {
    const rows = this.db.prepare(
      `SELECT * FROM meta_workflow_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
    ).all(projectId, limit);
    return rows.map((r) => this.mapRow(r));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/meta-workflow-run-repository.test.ts`

Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/meta-workflow/repositories/meta-workflow-run-repository.ts \
        server/src/domains/meta-workflow/__tests__/meta-workflow-run-repository.test.ts
git commit -m "feat(meta-workflow): add MetaWorkflowRunRepository"
```

---

## Task 3: MetaWorkflowPhaseRepository

**Files:**
- Create: `server/src/domains/meta-workflow/repositories/meta-workflow-phase-repository.ts`
- Test: `server/src/domains/meta-workflow/__tests__/meta-workflow-phase-repository.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/domains/meta-workflow/__tests__/meta-workflow-phase-repository.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaWorkflowPhaseRepository } from '../repositories/meta-workflow-phase-repository.js';

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

describe('MetaWorkflowPhaseRepository', () => {
  let db: Database.Database;
  let repo: MetaWorkflowPhaseRepository;

  beforeEach(() => {
    db = freshDb();
    repo = new MetaWorkflowPhaseRepository(db);
  });

  it('creates a phase with snapshots', () => {
    const now = Date.now();
    const phase = repo.create({
      runId: 'run-1',
      phaseId: 'p1',
      phaseType: 'code-implement',
      status: 'pending',
      executeEntity: 'workflow',
      attempt: 0,
      maxRetries: 3,
      inputsSnapshot: [{ kind: 'file', source: 'design/requirements.md' }],
      outputsSnapshot: [{ kind: 'commit', description: 'impl' }],
      gatesSnapshot: [{ id: 'compile', description: 'mvn compile', command: 'mvn compile', expect: { exitCode: 0 } }],
      createdAt: now,
    });
    expect(phase.id).toBeTruthy();
    expect(phase.phaseType).toBe('code-implement');
    expect(phase.inputsSnapshot).toHaveLength(1);
    expect(phase.gatesSnapshot?.[0].command).toBe('mvn compile');
  });

  it('findByRun returns phases', () => {
    const now = Date.now();
    repo.create({ runId: 'run-1', phaseId: 'p1', phaseType: 'code-implement', status: 'pending',
                  executeEntity: 'workflow', attempt: 0, maxRetries: 3, createdAt: now });
    repo.create({ runId: 'run-1', phaseId: 'p2', phaseType: 'design-doc', status: 'pending',
                  executeEntity: 'workflow', attempt: 0, maxRetries: 3, createdAt: now + 1 });
    const phases = repo.findByRun('run-1');
    expect(phases).toHaveLength(2);
  });

  it('updates phase status', () => {
    const now = Date.now();
    const created = repo.create({ runId: 'run-1', phaseId: 'p1', phaseType: 'code-implement',
                                  status: 'pending', executeEntity: 'workflow',
                                  attempt: 0, maxRetries: 3, createdAt: now });
    const updated = repo.update(created.id, { status: 'running', attempt: 1, startedAt: now + 10 });
    expect(updated.status).toBe('running');
    expect(updated.attempt).toBe(1);
    expect(updated.startedAt).toBe(now + 10);
  });

  it('stale flag fields round-trip', () => {
    const now = Date.now();
    const phase = repo.create({ runId: 'run-1', phaseId: 'p1', phaseType: 'code-implement',
                                status: 'done', executeEntity: 'workflow',
                                attempt: 1, maxRetries: 3, createdAt: now });
    const updated = repo.update(phase.id, {
      status: 'stale', staleSince: now + 100, staleSourcePhaseId: 'p-upstream',
    });
    expect(updated.status).toBe('stale');
    expect(updated.staleSince).toBe(now + 100);
    expect(updated.staleSourcePhaseId).toBe('p-upstream');
  });

  it('findByRunAndPhaseId returns the unique phase', () => {
    const now = Date.now();
    repo.create({ runId: 'run-1', phaseId: 'p1', phaseType: 'code-implement', status: 'pending',
                  executeEntity: 'workflow', attempt: 0, maxRetries: 3, createdAt: now });
    const phase = repo.findByRunAndPhaseId('run-1', 'p1');
    expect(phase).not.toBeNull();
    expect(phase?.phaseId).toBe('p1');
    expect(repo.findByRunAndPhaseId('run-1', 'missing')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/meta-workflow-phase-repository.test.ts`

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

```typescript
// server/src/domains/meta-workflow/repositories/meta-workflow-phase-repository.ts
import { BaseRepository } from '../../../infrastructure/repositories/base.js';
import type { Database } from 'better-sqlite3';
import type {
  MetaWorkflowPhase,
  MetaWorkflowPhaseStatus,
  PhaseType,
  ExecuteEntity,
  PhaseInput,
  PhaseOutput,
  AcceptanceGate,
  PhaseExecuteConfig,
} from '@my-claudia/shared/features/meta-workflow';
import { v4 as uuidv4 } from 'uuid';

type Create = Omit<MetaWorkflowPhase, 'id' | 'startedAt' | 'completedAt'>;
type Update = Partial<Omit<MetaWorkflowPhase, 'id' | 'runId' | 'phaseId' | 'createdAt'>>;

function parseJsonOrUndefined<T>(s: unknown): T | undefined {
  return s ? (JSON.parse(s as string) as T) : undefined;
}

export class MetaWorkflowPhaseRepository extends BaseRepository<MetaWorkflowPhase, Create, Update> {
  constructor(db: Database) {
    super(db, 'meta_workflow_phases');
  }

  mapRow(raw: unknown): MetaWorkflowPhase {
    const row = raw as Record<string, unknown>;
    return {
      id: row.id as string,
      runId: row.run_id as string,
      phaseId: row.phase_id as string,
      phaseType: row.phase_type as PhaseType,
      status: row.status as MetaWorkflowPhaseStatus,
      executeEntity: row.execute_entity as ExecuteEntity,
      reusedFromPoolId: (row.reused_from_pool_id as string) || undefined,
      generatedWorkflowId: (row.generated_workflow_id as string) || undefined,
      generatedSubagentId: (row.generated_subagent_id as string) || undefined,
      currentRunId: (row.current_run_id as string) || undefined,
      worktreePath: (row.worktree_path as string) || undefined,
      staleSince: (row.stale_since as number) || undefined,
      staleSourcePhaseId: (row.stale_source_phase_id as string) || undefined,
      attempt: row.attempt as number,
      maxRetries: row.max_retries as number,
      inputsSnapshot: parseJsonOrUndefined<PhaseInput[]>(row.inputs_snapshot),
      outputsSnapshot: parseJsonOrUndefined<PhaseOutput[]>(row.outputs_snapshot),
      gatesSnapshot: parseJsonOrUndefined<AcceptanceGate[]>(row.gates_snapshot),
      executeConfigSnapshot: parseJsonOrUndefined<PhaseExecuteConfig>(row.execute_config_snapshot),
      synthesizerProviderId: (row.synthesizer_provider_id as string) || undefined,
      runtimeProviderId: (row.runtime_provider_id as string) || undefined,
      createdAt: row.created_at as number,
      startedAt: (row.started_at as number) || undefined,
      completedAt: (row.completed_at as number) || undefined,
    };
  }

  createQuery(data: Create): { sql: string; params: unknown[] } {
    const id = uuidv4();
    return {
      sql: `INSERT INTO meta_workflow_phases (
        id, run_id, phase_id, phase_type, status, execute_entity,
        reused_from_pool_id, generated_workflow_id, generated_subagent_id,
        current_run_id, worktree_path, stale_since, stale_source_phase_id,
        attempt, max_retries,
        inputs_snapshot, outputs_snapshot, gates_snapshot, execute_config_snapshot,
        synthesizer_provider_id, runtime_provider_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id, data.runId, data.phaseId, data.phaseType, data.status, data.executeEntity,
        data.reusedFromPoolId ?? null,
        data.generatedWorkflowId ?? null,
        data.generatedSubagentId ?? null,
        data.currentRunId ?? null,
        data.worktreePath ?? null,
        data.staleSince ?? null,
        data.staleSourcePhaseId ?? null,
        data.attempt, data.maxRetries,
        data.inputsSnapshot ? JSON.stringify(data.inputsSnapshot) : null,
        data.outputsSnapshot ? JSON.stringify(data.outputsSnapshot) : null,
        data.gatesSnapshot ? JSON.stringify(data.gatesSnapshot) : null,
        data.executeConfigSnapshot ? JSON.stringify(data.executeConfigSnapshot) : null,
        data.synthesizerProviderId ?? null,
        data.runtimeProviderId ?? null,
        data.createdAt,
      ],
    };
  }

  updateQuery(id: string, data: Update): { sql: string; params: unknown[] } {
    const sets: string[] = [];
    const params: unknown[] = [];

    const jsonFields = new Set<keyof Update>([
      'inputsSnapshot', 'outputsSnapshot', 'gatesSnapshot', 'executeConfigSnapshot',
    ]);

    const fieldMap: Array<[keyof Update, string]> = [
      ['phaseType', 'phase_type'],
      ['status', 'status'],
      ['executeEntity', 'execute_entity'],
      ['reusedFromPoolId', 'reused_from_pool_id'],
      ['generatedWorkflowId', 'generated_workflow_id'],
      ['generatedSubagentId', 'generated_subagent_id'],
      ['currentRunId', 'current_run_id'],
      ['worktreePath', 'worktree_path'],
      ['staleSince', 'stale_since'],
      ['staleSourcePhaseId', 'stale_source_phase_id'],
      ['attempt', 'attempt'],
      ['maxRetries', 'max_retries'],
      ['inputsSnapshot', 'inputs_snapshot'],
      ['outputsSnapshot', 'outputs_snapshot'],
      ['gatesSnapshot', 'gates_snapshot'],
      ['executeConfigSnapshot', 'execute_config_snapshot'],
      ['synthesizerProviderId', 'synthesizer_provider_id'],
      ['runtimeProviderId', 'runtime_provider_id'],
      ['startedAt', 'started_at'],
      ['completedAt', 'completed_at'],
    ];

    for (const [key, col] of fieldMap) {
      if (data[key] !== undefined) {
        sets.push(`${col} = ?`);
        const value = data[key];
        if (jsonFields.has(key)) {
          params.push(value === null ? null : JSON.stringify(value));
        } else {
          params.push(value ?? null);
        }
      }
    }

    if (sets.length === 0) {
      return { sql: `SELECT 1 FROM meta_workflow_phases WHERE id = ?`, params: [id] };
    }
    params.push(id);
    return {
      sql: `UPDATE meta_workflow_phases SET ${sets.join(', ')} WHERE id = ?`,
      params,
    };
  }

  findByRun(runId: string): MetaWorkflowPhase[] {
    const rows = this.db.prepare(
      `SELECT * FROM meta_workflow_phases WHERE run_id = ? ORDER BY created_at ASC`,
    ).all(runId);
    return rows.map((r) => this.mapRow(r));
  }

  findByRunAndPhaseId(runId: string, phaseId: string): MetaWorkflowPhase | null {
    const row = this.db.prepare(
      `SELECT * FROM meta_workflow_phases WHERE run_id = ? AND phase_id = ? LIMIT 1`,
    ).get(runId, phaseId);
    return row ? this.mapRow(row) : null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/meta-workflow-phase-repository.test.ts`

Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/meta-workflow/repositories/meta-workflow-phase-repository.ts \
        server/src/domains/meta-workflow/__tests__/meta-workflow-phase-repository.test.ts
git commit -m "feat(meta-workflow): add MetaWorkflowPhaseRepository"
```

---

## Task 4: MetaWorkflowArtifactRepository

**Files:**
- Create: `server/src/domains/meta-workflow/repositories/meta-workflow-artifact-repository.ts`
- Test: `server/src/domains/meta-workflow/__tests__/meta-workflow-artifact-repository.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/domains/meta-workflow/__tests__/meta-workflow-artifact-repository.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaWorkflowArtifactRepository } from '../repositories/meta-workflow-artifact-repository.js';

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
  db.prepare(
    `INSERT INTO meta_workflow_phases (id, run_id, phase_id, phase_type, status, execute_entity, attempt, max_retries, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('phase-rec-1', 'run-1', 'p1', 'code-implement', 'done', 'workflow', 0, 3, 0);
  return db;
}

describe('MetaWorkflowArtifactRepository', () => {
  let db: Database.Database;
  let repo: MetaWorkflowArtifactRepository;

  beforeEach(() => {
    db = freshDb();
    repo = new MetaWorkflowArtifactRepository(db);
  });

  it('creates a versioned artifact', () => {
    const a = repo.create({
      phaseRecordId: 'phase-rec-1',
      version: 1,
      commitSha: 'abc123',
      status: 'active',
      artifactFiles: [{ kind: 'file', path: 'src/Foo.java' }],
      gateResults: [{ gateId: 'compile', passed: true, exitCode: 0 }],
      createdAt: Date.now(),
    });
    expect(a.id).toBeTruthy();
    expect(a.version).toBe(1);
    expect(a.commitSha).toBe('abc123');
    expect(a.gateResults?.[0].passed).toBe(true);
  });

  it('UNIQUE (phase_record_id, version) prevents duplicates', () => {
    const now = Date.now();
    repo.create({ phaseRecordId: 'phase-rec-1', version: 1, status: 'active', createdAt: now });
    expect(() =>
      repo.create({ phaseRecordId: 'phase-rec-1', version: 1, status: 'active', createdAt: now }),
    ).toThrow(/UNIQUE/);
  });

  it('findLatestByPhase returns highest version', () => {
    repo.create({ phaseRecordId: 'phase-rec-1', version: 1, status: 'stale', createdAt: 10 });
    repo.create({ phaseRecordId: 'phase-rec-1', version: 2, status: 'active', createdAt: 20 });
    const latest = repo.findLatestByPhase('phase-rec-1');
    expect(latest?.version).toBe(2);
    expect(latest?.status).toBe('active');
  });

  it('markAllStaleForPhase flips active → stale', () => {
    repo.create({ phaseRecordId: 'phase-rec-1', version: 1, status: 'active', createdAt: 10 });
    repo.markAllStaleForPhase('phase-rec-1');
    const all = repo.findByPhase('phase-rec-1');
    expect(all.every((a) => a.status === 'stale')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/meta-workflow-artifact-repository.test.ts`

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

```typescript
// server/src/domains/meta-workflow/repositories/meta-workflow-artifact-repository.ts
import { BaseRepository } from '../../../infrastructure/repositories/base.js';
import type { Database } from 'better-sqlite3';
import type {
  MetaWorkflowArtifact,
  MetaWorkflowGateResult,
} from '@my-claudia/shared/features/meta-workflow';
import { v4 as uuidv4 } from 'uuid';

type Create = Omit<MetaWorkflowArtifact, 'id'>;
type Update = Partial<Omit<MetaWorkflowArtifact, 'id' | 'phaseRecordId' | 'version' | 'createdAt'>>;

export class MetaWorkflowArtifactRepository extends BaseRepository<MetaWorkflowArtifact, Create, Update> {
  constructor(db: Database) {
    super(db, 'meta_workflow_artifacts');
  }

  mapRow(raw: unknown): MetaWorkflowArtifact {
    const row = raw as Record<string, unknown>;
    return {
      id: row.id as string,
      phaseRecordId: row.phase_record_id as string,
      version: row.version as number,
      commitSha: (row.commit_sha as string) || undefined,
      artifactFiles: row.artifact_files
        ? (JSON.parse(row.artifact_files as string) as MetaWorkflowArtifact['artifactFiles'])
        : undefined,
      gateResults: row.gate_results
        ? (JSON.parse(row.gate_results as string) as MetaWorkflowGateResult[])
        : undefined,
      aiReviewNotesPath: (row.ai_review_notes_path as string) || undefined,
      status: row.status as MetaWorkflowArtifact['status'],
      createdAt: row.created_at as number,
    };
  }

  createQuery(data: Create): { sql: string; params: unknown[] } {
    const id = uuidv4();
    return {
      sql: `INSERT INTO meta_workflow_artifacts (
        id, phase_record_id, version, commit_sha, artifact_files,
        gate_results, ai_review_notes_path, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id, data.phaseRecordId, data.version,
        data.commitSha ?? null,
        data.artifactFiles ? JSON.stringify(data.artifactFiles) : null,
        data.gateResults ? JSON.stringify(data.gateResults) : null,
        data.aiReviewNotesPath ?? null,
        data.status,
        data.createdAt,
      ],
    };
  }

  updateQuery(id: string, data: Update): { sql: string; params: unknown[] } {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (data.commitSha !== undefined) { sets.push('commit_sha = ?'); params.push(data.commitSha ?? null); }
    if (data.artifactFiles !== undefined) {
      sets.push('artifact_files = ?');
      params.push(data.artifactFiles ? JSON.stringify(data.artifactFiles) : null);
    }
    if (data.gateResults !== undefined) {
      sets.push('gate_results = ?');
      params.push(data.gateResults ? JSON.stringify(data.gateResults) : null);
    }
    if (data.aiReviewNotesPath !== undefined) { sets.push('ai_review_notes_path = ?'); params.push(data.aiReviewNotesPath ?? null); }
    if (data.status !== undefined) { sets.push('status = ?'); params.push(data.status); }

    if (sets.length === 0) {
      return { sql: `SELECT 1 FROM meta_workflow_artifacts WHERE id = ?`, params: [id] };
    }
    params.push(id);
    return { sql: `UPDATE meta_workflow_artifacts SET ${sets.join(', ')} WHERE id = ?`, params };
  }

  findByPhase(phaseRecordId: string): MetaWorkflowArtifact[] {
    const rows = this.db.prepare(
      `SELECT * FROM meta_workflow_artifacts WHERE phase_record_id = ? ORDER BY version DESC`,
    ).all(phaseRecordId);
    return rows.map((r) => this.mapRow(r));
  }

  findLatestByPhase(phaseRecordId: string): MetaWorkflowArtifact | null {
    const row = this.db.prepare(
      `SELECT * FROM meta_workflow_artifacts WHERE phase_record_id = ? ORDER BY version DESC LIMIT 1`,
    ).get(phaseRecordId);
    return row ? this.mapRow(row) : null;
  }

  markAllStaleForPhase(phaseRecordId: string): void {
    this.db.prepare(
      `UPDATE meta_workflow_artifacts SET status = 'stale'
         WHERE phase_record_id = ? AND status = 'active'`,
    ).run(phaseRecordId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/meta-workflow-artifact-repository.test.ts`

Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/meta-workflow/repositories/meta-workflow-artifact-repository.ts \
        server/src/domains/meta-workflow/__tests__/meta-workflow-artifact-repository.test.ts
git commit -m "feat(meta-workflow): add MetaWorkflowArtifactRepository"
```

---

## Task 5: MetaWorkflowRunAggregate

**Files:**
- Create: `server/src/domains/meta-workflow/run-aggregate.ts`
- Test: `server/src/domains/meta-workflow/__tests__/run-aggregate.test.ts`

Aggregate that wraps `MetaWorkflowRunRepository` and enforces transitions via `status-machine`. Exposes domain operations: `submitRequirements`, `approveRequirements`, `rejectRequirements`, `setPhasesJson`, `enterExecuting`, `enterReviewing`, `complete`, `cancel`.

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/domains/meta-workflow/__tests__/run-aggregate.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaWorkflowRunRepository } from '../repositories/meta-workflow-run-repository.js';
import { MetaWorkflowRunAggregate } from '../run-aggregate.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY);`);
  db.exec(m069.sql);
  db.prepare(`INSERT INTO projects (id) VALUES (?)`).run('proj-1');
  return db;
}

describe('MetaWorkflowRunAggregate', () => {
  let db: Database.Database;
  let agg: MetaWorkflowRunAggregate;

  beforeEach(() => {
    db = freshDb();
    agg = new MetaWorkflowRunAggregate(new MetaWorkflowRunRepository(db));
  });

  it('creates a run in requirement_draft', () => {
    const run = agg.create({ projectId: 'proj-1', title: 'Add billing' });
    expect(run.status).toBe('requirement_draft');
    expect(run.rejectCount).toBe(0);
  });

  it('submitRequirements moves draft → review', () => {
    const run = agg.create({ projectId: 'proj-1', title: 't' });
    const updated = agg.submitRequirements(run.id, 'design/requirements.md');
    expect(updated.status).toBe('requirement_review');
    expect(updated.requirementsPath).toBe('design/requirements.md');
  });

  it('approveRequirements moves review → splitting', () => {
    const run = agg.create({ projectId: 'proj-1', title: 't' });
    agg.submitRequirements(run.id, 'design/requirements.md');
    const updated = agg.approveRequirements(run.id);
    expect(updated.status).toBe('splitting');
  });

  it('rejectRequirements bumps counter and returns to draft', () => {
    const run = agg.create({ projectId: 'proj-1', title: 't' });
    agg.submitRequirements(run.id, 'r.md');
    const updated = agg.rejectRequirements(run.id);
    expect(updated.status).toBe('requirement_draft');
    expect(updated.rejectCount).toBe(1);
  });

  it('setPhasesJson stores serialized doc and moves splitting → executing', () => {
    const run = agg.create({ projectId: 'proj-1', title: 't' });
    agg.submitRequirements(run.id, 'r.md');
    agg.approveRequirements(run.id);
    const updated = agg.setPhasesJson(run.id, '{"version":"1","phases":[],"smokePath":[],"metadata":{"generatedAt":0,"requirementsPath":"r.md"}}');
    expect(updated.status).toBe('executing');
    expect(updated.phasesJson).toContain('"version":"1"');
  });

  it('complete from reviewing sets completedAt', () => {
    const run = agg.create({ projectId: 'proj-1', title: 't' });
    agg.submitRequirements(run.id, 'r.md');
    agg.approveRequirements(run.id);
    agg.setPhasesJson(run.id, '{"version":"1","phases":[],"smokePath":[],"metadata":{"generatedAt":0,"requirementsPath":"r.md"}}');
    agg.enterReviewing(run.id);
    const updated = agg.complete(run.id);
    expect(updated.status).toBe('completed');
    expect(updated.completedAt).toBeGreaterThan(0);
  });

  it('cancel from any non-terminal works', () => {
    const run = agg.create({ projectId: 'proj-1', title: 't' });
    const cancelled = agg.cancel(run.id);
    expect(cancelled.status).toBe('cancelled');
  });

  it('cannot reject in draft (only after submit)', () => {
    const run = agg.create({ projectId: 'proj-1', title: 't' });
    expect(() => agg.rejectRequirements(run.id)).toThrow(/Cannot reject requirements/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/run-aggregate.test.ts`

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

```typescript
// server/src/domains/meta-workflow/run-aggregate.ts
import type { MetaWorkflowRun } from '@my-claudia/shared/features/meta-workflow';
import { MetaWorkflowRunRepository } from './repositories/meta-workflow-run-repository.js';
import { assertRunTransition, assertRunStatusIn } from './status-machine.js';

export interface CreateRunInput {
  projectId: string;
  title: string;
  description?: string;
  defaultProviderId?: string;
}

export class MetaWorkflowRunAggregate {
  constructor(private repo: MetaWorkflowRunRepository) {}

  create(input: CreateRunInput): MetaWorkflowRun {
    const now = Date.now();
    return this.repo.create({
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      status: 'requirement_draft',
      rejectCount: 0,
      defaultProviderId: input.defaultProviderId,
      createdAt: now,
      updatedAt: now,
    });
  }

  submitRequirements(runId: string, requirementsPath: string): MetaWorkflowRun {
    const run = this.requireRun(runId);
    assertRunStatusIn(run.status, ['requirement_draft'], 'submit requirements for');
    assertRunTransition(run.status, 'requirement_review');
    return this.repo.update(runId, {
      status: 'requirement_review',
      requirementsPath,
      updatedAt: Date.now(),
    });
  }

  approveRequirements(runId: string): MetaWorkflowRun {
    const run = this.requireRun(runId);
    assertRunStatusIn(run.status, ['requirement_review'], 'approve requirements for');
    assertRunTransition(run.status, 'splitting');
    return this.repo.update(runId, { status: 'splitting', updatedAt: Date.now() });
  }

  rejectRequirements(runId: string): MetaWorkflowRun {
    const run = this.requireRun(runId);
    assertRunStatusIn(run.status, ['requirement_review'], 'reject requirements for');
    assertRunTransition(run.status, 'requirement_draft');
    return this.repo.update(runId, {
      status: 'requirement_draft',
      rejectCount: run.rejectCount + 1,
      updatedAt: Date.now(),
    });
  }

  setPhasesJson(runId: string, phasesJson: string): MetaWorkflowRun {
    const run = this.requireRun(runId);
    assertRunStatusIn(run.status, ['splitting'], 'set phases.json for');
    assertRunTransition(run.status, 'executing');
    return this.repo.update(runId, {
      status: 'executing',
      phasesJson,
      updatedAt: Date.now(),
    });
  }

  enterReviewing(runId: string): MetaWorkflowRun {
    const run = this.requireRun(runId);
    assertRunStatusIn(run.status, ['executing'], 'enter review for');
    assertRunTransition(run.status, 'reviewing');
    return this.repo.update(runId, { status: 'reviewing', updatedAt: Date.now() });
  }

  complete(runId: string): MetaWorkflowRun {
    const run = this.requireRun(runId);
    assertRunStatusIn(run.status, ['reviewing'], 'complete');
    assertRunTransition(run.status, 'completed');
    const now = Date.now();
    return this.repo.update(runId, { status: 'completed', completedAt: now, updatedAt: now });
  }

  cancel(runId: string): MetaWorkflowRun {
    const run = this.requireRun(runId);
    if (run.status === 'completed' || run.status === 'cancelled') {
      throw new Error(`Cannot cancel run in terminal status '${run.status}'`);
    }
    assertRunTransition(run.status, 'cancelled');
    const now = Date.now();
    return this.repo.update(runId, { status: 'cancelled', completedAt: now, updatedAt: now });
  }

  private requireRun(runId: string): MetaWorkflowRun {
    const run = this.repo.findById(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    return run;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/run-aggregate.test.ts`

Expected: PASS (8 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/meta-workflow/run-aggregate.ts \
        server/src/domains/meta-workflow/__tests__/run-aggregate.test.ts
git commit -m "feat(meta-workflow): add MetaWorkflowRunAggregate"
```

---

## Task 6: MetaWorkflowPhaseAggregate

**Files:**
- Create: `server/src/domains/meta-workflow/phase-aggregate.ts`
- Test: `server/src/domains/meta-workflow/__tests__/phase-aggregate.test.ts`

Aggregate for one phase. Exposes: `enterSearchingReuse`, `enterGenerating`, `enterReadyToRun`, `enterRunning`, `enterVerifyingGates`, `markDone`, `markFailed`, `markStale`, `clearStale`.

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/domains/meta-workflow/__tests__/phase-aggregate.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaWorkflowPhaseRepository } from '../repositories/meta-workflow-phase-repository.js';
import { MetaWorkflowPhaseAggregate } from '../phase-aggregate.js';
import type { PhaseDef } from '@my-claudia/shared/features/meta-workflow';

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

const phaseDef: PhaseDef = {
  id: 'p1',
  name: 'Impl X',
  description: 'Implement X',
  phaseType: 'code-implement',
  dependsOn: [],
  inputs: [],
  outputs: [{ kind: 'commit', description: 'commit' }],
  acceptanceGates: [{
    id: 'compile', description: 'compile', command: 'mvn compile', expect: { exitCode: 0 },
  }],
};

describe('MetaWorkflowPhaseAggregate', () => {
  let db: Database.Database;
  let agg: MetaWorkflowPhaseAggregate;

  beforeEach(() => {
    db = freshDb();
    agg = new MetaWorkflowPhaseAggregate(new MetaWorkflowPhaseRepository(db));
  });

  it('instantiates phase in pending with snapshot fields', () => {
    const phase = agg.instantiate('run-1', phaseDef);
    expect(phase.status).toBe('pending');
    expect(phase.attempt).toBe(0);
    expect(phase.maxRetries).toBe(3);
    expect(phase.executeEntity).toBe('workflow');
    expect(phase.inputsSnapshot).toEqual([]);
    expect(phase.gatesSnapshot?.[0].command).toBe('mvn compile');
  });

  it('subagent default for investigation phaseType', () => {
    const inv: PhaseDef = { ...phaseDef, id: 'p-inv', phaseType: 'investigation' };
    const phase = agg.instantiate('run-1', inv);
    expect(phase.executeEntity).toBe('subagent');
  });

  it('phase progression pending → done', () => {
    const phase = agg.instantiate('run-1', phaseDef);
    agg.enterSearchingReuse(phase.id);
    agg.enterGenerating(phase.id);
    agg.enterReadyToRun(phase.id);
    agg.enterRunning(phase.id);
    agg.enterVerifyingGates(phase.id);
    const done = agg.markDone(phase.id);
    expect(done.status).toBe('done');
    expect(done.completedAt).toBeGreaterThan(0);
  });

  it('markFailed from running', () => {
    const phase = agg.instantiate('run-1', phaseDef);
    agg.enterSearchingReuse(phase.id);
    agg.enterReadyToRun(phase.id);
    agg.enterRunning(phase.id);
    const failed = agg.markFailed(phase.id, 'compile fail');
    expect(failed.status).toBe('failed');
  });

  it('markStale from done', () => {
    const phase = agg.instantiate('run-1', phaseDef);
    agg.enterSearchingReuse(phase.id);
    agg.enterReadyToRun(phase.id);
    agg.enterRunning(phase.id);
    agg.enterVerifyingGates(phase.id);
    agg.markDone(phase.id);
    const stale = agg.markStale(phase.id, 'p-upstream');
    expect(stale.status).toBe('stale');
    expect(stale.staleSourcePhaseId).toBe('p-upstream');
    expect(stale.staleSince).toBeGreaterThan(0);
  });

  it('clearStale returns stale → done', () => {
    const phase = agg.instantiate('run-1', phaseDef);
    agg.enterSearchingReuse(phase.id);
    agg.enterReadyToRun(phase.id);
    agg.enterRunning(phase.id);
    agg.enterVerifyingGates(phase.id);
    agg.markDone(phase.id);
    agg.markStale(phase.id, 'p-upstream');
    const cleared = agg.clearStale(phase.id);
    expect(cleared.status).toBe('done');
    expect(cleared.staleSince).toBeUndefined();
  });

  it('forbids invalid transitions', () => {
    const phase = agg.instantiate('run-1', phaseDef);
    expect(() => agg.markDone(phase.id)).toThrow(/Invalid phase transition/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/phase-aggregate.test.ts`

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

```typescript
// server/src/domains/meta-workflow/phase-aggregate.ts
import type {
  MetaWorkflowPhase,
  PhaseDef,
  ExecuteEntity,
} from '@my-claudia/shared/features/meta-workflow';
import { MetaWorkflowPhaseRepository } from './repositories/meta-workflow-phase-repository.js';
import { assertPhaseTransition, assertPhaseStatusIn } from './status-machine.js';
import { getPhaseTemplate } from './phase-templates/index.js';

const DEFAULT_MAX_RETRIES = 3;

export class MetaWorkflowPhaseAggregate {
  constructor(private repo: MetaWorkflowPhaseRepository) {}

  instantiate(runId: string, def: PhaseDef): MetaWorkflowPhase {
    const template = getPhaseTemplate(def.phaseType);
    const executeEntity: ExecuteEntity = def.executeEntity ?? template.defaultExecuteEntity;
    const now = Date.now();
    return this.repo.create({
      runId,
      phaseId: def.id,
      phaseType: def.phaseType,
      status: 'pending',
      executeEntity,
      attempt: 0,
      maxRetries: DEFAULT_MAX_RETRIES,
      inputsSnapshot: def.inputs,
      outputsSnapshot: def.outputs,
      gatesSnapshot: def.acceptanceGates,
      executeConfigSnapshot: def.executeConfig,
      synthesizerProviderId: def.synthesizerProviderId,
      runtimeProviderId: def.runtimeProviderId,
      createdAt: now,
    });
  }

  enterSearchingReuse(phaseId: string): MetaWorkflowPhase {
    const phase = this.requirePhase(phaseId);
    assertPhaseStatusIn(phase.status, ['pending'], 'enter searching_reuse');
    assertPhaseTransition(phase.status, 'searching_reuse');
    return this.repo.update(phaseId, { status: 'searching_reuse' });
  }

  enterGenerating(phaseId: string, opts?: { reusedFromPoolId?: string }): MetaWorkflowPhase {
    const phase = this.requirePhase(phaseId);
    assertPhaseStatusIn(phase.status, ['searching_reuse'], 'enter generating');
    assertPhaseTransition(phase.status, 'generating');
    return this.repo.update(phaseId, {
      status: 'generating',
      reusedFromPoolId: opts?.reusedFromPoolId,
    });
  }

  enterReadyToRun(phaseId: string, opts?: {
    generatedWorkflowId?: string;
    generatedSubagentId?: string;
  }): MetaWorkflowPhase {
    const phase = this.requirePhase(phaseId);
    assertPhaseStatusIn(phase.status, ['searching_reuse', 'generating'], 'enter ready_to_run');
    assertPhaseTransition(phase.status, 'ready_to_run');
    return this.repo.update(phaseId, {
      status: 'ready_to_run',
      generatedWorkflowId: opts?.generatedWorkflowId,
      generatedSubagentId: opts?.generatedSubagentId,
    });
  }

  enterRunning(phaseId: string, opts?: {
    currentRunId?: string;
    worktreePath?: string;
  }): MetaWorkflowPhase {
    const phase = this.requirePhase(phaseId);
    assertPhaseStatusIn(phase.status, ['ready_to_run'], 'enter running');
    assertPhaseTransition(phase.status, 'running');
    return this.repo.update(phaseId, {
      status: 'running',
      currentRunId: opts?.currentRunId,
      worktreePath: opts?.worktreePath,
      attempt: phase.attempt + 1,
      startedAt: Date.now(),
    });
  }

  enterVerifyingGates(phaseId: string): MetaWorkflowPhase {
    const phase = this.requirePhase(phaseId);
    assertPhaseStatusIn(phase.status, ['running'], 'enter verifying_gates');
    assertPhaseTransition(phase.status, 'verifying_gates');
    return this.repo.update(phaseId, { status: 'verifying_gates' });
  }

  markDone(phaseId: string): MetaWorkflowPhase {
    const phase = this.requirePhase(phaseId);
    assertPhaseStatusIn(phase.status, ['verifying_gates'], 'mark done');
    assertPhaseTransition(phase.status, 'done');
    return this.repo.update(phaseId, { status: 'done', completedAt: Date.now() });
  }

  markFailed(phaseId: string, _reason?: string): MetaWorkflowPhase {
    const phase = this.requirePhase(phaseId);
    assertPhaseStatusIn(
      phase.status,
      ['searching_reuse', 'generating', 'ready_to_run', 'running', 'verifying_gates'],
      'mark failed',
    );
    assertPhaseTransition(phase.status, 'failed');
    return this.repo.update(phaseId, { status: 'failed', completedAt: Date.now() });
  }

  markStale(phaseId: string, staleSourcePhaseId: string): MetaWorkflowPhase {
    const phase = this.requirePhase(phaseId);
    // Only `done` is meaningfully "stale" — a `pending` phase will naturally read fresh
    // upstream artifacts when it eventually runs, so we ignore the call.
    if (phase.status === 'pending') return phase;
    assertPhaseStatusIn(phase.status, ['done'], 'mark stale');
    assertPhaseTransition(phase.status, 'stale');
    return this.repo.update(phaseId, {
      status: 'stale',
      staleSince: Date.now(),
      staleSourcePhaseId,
    });
  }

  clearStale(phaseId: string): MetaWorkflowPhase {
    const phase = this.requirePhase(phaseId);
    assertPhaseStatusIn(phase.status, ['stale'], 'clear stale on');
    assertPhaseTransition(phase.status, 'done');
    return this.repo.update(phaseId, {
      status: 'done',
      staleSince: null as unknown as undefined,
      staleSourcePhaseId: null as unknown as undefined,
    });
  }

  resetToPending(phaseId: string): MetaWorkflowPhase {
    const phase = this.requirePhase(phaseId);
    assertPhaseStatusIn(phase.status, ['failed', 'stale'], 'reset to pending');
    assertPhaseTransition(phase.status, 'pending');
    return this.repo.update(phaseId, { status: 'pending' });
  }

  private requirePhase(phaseId: string): MetaWorkflowPhase {
    const phase = this.repo.findById(phaseId);
    if (!phase) throw new Error(`Phase not found: ${phaseId}`);
    return phase;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/phase-aggregate.test.ts`

Expected: PASS (7 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/meta-workflow/phase-aggregate.ts \
        server/src/domains/meta-workflow/__tests__/phase-aggregate.test.ts
git commit -m "feat(meta-workflow): add MetaWorkflowPhaseAggregate"
```

---

## Task 7: phases.json Validator

**Files:**
- Create: `server/src/domains/meta-workflow/phases-json-validator.ts`
- Test: `server/src/domains/meta-workflow/__tests__/phases-json-validator.test.ts`

Hand-written validator (no zod dependency). Returns `{ ok: true, doc }` or `{ ok: false, errors: string[] }`. Checks:
1. JSON.parse safety
2. Top-level shape (`version: '1'`, `phases: array`, `smokePath: string[]`, `metadata` object)
3. Each phase shape (id non-empty, phaseType in enum, dependsOn array, gates non-empty array)
4. All `dependsOn` ids exist in phases
5. DAG is acyclic
6. At least one root (no deps)
7. `smokePath` is a valid path through the DAG

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/domains/meta-workflow/__tests__/phases-json-validator.test.ts
import { describe, it, expect } from 'vitest';
import { validatePhasesJson } from '../phases-json-validator.js';

const validDoc = {
  version: '1',
  phases: [
    {
      id: 'p1', name: 'Design', description: '', phaseType: 'design-doc',
      dependsOn: [], inputs: [], outputs: [{ kind: 'file', path: 'design/a.md', description: 'spec' }],
      acceptanceGates: [{ id: 'g1', description: 'doc exists', command: 'test -f design/a.md', expect: {} }],
    },
    {
      id: 'p2', name: 'Implement', description: '', phaseType: 'code-implement',
      dependsOn: ['p1'], inputs: [{ kind: 'file', source: 'design/a.md' }],
      outputs: [{ kind: 'commit', description: 'impl' }],
      acceptanceGates: [{ id: 'g2', description: 'compile', command: 'mvn compile', expect: { exitCode: 0 } }],
    },
  ],
  smokePath: ['p1', 'p2'],
  metadata: { generatedAt: 0, requirementsPath: 'design/requirements.md' },
};

describe('phases.json validator', () => {
  it('accepts a valid doc', () => {
    const result = validatePhasesJson(JSON.stringify(validDoc));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc.phases).toHaveLength(2);
  });

  it('rejects malformed JSON', () => {
    const result = validatePhasesJson('{not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/JSON/);
  });

  it('rejects missing version', () => {
    const bad = { ...validDoc, version: undefined };
    const result = validatePhasesJson(JSON.stringify(bad));
    expect(result.ok).toBe(false);
  });

  it('rejects invalid phaseType', () => {
    const bad = JSON.parse(JSON.stringify(validDoc));
    bad.phases[0].phaseType = 'invalid';
    const result = validatePhasesJson(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('|')).toMatch(/phaseType/);
  });

  it('rejects dangling dependsOn', () => {
    const bad = JSON.parse(JSON.stringify(validDoc));
    bad.phases[1].dependsOn = ['nonexistent'];
    const result = validatePhasesJson(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('|')).toMatch(/nonexistent/);
  });

  it('detects cycles', () => {
    const bad = JSON.parse(JSON.stringify(validDoc));
    bad.phases[0].dependsOn = ['p2'];
    const result = validatePhasesJson(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('|')).toMatch(/cycle/i);
  });

  it('requires at least one root', () => {
    const bad = JSON.parse(JSON.stringify(validDoc));
    bad.phases[0].dependsOn = ['p2'];
    bad.phases[1].dependsOn = ['p1'];
    const result = validatePhasesJson(JSON.stringify(bad));
    expect(result.ok).toBe(false);
  });

  it('rejects smokePath referencing missing phase', () => {
    const bad = JSON.parse(JSON.stringify(validDoc));
    bad.smokePath = ['p1', 'nonexistent'];
    const result = validatePhasesJson(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('|')).toMatch(/smokePath/);
  });

  it('rejects empty acceptanceGates', () => {
    const bad = JSON.parse(JSON.stringify(validDoc));
    bad.phases[0].acceptanceGates = [];
    const result = validatePhasesJson(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('|')).toMatch(/acceptanceGates/);
  });

  it('rejects acceptanceGate with empty command', () => {
    const bad = JSON.parse(JSON.stringify(validDoc));
    bad.phases[0].acceptanceGates[0].command = '';
    const result = validatePhasesJson(JSON.stringify(bad));
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/phases-json-validator.test.ts`

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

```typescript
// server/src/domains/meta-workflow/phases-json-validator.ts
import {
  PHASE_TYPES,
  EXECUTE_ENTITIES,
  type PhasesDoc,
  type PhaseDef,
  type PhaseType,
} from '@my-claudia/shared/features/meta-workflow';

export type ValidationResult =
  | { ok: true; doc: PhasesDoc }
  | { ok: false; errors: string[] };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

export function validatePhasesJson(input: string | unknown): ValidationResult {
  const errors: string[] = [];

  let raw: unknown;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (e) {
      return { ok: false, errors: [`Invalid JSON: ${(e as Error).message}`] };
    }
  } else {
    raw = input;
  }

  if (!isObject(raw)) return { ok: false, errors: ['Top-level value must be an object'] };

  if (raw.version !== '1') errors.push(`version must be '1', got ${JSON.stringify(raw.version)}`);

  if (!Array.isArray(raw.phases)) {
    errors.push('phases must be an array');
    return { ok: false, errors };
  }

  if (!isStringArray(raw.smokePath)) errors.push('smokePath must be an array of strings');

  if (!isObject(raw.metadata)) {
    errors.push('metadata must be an object');
  } else {
    if (typeof raw.metadata.generatedAt !== 'number') errors.push('metadata.generatedAt must be a number');
    if (typeof raw.metadata.requirementsPath !== 'string') errors.push('metadata.requirementsPath must be a string');
  }

  const phases: PhaseDef[] = [];
  const phaseIds = new Set<string>();

  for (let i = 0; i < raw.phases.length; i += 1) {
    const p = raw.phases[i];
    if (!isObject(p)) { errors.push(`phases[${i}] must be an object`); continue; }

    const id = p.id;
    if (typeof id !== 'string' || id.length === 0) { errors.push(`phases[${i}].id must be a non-empty string`); continue; }
    if (phaseIds.has(id)) errors.push(`Duplicate phase id: ${id}`);
    phaseIds.add(id);

    if (typeof p.name !== 'string') errors.push(`phases[${id}].name must be a string`);
    if (typeof p.description !== 'string') errors.push(`phases[${id}].description must be a string`);

    const phaseType = p.phaseType;
    if (typeof phaseType !== 'string' || !PHASE_TYPES.includes(phaseType as PhaseType)) {
      errors.push(`phases[${id}].phaseType must be one of ${PHASE_TYPES.join(', ')}; got ${JSON.stringify(phaseType)}`);
    }

    if (p.executeEntity !== undefined && (typeof p.executeEntity !== 'string'
        || !EXECUTE_ENTITIES.includes(p.executeEntity as never))) {
      errors.push(`phases[${id}].executeEntity must be one of ${EXECUTE_ENTITIES.join(', ')}`);
    }

    if (!isStringArray(p.dependsOn)) errors.push(`phases[${id}].dependsOn must be string[]`);
    if (!Array.isArray(p.inputs)) errors.push(`phases[${id}].inputs must be an array`);
    if (!Array.isArray(p.outputs)) errors.push(`phases[${id}].outputs must be an array`);

    if (!Array.isArray(p.acceptanceGates) || p.acceptanceGates.length === 0) {
      errors.push(`phases[${id}].acceptanceGates must be a non-empty array`);
    } else {
      for (let j = 0; j < p.acceptanceGates.length; j += 1) {
        const g = p.acceptanceGates[j];
        if (!isObject(g)) { errors.push(`phases[${id}].acceptanceGates[${j}] must be an object`); continue; }
        if (typeof g.id !== 'string' || !g.id) errors.push(`phases[${id}].acceptanceGates[${j}].id required`);
        if (typeof g.command !== 'string' || !g.command) {
          errors.push(`phases[${id}].acceptanceGates[${j}].command must be a non-empty string`);
        }
        if (!isObject(g.expect)) errors.push(`phases[${id}].acceptanceGates[${j}].expect must be an object`);
      }
    }

    phases.push(p as unknown as PhaseDef);
  }

  // Cross-phase checks
  for (const p of phases) {
    for (const dep of p.dependsOn) {
      if (!phaseIds.has(dep)) errors.push(`phases[${p.id}].dependsOn references nonexistent phase '${dep}'`);
    }
  }

  // At least one root
  const roots = phases.filter((p) => p.dependsOn.length === 0);
  if (roots.length === 0 && phases.length > 0) errors.push('At least one phase must have no dependsOn (root)');

  // Cycle detection (DFS)
  const adjacency = new Map<string, string[]>();
  for (const p of phases) adjacency.set(p.id, p.dependsOn);
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const p of phases) color.set(p.id, WHITE);

  function dfs(node: string): boolean {
    color.set(node, GRAY);
    for (const next of adjacency.get(node) ?? []) {
      const c = color.get(next);
      if (c === GRAY) return true;
      if (c === WHITE && dfs(next)) return true;
    }
    color.set(node, BLACK);
    return false;
  }

  for (const p of phases) {
    if (color.get(p.id) === WHITE && dfs(p.id)) {
      errors.push(`Phase graph contains a cycle (reachable from '${p.id}')`);
      break;
    }
  }

  // smokePath validity
  if (isStringArray(raw.smokePath)) {
    for (const id of raw.smokePath) {
      if (!phaseIds.has(id)) errors.push(`smokePath references nonexistent phase '${id}'`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, doc: raw as unknown as PhasesDoc };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/phases-json-validator.test.ts`

Expected: PASS (10 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/meta-workflow/phases-json-validator.ts \
        server/src/domains/meta-workflow/__tests__/phases-json-validator.test.ts
git commit -m "feat(meta-workflow): add hand-written phases.json validator"
```

---

## Task 8: Phase Template Expansion (extend interface + fill 6 stubs)

**Files:**
- Modify: `server/src/domains/meta-workflow/phase-templates/types.ts`
- Modify: all 6 stub files in `server/src/domains/meta-workflow/phase-templates/`
- Modify: `server/src/domains/meta-workflow/__tests__/phase-templates.test.ts` (extend assertions)

Extend `PhaseTemplate` with two methods:
- `buildSynthesizerPrompt(phase: PhaseDef): string` — the prompt template fed to `WorkflowGeneratorService` or subagent synthesis.
- `defaultGates(phase: PhaseDef): AcceptanceGate[]` — default gate skeletons (still empty for Phase B stubs that don't yet know project tooling, but the **method exists** with a deterministic shape; callers compose with `phase.acceptanceGates`).

Each phaseType stub returns a phaseType-specific prompt body.

- [ ] **Step 1: Extend `phase-templates/types.ts`**

Replace the existing contents with:

```typescript
// server/src/domains/meta-workflow/phase-templates/types.ts
import type {
  PhaseType,
  ExecuteEntity,
  ExecutePattern,
  AcceptanceGate,
  PhaseDef,
} from '@my-claudia/shared/features/meta-workflow';

export interface PhaseTemplate {
  readonly phaseType: PhaseType;
  readonly defaultExecuteEntity: ExecuteEntity;
  readonly defaultExecutePattern?: ExecutePattern;
  readonly defaultPlanRequired: boolean;
  readonly description: string;
  readonly defaultGateSkeletons: AcceptanceGate[];

  /**
   * Construct the synthesizer prompt for a phase of this type.
   * Used by `workflow-synthesizer` / `subagent-synthesizer` to drive
   * the existing `WorkflowGeneratorService` (or subagent prompt build).
   */
  buildSynthesizerPrompt(phase: PhaseDef): string;

  /**
   * Compose the canonical default gates for a phase of this type.
   * Implementations may use `phase` to parameterise commands (e.g.,
   * pick a test class name from outputs). For Phase B, most stubs
   * return an empty array; downstream phases fill them.
   */
  defaultGates(phase: PhaseDef): AcceptanceGate[];
}
```

- [ ] **Step 2: Update each stub — `code-implement.ts`**

```typescript
// server/src/domains/meta-workflow/phase-templates/code-implement.ts
import type { PhaseDef } from '@my-claudia/shared/features/meta-workflow';
import type { PhaseTemplate } from './types.js';

export const codeImplementTemplate: PhaseTemplate = {
  phaseType: 'code-implement',
  defaultExecuteEntity: 'workflow',
  defaultExecutePattern: 'self-healing',
  defaultPlanRequired: true,
  description: 'Implement a new feature, interface, or class in code.',
  defaultGateSkeletons: [],
  buildSynthesizerPrompt(phase: PhaseDef): string {
    return [
      `You are generating a workflow that implements phase "${phase.id}" (${phase.name}).`,
      `Description: ${phase.description}`,
      ``,
      `Phase type: code-implement.`,
      `Use the self-healing pattern: write → compile → if fail, fix → re-verify.`,
      `Plan node is required: produce plan.md before execute.`,
      ``,
      `Acceptance gates that MUST pass:`,
      ...phase.acceptanceGates.map((g) => `  - ${g.id}: ${g.command}`),
    ].join('\n');
  },
  defaultGates(_phase: PhaseDef) {
    // Phase B leaves these empty; phases.json supplies real commands.
    return [];
  },
};
```

- [ ] **Step 3: Update `code-refactor.ts`**

```typescript
// server/src/domains/meta-workflow/phase-templates/code-refactor.ts
import type { PhaseDef } from '@my-claudia/shared/features/meta-workflow';
import type { PhaseTemplate } from './types.js';

export const codeRefactorTemplate: PhaseTemplate = {
  phaseType: 'code-refactor',
  defaultExecuteEntity: 'workflow',
  defaultExecutePattern: 'self-healing',
  defaultPlanRequired: true,
  description: 'Refactor existing code while preserving behavior (tests unchanged).',
  defaultGateSkeletons: [],
  buildSynthesizerPrompt(phase: PhaseDef): string {
    return [
      `You are generating a workflow that refactors code in phase "${phase.id}" (${phase.name}).`,
      `Description: ${phase.description}`,
      ``,
      `Phase type: code-refactor.`,
      `Behavior must NOT change. The full test suite must pass before AND after this phase.`,
      `Use the self-healing pattern: refactor → run tests → if behavior changed, revise.`,
      ``,
      `Acceptance gates that MUST pass:`,
      ...phase.acceptanceGates.map((g) => `  - ${g.id}: ${g.command}`),
    ].join('\n');
  },
  defaultGates(_phase: PhaseDef) { return []; },
};
```

- [ ] **Step 4: Update `code-test-write.ts`**

```typescript
// server/src/domains/meta-workflow/phase-templates/code-test-write.ts
import type { PhaseDef } from '@my-claudia/shared/features/meta-workflow';
import type { PhaseTemplate } from './types.js';

export const codeTestWriteTemplate: PhaseTemplate = {
  phaseType: 'code-test-write',
  defaultExecuteEntity: 'workflow',
  defaultExecutePattern: 'multi-step',
  defaultPlanRequired: false,
  description: 'Write tests for code that is already implemented.',
  defaultGateSkeletons: [],
  buildSynthesizerPrompt(phase: PhaseDef): string {
    return [
      `You are generating a workflow that writes tests for phase "${phase.id}" (${phase.name}).`,
      `Description: ${phase.description}`,
      ``,
      `Phase type: code-test-write.`,
      `Use the multi-step pattern: identify uncovered behavior → write tests → run them → verify pass.`,
      ``,
      `Acceptance gates that MUST pass:`,
      ...phase.acceptanceGates.map((g) => `  - ${g.id}: ${g.command}`),
    ].join('\n');
  },
  defaultGates(_phase: PhaseDef) { return []; },
};
```

- [ ] **Step 5: Update `design-doc.ts`**

```typescript
// server/src/domains/meta-workflow/phase-templates/design-doc.ts
import type { PhaseDef } from '@my-claudia/shared/features/meta-workflow';
import type { PhaseTemplate } from './types.js';

export const designDocTemplate: PhaseTemplate = {
  phaseType: 'design-doc',
  defaultExecuteEntity: 'workflow',
  defaultExecutePattern: 'single-shot',
  defaultPlanRequired: false,
  description: 'Author a design document, API spec, or interface contract — no code produced.',
  defaultGateSkeletons: [],
  buildSynthesizerPrompt(phase: PhaseDef): string {
    return [
      `You are generating a workflow that authors a design document for phase "${phase.id}" (${phase.name}).`,
      `Description: ${phase.description}`,
      ``,
      `Phase type: design-doc.`,
      `No code change. Use the single-shot pattern: write the document at the path specified in outputs.`,
      ``,
      `Acceptance gates that MUST pass:`,
      ...phase.acceptanceGates.map((g) => `  - ${g.id}: ${g.command}`),
    ].join('\n');
  },
  defaultGates(_phase: PhaseDef) { return []; },
};
```

- [ ] **Step 6: Update `dep-update.ts`**

```typescript
// server/src/domains/meta-workflow/phase-templates/dep-update.ts
import type { PhaseDef } from '@my-claudia/shared/features/meta-workflow';
import type { PhaseTemplate } from './types.js';

export const depUpdateTemplate: PhaseTemplate = {
  phaseType: 'dep-update',
  defaultExecuteEntity: 'workflow',
  defaultExecutePattern: 'self-healing',
  defaultPlanRequired: true,
  description: 'Upgrade dependencies, modify build scripts, or change project configuration.',
  defaultGateSkeletons: [],
  buildSynthesizerPrompt(phase: PhaseDef): string {
    return [
      `You are generating a workflow that updates dependencies for phase "${phase.id}" (${phase.name}).`,
      `Description: ${phase.description}`,
      ``,
      `Phase type: dep-update.`,
      `Use the self-healing pattern: edit build files → build → if breakage, adapt code or pin alternative version.`,
      `Full test suite must pass at the end.`,
      ``,
      `Acceptance gates that MUST pass:`,
      ...phase.acceptanceGates.map((g) => `  - ${g.id}: ${g.command}`),
    ].join('\n');
  },
  defaultGates(_phase: PhaseDef) { return []; },
};
```

- [ ] **Step 7: Update `investigation.ts`**

```typescript
// server/src/domains/meta-workflow/phase-templates/investigation.ts
import type { PhaseDef } from '@my-claudia/shared/features/meta-workflow';
import type { PhaseTemplate } from './types.js';

export const investigationTemplate: PhaseTemplate = {
  phaseType: 'investigation',
  defaultExecuteEntity: 'subagent',
  defaultExecutePattern: undefined,
  defaultPlanRequired: false,
  description: 'Investigate, research, or analyze — produces a written report, no code change.',
  defaultGateSkeletons: [],
  buildSynthesizerPrompt(phase: PhaseDef): string {
    return [
      `You are an investigation subagent for phase "${phase.id}" (${phase.name}).`,
      `Description: ${phase.description}`,
      ``,
      `Phase type: investigation.`,
      `You may freely read files, grep, run read-only commands. Do NOT write code; you may only write a report file at the path specified in outputs.`,
      ``,
      `When the report exists and is non-empty, finish.`,
      ``,
      `Acceptance gates that MUST pass:`,
      ...phase.acceptanceGates.map((g) => `  - ${g.id}: ${g.command}`),
    ].join('\n');
  },
  defaultGates(_phase: PhaseDef) { return []; },
};
```

- [ ] **Step 8: Extend the registry test to also exercise the new methods**

Append these new `it` blocks to `server/src/domains/meta-workflow/__tests__/phase-templates.test.ts` (just before the final `});` of the describe block):

```typescript
  it('buildSynthesizerPrompt mentions the phaseType-specific pattern', () => {
    const phase = {
      id: 'p1', name: 'X', description: 'do x', phaseType: 'code-implement' as const,
      dependsOn: [], inputs: [], outputs: [],
      acceptanceGates: [{ id: 'g1', description: 'compile', command: 'mvn compile', expect: { exitCode: 0 } }],
    };
    const prompt = getPhaseTemplate('code-implement').buildSynthesizerPrompt(phase);
    expect(prompt).toMatch(/self-healing/);
    expect(prompt).toMatch(/mvn compile/);
  });

  it('investigation prompt mentions report file + read-only constraint', () => {
    const phase = {
      id: 'p1', name: 'X', description: 'investigate y', phaseType: 'investigation' as const,
      dependsOn: [], inputs: [], outputs: [],
      acceptanceGates: [{ id: 'g1', description: 'report exists', command: 'test -f report.md', expect: { exitCode: 0 } }],
    };
    const prompt = getPhaseTemplate('investigation').buildSynthesizerPrompt(phase);
    expect(prompt).toMatch(/report/i);
    expect(prompt).toMatch(/Do NOT write code/);
  });

  it('defaultGates returns empty array (Phase B stub behavior)', () => {
    const phase = {
      id: 'p1', name: 'X', description: 'x', phaseType: 'code-implement' as const,
      dependsOn: [], inputs: [], outputs: [],
      acceptanceGates: [{ id: 'g1', description: 'g', command: 'c', expect: {} }],
    };
    expect(getPhaseTemplate('code-implement').defaultGates(phase)).toEqual([]);
  });
```

- [ ] **Step 9: Run all phase-template tests**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/phase-templates.test.ts`

Expected: PASS (6 original + 3 new = 9 assertions).

- [ ] **Step 10: Commit**

```bash
git add server/src/domains/meta-workflow/phase-templates/types.ts \
        server/src/domains/meta-workflow/phase-templates/code-implement.ts \
        server/src/domains/meta-workflow/phase-templates/code-refactor.ts \
        server/src/domains/meta-workflow/phase-templates/code-test-write.ts \
        server/src/domains/meta-workflow/phase-templates/design-doc.ts \
        server/src/domains/meta-workflow/phase-templates/dep-update.ts \
        server/src/domains/meta-workflow/phase-templates/investigation.ts \
        server/src/domains/meta-workflow/__tests__/phase-templates.test.ts
git commit -m "feat(meta-workflow): expand phase templates with synthesizer prompts"
```

---

## Task 9: Workflow Synthesizer

**Files:**
- Create: `server/src/domains/meta-workflow/workflow-synthesizer.ts`
- Test: `server/src/domains/meta-workflow/__tests__/workflow-synthesizer.test.ts`

Builds a deterministic `WorkflowDefinition` (a 5-node Skeleton+Slot DAG) from a `PhaseDef`. Phase B uses a hand-coded synthesizer that emits the canonical skeleton (`context_load → plan → execute → verify → commit`) without calling the existing AI-driven `WorkflowGeneratorService` — that integration happens in Phase D when reuse-pool + advanced generation come online. The deterministic synthesizer is what Phase B's smoke test will drive.

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/domains/meta-workflow/__tests__/workflow-synthesizer.test.ts
import { describe, it, expect } from 'vitest';
import { synthesizeWorkflow } from '../workflow-synthesizer.js';
import type { PhaseDef } from '@my-claudia/shared/features/meta-workflow';

const phase: PhaseDef = {
  id: 'p1', name: 'Impl X', description: 'Implement X',
  phaseType: 'code-implement',
  dependsOn: [],
  inputs: [{ kind: 'file', source: 'design/requirements.md' }],
  outputs: [{ kind: 'commit', description: 'commit' }],
  acceptanceGates: [
    { id: 'compile', description: 'compile', command: 'mvn compile', expect: { exitCode: 0 } },
    { id: 'tests', description: 'tests', command: 'mvn test', expect: { exitCode: 0 } },
  ],
};

describe('workflow synthesizer', () => {
  it('returns the 5 skeleton nodes in order', () => {
    const def = synthesizeWorkflow(phase);
    const ids = def.nodes.map((n) => n.id);
    expect(ids).toEqual(['context_load', 'plan', 'execute', 'verify', 'commit']);
    expect(def.entryNodeId).toBe('context_load');
  });

  it('plan node is skipped if planRequired=false (single-shot)', () => {
    const designPhase: PhaseDef = { ...phase, phaseType: 'design-doc' };
    const def = synthesizeWorkflow(designPhase);
    const ids = def.nodes.map((n) => n.id);
    expect(ids).toContain('plan');  // node still exists but is set up to fast-path
    // Behavioral check: the design-doc template returns planRequired=false,
    // so the plan node's config should mark it as optional.
    const planNode = def.nodes.find((n) => n.id === 'plan');
    expect(planNode?.config?.planRequired).toBe(false);
  });

  it('verify node embeds acceptanceGates as shell sub-steps', () => {
    const def = synthesizeWorkflow(phase);
    const verifyNode = def.nodes.find((n) => n.id === 'verify');
    expect(verifyNode?.type).toBe('shell');
    const cfg = verifyNode!.config as { gates: { id: string; command: string }[] };
    expect(cfg.gates).toHaveLength(2);
    expect(cfg.gates[0].command).toBe('mvn compile');
    expect(cfg.gates[1].command).toBe('mvn test');
  });

  it('execute node embeds the phaseType prompt', () => {
    const def = synthesizeWorkflow(phase);
    const exec = def.nodes.find((n) => n.id === 'execute');
    expect(exec?.type).toBe('ai_prompt');
    expect((exec!.config as { prompt: string }).prompt).toMatch(/self-healing/);
    expect((exec!.config as { prompt: string }).prompt).toMatch(/Implement X/);
  });

  it('linear edges connect all 5 nodes', () => {
    const def = synthesizeWorkflow(phase);
    expect(def.edges.map((e) => `${e.source}->${e.target}`)).toEqual([
      'context_load->plan',
      'plan->execute',
      'execute->verify',
      'verify->commit',
    ]);
  });

  it('propagates runtime provider id to ai_prompt nodes', () => {
    const def = synthesizeWorkflow({ ...phase, runtimeProviderId: 'provider-x' });
    const aiNodes = def.nodes.filter((n) => n.type === 'ai_prompt');
    for (const n of aiNodes) {
      expect((n.config as { providerId?: string }).providerId).toBe('provider-x');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/workflow-synthesizer.test.ts`

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

```typescript
// server/src/domains/meta-workflow/workflow-synthesizer.ts
import type {
  PhaseDef,
} from '@my-claudia/shared/features/meta-workflow';
import type {
  WorkflowDefinition,
  WorkflowNodeDef,
  WorkflowEdgeDef,
} from '@my-claudia/shared/features/workflows';
import { getPhaseTemplate } from './phase-templates/index.js';

/**
 * Build the deterministic 5-node Skeleton+Slot WorkflowDefinition for a phase.
 * Phase B: hand-coded skeleton. Phase D+: enriched with AI-generated `execute`
 * slot via the reuse-pool / WorkflowGeneratorService.
 */
export function synthesizeWorkflow(phase: PhaseDef): WorkflowDefinition {
  const template = getPhaseTemplate(phase.phaseType);
  const planRequired = phase.executeConfig?.planRequired ?? template.defaultPlanRequired;
  const providerId = phase.runtimeProviderId;
  const prompt = template.buildSynthesizerPrompt(phase);

  const nodes: WorkflowNodeDef[] = [
    {
      id: 'context_load',
      name: 'Load context',
      type: 'ai_prompt',
      config: {
        prompt: `Load context for phase "${phase.id}". Inputs: ${JSON.stringify(phase.inputs)}. Outputs expected: ${JSON.stringify(phase.outputs)}.`,
        providerId,
      },
      position: { x: 100, y: 100 },
    },
    {
      id: 'plan',
      name: 'Plan',
      type: 'ai_prompt',
      config: {
        prompt: planRequired
          ? `Produce a plan.md for phase "${phase.id}". Description: ${phase.description}.`
          : `(planRequired=false) skip planning; pass through.`,
        planRequired,
        providerId,
      },
      position: { x: 100, y: 200 },
    },
    {
      id: 'execute',
      name: 'Execute',
      type: 'ai_prompt',
      config: { prompt, providerId },
      position: { x: 100, y: 300 },
    },
    {
      id: 'verify',
      name: 'Verify acceptance gates',
      type: 'shell',
      config: {
        gates: phase.acceptanceGates.map((g) => ({
          id: g.id,
          command: g.command,
          cwd: g.cwd,
          expect: g.expect,
        })),
      },
      position: { x: 100, y: 400 },
    },
    {
      id: 'commit',
      name: 'Commit phase outputs',
      type: 'git_commit',
      config: {
        message: `phase ${phase.id}: ${phase.name}`,
      },
      position: { x: 100, y: 500 },
    },
  ];

  const edges: WorkflowEdgeDef[] = [
    { id: 'e1', source: 'context_load', target: 'plan', type: 'success' },
    { id: 'e2', source: 'plan', target: 'execute', type: 'success' },
    { id: 'e3', source: 'execute', target: 'verify', type: 'success' },
    { id: 'e4', source: 'verify', target: 'commit', type: 'success' },
  ];

  return {
    nodes,
    edges,
    entryNodeId: 'context_load',
    triggers: [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/workflow-synthesizer.test.ts`

Expected: PASS (6 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/meta-workflow/workflow-synthesizer.ts \
        server/src/domains/meta-workflow/__tests__/workflow-synthesizer.test.ts
git commit -m "feat(meta-workflow): add deterministic workflow synthesizer"
```

---

## Task 10: Subagent Synthesizer

**Files:**
- Create: `server/src/domains/meta-workflow/subagent-synthesizer.ts`
- Test: `server/src/domains/meta-workflow/__tests__/subagent-synthesizer.test.ts`

Builds a `MetaSubagentTemplate` from a `PhaseDef` for `investigation` phases (or any phase explicitly set to `executeEntity='subagent'`).

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/domains/meta-workflow/__tests__/subagent-synthesizer.test.ts
import { describe, it, expect } from 'vitest';
import { synthesizeSubagent } from '../subagent-synthesizer.js';
import type { PhaseDef } from '@my-claudia/shared/features/meta-workflow';

const investigationPhase: PhaseDef = {
  id: 'p1', name: 'Investigate', description: 'figure out why X is slow',
  phaseType: 'investigation',
  dependsOn: [],
  inputs: [],
  outputs: [{ kind: 'file', path: 'investigation-report.md', description: 'report' }],
  acceptanceGates: [
    { id: 'has-report', description: 'report exists', command: 'test -s investigation-report.md', expect: { exitCode: 0 } },
  ],
};

describe('subagent synthesizer', () => {
  it('produces a template with phaseType-specific prompt', () => {
    const tmpl = synthesizeSubagent(investigationPhase);
    expect(tmpl.systemPrompt).toMatch(/investigate/i);
    expect(tmpl.systemPrompt).toMatch(/Do NOT write code/);
  });

  it('restricts tools to read-only set for investigation', () => {
    const tmpl = synthesizeSubagent(investigationPhase);
    expect(tmpl.allowedTools).toContain('Read');
    expect(tmpl.allowedTools).toContain('Grep');
    expect(tmpl.allowedTools).not.toContain('Edit');
    expect(tmpl.allowedTools).not.toContain('Write');
  });

  it('uses output-file termination when outputs contain a file', () => {
    const tmpl = synthesizeSubagent(investigationPhase);
    expect(tmpl.terminationCondition.kind).toBe('output-file');
    expect(tmpl.terminationCondition.target).toBe('investigation-report.md');
  });

  it('default maxTurns is reasonable', () => {
    const tmpl = synthesizeSubagent(investigationPhase);
    expect(tmpl.maxTurns).toBe(30);
  });

  it('respects maxSubagentTurns override from phase config', () => {
    const tmpl = synthesizeSubagent({ ...investigationPhase, executeConfig: { maxSubagentTurns: 12 } });
    expect(tmpl.maxTurns).toBe(12);
  });

  it('sourceType is auto on generation', () => {
    const tmpl = synthesizeSubagent(investigationPhase);
    expect(tmpl.sourceType).toBe('auto');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/subagent-synthesizer.test.ts`

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

```typescript
// server/src/domains/meta-workflow/subagent-synthesizer.ts
import type {
  PhaseDef,
  MetaSubagentTemplate,
  MetaSubagentTerminationCondition,
} from '@my-claudia/shared/features/meta-workflow';
import { getPhaseTemplate } from './phase-templates/index.js';
import { v4 as uuidv4 } from 'uuid';

const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob', 'Bash', 'WebFetch', 'WebSearch'];

export function synthesizeSubagent(phase: PhaseDef): MetaSubagentTemplate {
  const template = getPhaseTemplate(phase.phaseType);
  const systemPrompt = template.buildSynthesizerPrompt(phase);

  // Determine termination: prefer the first file output, else fall back to a keyword.
  const fileOutput = phase.outputs.find((o) => o.kind === 'file' && o.path);
  const terminationCondition: MetaSubagentTerminationCondition = fileOutput?.path
    ? { kind: 'output-file', target: fileOutput.path }
    : { kind: 'output-keyword', target: '[INVESTIGATION_COMPLETE]' };

  const maxTurns = phase.executeConfig?.maxSubagentTurns ?? 30;

  const now = Date.now();
  return {
    id: uuidv4(),
    name: undefined,
    systemPrompt,
    allowedTools: [...READ_ONLY_TOOLS],
    maxTurns,
    terminationCondition,
    sourceType: 'auto',
    createdAt: now,
    updatedAt: now,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/subagent-synthesizer.test.ts`

Expected: PASS (6 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/meta-workflow/subagent-synthesizer.ts \
        server/src/domains/meta-workflow/__tests__/subagent-synthesizer.test.ts
git commit -m "feat(meta-workflow): add subagent synthesizer for investigation phases"
```

---

## Task 11: Gate Runner

**Files:**
- Create: `server/src/domains/meta-workflow/gate-runner.ts`
- Test: `server/src/domains/meta-workflow/__tests__/gate-runner.test.ts`

Executes one or more `AcceptanceGate`s by spawning shell commands and checking `expect` matches (exitCode + stdoutMatches + stderrMatches + fileExists + fileNotExists + durationMaxMs). Returns `MetaWorkflowGateResult[]`. Synchronous-style API but uses `child_process.spawn`.

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/domains/meta-workflow/__tests__/gate-runner.test.ts
import { describe, it, expect } from 'vitest';
import { runGate, runGates } from '../gate-runner.js';
import type { AcceptanceGate } from '@my-claudia/shared/features/meta-workflow';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'gate-runner-'));
}

describe('gate runner', () => {
  it('passes when exit code matches', async () => {
    const gate: AcceptanceGate = {
      id: 'echo', description: 'echo ok', command: 'echo hello', expect: { exitCode: 0 },
    };
    const result = await runGate(gate, tmpDir());
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/hello/);
  });

  it('fails when exit code does not match', async () => {
    const gate: AcceptanceGate = {
      id: 'fail', description: 'exit 1', command: 'exit 1', expect: { exitCode: 0 },
    };
    const result = await runGate(gate, tmpDir());
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('checks stdoutMatches regex', async () => {
    const gate: AcceptanceGate = {
      id: 'm', description: 'm', command: 'echo SUCCESS-42',
      expect: { exitCode: 0, stdoutMatches: 'SUCCESS-\\d+' },
    };
    const result = await runGate(gate, tmpDir());
    expect(result.passed).toBe(true);
  });

  it('fails when stdoutMatches does not match', async () => {
    const gate: AcceptanceGate = {
      id: 'm', description: 'm', command: 'echo something',
      expect: { exitCode: 0, stdoutMatches: 'NOPE' },
    };
    const result = await runGate(gate, tmpDir());
    expect(result.passed).toBe(false);
  });

  it('checks fileExists', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'created.txt'), 'x');
    const gate: AcceptanceGate = {
      id: 'fe', description: 'file exists', command: 'true',
      expect: { exitCode: 0, fileExists: ['created.txt'] },
    };
    const result = await runGate(gate, dir);
    expect(result.passed).toBe(true);
  });

  it('checks fileNotExists', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'should-be-gone.txt'), 'x');
    const gate: AcceptanceGate = {
      id: 'fne', description: 'file is gone', command: 'true',
      expect: { exitCode: 0, fileNotExists: ['should-be-gone.txt'] },
    };
    const result = await runGate(gate, dir);
    expect(result.passed).toBe(false);
  });

  it('respects durationMaxMs (fast command passes)', async () => {
    const gate: AcceptanceGate = {
      id: 'fast', description: 'quick', command: 'true', expect: { exitCode: 0, durationMaxMs: 5000 },
    };
    const result = await runGate(gate, tmpDir());
    expect(result.passed).toBe(true);
  });

  it('runs multiple gates sequentially and short-circuits at first failure (optional)', async () => {
    const gates: AcceptanceGate[] = [
      { id: 'a', description: 'a', command: 'true', expect: { exitCode: 0 } },
      { id: 'b', description: 'b', command: 'false', expect: { exitCode: 0 } },
      { id: 'c', description: 'c', command: 'true', expect: { exitCode: 0 } },
    ];
    const results = await runGates(gates, tmpDir(), { stopOnFirstFailure: true });
    expect(results.map((r) => r.gateId)).toEqual(['a', 'b']);
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(false);
  });

  it('runs all gates by default', async () => {
    const gates: AcceptanceGate[] = [
      { id: 'a', description: 'a', command: 'true', expect: { exitCode: 0 } },
      { id: 'b', description: 'b', command: 'false', expect: { exitCode: 0 } },
      { id: 'c', description: 'c', command: 'true', expect: { exitCode: 0 } },
    ];
    const results = await runGates(gates, tmpDir());
    expect(results).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/gate-runner.test.ts`

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

```typescript
// server/src/domains/meta-workflow/gate-runner.ts
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import type {
  AcceptanceGate,
  MetaWorkflowGateResult,
} from '@my-claudia/shared/features/meta-workflow';

export interface RunGatesOptions {
  stopOnFirstFailure?: boolean;
}

export async function runGate(gate: AcceptanceGate, cwd: string): Promise<MetaWorkflowGateResult> {
  const effectiveCwd = gate.cwd ? join(cwd, gate.cwd) : cwd;
  const start = Date.now();

  const { stdout, stderr, exitCode, timedOut } = await execShell(gate.command, effectiveCwd, gate.expect.durationMaxMs);
  const durationMs = Date.now() - start;

  const expectedExit = gate.expect.exitCode ?? 0;
  let passed = !timedOut && exitCode === expectedExit;

  if (passed && gate.expect.stdoutMatches) {
    passed = new RegExp(gate.expect.stdoutMatches).test(stdout);
  }
  if (passed && gate.expect.stderrMatches) {
    passed = new RegExp(gate.expect.stderrMatches).test(stderr);
  }
  if (passed && gate.expect.fileExists) {
    for (const rel of gate.expect.fileExists) {
      const p = isAbsolute(rel) ? rel : join(effectiveCwd, rel);
      if (!existsSync(p)) { passed = false; break; }
    }
  }
  if (passed && gate.expect.fileNotExists) {
    for (const rel of gate.expect.fileNotExists) {
      const p = isAbsolute(rel) ? rel : join(effectiveCwd, rel);
      if (existsSync(p)) { passed = false; break; }
    }
  }

  return {
    gateId: gate.id,
    passed,
    stdout,
    stderr,
    exitCode,
    durationMs,
  };
}

export async function runGates(
  gates: AcceptanceGate[],
  cwd: string,
  opts: RunGatesOptions = {},
): Promise<MetaWorkflowGateResult[]> {
  const results: MetaWorkflowGateResult[] = [];
  for (const gate of gates) {
    const result = await runGate(gate, cwd);
    results.push(result);
    if (!result.passed && opts.stopOnFirstFailure) break;
  }
  return results;
}

function execShell(
  command: string,
  cwd: string,
  timeoutMs?: number,
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = timeoutMs ? setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs) : null;

    child.stdout?.on('data', (b: Buffer) => { stdout += b.toString(); });
    child.stderr?.on('data', (b: Buffer) => { stderr += b.toString(); });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? -1, timedOut });
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/gate-runner.test.ts`

Expected: PASS (9 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/meta-workflow/gate-runner.ts \
        server/src/domains/meta-workflow/__tests__/gate-runner.test.ts
git commit -m "feat(meta-workflow): add acceptance-gate shell runner"
```

---

## Task 12: MetaPhaseExecutor

**Files:**
- Create: `server/src/domains/meta-workflow/phase-executor.ts`
- Test: `server/src/domains/meta-workflow/__tests__/phase-executor.test.ts`

The orchestrator. Given a `MetaWorkflowPhase` record and its `PhaseDef`:
1. Transitions phase pending → searching_reuse → generating → ready_to_run
2. Calls `synthesizeWorkflow` or `synthesizeSubagent` based on `executeEntity`
3. Persists the generated entity id on the phase
4. Transitions to `running`
5. **For Phase B: skips the actual workflow-engine execution** — that's deferred to the WorkflowRuntime integration test in Phase C/D. Instead, the executor accepts an injected "runner" function for testability.
6. Transitions to `verifying_gates`
7. Runs `gate-runner.runGates`
8. If all pass → `markDone`; if any fail → `markFailed`

The executor returns `{ phase, gateResults }`.

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/domains/meta-workflow/__tests__/phase-executor.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaWorkflowPhaseRepository } from '../repositories/meta-workflow-phase-repository.js';
import { MetaWorkflowPhaseAggregate } from '../phase-aggregate.js';
import { MetaPhaseExecutor } from '../phase-executor.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PhaseDef } from '@my-claudia/shared/features/meta-workflow';

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

const phaseDef: PhaseDef = {
  id: 'p1', name: 'Echo', description: 'echo something',
  phaseType: 'code-implement',
  dependsOn: [],
  inputs: [],
  outputs: [{ kind: 'commit', description: 'commit' }],
  acceptanceGates: [
    { id: 'g1', description: 'ok', command: 'true', expect: { exitCode: 0 } },
  ],
};

describe('MetaPhaseExecutor', () => {
  let db: Database.Database;
  let agg: MetaWorkflowPhaseAggregate;
  let workdir: string;

  beforeEach(() => {
    db = freshDb();
    agg = new MetaWorkflowPhaseAggregate(new MetaWorkflowPhaseRepository(db));
    workdir = mkdtempSync(join(tmpdir(), 'phase-exec-'));
  });

  it('drives a workflow phase to done when gates pass', async () => {
    const phase = agg.instantiate('run-1', phaseDef);
    const executor = new MetaPhaseExecutor({
      aggregate: agg,
      runEntity: async () => ({ exitOk: true }),  // pretend the workflow ran fine
    });
    const result = await executor.execute(phase.id, phaseDef, workdir);
    expect(result.phase.status).toBe('done');
    expect(result.gateResults[0].passed).toBe(true);
  });

  it('marks failed when gate command fails', async () => {
    const failPhase: PhaseDef = {
      ...phaseDef,
      acceptanceGates: [{ id: 'g1', description: 'no', command: 'false', expect: { exitCode: 0 } }],
    };
    const phase = agg.instantiate('run-1', failPhase);
    const executor = new MetaPhaseExecutor({
      aggregate: agg,
      runEntity: async () => ({ exitOk: true }),
    });
    const result = await executor.execute(phase.id, failPhase, workdir);
    expect(result.phase.status).toBe('failed');
    expect(result.gateResults[0].passed).toBe(false);
  });

  it('marks failed when entity runner reports failure (skips gates)', async () => {
    const phase = agg.instantiate('run-1', phaseDef);
    const executor = new MetaPhaseExecutor({
      aggregate: agg,
      runEntity: async () => ({ exitOk: false }),
    });
    const result = await executor.execute(phase.id, phaseDef, workdir);
    expect(result.phase.status).toBe('failed');
    expect(result.gateResults).toEqual([]);
  });

  it('persists generatedWorkflowId after synthesizing a workflow', async () => {
    const phase = agg.instantiate('run-1', phaseDef);
    const executor = new MetaPhaseExecutor({
      aggregate: agg,
      runEntity: async () => ({ exitOk: true }),
    });
    await executor.execute(phase.id, phaseDef, workdir);
    const final = agg['repo'].findById(phase.id);
    expect(final?.generatedWorkflowId).toBeTruthy();
  });

  it('uses subagent path for investigation phaseType', async () => {
    const invDef: PhaseDef = { ...phaseDef, id: 'p2', phaseType: 'investigation',
                               outputs: [{ kind: 'file', path: 'rep.md', description: 'rep' }] };
    const phase = agg.instantiate('run-1', invDef);
    let seenEntityKind: string | undefined;
    const executor = new MetaPhaseExecutor({
      aggregate: agg,
      runEntity: async (entity) => { seenEntityKind = entity.kind; return { exitOk: true }; },
    });
    await executor.execute(phase.id, invDef, workdir);
    expect(seenEntityKind).toBe('subagent');
    const final = agg['repo'].findById(phase.id);
    expect(final?.generatedSubagentId).toBeTruthy();
    expect(final?.generatedWorkflowId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/phase-executor.test.ts`

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

```typescript
// server/src/domains/meta-workflow/phase-executor.ts
import type {
  MetaWorkflowPhase,
  PhaseDef,
  MetaWorkflowGateResult,
  MetaSubagentTemplate,
} from '@my-claudia/shared/features/meta-workflow';
import type { WorkflowDefinition } from '@my-claudia/shared/features/workflows';
import { MetaWorkflowPhaseAggregate } from './phase-aggregate.js';
import { synthesizeWorkflow } from './workflow-synthesizer.js';
import { synthesizeSubagent } from './subagent-synthesizer.js';
import { runGates } from './gate-runner.js';

export type SynthesizedEntity =
  | { kind: 'workflow'; workflow: WorkflowDefinition; workflowId: string }
  | { kind: 'subagent'; subagent: MetaSubagentTemplate };

export interface RunEntityOutcome {
  exitOk: boolean;
}

export type RunEntity = (entity: SynthesizedEntity, opts: { worktreePath: string }) => Promise<RunEntityOutcome>;

export interface MetaPhaseExecutorOptions {
  aggregate: MetaWorkflowPhaseAggregate;
  /** Injected runner — Phase B uses a stub; Phase C+ wires the real workflow engine. */
  runEntity: RunEntity;
}

export interface PhaseExecutionResult {
  phase: MetaWorkflowPhase;
  gateResults: MetaWorkflowGateResult[];
}

export class MetaPhaseExecutor {
  constructor(private opts: MetaPhaseExecutorOptions) {}

  async execute(
    phaseRecordId: string,
    def: PhaseDef,
    worktreePath: string,
  ): Promise<PhaseExecutionResult> {
    const { aggregate, runEntity } = this.opts;

    // pending → searching_reuse (Phase B: skip pool search, go straight to generating)
    aggregate.enterSearchingReuse(phaseRecordId);
    aggregate.enterGenerating(phaseRecordId);

    // Synthesize the entity according to executeEntity.
    const executeEntity = def.executeEntity ?? this.defaultExecuteEntityFor(def.phaseType);
    let entity: SynthesizedEntity;
    if (executeEntity === 'subagent') {
      const subagent = synthesizeSubagent(def);
      entity = { kind: 'subagent', subagent };
      aggregate.enterReadyToRun(phaseRecordId, { generatedSubagentId: subagent.id });
    } else {
      const workflow = synthesizeWorkflow(def);
      const workflowId = `auto-${phaseRecordId}`;
      entity = { kind: 'workflow', workflow, workflowId };
      aggregate.enterReadyToRun(phaseRecordId, { generatedWorkflowId: workflowId });
    }

    aggregate.enterRunning(phaseRecordId, { worktreePath });

    let runOutcome: RunEntityOutcome;
    try {
      runOutcome = await runEntity(entity, { worktreePath });
    } catch (e) {
      const phase = aggregate.markFailed(phaseRecordId, (e as Error).message);
      return { phase, gateResults: [] };
    }

    if (!runOutcome.exitOk) {
      const phase = aggregate.markFailed(phaseRecordId, 'entity runner reported failure');
      return { phase, gateResults: [] };
    }

    aggregate.enterVerifyingGates(phaseRecordId);

    const gateResults = await runGates(def.acceptanceGates, worktreePath);
    const allPassed = gateResults.every((r) => r.passed);

    const phase = allPassed
      ? aggregate.markDone(phaseRecordId)
      : aggregate.markFailed(phaseRecordId, 'one or more acceptance gates failed');
    return { phase, gateResults };
  }

  private defaultExecuteEntityFor(phaseType: PhaseDef['phaseType']): 'workflow' | 'subagent' {
    return phaseType === 'investigation' ? 'subagent' : 'workflow';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/phase-executor.test.ts`

Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/meta-workflow/phase-executor.ts \
        server/src/domains/meta-workflow/__tests__/phase-executor.test.ts
git commit -m "feat(meta-workflow): add MetaPhaseExecutor orchestrating synth + gates"
```

---

## Task 13: CRUD ClientMessages

**Files:**
- Modify: `shared/src/protocol/messages/meta-workflow.ts` (add Client→Server CRUD)
- Modify: `shared/src/protocol/messages/index.ts` (extend ClientMessage union)
- Test: `shared/src/features/__tests__/meta-workflow-protocol.test.ts` (extend coverage)

Phase B adds the **message types only**. Server-side handlers wiring them to the new aggregates lives in Phase C (HTTP routes / WebSocket handler).

- [ ] **Step 1: Extend `shared/src/protocol/messages/meta-workflow.ts`**

Append these interfaces after the existing two Server→Client messages:

```typescript
// Client → Server: create a new meta-workflow run
export interface CreateMetaWorkflowRunMessage {
  type: 'create_meta_workflow_run';
  projectId: string;
  title: string;
  description?: string;
  defaultProviderId?: string;
}

// Client → Server: submit requirements.md path
export interface SubmitMetaWorkflowRequirementsMessage {
  type: 'submit_meta_workflow_requirements';
  runId: string;
  requirementsPath: string;
}

// Client → Server: approve or reject requirements
export interface ResolveMetaWorkflowRequirementsMessage {
  type: 'resolve_meta_workflow_requirements';
  runId: string;
  decision: 'approve' | 'reject';
}

// Client → Server: write phases.json into the run (after decomposition AI step)
export interface SetMetaWorkflowPhasesMessage {
  type: 'set_meta_workflow_phases';
  runId: string;
  phasesJson: string;
}

// Client → Server: cancel the entire run
export interface CancelMetaWorkflowRunMessage {
  type: 'cancel_meta_workflow_run';
  runId: string;
}

// Client → Server: trigger execution of one specific phase
export interface RunMetaWorkflowPhaseMessage {
  type: 'run_meta_workflow_phase';
  runId: string;
  phaseId: string;
}
```

- [ ] **Step 2: Wire into `shared/src/protocol/messages/index.ts`**

Find the `ClientMessage` union (around line 57-112). After the existing `// Claudia Tasks` block (just before `// Notifications`), insert:

```typescript
  // Meta Workflow
  | CreateMetaWorkflowRunMessage
  | SubmitMetaWorkflowRequirementsMessage
  | ResolveMetaWorkflowRequirementsMessage
  | SetMetaWorkflowPhasesMessage
  | CancelMetaWorkflowRunMessage
  | RunMetaWorkflowPhaseMessage
```

In the `ClientMessage` import block at top of the file (around line 23-55), add:

```typescript
import type {
  CreateMetaWorkflowRunMessage,
  SubmitMetaWorkflowRequirementsMessage,
  ResolveMetaWorkflowRequirementsMessage,
  SetMetaWorkflowPhasesMessage,
  CancelMetaWorkflowRunMessage,
  RunMetaWorkflowPhaseMessage,
} from './meta-workflow.js';
```

- [ ] **Step 3: Extend the existing protocol test**

Open `shared/src/features/__tests__/meta-workflow-protocol.test.ts`. Append the following `it` blocks before the closing `});`:

```typescript
  it('CreateMetaWorkflowRunMessage is a valid ClientMessage', async () => {
    const { describe, it, expect } = await import('vitest');
    void describe; void it; void expect;
    const _msg: import('../../protocol/messages/meta-workflow.js').CreateMetaWorkflowRunMessage = {
      type: 'create_meta_workflow_run',
      projectId: 'p',
      title: 't',
    };
    const _asUnion: import('../../protocol/messages/index.js').ClientMessage = _msg;
    expect(_asUnion.type).toBe('create_meta_workflow_run');
  });

  it('RunMetaWorkflowPhaseMessage roundtrips through union', () => {
    const msg: import('../../protocol/messages/meta-workflow.js').RunMetaWorkflowPhaseMessage = {
      type: 'run_meta_workflow_phase',
      runId: 'r',
      phaseId: 'p',
    };
    const asUnion: import('../../protocol/messages/index.js').ClientMessage = msg;
    expect(asUnion.type).toBe('run_meta_workflow_phase');
  });
```

- [ ] **Step 4: Run tests + cross-package type-check**

```bash
pnpm --filter @my-claudia/shared exec vitest run src/features/__tests__/meta-workflow-protocol.test.ts
pnpm --filter @my-claudia/shared build
pnpm --filter @my-claudia/server exec tsc --noEmit
pnpm --filter @my-claudia/desktop exec tsc --noEmit
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add shared/src/protocol/messages/meta-workflow.ts \
        shared/src/protocol/messages/index.ts \
        shared/src/features/__tests__/meta-workflow-protocol.test.ts
git commit -m "feat(meta-workflow): add Client→Server CRUD protocol messages"
```

---

## Task 14: Domain Index + Full Smoke Verification

**Files:**
- Modify: `server/src/domains/meta-workflow/index.ts` (export new modules)

- [ ] **Step 1: Update the domain index to export new public surface**

Replace `server/src/domains/meta-workflow/index.ts` with:

```typescript
// server/src/domains/meta-workflow/index.ts
/**
 * Meta Workflow domain — public surface.
 *
 * Phase B: aggregates, repositories, synthesizers, validator, gate runner,
 * and phase executor. Subsequent phases will export a register() factory
 * + HTTP routes + the WorkflowRuntime integration (real `runEntity`).
 */
export * from './phase-templates/index.js';
export * from './status-machine.js';
export { MetaWorkflowRunRepository } from './repositories/meta-workflow-run-repository.js';
export { MetaWorkflowPhaseRepository } from './repositories/meta-workflow-phase-repository.js';
export { MetaWorkflowArtifactRepository } from './repositories/meta-workflow-artifact-repository.js';
export { MetaWorkflowRunAggregate } from './run-aggregate.js';
export { MetaWorkflowPhaseAggregate } from './phase-aggregate.js';
export { validatePhasesJson, type ValidationResult } from './phases-json-validator.js';
export { synthesizeWorkflow } from './workflow-synthesizer.js';
export { synthesizeSubagent } from './subagent-synthesizer.js';
export { runGate, runGates, type RunGatesOptions } from './gate-runner.js';
export {
  MetaPhaseExecutor,
  type SynthesizedEntity,
  type RunEntity,
  type RunEntityOutcome,
  type PhaseExecutionResult,
  type MetaPhaseExecutorOptions,
} from './phase-executor.js';
```

- [ ] **Step 2: Run full builds + Phase B-specific tests**

```bash
pnpm build
pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow
pnpm --filter @my-claudia/shared exec vitest run src/features/__tests__/meta-workflow.test.ts src/features/__tests__/meta-workflow-protocol.test.ts
```

Expected: all green.

- [ ] **Step 3: End-to-end programmatic smoke test (manual one-liner)**

```bash
cd /Users/haozhang/SourceCode/zhvala/my-claudia && node --input-type=module -e "
import Database from 'better-sqlite3';
import { migrations } from './server/dist/infrastructure/storage/migrations/index.js';
import {
  MetaWorkflowRunRepository, MetaWorkflowPhaseRepository,
  MetaWorkflowRunAggregate, MetaWorkflowPhaseAggregate,
  MetaPhaseExecutor,
} from './server/dist/domains/meta-workflow/index.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY);');
for (const m of migrations) {
  try { db.exec(m.sql); } catch (e) {
    if (m.idempotent && /duplicate column|already exists/i.test(e.message)) continue;
    throw e;
  }
}
db.prepare('INSERT INTO projects (id) VALUES (?)').run('proj-1');

const runRepo = new MetaWorkflowRunRepository(db);
const phaseRepo = new MetaWorkflowPhaseRepository(db);
const runAgg = new MetaWorkflowRunAggregate(runRepo);
const phaseAgg = new MetaWorkflowPhaseAggregate(phaseRepo);

const run = runAgg.create({ projectId: 'proj-1', title: 'Smoke' });
runAgg.submitRequirements(run.id, 'design/req.md');
runAgg.approveRequirements(run.id);
runAgg.setPhasesJson(run.id, '{\"version\":\"1\",\"phases\":[],\"smokePath\":[],\"metadata\":{\"generatedAt\":0,\"requirementsPath\":\"design/req.md\"}}');

const phaseDef = {
  id: 'p1', name: 'Echo', description: 'test',
  phaseType: 'code-implement', dependsOn: [], inputs: [],
  outputs: [{ kind: 'commit', description: 'commit' }],
  acceptanceGates: [{ id: 'g1', description: 'ok', command: 'true', expect: { exitCode: 0 } }],
};
const phase = phaseAgg.instantiate(run.id, phaseDef);

const workdir = mkdtempSync(join(tmpdir(), 'phase-b-smoke-'));
const executor = new MetaPhaseExecutor({
  aggregate: phaseAgg,
  runEntity: async () => ({ exitOk: true }),
});
const result = await executor.execute(phase.id, phaseDef, workdir);
console.log('Smoke result:', result.phase.status, 'gates:', result.gateResults.length);
if (result.phase.status !== 'done') process.exit(1);
console.log('Phase B smoke: PASS');
"
```

Expected output:
```
Smoke result: done gates: 1
Phase B smoke: PASS
```

- [ ] **Step 4: Commit the index update**

```bash
git add server/src/domains/meta-workflow/index.ts
git commit -m "feat(meta-workflow): export Phase B public surface from domain index"
```

- [ ] **Step 5: Tag**

```bash
git tag -a meta-workflow/phase-b-complete -m "Meta Workflow Phase B core domain landed"
```

---

## Phase B Acceptance Criteria

- [ ] All 14 tasks complete and individually committed.
- [ ] `pnpm build` passes.
- [ ] `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow` passes.
- [ ] `pnpm --filter @my-claudia/shared` tests pass.
- [ ] The programmatic smoke test in Task 14 outputs `Phase B smoke: PASS`.
- [ ] No regressions in pre-existing tests outside `meta-workflow` (the known `run-handler.test.ts` WIP failure remains and is unrelated).

---

## What Phase B Deliberately Leaves to Later Phases

| Item | Where it lands |
|------|---------------|
| Reuse-pool repository + semantic search | Phase C |
| Promotion flow (auto → user) | Phase C |
| Stale propagator (Lazy + Soft + 4 user ops) | Phase D |
| Artifact versioning + UI surfacing | Phase D |
| Real `runEntity` wiring to the existing WorkflowRuntime / conversation runner | Phase C |
| HTTP routes / WebSocket handler dispatching the new CRUD ClientMessages | Phase C |
| All UI (RequirementsScreen, PhaseBoardScreen, etc.) | Phase E |
| End-to-end smoke on a real Java/TS project | Phase F |

These are explicit non-goals for Phase B.

---

*Plan version: 1 / 2026-05-18*
*Spec reference: `docs/design/supervisor-meta-workflow.zh-CN.md`*
*Phase A reference: `docs/impl/meta-workflow-phase-a-foundation.md` (already complete)*
