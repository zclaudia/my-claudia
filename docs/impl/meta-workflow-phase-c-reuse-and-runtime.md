# Meta Workflow — Phase C: Reuse Pool & Runtime Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Land the reuse-pool data + search + promotion vertical; (2) replace Phase B's stub `runEntity` with real integrations into the existing `WorkflowEngine` (for workflow entities) and a minimal subagent runner; (3) expose the system over HTTP routes + WebSocket handlers so a client can drive a Meta Workflow run end-to-end without touching server internals.

**Architecture:** Two independent verticals share Phase C:
- **Reuse pool**: two new repositories (`ReusePool` + `SubagentTemplate`), a search service (tag + keyword BM25-lite), a promotion service (auto → user), and a small `PhaseAggregate` change to support the reuse-hit path (`searching_reuse → ready_to_run` directly when a reusable entity is adopted).
- **Runtime + transport**: real `RunEntity` adapters (Phase B used stubs), a top-level `MetaWorkflowService` that orchestrates aggregates + executor + repos for one-shot operations, HTTP routes under `/api/meta-workflow/*`, and 6 WebSocket handlers dispatched from `ClientMessage`.

Plus one Phase B follow-up (the `null as unknown as undefined` cast removal).

**Tech Stack:** TypeScript, Express, vitest, the existing `WorkflowEngine` (`server/src/domains/workflows/engine.ts`), the existing virtual-client AI runner (`server/src/domains/workflows/step-executors/virtual-client-ai-runner.ts`) for subagent execution. **No new external dependencies.**

**Spec reference:** `docs/design/supervisor-meta-workflow.zh-CN.md` (sections §7 Reuse Pool, §6.3 Phase Execution, §9 Provider Strategy, §10 Data Model).

**Phase A/B references:**
- `docs/impl/meta-workflow-phase-a-foundation.md` (data model + types + stubs, complete)
- `docs/impl/meta-workflow-phase-b-core-domain.md` (aggregates + synthesizers + executor with stub `runEntity`, complete)
- Tag `meta-workflow/phase-b-complete` (commit `d4a8419b`) marks Phase B's end.

---

## File Structure

```
server/src/domains/meta-workflow/
├── index.ts                                                MODIFY (export new modules)
├── register.ts                                             NEW (factory wires DI)
├── service.ts                                              NEW (top-level orchestrator)
├── routes.ts                                               NEW (Express HTTP routes)
├── repositories/
│   ├── meta-workflow-run-repository.ts                     MODIFY (widen Update type)
│   ├── meta-workflow-phase-repository.ts                   MODIFY (widen Update type)
│   ├── meta-workflow-artifact-repository.ts                MODIFY (widen Update type)
│   ├── meta-workflow-reuse-pool-repository.ts              NEW
│   └── meta-subagent-template-repository.ts                NEW
├── phase-aggregate.ts                                      MODIFY (drop the cast; reuse-hit path)
├── reuse-pool-search.ts                                    NEW
├── reuse-pool-promotion.ts                                 NEW
├── run-entities/
│   ├── workflow-run-entity.ts                              NEW (real WorkflowEngine adapter)
│   └── subagent-run-entity.ts                              NEW (real virtual-client adapter)
└── __tests__/
    ├── meta-workflow-reuse-pool-repository.test.ts         NEW
    ├── meta-subagent-template-repository.test.ts           NEW
    ├── reuse-pool-search.test.ts                           NEW
    ├── reuse-pool-promotion.test.ts                        NEW
    ├── phase-aggregate.test.ts                             MODIFY (add reuse-hit case)
    ├── service.test.ts                                     NEW
    ├── workflow-run-entity.test.ts                         NEW
    └── subagent-run-entity.test.ts                         NEW

server/src/application/conversation/handlers/
└── meta-workflow.ts                                        NEW (6 WS handlers)

server/src/application/conversation/handlers/__tests__/
└── meta-workflow.test.ts                                   NEW

server/src/index.ts or wiring entrypoint                    MODIFY (mount routes + dispatcher)
```

13 tasks total. Two clear verticals:

**Vertical 1 — Reuse Pool (Tasks 1-6):** independent of runtime; can ship before Vertical 2 and produces working, testable software (search + promotion via direct repo calls).

**Vertical 2 — Runtime + Transport (Tasks 7-13):** depends on Vertical 1 only for the executor's reuse-hit path (Task 6). Adds real runners, service orchestrator, routes, WS handlers.

```
Task 1 (Update type widening) ─── independent
Task 2 (ReusePoolRepo) ─────────── independent
Task 3 (SubagentTemplateRepo) ──── independent
Task 4 (search) ──────────────── needs 2
Task 5 (promotion) ─────────────── needs 2, 3
Task 6 (PhaseAggregate reuse-hit) ─ needs 1
Task 7 (workflow runEntity) ────── independent (uses existing WorkflowEngine)
Task 8 (subagent runEntity) ────── independent (uses existing virtual-client)
Task 9 (MetaWorkflowService) ──── needs 2-8
Task 10 (HTTP routes) ───────────── needs 9
Task 11 (WS handlers) ──────────── needs 9
Task 12 (register.ts) ───────────── needs 9, 10, 11
Task 13 (smoke + tag) ──────────── final
```

---

## Task 1: Widen Update Partial Type (Phase B follow-up)

**Files:**
- Modify: `server/src/domains/meta-workflow/repositories/meta-workflow-run-repository.ts`
- Modify: `server/src/domains/meta-workflow/repositories/meta-workflow-phase-repository.ts`
- Modify: `server/src/domains/meta-workflow/repositories/meta-workflow-artifact-repository.ts`
- Modify: `server/src/domains/meta-workflow/phase-aggregate.ts` (drop the cast in `clearStale`)

Phase B reviewer flagged `null as unknown as undefined` cast in `phase-aggregate.ts:130-131` as a code smell. Root cause: repos' `Update` partial type uses `Partial<Omit<...>>` which doesn't allow explicit `null`. Fix: widen each `Update` type so nullable string fields accept `string | null | undefined`. Drop the cast at the call site.

- [ ] **Step 1: Modify `Update` type in `meta-workflow-run-repository.ts`**

Replace the existing line:

```typescript
type Update = Partial<Omit<MetaWorkflowRun, 'id' | 'projectId' | 'createdAt'>>;
```

With:

```typescript
type Update = {
  title?: string;
  description?: string | null;
  status?: MetaWorkflowRun['status'];
  requirementsPath?: string | null;
  phasesJson?: string | null;
  smokePathRunId?: string | null;
  rejectCount?: number;
  defaultProviderId?: string | null;
  config?: MetaWorkflowRun['config'] | null;
  worktreeId?: string | null;
  updatedAt?: number;
  completedAt?: number | null;
};
```

No call-site changes needed in Phase B code — the existing `repo.update(id, { ... })` calls remain valid.

- [ ] **Step 2: Modify `Update` type in `meta-workflow-phase-repository.ts`**

Replace:

```typescript
type Update = Partial<Omit<MetaWorkflowPhase, 'id' | 'runId' | 'phaseId' | 'createdAt'>>;
```

With:

```typescript
type Update = {
  phaseType?: MetaWorkflowPhase['phaseType'];
  status?: MetaWorkflowPhase['status'];
  executeEntity?: MetaWorkflowPhase['executeEntity'];
  reusedFromPoolId?: string | null;
  generatedWorkflowId?: string | null;
  generatedSubagentId?: string | null;
  currentRunId?: string | null;
  worktreePath?: string | null;
  staleSince?: number | null;
  staleSourcePhaseId?: string | null;
  attempt?: number;
  maxRetries?: number;
  inputsSnapshot?: MetaWorkflowPhase['inputsSnapshot'] | null;
  outputsSnapshot?: MetaWorkflowPhase['outputsSnapshot'] | null;
  gatesSnapshot?: MetaWorkflowPhase['gatesSnapshot'] | null;
  executeConfigSnapshot?: MetaWorkflowPhase['executeConfigSnapshot'] | null;
  synthesizerProviderId?: string | null;
  runtimeProviderId?: string | null;
  startedAt?: number;
  completedAt?: number;
};
```

- [ ] **Step 3: Modify `Update` type in `meta-workflow-artifact-repository.ts`**

Replace:

```typescript
type Update = Partial<Omit<MetaWorkflowArtifact, 'id' | 'phaseRecordId' | 'version' | 'createdAt'>>;
```

With:

```typescript
type Update = {
  commitSha?: string | null;
  artifactFiles?: MetaWorkflowArtifact['artifactFiles'] | null;
  gateResults?: MetaWorkflowArtifact['gateResults'] | null;
  aiReviewNotesPath?: string | null;
  status?: MetaWorkflowArtifact['status'];
};
```

- [ ] **Step 4: Drop the cast in `phase-aggregate.ts` `clearStale`**

Find this block:

```typescript
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
```

Replace the body with:

```typescript
clearStale(phaseId: string): MetaWorkflowPhase {
  const phase = this.requirePhase(phaseId);
  assertPhaseStatusIn(phase.status, ['stale'], 'clear stale on');
  assertPhaseTransition(phase.status, 'done');
  return this.repo.update(phaseId, {
    status: 'done',
    staleSince: null,
    staleSourcePhaseId: null,
  });
}
```

- [ ] **Step 5: Run all Phase B tests to confirm no regressions**

Run: `cd /Users/haozhang/SourceCode/zhvala/my-claudia/server && pnpm exec vitest run src/domains/meta-workflow`

Expected: 85/85 pass (same count as Phase B end).

- [ ] **Step 6: Commit**

```bash
git add server/src/domains/meta-workflow/repositories/meta-workflow-run-repository.ts \
        server/src/domains/meta-workflow/repositories/meta-workflow-phase-repository.ts \
        server/src/domains/meta-workflow/repositories/meta-workflow-artifact-repository.ts \
        server/src/domains/meta-workflow/phase-aggregate.ts
git commit -m "refactor(meta-workflow): widen repository Update types to accept null"
```

---

## Task 2: MetaWorkflowReusePoolRepository

**Files:**
- Create: `server/src/domains/meta-workflow/repositories/meta-workflow-reuse-pool-repository.ts`
- Test: `server/src/domains/meta-workflow/__tests__/meta-workflow-reuse-pool-repository.test.ts`

Standard `BaseRepository` extension for the `meta_workflow_reuse_pool` table created by migration 069. Stores `ReusablePoolItem` records.

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/domains/meta-workflow/__tests__/meta-workflow-reuse-pool-repository.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaWorkflowReusePoolRepository } from '../repositories/meta-workflow-reuse-pool-repository.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY);`);
  db.exec(m069.sql);
  return db;
}

describe('MetaWorkflowReusePoolRepository', () => {
  let db: Database.Database;
  let repo: MetaWorkflowReusePoolRepository;

  beforeEach(() => {
    db = freshDb();
    repo = new MetaWorkflowReusePoolRepository(db);
  });

  it('creates a workflow-kind item with tags', () => {
    const item = repo.create({
      kind: 'workflow',
      entityId: 'wf-1',
      phaseType: 'code-implement',
      description: 'Impl service layer',
      tags: ['auto-generated', 'run-abc', 'phase-1'],
      sourceType: 'auto',
      createdAt: Date.now(),
    });
    expect(item.id).toBeTruthy();
    expect(item.kind).toBe('workflow');
    expect(item.tags).toEqual(['auto-generated', 'run-abc', 'phase-1']);
  });

  it('round-trips JSON tags + metadata', () => {
    const item = repo.create({
      kind: 'subagent',
      entityId: 'sub-1',
      phaseType: 'investigation',
      description: 'Investigation template',
      tags: ['auto-generated'],
      sourceType: 'auto',
      metadata: { generatedFromPhaseId: 'p-1', originalRunId: 'r-1', usageCount: 3, successRate: 0.85 },
      createdAt: Date.now(),
    });
    const fetched = repo.findById(item.id);
    expect(fetched?.metadata?.usageCount).toBe(3);
    expect(fetched?.metadata?.successRate).toBe(0.85);
  });

  it('findByPhaseType filters correctly + excludes archived', () => {
    repo.create({ kind: 'workflow', entityId: 'a', phaseType: 'code-implement',
                  tags: [], sourceType: 'auto', createdAt: 10 });
    repo.create({ kind: 'workflow', entityId: 'b', phaseType: 'code-refactor',
                  tags: [], sourceType: 'auto', createdAt: 20 });
    const item = repo.create({ kind: 'workflow', entityId: 'c', phaseType: 'code-implement',
                  tags: [], sourceType: 'user', createdAt: 30 });
    repo.archive(item.id);

    const implItems = repo.findByPhaseType('code-implement');
    expect(implItems.map((i) => i.entityId)).toEqual(['a']);  // 'c' is archived
  });

  it('archive sets archivedAt + excludes from findByPhaseType', () => {
    const item = repo.create({ kind: 'workflow', entityId: 'x', phaseType: 'code-implement',
                  tags: ['auto-generated'], sourceType: 'auto', createdAt: 10 });
    repo.archive(item.id);
    const fetched = repo.findById(item.id);
    expect(fetched?.archivedAt).toBeGreaterThan(0);
    expect(repo.findByPhaseType('code-implement')).toHaveLength(0);
  });

  it('promote flips sourceType auto → user + strips auto-generated tag', () => {
    const item = repo.create({ kind: 'workflow', entityId: 'x', phaseType: 'code-implement',
                  tags: ['auto-generated', 'run-abc', 'custom-tag'],
                  sourceType: 'auto', createdAt: 10 });
    const promoted = repo.promote(item.id, ['user', 'custom-tag', 'jpa']);
    expect(promoted.sourceType).toBe('user');
    expect(promoted.tags).toEqual(['user', 'custom-tag', 'jpa']);
  });

  it('updateMetadata merges with existing metadata', () => {
    const item = repo.create({ kind: 'workflow', entityId: 'x', phaseType: 'code-implement',
                  tags: [], sourceType: 'auto',
                  metadata: { usageCount: 1 },
                  createdAt: 10 });
    repo.updateMetadata(item.id, { usageCount: 2, successRate: 1.0 });
    const fetched = repo.findById(item.id);
    expect(fetched?.metadata).toEqual({ usageCount: 2, successRate: 1.0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/meta-workflow-reuse-pool-repository.test.ts`

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

```typescript
// server/src/domains/meta-workflow/repositories/meta-workflow-reuse-pool-repository.ts
import { BaseRepository } from '../../../infrastructure/repositories/base.js';
import type { Database } from 'better-sqlite3';
import type {
  ReusablePoolItem,
  ReusablePoolMetadata,
  ExecuteEntity,
  PhaseType,
  ReusePoolSourceType,
} from '@my-claudia/shared/features/meta-workflow';
import { v4 as uuidv4 } from 'uuid';

type Create = Omit<ReusablePoolItem, 'id' | 'archivedAt'>;
type Update = {
  description?: string | null;
  tags?: string[];
  sourceType?: ReusePoolSourceType;
  metadata?: ReusablePoolMetadata | null;
  archivedAt?: number | null;
};

export class MetaWorkflowReusePoolRepository extends BaseRepository<ReusablePoolItem, Create, Update> {
  constructor(db: Database) {
    super(db, 'meta_workflow_reuse_pool');
  }

  mapRow(raw: unknown): ReusablePoolItem {
    const row = raw as Record<string, unknown>;
    return {
      id: row.id as string,
      kind: row.kind as ExecuteEntity,
      entityId: row.entity_id as string,
      phaseType: row.phase_type as PhaseType,
      description: (row.description as string) || undefined,
      tags: row.tags ? (JSON.parse(row.tags as string) as string[]) : [],
      sourceType: row.source_type as ReusePoolSourceType,
      metadata: row.metadata
        ? (JSON.parse(row.metadata as string) as ReusablePoolMetadata)
        : undefined,
      createdAt: row.created_at as number,
      archivedAt: (row.archived_at as number) || undefined,
    };
  }

  createQuery(data: Create): { sql: string; params: unknown[] } {
    const id = uuidv4();
    return {
      sql: `INSERT INTO meta_workflow_reuse_pool (
        id, kind, entity_id, phase_type, description, tags,
        source_type, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id, data.kind, data.entityId, data.phaseType,
        data.description ?? null,
        JSON.stringify(data.tags),
        data.sourceType,
        data.metadata ? JSON.stringify(data.metadata) : null,
        data.createdAt,
      ],
    };
  }

  updateQuery(id: string, data: Update): { sql: string; params: unknown[] } {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description ?? null); }
    if (data.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(data.tags)); }
    if (data.sourceType !== undefined) { sets.push('source_type = ?'); params.push(data.sourceType); }
    if (data.metadata !== undefined) {
      sets.push('metadata = ?');
      params.push(data.metadata ? JSON.stringify(data.metadata) : null);
    }
    if (data.archivedAt !== undefined) { sets.push('archived_at = ?'); params.push(data.archivedAt ?? null); }

    if (sets.length === 0) {
      return { sql: `SELECT 1 FROM meta_workflow_reuse_pool WHERE id = ?`, params: [id] };
    }
    params.push(id);
    return {
      sql: `UPDATE meta_workflow_reuse_pool SET ${sets.join(', ')} WHERE id = ?`,
      params,
    };
  }

  /**
   * Find non-archived items for a given phaseType (used by the search service).
   */
  findByPhaseType(phaseType: PhaseType): ReusablePoolItem[] {
    const rows = this.db.prepare(
      `SELECT * FROM meta_workflow_reuse_pool
         WHERE phase_type = ? AND archived_at IS NULL
         ORDER BY source_type DESC, created_at DESC`,
    ).all(phaseType);
    return rows.map((r) => this.mapRow(r));
  }

  archive(id: string): void {
    this.db.prepare(
      `UPDATE meta_workflow_reuse_pool SET archived_at = ? WHERE id = ?`,
    ).run(Date.now(), id);
  }

  /**
   * Promote a pool item from 'auto' → 'user', replacing tags entirely.
   * Returns the updated item.
   */
  promote(id: string, newTags: string[]): ReusablePoolItem {
    return this.update(id, { sourceType: 'user', tags: newTags });
  }

  updateMetadata(id: string, metadata: ReusablePoolMetadata): void {
    this.update(id, { metadata });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/meta-workflow-reuse-pool-repository.test.ts`

Expected: PASS (6 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/meta-workflow/repositories/meta-workflow-reuse-pool-repository.ts \
        server/src/domains/meta-workflow/__tests__/meta-workflow-reuse-pool-repository.test.ts
git commit -m "feat(meta-workflow): add MetaWorkflowReusePoolRepository"
```

---

## Task 3: MetaSubagentTemplateRepository

**Files:**
- Create: `server/src/domains/meta-workflow/repositories/meta-subagent-template-repository.ts`
- Test: `server/src/domains/meta-workflow/__tests__/meta-subagent-template-repository.test.ts`

Standard `BaseRepository` for the `meta_subagent_templates` table created by migration 069.

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/domains/meta-workflow/__tests__/meta-subagent-template-repository.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaSubagentTemplateRepository } from '../repositories/meta-subagent-template-repository.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY);`);
  db.exec(m069.sql);
  return db;
}

describe('MetaSubagentTemplateRepository', () => {
  let db: Database.Database;
  let repo: MetaSubagentTemplateRepository;

  beforeEach(() => {
    db = freshDb();
    repo = new MetaSubagentTemplateRepository(db);
  });

  it('creates a template with allowedTools array', () => {
    const now = Date.now();
    const tmpl = repo.create({
      name: 'investigation-default',
      systemPrompt: 'You investigate.',
      allowedTools: ['Read', 'Grep', 'Bash'],
      maxTurns: 30,
      terminationCondition: { kind: 'output-file', target: 'report.md' },
      sourceType: 'auto',
      createdAt: now,
      updatedAt: now,
    });
    expect(tmpl.id).toBeTruthy();
    expect(tmpl.allowedTools).toEqual(['Read', 'Grep', 'Bash']);
    expect(tmpl.terminationCondition.kind).toBe('output-file');
  });

  it('round-trips terminationCondition with output-keyword variant', () => {
    const now = Date.now();
    const tmpl = repo.create({
      systemPrompt: 'p',
      allowedTools: ['Read'],
      maxTurns: 10,
      terminationCondition: { kind: 'output-keyword', target: '[DONE]' },
      sourceType: 'auto',
      createdAt: now,
      updatedAt: now,
    });
    const fetched = repo.findById(tmpl.id);
    expect(fetched?.terminationCondition).toEqual({ kind: 'output-keyword', target: '[DONE]' });
  });

  it('updates allowedTools', () => {
    const now = Date.now();
    const tmpl = repo.create({
      systemPrompt: 'p', allowedTools: ['Read'],
      maxTurns: 10,
      terminationCondition: { kind: 'output-keyword', target: '[X]' },
      sourceType: 'auto', createdAt: now, updatedAt: now,
    });
    const updated = repo.update(tmpl.id, { allowedTools: ['Read', 'Grep', 'Glob'], updatedAt: now + 1 });
    expect(updated.allowedTools).toEqual(['Read', 'Grep', 'Glob']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/meta-subagent-template-repository.test.ts`

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

```typescript
// server/src/domains/meta-workflow/repositories/meta-subagent-template-repository.ts
import { BaseRepository } from '../../../infrastructure/repositories/base.js';
import type { Database } from 'better-sqlite3';
import type {
  MetaSubagentTemplate,
  MetaSubagentTerminationCondition,
  ReusePoolSourceType,
} from '@my-claudia/shared/features/meta-workflow';
import { v4 as uuidv4 } from 'uuid';

type Create = Omit<MetaSubagentTemplate, 'id'>;
type Update = {
  name?: string | null;
  systemPrompt?: string;
  allowedTools?: string[];
  maxTurns?: number;
  terminationCondition?: MetaSubagentTerminationCondition;
  sourceType?: ReusePoolSourceType;
  updatedAt?: number;
};

export class MetaSubagentTemplateRepository extends BaseRepository<MetaSubagentTemplate, Create, Update> {
  constructor(db: Database) {
    super(db, 'meta_subagent_templates');
  }

  mapRow(raw: unknown): MetaSubagentTemplate {
    const row = raw as Record<string, unknown>;
    return {
      id: row.id as string,
      name: (row.name as string) || undefined,
      systemPrompt: row.system_prompt as string,
      allowedTools: JSON.parse(row.allowed_tools as string) as string[],
      maxTurns: row.max_turns as number,
      terminationCondition: JSON.parse(row.termination_condition as string) as MetaSubagentTerminationCondition,
      sourceType: row.source_type as ReusePoolSourceType,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  createQuery(data: Create): { sql: string; params: unknown[] } {
    const id = uuidv4();
    return {
      sql: `INSERT INTO meta_subagent_templates (
        id, name, system_prompt, allowed_tools, max_turns,
        termination_condition, source_type, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id, data.name ?? null, data.systemPrompt,
        JSON.stringify(data.allowedTools),
        data.maxTurns,
        JSON.stringify(data.terminationCondition),
        data.sourceType,
        data.createdAt, data.updatedAt,
      ],
    };
  }

  updateQuery(id: string, data: Update): { sql: string; params: unknown[] } {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name ?? null); }
    if (data.systemPrompt !== undefined) { sets.push('system_prompt = ?'); params.push(data.systemPrompt); }
    if (data.allowedTools !== undefined) { sets.push('allowed_tools = ?'); params.push(JSON.stringify(data.allowedTools)); }
    if (data.maxTurns !== undefined) { sets.push('max_turns = ?'); params.push(data.maxTurns); }
    if (data.terminationCondition !== undefined) {
      sets.push('termination_condition = ?');
      params.push(JSON.stringify(data.terminationCondition));
    }
    if (data.sourceType !== undefined) { sets.push('source_type = ?'); params.push(data.sourceType); }
    if (data.updatedAt !== undefined) { sets.push('updated_at = ?'); params.push(data.updatedAt); }

    if (sets.length === 0) {
      return { sql: `SELECT 1 FROM meta_subagent_templates WHERE id = ?`, params: [id] };
    }
    params.push(id);
    return {
      sql: `UPDATE meta_subagent_templates SET ${sets.join(', ')} WHERE id = ?`,
      params,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/meta-subagent-template-repository.test.ts`

Expected: PASS (3 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/meta-workflow/repositories/meta-subagent-template-repository.ts \
        server/src/domains/meta-workflow/__tests__/meta-subagent-template-repository.test.ts
git commit -m "feat(meta-workflow): add MetaSubagentTemplateRepository"
```

---

## Task 4: Reuse-Pool Search Service

**Files:**
- Create: `server/src/domains/meta-workflow/reuse-pool-search.ts`
- Test: `server/src/domains/meta-workflow/__tests__/reuse-pool-search.test.ts`

Hand-rolled tag + keyword search. Two-pass:
1. **Filter** by `phaseType` (exact) and `kind` (exact, derived from `executeEntity`).
2. **Score** by token-overlap between the input phase's `description` and the candidate's `description` (case-insensitive, alphanumeric tokens, simple count). Tie-break by `sourceType === 'user'` (promoted templates first), then `metadata.usageCount` desc, then `createdAt` desc.

Returns top N (default 5).

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/domains/meta-workflow/__tests__/reuse-pool-search.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaWorkflowReusePoolRepository } from '../repositories/meta-workflow-reuse-pool-repository.js';
import { ReusePoolSearchService } from '../reuse-pool-search.js';
import type { PhaseDef } from '@my-claudia/shared/features/meta-workflow';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY);`);
  db.exec(m069.sql);
  return db;
}

const phaseDef: PhaseDef = {
  id: 'p1', name: 'Impl UserService', description: 'Implement UserServiceImpl with JPA',
  phaseType: 'code-implement',
  dependsOn: [], inputs: [],
  outputs: [{ kind: 'commit', description: 'commit' }],
  acceptanceGates: [{ id: 'g', description: 'g', command: 'mvn test', expect: { exitCode: 0 } }],
};

describe('ReusePoolSearchService', () => {
  let db: Database.Database;
  let poolRepo: MetaWorkflowReusePoolRepository;
  let search: ReusePoolSearchService;

  beforeEach(() => {
    db = freshDb();
    poolRepo = new MetaWorkflowReusePoolRepository(db);
    search = new ReusePoolSearchService(poolRepo);
  });

  it('returns empty when pool is empty', () => {
    expect(search.search(phaseDef)).toEqual([]);
  });

  it('returns only matching phaseType', () => {
    poolRepo.create({ kind: 'workflow', entityId: 'a', phaseType: 'code-implement',
                      description: 'JPA repo impl', tags: [], sourceType: 'auto', createdAt: 10 });
    poolRepo.create({ kind: 'workflow', entityId: 'b', phaseType: 'code-refactor',
                      description: 'JPA refactor', tags: [], sourceType: 'auto', createdAt: 20 });
    const results = search.search(phaseDef);
    expect(results).toHaveLength(1);
    expect(results[0].item.entityId).toBe('a');
  });

  it('scores by token-overlap on description', () => {
    poolRepo.create({ kind: 'workflow', entityId: 'a', phaseType: 'code-implement',
                      description: 'Random unrelated text', tags: [], sourceType: 'auto', createdAt: 10 });
    poolRepo.create({ kind: 'workflow', entityId: 'b', phaseType: 'code-implement',
                      description: 'Implement JPA user repository', tags: [], sourceType: 'auto', createdAt: 20 });
    const results = search.search(phaseDef);
    expect(results[0].item.entityId).toBe('b'); // higher token overlap with "Implement UserServiceImpl with JPA"
  });

  it('promoted items rank above auto-generated of equal score', () => {
    poolRepo.create({ kind: 'workflow', entityId: 'auto', phaseType: 'code-implement',
                      description: 'identical text here', tags: [], sourceType: 'auto', createdAt: 10 });
    poolRepo.create({ kind: 'workflow', entityId: 'user', phaseType: 'code-implement',
                      description: 'identical text here', tags: [], sourceType: 'user', createdAt: 5 });
    const samePhase: PhaseDef = { ...phaseDef, description: 'identical text here' };
    const results = search.search(samePhase);
    expect(results[0].item.entityId).toBe('user');
  });

  it('respects kind filter from executeEntity', () => {
    poolRepo.create({ kind: 'workflow', entityId: 'w', phaseType: 'investigation',
                      description: 'invest', tags: [], sourceType: 'auto', createdAt: 10 });
    poolRepo.create({ kind: 'subagent', entityId: 's', phaseType: 'investigation',
                      description: 'invest', tags: [], sourceType: 'auto', createdAt: 20 });
    const invPhase: PhaseDef = { ...phaseDef, phaseType: 'investigation', executeEntity: 'subagent' };
    const results = search.search(invPhase);
    expect(results.every((r) => r.item.kind === 'subagent')).toBe(true);
  });

  it('limits to top 5 by default', () => {
    for (let i = 0; i < 8; i += 1) {
      poolRepo.create({ kind: 'workflow', entityId: `e${i}`, phaseType: 'code-implement',
                        description: 'Implement', tags: [], sourceType: 'auto', createdAt: i });
    }
    const results = search.search(phaseDef);
    expect(results).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/reuse-pool-search.test.ts`

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

```typescript
// server/src/domains/meta-workflow/reuse-pool-search.ts
import type {
  PhaseDef,
  ReusablePoolItem,
  ExecuteEntity,
} from '@my-claudia/shared/features/meta-workflow';
import type { MetaWorkflowReusePoolRepository } from './repositories/meta-workflow-reuse-pool-repository.js';
import { getPhaseTemplate } from './phase-templates/index.js';

export interface ReuseSearchResult {
  item: ReusablePoolItem;
  score: number;
}

function tokenize(s: string | undefined): Set<string> {
  if (!s) return new Set();
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const tok of a) if (b.has(tok)) n += 1;
  return n;
}

export class ReusePoolSearchService {
  constructor(
    private repo: MetaWorkflowReusePoolRepository,
    private limit = 5,
  ) {}

  search(phase: PhaseDef): ReuseSearchResult[] {
    const template = getPhaseTemplate(phase.phaseType);
    const expectedKind: ExecuteEntity = phase.executeEntity ?? template.defaultExecuteEntity;

    const candidates = this.repo
      .findByPhaseType(phase.phaseType)
      .filter((c) => c.kind === expectedKind);

    const queryTokens = tokenize(`${phase.name} ${phase.description}`);
    const scored = candidates.map((item) => ({
      item,
      score: tokenOverlap(queryTokens, tokenize(item.description)),
    }));

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aIsUser = a.item.sourceType === 'user' ? 1 : 0;
      const bIsUser = b.item.sourceType === 'user' ? 1 : 0;
      if (aIsUser !== bIsUser) return bIsUser - aIsUser;
      const aUsage = a.item.metadata?.usageCount ?? 0;
      const bUsage = b.item.metadata?.usageCount ?? 0;
      if (bUsage !== aUsage) return bUsage - aUsage;
      return b.item.createdAt - a.item.createdAt;
    });

    return scored.slice(0, this.limit);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/reuse-pool-search.test.ts`

Expected: PASS (6 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/meta-workflow/reuse-pool-search.ts \
        server/src/domains/meta-workflow/__tests__/reuse-pool-search.test.ts
git commit -m "feat(meta-workflow): add reuse-pool tag+keyword search"
```

---

## Task 5: Reuse-Pool Promotion Service

**Files:**
- Create: `server/src/domains/meta-workflow/reuse-pool-promotion.ts`
- Test: `server/src/domains/meta-workflow/__tests__/reuse-pool-promotion.test.ts`

A small service: given a pool item id and a (possibly partial) user-supplied set of tags + optional new name/description, promote it. Handles both workflow-kind (no entity-side change) and subagent-kind (also update the subagent template's `sourceType`).

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/domains/meta-workflow/__tests__/reuse-pool-promotion.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaWorkflowReusePoolRepository } from '../repositories/meta-workflow-reuse-pool-repository.js';
import { MetaSubagentTemplateRepository } from '../repositories/meta-subagent-template-repository.js';
import { ReusePoolPromotionService } from '../reuse-pool-promotion.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY);`);
  db.exec(m069.sql);
  return db;
}

describe('ReusePoolPromotionService', () => {
  let db: Database.Database;
  let poolRepo: MetaWorkflowReusePoolRepository;
  let subagentRepo: MetaSubagentTemplateRepository;
  let promote: ReusePoolPromotionService;

  beforeEach(() => {
    db = freshDb();
    poolRepo = new MetaWorkflowReusePoolRepository(db);
    subagentRepo = new MetaSubagentTemplateRepository(db);
    promote = new ReusePoolPromotionService(poolRepo, subagentRepo);
  });

  it('promotes a workflow-kind item: strips auto tags, flips sourceType, adds user tags', () => {
    const item = poolRepo.create({
      kind: 'workflow', entityId: 'wf-1', phaseType: 'code-implement',
      description: 'old desc',
      tags: ['auto-generated', 'run-abc', 'phase-1', 'keep-me'],
      sourceType: 'auto', createdAt: 10,
    });
    const result = promote.promote(item.id, {
      newTags: ['keep-me', 'jpa-impl'],
      newDescription: 'JPA impl template',
    });
    expect(result.sourceType).toBe('user');
    expect(result.tags.sort()).toEqual(['jpa-impl', 'keep-me']);
    expect(result.description).toBe('JPA impl template');
    expect(result.tags).not.toContain('auto-generated');
    expect(result.tags).not.toContain('run-abc');
  });

  it('also flips subagent template sourceType when kind=subagent', () => {
    const now = Date.now();
    const tmpl = subagentRepo.create({
      systemPrompt: 'investigate',
      allowedTools: ['Read'],
      maxTurns: 30,
      terminationCondition: { kind: 'output-file', target: 'r.md' },
      sourceType: 'auto', createdAt: now, updatedAt: now,
    });
    const item = poolRepo.create({
      kind: 'subagent', entityId: tmpl.id, phaseType: 'investigation',
      description: 'invest', tags: ['auto-generated'], sourceType: 'auto', createdAt: now,
    });
    promote.promote(item.id, { newTags: ['my-investigation'] });

    const refetched = subagentRepo.findById(tmpl.id);
    expect(refetched?.sourceType).toBe('user');
  });

  it('throws on missing pool item', () => {
    expect(() => promote.promote('missing', { newTags: [] })).toThrow(/not found/);
  });

  it('throws when subagent template is missing for a subagent-kind item', () => {
    const item = poolRepo.create({
      kind: 'subagent', entityId: 'orphan-tmpl-id', phaseType: 'investigation',
      tags: [], sourceType: 'auto', createdAt: Date.now(),
    });
    expect(() => promote.promote(item.id, { newTags: [] })).toThrow(/subagent template/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/reuse-pool-promotion.test.ts`

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

```typescript
// server/src/domains/meta-workflow/reuse-pool-promotion.ts
import type { ReusablePoolItem } from '@my-claudia/shared/features/meta-workflow';
import type { MetaWorkflowReusePoolRepository } from './repositories/meta-workflow-reuse-pool-repository.js';
import type { MetaSubagentTemplateRepository } from './repositories/meta-subagent-template-repository.js';

export interface PromoteInput {
  /** Final tag set after promotion. Auto-* tags will be stripped by the service. */
  newTags: string[];
  newName?: string;
  newDescription?: string;
}

const AUTO_TAG_PREFIXES = ['auto-generated', 'run-', 'phase-'];

function stripAutoTags(tags: string[]): string[] {
  return tags.filter((t) => !AUTO_TAG_PREFIXES.some((p) => t === p || t.startsWith(p)));
}

export class ReusePoolPromotionService {
  constructor(
    private poolRepo: MetaWorkflowReusePoolRepository,
    private subagentRepo: MetaSubagentTemplateRepository,
  ) {}

  promote(itemId: string, input: PromoteInput): ReusablePoolItem {
    const item = this.poolRepo.findById(itemId);
    if (!item) throw new Error(`Reuse pool item not found: ${itemId}`);

    const mergedTags = Array.from(new Set([
      ...stripAutoTags(item.tags),
      ...stripAutoTags(input.newTags),
    ]));

    const updated = this.poolRepo.update(itemId, {
      sourceType: 'user',
      tags: mergedTags,
      description: input.newDescription ?? item.description ?? null,
    });

    if (item.kind === 'subagent') {
      const tmpl = this.subagentRepo.findById(item.entityId);
      if (!tmpl) {
        throw new Error(`Linked subagent template not found: ${item.entityId}`);
      }
      this.subagentRepo.update(item.entityId, {
        sourceType: 'user',
        name: input.newName ?? tmpl.name ?? null,
        updatedAt: Date.now(),
      });
    }

    return updated;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/reuse-pool-promotion.test.ts`

Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/meta-workflow/reuse-pool-promotion.ts \
        server/src/domains/meta-workflow/__tests__/reuse-pool-promotion.test.ts
git commit -m "feat(meta-workflow): add reuse-pool promotion service"
```

---

## Task 6: Phase Aggregate Reuse-Hit Path

**Files:**
- Modify: `server/src/domains/meta-workflow/phase-aggregate.ts` (small change to `enterReadyToRun`)
- Modify: `server/src/domains/meta-workflow/__tests__/phase-aggregate.test.ts` (add 1 test)

Phase B's `enterReadyToRun` accepts `{ generatedWorkflowId?, generatedSubagentId? }`. Reuse-hit also wants to set `reusedFromPoolId` — Phase B's signature already accepts this on `enterGenerating`, but the reuse-hit path **skips** `enterGenerating` (it goes `searching_reuse → ready_to_run` directly). So `enterReadyToRun` needs to also accept `reusedFromPoolId`.

- [ ] **Step 1: Add test for reuse-hit path**

Append this test to `phase-aggregate.test.ts` (before the closing `});`):

```typescript
  it('reuse-hit path: searching_reuse → ready_to_run skipping generating', () => {
    const phase = agg.instantiate('run-1', phaseDef);
    agg.enterSearchingReuse(phase.id);
    const updated = agg.enterReadyToRun(phase.id, {
      reusedFromPoolId: 'pool-item-1',
      generatedWorkflowId: 'wf-existing',
    });
    expect(updated.status).toBe('ready_to_run');
    expect(updated.reusedFromPoolId).toBe('pool-item-1');
    expect(updated.generatedWorkflowId).toBe('wf-existing');
  });
```

- [ ] **Step 2: Run test to verify it fails (or passes — Phase B may already accept this)**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/phase-aggregate.test.ts`

If the test FAILS because `reusedFromPoolId` is not accepted by `enterReadyToRun`, proceed to Step 3. If it PASSES (Phase B happened to be permissive), still proceed to ensure the signature is explicit.

- [ ] **Step 3: Modify `enterReadyToRun` to accept reusedFromPoolId**

Open `server/src/domains/meta-workflow/phase-aggregate.ts`. Find the existing `enterReadyToRun` method:

```typescript
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
```

Replace it with:

```typescript
enterReadyToRun(phaseId: string, opts?: {
  generatedWorkflowId?: string;
  generatedSubagentId?: string;
  reusedFromPoolId?: string;
}): MetaWorkflowPhase {
  const phase = this.requirePhase(phaseId);
  assertPhaseStatusIn(phase.status, ['searching_reuse', 'generating'], 'enter ready_to_run');
  assertPhaseTransition(phase.status, 'ready_to_run');
  return this.repo.update(phaseId, {
    status: 'ready_to_run',
    generatedWorkflowId: opts?.generatedWorkflowId,
    generatedSubagentId: opts?.generatedSubagentId,
    reusedFromPoolId: opts?.reusedFromPoolId,
  });
}
```

- [ ] **Step 4: Run all phase-aggregate tests + Phase B regression**

```bash
cd /Users/haozhang/SourceCode/zhvala/my-claudia/server
pnpm exec vitest run src/domains/meta-workflow/__tests__/phase-aggregate.test.ts
pnpm exec vitest run src/domains/meta-workflow
```

Expected: phase-aggregate tests pass (7 original + 1 new = 8). Full meta-workflow domain still green.

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/meta-workflow/phase-aggregate.ts \
        server/src/domains/meta-workflow/__tests__/phase-aggregate.test.ts
git commit -m "feat(meta-workflow): support reuse-hit path in PhaseAggregate.enterReadyToRun"
```

---

## Task 7: Real Workflow RunEntity Adapter

**Files:**
- Create: `server/src/domains/meta-workflow/run-entities/workflow-run-entity.ts`
- Test: `server/src/domains/meta-workflow/__tests__/workflow-run-entity.test.ts`

Phase B's executor used a stub `runEntity` injection. Task 7 wires the real one for workflow-kind entities. It accepts a `WorkflowEngine` (from `server/src/domains/workflows/engine.ts`) and returns a `RunEntity` function. The returned function:

1. Receives `{ kind: 'workflow', workflow: WorkflowDefinition, workflowId: string }` + `{ worktreePath }`.
2. Persists the workflow definition to the `workflows` table via a minimal hook — **but** Phase C MVP **does not** require this hook: we'll directly call `engine.startRun(definition, projectId, workflowId, opts)`.
3. Wait for engine to complete via polling the run repository (simplest) OR listening to dispatcher events.

Phase C MVP: use polling (every 200 ms, 5-minute timeout). Polling is straightforward, doesn't require event-listener plumbing yet.

Engine API used: `await engine.startRun(definition, projectId, workflowId, opts)` returns a `WorkflowRun` with id; then poll `runRepo.findById(runId)` until status is `completed` or `failed`.

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/domains/meta-workflow/__tests__/workflow-run-entity.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createWorkflowRunEntity } from '../run-entities/workflow-run-entity.js';
import type { WorkflowRun } from '@my-claudia/shared/features/workflows';

describe('workflow run-entity adapter', () => {
  it('returns exitOk=true when engine completes successfully', async () => {
    const engine = {
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
    expect(engine.startRun).toHaveBeenCalledTimes(1);
  });

  it('returns exitOk=false when engine reports failed', async () => {
    const engine = {
      startRun: vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' } as WorkflowRun),
    };
    const runRepo = {
      findById: vi.fn().mockReturnValueOnce({ id: 'run-1', status: 'failed', error: 'boom' }),
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
    expect(outcome.exitOk).toBe(false);
  });

  it('times out and returns exitOk=false', async () => {
    const engine = {
      startRun: vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' } as WorkflowRun),
    };
    const runRepo = {
      findById: vi.fn().mockReturnValue({ id: 'run-1', status: 'running' }),  // never finishes
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
      engine: {} as never, runRepo: {} as never, projectId: 'p1',
    });
    await expect(runEntity(
      { kind: 'subagent', subagent: {} as never },
      { worktreePath: '/tmp/wt' },
    )).rejects.toThrow(/workflow/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/workflow-run-entity.test.ts`

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

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
  pollIntervalMs?: number;
  timeoutMs?: number;
}

const DEFAULT_POLL_MS = 200;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'cancelled'] as const;

function isTerminal(run: WorkflowRun): boolean {
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
      entity.workflow,
      opts.projectId,
      entity.workflowId,
    );

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const fresh = opts.runRepo.findById(run.id);
      if (fresh && isTerminal(fresh)) {
        return { exitOk: fresh.status === 'completed' };
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    return { exitOk: false };
  };
}
```

> **NOTE**: The `engine.startRun(...)` signature here is the conceptual public surface; if the actual `WorkflowEngine.startRun` requires a different argument shape (e.g., separate `WorkflowDefinition` arg + `TriggerContext` object), adapt the call site. The 4 test cases verify behavior at the adapter layer, not the engine internals. If type-checking fails, inspect `server/src/domains/workflows/engine.ts` line 228 (`startRun`) and update the call to match its real signature. Do NOT change the engine itself.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/workflow-run-entity.test.ts`

Expected: PASS (4 assertions).

- [ ] **Step 5: TypeScript check (this is the integration moment of truth)**

Run: `pnpm --filter @my-claudia/server exec tsc --noEmit`

Expected: clean. If it errors on the `engine.startRun(...)` call signature, fix the adapter (not the engine). Re-run tests.

- [ ] **Step 6: Commit**

```bash
git add server/src/domains/meta-workflow/run-entities/workflow-run-entity.ts \
        server/src/domains/meta-workflow/__tests__/workflow-run-entity.test.ts
git commit -m "feat(meta-workflow): add workflow run-entity adapter for WorkflowEngine"
```

---

## Task 8: Real Subagent RunEntity Adapter

**Files:**
- Create: `server/src/domains/meta-workflow/run-entities/subagent-run-entity.ts`
- Test: `server/src/domains/meta-workflow/__tests__/subagent-run-entity.test.ts`

Phase C MVP for subagent execution: invoke a single `ai_prompt` (via the existing virtual-client runner) with the subagent's systemPrompt as prompt and `allowedTools` as the tool restriction. Termination is **best-effort**: after the AI completes, check if the termination file exists (for `output-file` kind) or if the termination keyword appears in the output (for `output-keyword` kind).

This is a simplification of the spec's "multi-turn subagent with autonomous continuation"; full multi-turn behavior lands in Phase D.

The adapter accepts an injected `runVirtualClient` callable so the test can mock it.

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/domains/meta-workflow/__tests__/subagent-run-entity.test.ts
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSubagentRunEntity } from '../run-entities/subagent-run-entity.js';
import type { MetaSubagentTemplate } from '@my-claudia/shared/features/meta-workflow';

const baseTemplate: MetaSubagentTemplate = {
  id: 's1',
  systemPrompt: 'You investigate.',
  allowedTools: ['Read', 'Grep'],
  maxTurns: 5,
  terminationCondition: { kind: 'output-file', target: 'report.md' },
  sourceType: 'auto',
  createdAt: 0,
  updatedAt: 0,
};

describe('subagent run-entity adapter', () => {
  it('returns exitOk=true when output-file is produced', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'subagent-test-'));
    const runVirtualClient = vi.fn().mockImplementation(async () => {
      writeFileSync(join(dir, 'report.md'), '# report');
      return { ok: true };
    });
    const runEntity = createSubagentRunEntity({ runVirtualClient });
    const outcome = await runEntity(
      { kind: 'subagent', subagent: baseTemplate },
      { worktreePath: dir },
    );
    expect(outcome.exitOk).toBe(true);
    expect(runVirtualClient).toHaveBeenCalledOnce();
  });

  it('returns exitOk=false when output-file is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'subagent-test-'));
    const runVirtualClient = vi.fn().mockResolvedValue({ ok: true });
    const runEntity = createSubagentRunEntity({ runVirtualClient });
    const outcome = await runEntity(
      { kind: 'subagent', subagent: baseTemplate },
      { worktreePath: dir },
    );
    expect(outcome.exitOk).toBe(false);
  });

  it('output-keyword termination matches when AI output contains keyword', async () => {
    const tmpl: MetaSubagentTemplate = {
      ...baseTemplate,
      terminationCondition: { kind: 'output-keyword', target: '[INVESTIGATION_COMPLETE]' },
    };
    const dir = mkdtempSync(join(tmpdir(), 'subagent-test-'));
    const runVirtualClient = vi.fn().mockResolvedValue({
      ok: true,
      output: 'I have finished my investigation. [INVESTIGATION_COMPLETE]',
    });
    const runEntity = createSubagentRunEntity({ runVirtualClient });
    const outcome = await runEntity(
      { kind: 'subagent', subagent: tmpl },
      { worktreePath: dir },
    );
    expect(outcome.exitOk).toBe(true);
  });

  it('output-keyword termination fails when keyword is missing', async () => {
    const tmpl: MetaSubagentTemplate = {
      ...baseTemplate,
      terminationCondition: { kind: 'output-keyword', target: '[DONE]' },
    };
    const dir = mkdtempSync(join(tmpdir(), 'subagent-test-'));
    const runVirtualClient = vi.fn().mockResolvedValue({ ok: true, output: 'lorem ipsum' });
    const runEntity = createSubagentRunEntity({ runVirtualClient });
    const outcome = await runEntity(
      { kind: 'subagent', subagent: tmpl },
      { worktreePath: dir },
    );
    expect(outcome.exitOk).toBe(false);
  });

  it('rejects non-subagent kind', async () => {
    const runVirtualClient = vi.fn();
    const runEntity = createSubagentRunEntity({ runVirtualClient });
    await expect(runEntity(
      { kind: 'workflow', workflow: {} as never, workflowId: 'w' },
      { worktreePath: '/tmp' },
    )).rejects.toThrow(/subagent/i);
  });

  it('returns exitOk=false when virtual client itself fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'subagent-test-'));
    const runVirtualClient = vi.fn().mockResolvedValue({ ok: false });
    const runEntity = createSubagentRunEntity({ runVirtualClient });
    const outcome = await runEntity(
      { kind: 'subagent', subagent: baseTemplate },
      { worktreePath: dir },
    );
    expect(outcome.exitOk).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/subagent-run-entity.test.ts`

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

```typescript
// server/src/domains/meta-workflow/run-entities/subagent-run-entity.ts
import { existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import type {
  RunEntity,
  SynthesizedEntity,
  RunEntityOutcome,
} from '../phase-executor.js';
import type { MetaSubagentTemplate } from '@my-claudia/shared/features/meta-workflow';

export interface VirtualClientResult {
  ok: boolean;
  output?: string;
}

export interface VirtualClientArgs {
  systemPrompt: string;
  allowedTools: string[];
  maxTurns: number;
  cwd: string;
}

export type RunVirtualClient = (args: VirtualClientArgs) => Promise<VirtualClientResult>;

export interface CreateSubagentRunEntityOptions {
  runVirtualClient: RunVirtualClient;
}

function checkTermination(
  tmpl: MetaSubagentTemplate,
  cwd: string,
  output: string | undefined,
): boolean {
  const cond = tmpl.terminationCondition;
  if (cond.kind === 'output-file') {
    const p = isAbsolute(cond.target) ? cond.target : join(cwd, cond.target);
    return existsSync(p);
  }
  if (cond.kind === 'output-keyword') {
    return (output ?? '').includes(cond.target);
  }
  return false;
}

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
    });
    if (!result.ok) return { exitOk: false };
    return { exitOk: checkTermination(tmpl, ctx.worktreePath, result.output) };
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/subagent-run-entity.test.ts`

Expected: PASS (6 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/meta-workflow/run-entities/subagent-run-entity.ts \
        server/src/domains/meta-workflow/__tests__/subagent-run-entity.test.ts
git commit -m "feat(meta-workflow): add subagent run-entity adapter"
```

---

## Task 9: MetaWorkflowService — Top-Level Orchestrator

**Files:**
- Create: `server/src/domains/meta-workflow/service.ts`
- Test: `server/src/domains/meta-workflow/__tests__/service.test.ts`

Single class that aggregates everything: the 5 repositories, the 2 aggregates, the search + promotion services, the executor, the run-entity adapters. Exposes one method per CRUD ClientMessage so the WS handlers and HTTP routes just thin-wrap into this service:

- `createRun(projectId, title, description?, defaultProviderId?)`
- `submitRequirements(runId, requirementsPath)`
- `approveRequirements(runId)`
- `rejectRequirements(runId)`
- `setPhasesJson(runId, phasesJson)` (validates with `validatePhasesJson`; instantiates `MetaWorkflowPhase` rows for every phase)
- `runPhase(runId, phaseId, worktreePath)` — drives `MetaPhaseExecutor`; first does a reuse-pool search, on hit uses existing entity, otherwise lets executor synthesize
- `cancelRun(runId)`
- `promotePoolItem(itemId, input)` — delegates to `ReusePoolPromotionService`

- [ ] **Step 1: Write the failing test**

```typescript
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

  beforeEach(() => {
    db = freshDb();
    workdir = mkdtempSync(join(tmpdir(), 'meta-service-'));
    service = new MetaWorkflowService({
      db,
      runEntityForWorkflow: vi.fn().mockResolvedValue({ exitOk: true }),
      runEntityForSubagent: vi.fn().mockResolvedValue({ exitOk: true }),
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
    const result = await service.runPhase(run.id, 'p1', workdir);
    expect(result.phase.status).toBe('done');
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/service.test.ts`

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

```typescript
// server/src/domains/meta-workflow/service.ts
import type { Database } from 'better-sqlite3';
import type {
  MetaWorkflowRun,
  MetaWorkflowPhase,
  ReusablePoolItem,
} from '@my-claudia/shared/features/meta-workflow';
import { MetaWorkflowRunRepository } from './repositories/meta-workflow-run-repository.js';
import { MetaWorkflowPhaseRepository } from './repositories/meta-workflow-phase-repository.js';
import { MetaWorkflowArtifactRepository } from './repositories/meta-workflow-artifact-repository.js';
import { MetaWorkflowReusePoolRepository } from './repositories/meta-workflow-reuse-pool-repository.js';
import { MetaSubagentTemplateRepository } from './repositories/meta-subagent-template-repository.js';
import { MetaWorkflowRunAggregate } from './run-aggregate.js';
import { MetaWorkflowPhaseAggregate } from './phase-aggregate.js';
import { ReusePoolSearchService } from './reuse-pool-search.js';
import { ReusePoolPromotionService, type PromoteInput } from './reuse-pool-promotion.js';
import { MetaPhaseExecutor, type RunEntity, type PhaseExecutionResult } from './phase-executor.js';
import { validatePhasesJson } from './phases-json-validator.js';

export interface MetaWorkflowServiceOptions {
  db: Database;
  runEntityForWorkflow: RunEntity;
  runEntityForSubagent: RunEntity;
}

export interface CreateRunInput {
  projectId: string;
  title: string;
  description?: string;
  defaultProviderId?: string;
}

export class MetaWorkflowService {
  private runRepo: MetaWorkflowRunRepository;
  private phaseRepo: MetaWorkflowPhaseRepository;
  private artifactRepo: MetaWorkflowArtifactRepository;
  private poolRepo: MetaWorkflowReusePoolRepository;
  private subagentRepo: MetaSubagentTemplateRepository;
  private runAggregate: MetaWorkflowRunAggregate;
  private phaseAggregate: MetaWorkflowPhaseAggregate;
  private search: ReusePoolSearchService;
  private promotion: ReusePoolPromotionService;

  constructor(private opts: MetaWorkflowServiceOptions) {
    this.runRepo = new MetaWorkflowRunRepository(opts.db);
    this.phaseRepo = new MetaWorkflowPhaseRepository(opts.db);
    this.artifactRepo = new MetaWorkflowArtifactRepository(opts.db);
    this.poolRepo = new MetaWorkflowReusePoolRepository(opts.db);
    this.subagentRepo = new MetaSubagentTemplateRepository(opts.db);
    this.runAggregate = new MetaWorkflowRunAggregate(this.runRepo);
    this.phaseAggregate = new MetaWorkflowPhaseAggregate(this.phaseRepo);
    this.search = new ReusePoolSearchService(this.poolRepo);
    this.promotion = new ReusePoolPromotionService(this.poolRepo, this.subagentRepo);
  }

  // ── Run lifecycle ───────────────────────────────────────

  createRun(input: CreateRunInput): MetaWorkflowRun {
    return this.runAggregate.create(input);
  }

  submitRequirements(runId: string, requirementsPath: string): MetaWorkflowRun {
    return this.runAggregate.submitRequirements(runId, requirementsPath);
  }

  approveRequirements(runId: string): MetaWorkflowRun {
    return this.runAggregate.approveRequirements(runId);
  }

  rejectRequirements(runId: string): MetaWorkflowRun {
    return this.runAggregate.rejectRequirements(runId);
  }

  setPhasesJson(runId: string, phasesJson: string): MetaWorkflowRun {
    const validation = validatePhasesJson(phasesJson);
    if (!validation.ok) {
      throw new Error(`Invalid phases.json: ${validation.errors.join('; ')}`);
    }
    const updated = this.runAggregate.setPhasesJson(runId, phasesJson);
    for (const phaseDef of validation.doc.phases) {
      this.phaseAggregate.instantiate(runId, phaseDef);
    }
    return updated;
  }

  cancelRun(runId: string): MetaWorkflowRun {
    return this.runAggregate.cancel(runId);
  }

  // ── Phase execution ─────────────────────────────────────

  async runPhase(runId: string, phaseId: string, worktreePath: string): Promise<PhaseExecutionResult> {
    const phase = this.phaseRepo.findByRunAndPhaseId(runId, phaseId);
    if (!phase) throw new Error(`Phase not found: run=${runId} phase=${phaseId}`);

    const run = this.runRepo.findById(runId);
    if (!run?.phasesJson) throw new Error(`Run ${runId} has no phases.json`);

    const validation = validatePhasesJson(run.phasesJson);
    if (!validation.ok) throw new Error('Run has invalid phasesJson');
    const phaseDef = validation.doc.phases.find((p) => p.id === phaseId);
    if (!phaseDef) throw new Error(`Phase def not in phases.json: ${phaseId}`);

    const executor = new MetaPhaseExecutor({
      aggregate: this.phaseAggregate,
      runEntity: async (entity, ctx) => {
        if (entity.kind === 'workflow') return this.opts.runEntityForWorkflow(entity, ctx);
        return this.opts.runEntityForSubagent(entity, ctx);
      },
    });
    return executor.execute(phase.id, phaseDef, worktreePath);
  }

  // ── Reuse pool ──────────────────────────────────────────

  promotePoolItem(itemId: string, input: PromoteInput): ReusablePoolItem {
    return this.promotion.promote(itemId, input);
  }

  searchReusePool(phaseDef: Parameters<ReusePoolSearchService['search']>[0]) {
    return this.search.search(phaseDef);
  }

  // ── Read queries (for routes/handlers) ──────────────────

  listRuns(projectId: string): MetaWorkflowRun[] {
    return this.runRepo.findByProject(projectId);
  }

  getRun(runId: string): MetaWorkflowRun | null {
    return this.runRepo.findById(runId);
  }

  listPhases(runId: string): MetaWorkflowPhase[] {
    return this.phaseRepo.findByRun(runId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/service.test.ts`

Expected: PASS (6 assertions).

- [ ] **Step 5: Full Phase B + C regression**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow`

Expected: all Phase B (85) + new Phase C tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/domains/meta-workflow/service.ts \
        server/src/domains/meta-workflow/__tests__/service.test.ts
git commit -m "feat(meta-workflow): add MetaWorkflowService top-level orchestrator"
```

---

## Task 10: HTTP Routes

**Files:**
- Create: `server/src/domains/meta-workflow/routes.ts`

Standard Express routes that wrap `MetaWorkflowService`. Mirrors the pattern from `server/src/domains/workflows/routes.ts`. No tests in this task — route logic is thin pass-through and is exercised by the integration smoke test in Task 13.

Endpoints:
- `GET /api/meta-workflow/runs?projectId=...` → `listRuns`
- `GET /api/meta-workflow/runs/:runId` → `getRun`
- `GET /api/meta-workflow/runs/:runId/phases` → `listPhases`
- `POST /api/meta-workflow/runs/:runId/promote-item` (body `{ itemId, newTags, newName?, newDescription? }`) → `promotePoolItem`

The CRUD mutations (create / submit / approve / reject / set phases / cancel / run phase) go through WebSocket handlers in Task 11, not HTTP. This matches MyClaudia's existing pattern where mutations needing live progress feedback use WS.

- [ ] **Step 1: Create the routes file**

```typescript
// server/src/domains/meta-workflow/routes.ts
import { Router, type Request, type Response } from 'express';
import type { MetaWorkflowService } from './service.js';

export function createMetaWorkflowRoutes(service: MetaWorkflowService): Router {
  const router = Router();

  router.get('/runs', (req: Request, res: Response) => {
    const projectId = req.query.projectId as string | undefined;
    if (!projectId) {
      res.status(400).json({ error: 'projectId query param required' });
      return;
    }
    res.json({ runs: service.listRuns(projectId) });
  });

  router.get('/runs/:runId', (req: Request, res: Response) => {
    const run = service.getRun(req.params.runId);
    if (!run) {
      res.status(404).json({ error: 'run not found' });
      return;
    }
    res.json({ run });
  });

  router.get('/runs/:runId/phases', (req: Request, res: Response) => {
    res.json({ phases: service.listPhases(req.params.runId) });
  });

  router.post('/runs/:runId/promote-item', (req: Request, res: Response) => {
    const body = req.body as {
      itemId?: string;
      newTags?: string[];
      newName?: string;
      newDescription?: string;
    };
    if (!body.itemId || !Array.isArray(body.newTags)) {
      res.status(400).json({ error: 'itemId and newTags required' });
      return;
    }
    try {
      const promoted = service.promotePoolItem(body.itemId, {
        newTags: body.newTags,
        newName: body.newName,
        newDescription: body.newDescription,
      });
      res.json({ item: promoted });
    } catch (e) {
      res.status(404).json({ error: (e as Error).message });
    }
  });

  return router;
}
```

- [ ] **Step 2: TypeScript compiles**

Run: `pnpm --filter @my-claudia/server exec tsc --noEmit`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add server/src/domains/meta-workflow/routes.ts
git commit -m "feat(meta-workflow): add HTTP routes for read + promote"
```

---

## Task 11: WebSocket Handlers

**Files:**
- Create: `server/src/application/conversation/handlers/meta-workflow.ts`
- Test: `server/src/application/conversation/handlers/__tests__/meta-workflow.test.ts`

One handler per Phase B CRUD ClientMessage (6 handlers). Each calls into `MetaWorkflowService` and broadcasts the resulting state via the existing message-sending pattern (`sendMessage(client.ws, ...)`). The handlers do NOT auto-broadcast to other clients — that happens via the broader dispatcher event system, out of scope for this task.

For `RunMetaWorkflowPhaseMessage`, the handler needs a worktreePath — for Phase C MVP we'll synthesize a temp dir per phase run. Phase D will wire real `WorktreeManager`.

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/application/conversation/handlers/__tests__/meta-workflow.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleCreateMetaWorkflowRun,
  handleSubmitMetaWorkflowRequirements,
  handleResolveMetaWorkflowRequirements,
  handleSetMetaWorkflowPhases,
  handleCancelMetaWorkflowRun,
  handleRunMetaWorkflowPhase,
} from '../meta-workflow.js';

function makeClient() {
  const sent: unknown[] = [];
  return {
    sent,
    client: { ws: { send: (msg: string) => { sent.push(JSON.parse(msg)); } } } as never,
  };
}

describe('meta-workflow WS handlers', () => {
  it('handleCreateMetaWorkflowRun calls service.createRun + replies with run', () => {
    const { client, sent } = makeClient();
    const service = { createRun: vi.fn().mockReturnValue({ id: 'r1', status: 'requirement_draft', projectId: 'p', title: 't' }) };
    handleCreateMetaWorkflowRun(client, {
      type: 'create_meta_workflow_run', projectId: 'p', title: 't',
    }, service as never);
    expect(service.createRun).toHaveBeenCalledWith({ projectId: 'p', title: 't', description: undefined, defaultProviderId: undefined });
    expect(sent[0]).toMatchObject({ type: 'meta_workflow_run_update', run: { id: 'r1' } });
  });

  it('handleSubmitMetaWorkflowRequirements calls service.submitRequirements', () => {
    const { client, sent } = makeClient();
    const service = { submitRequirements: vi.fn().mockReturnValue({ id: 'r1', status: 'requirement_review', projectId: 'p', title: 't' }) };
    handleSubmitMetaWorkflowRequirements(client, {
      type: 'submit_meta_workflow_requirements', runId: 'r1', requirementsPath: 'r.md',
    }, service as never);
    expect(service.submitRequirements).toHaveBeenCalledWith('r1', 'r.md');
    expect(sent[0]).toMatchObject({ type: 'meta_workflow_run_update' });
  });

  it('handleResolveMetaWorkflowRequirements with approve calls approveRequirements', () => {
    const { client } = makeClient();
    const service = {
      approveRequirements: vi.fn().mockReturnValue({ id: 'r1', status: 'splitting', projectId: 'p', title: 't' }),
      rejectRequirements: vi.fn(),
    };
    handleResolveMetaWorkflowRequirements(client, {
      type: 'resolve_meta_workflow_requirements', runId: 'r1', decision: 'approve',
    }, service as never);
    expect(service.approveRequirements).toHaveBeenCalledWith('r1');
    expect(service.rejectRequirements).not.toHaveBeenCalled();
  });

  it('handleResolveMetaWorkflowRequirements with reject calls rejectRequirements', () => {
    const { client } = makeClient();
    const service = {
      approveRequirements: vi.fn(),
      rejectRequirements: vi.fn().mockReturnValue({ id: 'r1', status: 'requirement_draft', projectId: 'p', title: 't' }),
    };
    handleResolveMetaWorkflowRequirements(client, {
      type: 'resolve_meta_workflow_requirements', runId: 'r1', decision: 'reject',
    }, service as never);
    expect(service.rejectRequirements).toHaveBeenCalledWith('r1');
  });

  it('handleSetMetaWorkflowPhases passes phasesJson through', () => {
    const { client } = makeClient();
    const service = { setPhasesJson: vi.fn().mockReturnValue({ id: 'r1', status: 'executing', projectId: 'p', title: 't' }) };
    handleSetMetaWorkflowPhases(client, {
      type: 'set_meta_workflow_phases', runId: 'r1', phasesJson: '{}',
    }, service as never);
    expect(service.setPhasesJson).toHaveBeenCalledWith('r1', '{}');
  });

  it('handleCancelMetaWorkflowRun calls cancelRun', () => {
    const { client } = makeClient();
    const service = { cancelRun: vi.fn().mockReturnValue({ id: 'r1', status: 'cancelled', projectId: 'p', title: 't' }) };
    handleCancelMetaWorkflowRun(client, {
      type: 'cancel_meta_workflow_run', runId: 'r1',
    }, service as never);
    expect(service.cancelRun).toHaveBeenCalledWith('r1');
  });

  it('handleRunMetaWorkflowPhase awaits service.runPhase and broadcasts phase update', async () => {
    const { client, sent } = makeClient();
    const service = {
      runPhase: vi.fn().mockResolvedValue({
        phase: { id: 'pr1', runId: 'r1', phaseId: 'p1', status: 'done', executeEntity: 'workflow',
                 phaseType: 'code-implement', attempt: 1, maxRetries: 3, createdAt: 0 },
        gateResults: [],
      }),
    };
    await handleRunMetaWorkflowPhase(client, {
      type: 'run_meta_workflow_phase', runId: 'r1', phaseId: 'p1',
    }, service as never);
    expect(service.runPhase).toHaveBeenCalledWith('r1', 'p1', expect.any(String));
    expect(sent[0]).toMatchObject({ type: 'meta_workflow_phase_update', phase: { id: 'pr1', status: 'done' } });
  });

  it('handlers reply with error message when service throws', () => {
    const { client, sent } = makeClient();
    const service = { createRun: vi.fn().mockImplementation(() => { throw new Error('boom'); }) };
    handleCreateMetaWorkflowRun(client, {
      type: 'create_meta_workflow_run', projectId: 'p', title: 't',
    }, service as never);
    expect(sent[0]).toMatchObject({ type: 'error', message: expect.stringMatching(/boom/) });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @my-claudia/server exec vitest run src/application/conversation/handlers/__tests__/meta-workflow.test.ts`

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

```typescript
// server/src/application/conversation/handlers/meta-workflow.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  CreateMetaWorkflowRunMessage,
  SubmitMetaWorkflowRequirementsMessage,
  ResolveMetaWorkflowRequirementsMessage,
  SetMetaWorkflowPhasesMessage,
  CancelMetaWorkflowRunMessage,
  RunMetaWorkflowPhaseMessage,
} from '@my-claudia/shared/protocol/messages';
import type { ConnectedClient } from '../transport/types.js';
import type { MetaWorkflowService } from '../../../domains/meta-workflow/service.js';

function send(client: ConnectedClient, message: unknown): void {
  // matches existing handlers' use of sendMessage()
  client.ws.send(JSON.stringify(message));
}

function sendError(client: ConnectedClient, e: unknown): void {
  send(client, {
    type: 'error',
    message: e instanceof Error ? e.message : String(e),
  });
}

function broadcastRun(client: ConnectedClient, run: { projectId: string }): void {
  send(client, {
    type: 'meta_workflow_run_update',
    projectId: run.projectId,
    run,
  });
}

function broadcastPhase(
  client: ConnectedClient,
  projectId: string,
  runId: string,
  phase: unknown,
): void {
  send(client, {
    type: 'meta_workflow_phase_update',
    projectId,
    runId,
    phase,
  });
}

export function handleCreateMetaWorkflowRun(
  client: ConnectedClient,
  msg: CreateMetaWorkflowRunMessage,
  service: MetaWorkflowService,
): void {
  try {
    const run = service.createRun({
      projectId: msg.projectId,
      title: msg.title,
      description: msg.description,
      defaultProviderId: msg.defaultProviderId,
    });
    broadcastRun(client, run);
  } catch (e) {
    sendError(client, e);
  }
}

export function handleSubmitMetaWorkflowRequirements(
  client: ConnectedClient,
  msg: SubmitMetaWorkflowRequirementsMessage,
  service: MetaWorkflowService,
): void {
  try {
    const run = service.submitRequirements(msg.runId, msg.requirementsPath);
    broadcastRun(client, run);
  } catch (e) {
    sendError(client, e);
  }
}

export function handleResolveMetaWorkflowRequirements(
  client: ConnectedClient,
  msg: ResolveMetaWorkflowRequirementsMessage,
  service: MetaWorkflowService,
): void {
  try {
    const run = msg.decision === 'approve'
      ? service.approveRequirements(msg.runId)
      : service.rejectRequirements(msg.runId);
    broadcastRun(client, run);
  } catch (e) {
    sendError(client, e);
  }
}

export function handleSetMetaWorkflowPhases(
  client: ConnectedClient,
  msg: SetMetaWorkflowPhasesMessage,
  service: MetaWorkflowService,
): void {
  try {
    const run = service.setPhasesJson(msg.runId, msg.phasesJson);
    broadcastRun(client, run);
  } catch (e) {
    sendError(client, e);
  }
}

export function handleCancelMetaWorkflowRun(
  client: ConnectedClient,
  msg: CancelMetaWorkflowRunMessage,
  service: MetaWorkflowService,
): void {
  try {
    const run = service.cancelRun(msg.runId);
    broadcastRun(client, run);
  } catch (e) {
    sendError(client, e);
  }
}

export async function handleRunMetaWorkflowPhase(
  client: ConnectedClient,
  msg: RunMetaWorkflowPhaseMessage,
  service: MetaWorkflowService,
): Promise<void> {
  try {
    // Phase C MVP: per-phase temp worktree. Phase D will wire WorktreeManager.
    const worktreePath = mkdtempSync(join(tmpdir(), 'meta-phase-'));
    const result = await service.runPhase(msg.runId, msg.phaseId, worktreePath);
    const run = service.getRun(msg.runId);
    if (!run) return;
    broadcastPhase(client, run.projectId, msg.runId, result.phase);
  } catch (e) {
    sendError(client, e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @my-claudia/server exec vitest run src/application/conversation/handlers/__tests__/meta-workflow.test.ts`

Expected: PASS (8 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/src/application/conversation/handlers/meta-workflow.ts \
        server/src/application/conversation/handlers/__tests__/meta-workflow.test.ts
git commit -m "feat(meta-workflow): add WS handlers for 6 CRUD messages"
```

---

## Task 12: Domain register.ts Factory

**Files:**
- Create: `server/src/domains/meta-workflow/register.ts`
- Modify: `server/src/domains/meta-workflow/index.ts` (export new modules)

`register.ts` is the dependency-injection factory that constructs everything for a single domain. Mirrors the pattern from `server/src/domains/workflows/register.ts`. Returns `{ service, routes }` so the application bootstrap can wire them in.

For Phase C, the factory takes:
- `db`
- `workflowEngine` + `workflowRunRepository` (for the workflow runEntity adapter)
- `runVirtualClient` (for the subagent runEntity adapter)

If the bootstrap doesn't yet have a real `runVirtualClient`, Phase C MVP allows passing a stub that returns `{ ok: true }` — this means the meta-workflow can still run end-to-end but with no real AI. Replacing the stub is a Phase D task.

- [ ] **Step 1: Create the factory**

```typescript
// server/src/domains/meta-workflow/register.ts
import type { Database } from 'better-sqlite3';
import type { Router } from 'express';
import type { WorkflowEngine } from '../workflows/engine.js';
import type { WorkflowRunRepository } from '../workflows/workflow-run-repository.js';
import { MetaWorkflowService } from './service.js';
import { createMetaWorkflowRoutes } from './routes.js';
import { createWorkflowRunEntity } from './run-entities/workflow-run-entity.js';
import {
  createSubagentRunEntity,
  type RunVirtualClient,
} from './run-entities/subagent-run-entity.js';

export interface RegisterMetaWorkflowOptions {
  db: Database;
  workflowEngine: WorkflowEngine;
  workflowRunRepository: WorkflowRunRepository;
  runVirtualClient: RunVirtualClient;
  /**
   * Project to bind every workflow run to. For per-run project context the
   * service should accept this at call time; for Phase C MVP a single
   * default is used and overridden by `runPhase`'s implicit context.
   */
  defaultProjectId: string;
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
  const runEntityForSubagent = createSubagentRunEntity({
    runVirtualClient: opts.runVirtualClient,
  });

  const service = new MetaWorkflowService({
    db: opts.db,
    runEntityForWorkflow,
    runEntityForSubagent,
  });
  const routes = createMetaWorkflowRoutes(service);

  return { service, routes };
}
```

- [ ] **Step 2: Update `index.ts` to export Phase C public surface**

Replace `server/src/domains/meta-workflow/index.ts` with:

```typescript
// server/src/domains/meta-workflow/index.ts
/**
 * Meta Workflow domain — public surface.
 *
 * Phase A: types + schema + template stubs.
 * Phase B: aggregates, repositories, synthesizers, validator, executor.
 * Phase C: reuse pool (repo+search+promotion), real run-entity adapters,
 *          MetaWorkflowService orchestrator, HTTP routes, register() factory.
 */
export * from './phase-templates/index.js';
export * from './status-machine.js';

// Repositories
export { MetaWorkflowRunRepository } from './repositories/meta-workflow-run-repository.js';
export { MetaWorkflowPhaseRepository } from './repositories/meta-workflow-phase-repository.js';
export { MetaWorkflowArtifactRepository } from './repositories/meta-workflow-artifact-repository.js';
export { MetaWorkflowReusePoolRepository } from './repositories/meta-workflow-reuse-pool-repository.js';
export { MetaSubagentTemplateRepository } from './repositories/meta-subagent-template-repository.js';

// Aggregates
export { MetaWorkflowRunAggregate } from './run-aggregate.js';
export { MetaWorkflowPhaseAggregate } from './phase-aggregate.js';

// Validator
export { validatePhasesJson, type ValidationResult } from './phases-json-validator.js';

// Synthesizers
export { synthesizeWorkflow } from './workflow-synthesizer.js';
export { synthesizeSubagent } from './subagent-synthesizer.js';

// Gate runner
export { runGate, runGates, type RunGatesOptions } from './gate-runner.js';

// Phase executor
export {
  MetaPhaseExecutor,
  type SynthesizedEntity,
  type RunEntity,
  type RunEntityOutcome,
  type PhaseExecutionResult,
  type MetaPhaseExecutorOptions,
} from './phase-executor.js';

// Reuse pool services
export { ReusePoolSearchService, type ReuseSearchResult } from './reuse-pool-search.js';
export { ReusePoolPromotionService, type PromoteInput } from './reuse-pool-promotion.js';

// Run-entity adapters
export {
  createWorkflowRunEntity,
  type CreateWorkflowRunEntityOptions,
} from './run-entities/workflow-run-entity.js';
export {
  createSubagentRunEntity,
  type CreateSubagentRunEntityOptions,
  type RunVirtualClient,
  type VirtualClientArgs,
  type VirtualClientResult,
} from './run-entities/subagent-run-entity.js';

// Service + routes + register factory
export { MetaWorkflowService, type MetaWorkflowServiceOptions, type CreateRunInput } from './service.js';
export { createMetaWorkflowRoutes } from './routes.js';
export {
  registerMetaWorkflow,
  type RegisterMetaWorkflowOptions,
  type RegisteredMetaWorkflow,
} from './register.js';
```

- [ ] **Step 3: TypeScript compiles**

Run: `pnpm --filter @my-claudia/server exec tsc --noEmit`

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add server/src/domains/meta-workflow/register.ts \
        server/src/domains/meta-workflow/index.ts
git commit -m "feat(meta-workflow): add register() factory + export Phase C surface"
```

---

## Task 13: Full Smoke Verify + Tag

**Files:** none (verification only)

- [ ] **Step 1: Build all packages**

Run: `pnpm build`

Expected: all packages build cleanly.

- [ ] **Step 2: Run all Phase A/B/C tests**

```bash
cd /Users/haozhang/SourceCode/zhvala/my-claudia
pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow src/application/conversation/handlers/__tests__/meta-workflow.test.ts src/infrastructure/storage/migrations/__tests__/069_meta_workflow.test.ts
pnpm --filter @my-claudia/shared exec vitest run src/features/__tests__/meta-workflow.test.ts src/features/__tests__/meta-workflow-protocol.test.ts
```

Expected: all pass. Approximate counts:
- Server meta-workflow domain: 85 (Phase B) + 6 (ReusePoolRepo) + 3 (SubagentTemplateRepo) + 6 (search) + 4 (promotion) + 1 (PhaseAggregate add) + 4 (workflow-runEntity) + 6 (subagent-runEntity) + 6 (service) = 121
- Server handlers: 8
- Server migration: 11
- Shared: 12

Total: ~152 meta-workflow-related tests.

- [ ] **Step 3: End-to-end programmatic smoke through `MetaWorkflowService`**

```bash
cd /Users/haozhang/SourceCode/zhvala/my-claudia && node --input-type=module -e "
import Database from 'better-sqlite3';
import { migrations } from './server/dist/infrastructure/storage/migrations/index.js';
import { MetaWorkflowService } from './server/dist/domains/meta-workflow/service.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

const service = new MetaWorkflowService({
  db,
  runEntityForWorkflow: async () => ({ exitOk: true }),
  runEntityForSubagent: async () => ({ exitOk: true }),
});

const run = service.createRun({ projectId: 'proj-1', title: 'Phase C smoke' });
service.submitRequirements(run.id, 'design/req.md');
service.approveRequirements(run.id);
service.setPhasesJson(run.id, JSON.stringify({
  version: '1',
  phases: [{
    id: 'p1', name: 'Echo', description: 'echo',
    phaseType: 'code-implement', dependsOn: [], inputs: [],
    outputs: [{ kind: 'commit', description: 'commit' }],
    acceptanceGates: [{ id: 'g1', description: 'ok', command: 'true', expect: { exitCode: 0 } }],
  }],
  smokePath: ['p1'],
  metadata: { generatedAt: 0, requirementsPath: 'design/req.md' },
}));

const workdir = mkdtempSync(join(tmpdir(), 'phase-c-smoke-'));
const result = await service.runPhase(run.id, 'p1', workdir);
console.log('Phase status:', result.phase.status);
console.log('Gate results:', result.gateResults.length);
if (result.phase.status !== 'done') process.exit(1);
console.log('Phase C smoke: PASS');
"
```

Expected output:
```
Phase status: done
Gate results: 1
Phase C smoke: PASS
```

- [ ] **Step 4: Tag**

```bash
git tag -a meta-workflow/phase-c-complete -m "Meta Workflow Phase C reuse pool + runtime adapters + routes landed"
```

---

## Phase C Acceptance Criteria

- [ ] All 13 tasks complete and individually committed.
- [ ] `pnpm build` passes.
- [ ] Phase C-specific tests pass (counts above).
- [ ] Phase A/B regression tests still pass.
- [ ] Programmatic smoke through `MetaWorkflowService` outputs `Phase C smoke: PASS`.
- [ ] No regressions in pre-existing tests outside the meta-workflow scope (the known `run-handler.test.ts` WIP failure remains and is unrelated).

---

## What Phase C Deliberately Leaves to Later Phases

| Item | Where it lands |
|------|---------------|
| `WorkflowEngine` event-listener integration (replace polling) | Phase D |
| Real multi-turn subagent conversation runtime (replace single ai_prompt) | Phase D |
| `WorktreeManager` integration (replace temp dirs) | Phase D |
| Stale propagator service + 4 user actions on stale phases | Phase D |
| Artifact versioning + UI surfacing | Phase D |
| `MetaWorkflowService` event/notification broadcasting beyond the calling client | Phase D |
| Mount routes + WS handlers in application bootstrap (`server/src/index.ts`) | Phase D or Phase E |
| All UI screens (requirements / phase-graph / phase-board / phase-detail / promotion dialog) | Phase E |
| End-to-end smoke on a real Java/TS project | Phase F |
| Real `runVirtualClient` wiring to existing conversation runtime | Phase D |

---

*Plan version: 1 / 2026-05-18*
*Spec reference: `docs/design/supervisor-meta-workflow.zh-CN.md`*
*Phase A: complete (tag `meta-workflow/phase-a-complete`)*
*Phase B: complete (tag `meta-workflow/phase-b-complete`)*
