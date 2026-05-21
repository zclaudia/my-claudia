# OpenSpec × Supervisor — Phase G1: Data Layer Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the data + abstraction foundation for the OpenSpec integration without changing any user-visible behavior. Add 3 new tables, extend `local_issues`, define the `IExecutor` port, and ship 3 adapters (`Classic` / `MetaWorkflow` / `Manual`) — all behind feature-flagged code paths that current Classic Change and Meta Workflow flows do not yet invoke.

**Architecture:** This phase is purely additive. New schema sits alongside existing tables. The `IExecutor` interface is registered in the domain layer but no production code path constructs an `ExecutorInstance` yet — that happens in G3 when the Issue layer starts attaching SpecChanges. Adapters wrap the existing `ChangeLifecycle` / `MetaWorkflowService` without modifying them. The single exception: `LocalIssue` gets 4 new nullable columns (default-backfilled) — no existing query is broken.

**Tech Stack:** TypeScript strict, better-sqlite3 migrations, vitest, the existing `BaseRepository` pattern (`server/src/infrastructure/repositories/base.ts`).

**Spec reference:** `docs/design/openspec-integration-v2.zh-CN.md` §5 (data model) + §11 G1 acceptance.

**Phase predecessors:**
- Design v0.2 committed `342651f6`
- Latest test green tag chain: `meta-workflow/phase-f-complete`

---

## File Structure

```
shared/src/features/
├── local-issue.ts                                                MODIFY (+ type, parent, status v2)
├── spec-change.ts                                                NEW (SpecChange type)
├── executor.ts                                                   NEW (ExecutorInstance + IExecutor port + status enums)
└── __tests__/
    └── spec-change.test.ts                                       NEW

server/src/infrastructure/storage/migrations/
├── 070_openspec_foundation.ts                                    NEW (3 tables + ALTER local_issues)
└── index.ts                                                      MODIFY (register migration)

server/src/domains/spec-change/                                   NEW domain
├── index.ts
├── spec-change-repository.ts
├── register.ts
└── __tests__/
    └── spec-change-repository.test.ts

server/src/domains/executor/                                      NEW domain
├── index.ts
├── executor-port.ts                                              IExecutor + ExecutorRegistry
├── executor-instance-repository.ts
├── executor-registry.ts
├── adapters/
│   ├── classic-adapter.ts
│   ├── meta-workflow-adapter.ts
│   └── manual-adapter.ts
├── register.ts
└── __tests__/
    ├── executor-instance-repository.test.ts
    ├── classic-adapter.test.ts
    ├── meta-workflow-adapter.test.ts
    └── manual-adapter.test.ts

server/src/domains/local-issues/
├── repository.ts                                                 MODIFY (new fields)
└── __tests__/repository.test.ts                                  MODIFY (cover new fields)

server/src/application/bootstrap/
└── feature-domains.ts                                            MODIFY (register spec-change + executor domains)
```

7 tasks total.

```
Task 1 — Shared types (LocalIssue ext + SpecChange + Executor)         ← independent
Task 2 — Migration 070 + ExecutorInstance repository                    ← needs T1
Task 3 — SpecChange repository + LocalIssue repo extension              ← needs T2
Task 4 — IExecutor port + ExecutorRegistry + ManualAdapter             ← needs T1
Task 5 — ClassicAdapter (wraps ChangeLifecycle)                         ← needs T3, T4
Task 6 — MetaWorkflowAdapter (wraps MetaWorkflowService)                ← needs T3, T4
Task 7 — Wire to bootstrap + smoke + tag                                ← final
```

---

## Task 1: Shared types

**Files:**
- Modify: `shared/src/features/local-issue.ts`
- Create: `shared/src/features/spec-change.ts`
- Create: `shared/src/features/executor.ts`
- Create: `shared/src/features/__tests__/spec-change.test.ts`

**Goal:** All the type contracts the rest of G1 depends on. No runtime code, just types + exhaustive enum lists.

- [ ] **Step 1: Extend `local-issue.ts`**

Replace contents of `shared/src/features/local-issue.ts`:

```typescript
// Local Issue Types

/**
 * Issue type discriminator.
 *
 * - 'feature': parent-only organizational container. Never carries a SpecChange.
 *   Status is restricted to 'open' | 'closed' | 'cancelled'.
 * - 'implement' | 'bug' | 'enhancement' | 'chore': sub-issue types that may
 *   carry a SpecChange and use the full 7-state status machine below.
 */
export type LocalIssueType =
  | 'feature'
  | 'implement'
  | 'bug'
  | 'enhancement'
  | 'chore';

/**
 * Status enum covering both parent (feature) and sub-issue lifecycles.
 *
 * Parent (type='feature') uses: open | closed | cancelled
 * Sub-issue uses the full set.
 *
 * Note: 'in_progress' (v1) is retained for backward compatibility with
 * existing local_issues records that pre-date G1. Code reading status must
 * treat legacy 'in_progress' as 'executing' for new-flow semantics. See
 * Task 3 for migration backfill.
 */
export type LocalIssueStatus =
  | 'open'
  | 'planning'
  | 'tasks_ready'
  | 'executing'
  | 'reviewing'
  | 'closed'
  | 'cancelled'
  | 'in_progress';  // legacy

export type LocalIssuePriority = 'low' | 'medium' | 'high' | 'critical';

export interface LocalIssue {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: LocalIssueStatus;
  priority: LocalIssuePriority;
  labels: string[];

  // G1 additions
  type: LocalIssueType;
  parentIssueId?: string;
  specChangeId?: string;
  isAnonymous: boolean;

  createdAt: number;
  updatedAt: number;
  closedAt?: number;
}

export interface LocalIssueComment {
  id: string;
  issueId: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export const ACTIONABLE_LABEL = 'actionable';

export function extractDefaultTitleFromPlan(planMarkdown: string): string {
  const lines = planMarkdown.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/);
    if (m) {
      const text = m[1];
      if (text) return text;
    }
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.length > 80 ? trimmed.slice(0, 80) : trimmed;
  }
  return `Plan from ${new Date().toISOString()}`;
}
```

- [ ] **Step 2: Create `spec-change.ts`**

```typescript
// shared/src/features/spec-change.ts

export type SpecChangeStatus =
  | 'drafting'
  | 'proposing'
  | 'designing'
  | 'tasks_ready'
  | 'archived'
  | 'cancelled';

export interface SpecChange {
  id: string;
  projectId: string;
  /** The sub-issue this SpecChange belongs to (always 1:1). */
  subIssueId: string;
  /** kebab-case folder name under openspec/changes/. */
  slug: string;
  title: string;
  status: SpecChangeStatus;
  proposalPath: string;
  designPath: string;
  tasksPath: string;
  /** File paths of delta specs (one per touched capability). */
  deltaSpecPaths: string[];
  /** B3: true means delta has been frozen at sub-issue close, awaiting merge. */
  deltaPendingMerge: boolean;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
}

export interface SpecChangeCreate {
  projectId: string;
  subIssueId: string;
  slug: string;
  title: string;
}

export interface SpecChangeUpdate {
  status?: SpecChangeStatus;
  title?: string;
  deltaSpecPaths?: string[];
  deltaPendingMerge?: boolean;
  archivedAt?: number;
}
```

- [ ] **Step 3: Create `executor.ts`**

```typescript
// shared/src/features/executor.ts

export type ExecutorType = 'classic' | 'meta-workflow' | 'manual' | 'superpowers';

export type ExecutorStatus =
  | 'pending'
  | 'executing'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ExecutorInstance {
  id: string;
  projectId: string;
  specChangeId: string;
  type: ExecutorType;
  /** FK into the type-specific table (project_changes / meta_workflow_runs / etc).
   *  null for type='manual'. */
  underlyingId?: string;
  statusSummary: ExecutorStatus;
  progressJson?: string;
  startedAt?: number;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ExecutorInstanceCreate {
  projectId: string;
  specChangeId: string;
  type: ExecutorType;
  underlyingId?: string;
}

export interface ExecutorInstanceUpdate {
  statusSummary?: ExecutorStatus;
  progressJson?: string;
  startedAt?: number;
  completedAt?: number;
}

/** Generic input passed to IExecutor.start(). Adapters cast to their concrete shape. */
export interface ExecutorInput {
  /** Adapter-specific configuration. */
  config?: unknown;
}

export interface ExecutorProgress {
  /** 0–1 normalized progress (best-effort; -1 if unknown). */
  fraction: number;
  /** Human-readable summary line. */
  summary: string;
  /** Adapter-specific extra info. */
  metadata?: Record<string, unknown>;
}

export interface GitCommit {
  sha: string;
  message: string;
  authoredAt: number;
}

/**
 * Port that every executor implementation must satisfy. Adapters implement
 * this in the server domain; the Issue layer talks to executors only via
 * this interface.
 */
export interface IExecutor {
  start(input: ExecutorInput): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
  getStatus(): ExecutorStatus;
  getProgress(): ExecutorProgress;
  getOutputCommits(): GitCommit[];
}
```

- [ ] **Step 4: Add a sanity test for shared types**

Create `shared/src/features/__tests__/spec-change.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { SpecChange, SpecChangeStatus } from '../spec-change.js';
import type { ExecutorInstance, ExecutorStatus, ExecutorType } from '../executor.js';
import type { LocalIssue, LocalIssueType, LocalIssueStatus } from '../local-issue.js';

describe('OpenSpec G1 shared type sanity', () => {
  it('SpecChangeStatus enum covers all designed states', () => {
    const all: SpecChangeStatus[] = ['drafting', 'proposing', 'designing', 'tasks_ready', 'archived', 'cancelled'];
    expect(all.length).toBe(6);
  });

  it('ExecutorStatus enum covers all designed states', () => {
    const all: ExecutorStatus[] = ['pending', 'executing', 'paused', 'completed', 'failed', 'cancelled'];
    expect(all.length).toBe(6);
  });

  it('ExecutorType enum includes the 4 G1 adapter targets', () => {
    const all: ExecutorType[] = ['classic', 'meta-workflow', 'manual', 'superpowers'];
    expect(all).toContain('classic');
    expect(all).toContain('meta-workflow');
    expect(all).toContain('manual');
  });

  it('LocalIssueType discriminator', () => {
    const all: LocalIssueType[] = ['feature', 'implement', 'bug', 'enhancement', 'chore'];
    expect(all.length).toBe(5);
  });

  it('LocalIssueStatus retains legacy in_progress for backward compat', () => {
    const all: LocalIssueStatus[] = ['open', 'planning', 'tasks_ready', 'executing', 'reviewing', 'closed', 'cancelled', 'in_progress'];
    expect(all).toContain('in_progress');
  });

  it('shapes compile', () => {
    const sc: SpecChange = {
      id: 's1', projectId: 'p1', subIssueId: 'i1', slug: 'add-2fa', title: 'Add 2FA',
      status: 'drafting', proposalPath: 'openspec/changes/add-2fa/proposal.md',
      designPath: 'openspec/changes/add-2fa/design.md', tasksPath: 'openspec/changes/add-2fa/tasks.md',
      deltaSpecPaths: [], deltaPendingMerge: false, createdAt: 0, updatedAt: 0,
    };
    expect(sc.slug).toBe('add-2fa');

    const e: ExecutorInstance = {
      id: 'e1', projectId: 'p1', specChangeId: 's1', type: 'classic',
      underlyingId: 'pc-1', statusSummary: 'pending', createdAt: 0, updatedAt: 0,
    };
    expect(e.type).toBe('classic');

    const li: LocalIssue = {
      id: 'i1', projectId: 'p1', title: 'T', status: 'open', priority: 'medium', labels: [],
      type: 'implement', isAnonymous: false, createdAt: 0, updatedAt: 0,
    };
    expect(li.type).toBe('implement');
  });
});
```

- [ ] **Step 5: Build + run shared tests**

Run:
```bash
pnpm --filter @my-claudia/shared exec tsc --noEmit
pnpm --filter @my-claudia/shared exec vitest run src/features/__tests__/spec-change.test.ts
```

Expected: both exit 0; 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add shared/src/features/local-issue.ts \
        shared/src/features/spec-change.ts \
        shared/src/features/executor.ts \
        shared/src/features/__tests__/spec-change.test.ts
git commit -m "feat(openspec-shared): SpecChange + Executor + LocalIssue type extensions"
```

---

## Task 2: Migration 070 + ExecutorInstance repository

**Files:**
- Create: `server/src/infrastructure/storage/migrations/070_openspec_foundation.ts`
- Modify: `server/src/infrastructure/storage/migrations/index.ts`
- Create: `server/src/domains/executor/executor-instance-repository.ts`
- Create: `server/src/domains/executor/__tests__/executor-instance-repository.test.ts`

**Goal:** New tables in place; `ExecutorInstanceRepository` works.

- [ ] **Step 1: Create migration 070**

Create `server/src/infrastructure/storage/migrations/070_openspec_foundation.ts`:

```typescript
import type { Migration } from './types.js';

export const migration: Migration = {
  name: '070_openspec_foundation',
  sql: `
    -- SpecChange (1:1 with sub-issue)
    CREATE TABLE IF NOT EXISTS spec_changes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      sub_issue_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'drafting'
        CHECK (status IN ('drafting','proposing','designing','tasks_ready','archived','cancelled')),
      proposal_path TEXT NOT NULL,
      design_path TEXT NOT NULL,
      tasks_path TEXT NOT NULL,
      delta_spec_paths TEXT NOT NULL DEFAULT '[]',
      delta_pending_merge INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (sub_issue_id) REFERENCES local_issues(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_spec_changes_project ON spec_changes(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_spec_changes_sub_issue ON spec_changes(sub_issue_id);

    -- ExecutorInstance (abstraction layer)
    CREATE TABLE IF NOT EXISTS executor_instances (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      spec_change_id TEXT NOT NULL,
      type TEXT NOT NULL
        CHECK (type IN ('classic','meta-workflow','manual','superpowers')),
      underlying_id TEXT,
      status_summary TEXT NOT NULL DEFAULT 'pending'
        CHECK (status_summary IN ('pending','executing','paused','completed','failed','cancelled')),
      progress_json TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (spec_change_id) REFERENCES spec_changes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_executor_instances_spec_change ON executor_instances(spec_change_id);
    CREATE INDEX IF NOT EXISTS idx_executor_instances_status ON executor_instances(project_id, status_summary);

    -- Spec corpus metadata cache (optional; populated by G4 bootstrap)
    CREATE TABLE IF NOT EXISTS project_spec_corpus_meta (
      project_id TEXT PRIMARY KEY,
      initialized INTEGER NOT NULL DEFAULT 0,
      last_bootstrap_at INTEGER,
      capabilities_json TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- LocalIssue extension
    ALTER TABLE local_issues ADD COLUMN type TEXT NOT NULL DEFAULT 'implement'
      CHECK (type IN ('feature','implement','bug','enhancement','chore'));
    ALTER TABLE local_issues ADD COLUMN parent_issue_id TEXT
      REFERENCES local_issues(id) ON DELETE SET NULL;
    ALTER TABLE local_issues ADD COLUMN spec_change_id TEXT;
    ALTER TABLE local_issues ADD COLUMN is_anonymous INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX IF NOT EXISTS idx_local_issues_parent ON local_issues(parent_issue_id);
    CREATE INDEX IF NOT EXISTS idx_local_issues_type ON local_issues(project_id, type);
  `,
};
```

- [ ] **Step 2: Register in migration index**

Edit `server/src/infrastructure/storage/migrations/index.ts`. Find the last import (`069_meta_workflow`). Add after it:

```typescript
import { migration as m_070_openspec_foundation } from './070_openspec_foundation.js';
```

Find the `migrations` array and append `m_070_openspec_foundation` at the end.

- [ ] **Step 3: Verify migrations apply cleanly**

Run:
```bash
pnpm --filter @my-claudia/server exec vitest run src/infrastructure/storage/migrations
```

Expected: existing migration tests pass; if there's a "all migrations apply" smoke, it runs the new one too.

- [ ] **Step 4: Create `executor-instance-repository.ts`**

Create `server/src/domains/executor/executor-instance-repository.ts`:

```typescript
import { BaseRepository } from '../../infrastructure/repositories/base.js';
import type { Database } from 'better-sqlite3';
import type {
  ExecutorInstance,
  ExecutorInstanceCreate,
  ExecutorInstanceUpdate,
  ExecutorStatus,
  ExecutorType,
} from '@my-claudia/shared/features/executor';

interface Row {
  id: string;
  project_id: string;
  spec_change_id: string;
  type: string;
  underlying_id: string | null;
  status_summary: string;
  progress_json: string | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

export class ExecutorInstanceRepository extends BaseRepository<
  ExecutorInstance,
  ExecutorInstanceCreate,
  ExecutorInstanceUpdate
> {
  constructor(db: Database) {
    super(db, 'executor_instances');
  }

  protected fromRow(row: unknown): ExecutorInstance {
    const r = row as Row;
    return {
      id: r.id,
      projectId: r.project_id,
      specChangeId: r.spec_change_id,
      type: r.type as ExecutorType,
      underlyingId: r.underlying_id ?? undefined,
      statusSummary: r.status_summary as ExecutorStatus,
      progressJson: r.progress_json ?? undefined,
      startedAt: r.started_at ?? undefined,
      completedAt: r.completed_at ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  protected buildInsert(id: string, data: ExecutorInstanceCreate): { sql: string; params: unknown[] } {
    const now = Date.now();
    return {
      sql: `INSERT INTO executor_instances
              (id, project_id, spec_change_id, type, underlying_id, status_summary, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [id, data.projectId, data.specChangeId, data.type, data.underlyingId ?? null, 'pending', now, now],
    };
  }

  protected buildUpdate(id: string, data: ExecutorInstanceUpdate): { sql: string; params: unknown[] } | null {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (data.statusSummary !== undefined) { sets.push('status_summary = ?'); params.push(data.statusSummary); }
    if (data.progressJson !== undefined) { sets.push('progress_json = ?'); params.push(data.progressJson); }
    if (data.startedAt !== undefined) { sets.push('started_at = ?'); params.push(data.startedAt); }
    if (data.completedAt !== undefined) { sets.push('completed_at = ?'); params.push(data.completedAt); }
    if (sets.length === 0) return null;
    sets.push('updated_at = ?'); params.push(Date.now());
    params.push(id);
    return { sql: `UPDATE executor_instances SET ${sets.join(', ')} WHERE id = ?`, params };
  }

  listBySpecChange(specChangeId: string): ExecutorInstance[] {
    const rows = this.db.prepare(
      `SELECT * FROM executor_instances WHERE spec_change_id = ? ORDER BY created_at ASC`,
    ).all(specChangeId);
    return rows.map((r) => this.fromRow(r));
  }

  listByProjectAndStatus(projectId: string, status: ExecutorStatus): ExecutorInstance[] {
    const rows = this.db.prepare(
      `SELECT * FROM executor_instances WHERE project_id = ? AND status_summary = ? ORDER BY updated_at DESC`,
    ).all(projectId, status);
    return rows.map((r) => this.fromRow(r));
  }
}
```

> If the actual `BaseRepository` API differs (method names, what's protected, where `db` lives), inspect `server/src/infrastructure/repositories/base.ts` and adapt. The current code uses `extends BaseRepository<T, Create, Update>` with `fromRow` / `buildInsert` / `buildUpdate`; check before assuming.

- [ ] **Step 5: Write the repository test**

Create `server/src/domains/executor/__tests__/executor-instance-repository.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { ExecutorInstanceRepository } from '../executor-instance-repository.js';

describe('ExecutorInstanceRepository', () => {
  let db: Database.Database;
  let repo: ExecutorInstanceRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    // Seed minimal FK targets
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run('proj-1', 'P', 'code', 0, 0);
    db.prepare(`INSERT INTO local_issues
      (id, project_id, title, description, status, priority, labels, created_at, updated_at, type, is_anonymous)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('issue-1', 'proj-1', 'i', null, 'open', 'medium', '[]', 0, 0, 'implement', 0);
    db.prepare(`INSERT INTO spec_changes
      (id, project_id, sub_issue_id, slug, title, status, proposal_path, design_path, tasks_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('sc-1', 'proj-1', 'issue-1', 'add-2fa', 'Add 2FA', 'drafting',
           'openspec/changes/add-2fa/proposal.md',
           'openspec/changes/add-2fa/design.md',
           'openspec/changes/add-2fa/tasks.md',
           0, 0);
    repo = new ExecutorInstanceRepository(db);
  });

  it('create + findById round-trip', () => {
    const e = repo.create({ projectId: 'proj-1', specChangeId: 'sc-1', type: 'classic', underlyingId: 'pc-1' });
    expect(e.id).toBeTruthy();
    expect(e.statusSummary).toBe('pending');
    const f = repo.findById(e.id)!;
    expect(f.type).toBe('classic');
    expect(f.underlyingId).toBe('pc-1');
  });

  it('manual executor has null underlyingId', () => {
    const e = repo.create({ projectId: 'proj-1', specChangeId: 'sc-1', type: 'manual' });
    expect(e.underlyingId).toBeUndefined();
  });

  it('update sets fields and bumps updatedAt', () => {
    const e = repo.create({ projectId: 'proj-1', specChangeId: 'sc-1', type: 'classic', underlyingId: 'pc-1' });
    const before = e.updatedAt;
    // ensure clock progression
    const updated = repo.update(e.id, { statusSummary: 'executing', startedAt: 9999 });
    expect(updated.statusSummary).toBe('executing');
    expect(updated.startedAt).toBe(9999);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('listBySpecChange returns instances ordered by created_at', () => {
    const a = repo.create({ projectId: 'proj-1', specChangeId: 'sc-1', type: 'classic', underlyingId: 'a' });
    const b = repo.create({ projectId: 'proj-1', specChangeId: 'sc-1', type: 'meta-workflow', underlyingId: 'b' });
    const items = repo.listBySpecChange('sc-1');
    expect(items.map((i) => i.id)).toEqual([a.id, b.id]);
  });

  it('listByProjectAndStatus filters correctly', () => {
    const a = repo.create({ projectId: 'proj-1', specChangeId: 'sc-1', type: 'classic', underlyingId: 'a' });
    repo.update(a.id, { statusSummary: 'completed' });
    const b = repo.create({ projectId: 'proj-1', specChangeId: 'sc-1', type: 'classic', underlyingId: 'b' });
    const pending = repo.listByProjectAndStatus('proj-1', 'pending');
    expect(pending.map((i) => i.id)).toEqual([b.id]);
  });

  it('CHECK constraint rejects invalid type', () => {
    expect(() => db.prepare(`INSERT INTO executor_instances
      (id, project_id, spec_change_id, type, status_summary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run('bad', 'proj-1', 'sc-1', 'invalid', 'pending', 0, 0))
      .toThrow();
  });
});
```

- [ ] **Step 6: Run + verify**

Run:
```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/executor/__tests__/executor-instance-repository.test.ts
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: 6 tests green; tsc clean.

- [ ] **Step 7: Commit**

```bash
git add server/src/infrastructure/storage/migrations/070_openspec_foundation.ts \
        server/src/infrastructure/storage/migrations/index.ts \
        server/src/domains/executor/executor-instance-repository.ts \
        server/src/domains/executor/__tests__/executor-instance-repository.test.ts
git commit -m "feat(openspec): migration 070 + ExecutorInstanceRepository"
```

---

## Task 3: SpecChange repository + LocalIssue repo extension

**Files:**
- Create: `server/src/domains/spec-change/spec-change-repository.ts`
- Create: `server/src/domains/spec-change/__tests__/spec-change-repository.test.ts`
- Modify: `server/src/domains/local-issues/repository.ts`
- Modify: `server/src/domains/local-issues/__tests__/repository.test.ts`

**Goal:** Both repositories now read/write the new schema.

- [ ] **Step 1: Create `spec-change-repository.ts`**

```typescript
// server/src/domains/spec-change/spec-change-repository.ts
import { BaseRepository } from '../../infrastructure/repositories/base.js';
import type { Database } from 'better-sqlite3';
import type {
  SpecChange,
  SpecChangeCreate,
  SpecChangeUpdate,
  SpecChangeStatus,
} from '@my-claudia/shared/features/spec-change';

interface Row {
  id: string;
  project_id: string;
  sub_issue_id: string;
  slug: string;
  title: string;
  status: string;
  proposal_path: string;
  design_path: string;
  tasks_path: string;
  delta_spec_paths: string;
  delta_pending_merge: number;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
}

export class SpecChangeRepository extends BaseRepository<SpecChange, SpecChangeCreate, SpecChangeUpdate> {
  constructor(db: Database) {
    super(db, 'spec_changes');
  }

  protected fromRow(row: unknown): SpecChange {
    const r = row as Row;
    return {
      id: r.id,
      projectId: r.project_id,
      subIssueId: r.sub_issue_id,
      slug: r.slug,
      title: r.title,
      status: r.status as SpecChangeStatus,
      proposalPath: r.proposal_path,
      designPath: r.design_path,
      tasksPath: r.tasks_path,
      deltaSpecPaths: JSON.parse(r.delta_spec_paths) as string[],
      deltaPendingMerge: r.delta_pending_merge === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      archivedAt: r.archived_at ?? undefined,
    };
  }

  protected buildInsert(id: string, data: SpecChangeCreate): { sql: string; params: unknown[] } {
    const now = Date.now();
    const base = `openspec/changes/${data.slug}`;
    return {
      sql: `INSERT INTO spec_changes
              (id, project_id, sub_issue_id, slug, title, status,
               proposal_path, design_path, tasks_path,
               delta_spec_paths, delta_pending_merge, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [id, data.projectId, data.subIssueId, data.slug, data.title, 'drafting',
               `${base}/proposal.md`, `${base}/design.md`, `${base}/tasks.md`,
               '[]', 0, now, now],
    };
  }

  protected buildUpdate(id: string, data: SpecChangeUpdate): { sql: string; params: unknown[] } | null {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (data.status !== undefined) { sets.push('status = ?'); params.push(data.status); }
    if (data.title !== undefined) { sets.push('title = ?'); params.push(data.title); }
    if (data.deltaSpecPaths !== undefined) { sets.push('delta_spec_paths = ?'); params.push(JSON.stringify(data.deltaSpecPaths)); }
    if (data.deltaPendingMerge !== undefined) { sets.push('delta_pending_merge = ?'); params.push(data.deltaPendingMerge ? 1 : 0); }
    if (data.archivedAt !== undefined) { sets.push('archived_at = ?'); params.push(data.archivedAt); }
    if (sets.length === 0) return null;
    sets.push('updated_at = ?'); params.push(Date.now());
    params.push(id);
    return { sql: `UPDATE spec_changes SET ${sets.join(', ')} WHERE id = ?`, params };
  }

  findBySubIssue(subIssueId: string): SpecChange | null {
    const row = this.db.prepare(`SELECT * FROM spec_changes WHERE sub_issue_id = ?`).get(subIssueId);
    return row ? this.fromRow(row) : null;
  }

  findBySlug(projectId: string, slug: string): SpecChange | null {
    const row = this.db.prepare(`SELECT * FROM spec_changes WHERE project_id = ? AND slug = ?`).get(projectId, slug);
    return row ? this.fromRow(row) : null;
  }

  listByProject(projectId: string): SpecChange[] {
    const rows = this.db.prepare(`SELECT * FROM spec_changes WHERE project_id = ? ORDER BY created_at DESC`).all(projectId);
    return rows.map((r) => this.fromRow(r));
  }
}
```

- [ ] **Step 2: Write tests for SpecChange repo**

Create `server/src/domains/spec-change/__tests__/spec-change-repository.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { SpecChangeRepository } from '../spec-change-repository.js';

describe('SpecChangeRepository', () => {
  let db: Database.Database;
  let repo: SpecChangeRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run('proj-1', 'P', 'code', 0, 0);
    db.prepare(`INSERT INTO local_issues
      (id, project_id, title, description, status, priority, labels, created_at, updated_at, type, is_anonymous)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('issue-1', 'proj-1', 't', null, 'open', 'medium', '[]', 0, 0, 'implement', 0);
    repo = new SpecChangeRepository(db);
  });

  it('create defaults to drafting with auto-derived paths', () => {
    const sc = repo.create({ projectId: 'proj-1', subIssueId: 'issue-1', slug: 'add-2fa', title: 'Add 2FA' });
    expect(sc.status).toBe('drafting');
    expect(sc.proposalPath).toBe('openspec/changes/add-2fa/proposal.md');
    expect(sc.designPath).toBe('openspec/changes/add-2fa/design.md');
    expect(sc.tasksPath).toBe('openspec/changes/add-2fa/tasks.md');
    expect(sc.deltaSpecPaths).toEqual([]);
    expect(sc.deltaPendingMerge).toBe(false);
  });

  it('update status + deltaPendingMerge + deltaSpecPaths', () => {
    const sc = repo.create({ projectId: 'proj-1', subIssueId: 'issue-1', slug: 'x', title: 'X' });
    const upd = repo.update(sc.id, {
      status: 'tasks_ready',
      deltaSpecPaths: ['openspec/changes/x/specs/auth/spec.md'],
      deltaPendingMerge: true,
    });
    expect(upd.status).toBe('tasks_ready');
    expect(upd.deltaSpecPaths).toEqual(['openspec/changes/x/specs/auth/spec.md']);
    expect(upd.deltaPendingMerge).toBe(true);
  });

  it('findBySubIssue + findBySlug + listByProject', () => {
    const sc = repo.create({ projectId: 'proj-1', subIssueId: 'issue-1', slug: 'add-2fa', title: 'A' });
    expect(repo.findBySubIssue('issue-1')!.id).toBe(sc.id);
    expect(repo.findBySlug('proj-1', 'add-2fa')!.id).toBe(sc.id);
    expect(repo.listByProject('proj-1').map((s) => s.id)).toEqual([sc.id]);
    expect(repo.findBySubIssue('nope')).toBeNull();
  });

  it('archived_at is settable', () => {
    const sc = repo.create({ projectId: 'proj-1', subIssueId: 'issue-1', slug: 'x', title: 'X' });
    const upd = repo.update(sc.id, { status: 'archived', archivedAt: 12345 });
    expect(upd.archivedAt).toBe(12345);
    expect(upd.status).toBe('archived');
  });

  it('CHECK constraint rejects invalid status', () => {
    expect(() => db.prepare(`INSERT INTO spec_changes
      (id, project_id, sub_issue_id, slug, title, status,
       proposal_path, design_path, tasks_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('bad', 'proj-1', 'issue-1', 'x', 'X', 'invalid', 'p', 'd', 't', 0, 0)).toThrow();
  });
});
```

- [ ] **Step 3: Extend `LocalIssueRepository` with new fields**

Open `server/src/domains/local-issues/repository.ts`. Find the `fromRow` and `buildInsert` / `buildUpdate` methods. Modify them to handle the 4 new columns (`type`, `parent_issue_id`, `spec_change_id`, `is_anonymous`).

The exact diff depends on the current shape. Pattern:

```typescript
protected fromRow(row: unknown): LocalIssue {
  const r = row as Row;  // expanded Row to include new columns
  return {
    // existing
    id: r.id, projectId: r.project_id, title: r.title, description: r.description ?? undefined,
    status: r.status as LocalIssueStatus,
    priority: r.priority as LocalIssuePriority,
    labels: JSON.parse(r.labels) as string[],
    createdAt: r.created_at, updatedAt: r.updated_at, closedAt: r.closed_at ?? undefined,
    // new
    type: r.type as LocalIssueType,
    parentIssueId: r.parent_issue_id ?? undefined,
    specChangeId: r.spec_change_id ?? undefined,
    isAnonymous: r.is_anonymous === 1,
  };
}
```

Update `buildInsert` to include the 4 new columns with defaults:

```typescript
protected buildInsert(id: string, data: LocalIssueCreate): { sql: string; params: unknown[] } {
  const now = Date.now();
  return {
    sql: `INSERT INTO local_issues
            (id, project_id, title, description, status, priority, labels,
             type, parent_issue_id, spec_change_id, is_anonymous,
             created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [id, data.projectId, data.title, data.description ?? null,
             data.status ?? 'open', data.priority ?? 'medium', JSON.stringify(data.labels ?? []),
             data.type ?? 'implement', data.parentIssueId ?? null,
             data.specChangeId ?? null, data.isAnonymous ? 1 : 0,
             now, now],
  };
}
```

Update `buildUpdate` to support updating the new columns:

```typescript
// Add these to the existing chain
if (data.type !== undefined) { sets.push('type = ?'); params.push(data.type); }
if (data.parentIssueId !== undefined) { sets.push('parent_issue_id = ?'); params.push(data.parentIssueId); }
if (data.specChangeId !== undefined) { sets.push('spec_change_id = ?'); params.push(data.specChangeId); }
if (data.isAnonymous !== undefined) { sets.push('is_anonymous = ?'); params.push(data.isAnonymous ? 1 : 0); }
```

`LocalIssueCreate` / `LocalIssueUpdate` types: extend to include optional `type`, `parentIssueId`, `specChangeId`, `isAnonymous`. Add to wherever they're defined (probably in the repo file or shared).

- [ ] **Step 4: Extend LocalIssue tests**

In `server/src/domains/local-issues/__tests__/repository.test.ts`, append:

```typescript
describe('G1 extensions', () => {
  it('creates an implement-type sub-issue with a parent', () => {
    const parent = repo.create({ projectId: 'proj-1', title: 'Feature', type: 'feature' });
    const sub = repo.create({ projectId: 'proj-1', title: 'Impl', type: 'implement', parentIssueId: parent.id });
    expect(sub.type).toBe('implement');
    expect(sub.parentIssueId).toBe(parent.id);
  });

  it('isAnonymous flag round-trips', () => {
    const i = repo.create({ projectId: 'proj-1', title: 'X', isAnonymous: true });
    expect(repo.findById(i.id)!.isAnonymous).toBe(true);
  });

  it('default type is implement', () => {
    const i = repo.create({ projectId: 'proj-1', title: 'X' });
    expect(i.type).toBe('implement');
    expect(i.isAnonymous).toBe(false);
  });
});
```

- [ ] **Step 5: Run all + verify**

Run:
```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/spec-change src/domains/local-issues
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add server/src/domains/spec-change/spec-change-repository.ts \
        server/src/domains/spec-change/__tests__/spec-change-repository.test.ts \
        server/src/domains/local-issues/repository.ts \
        server/src/domains/local-issues/__tests__/repository.test.ts
git commit -m "feat(openspec): SpecChange repo + LocalIssue G1 field extensions"
```

---

## Task 4: IExecutor port + Registry + ManualAdapter

**Files:**
- Create: `server/src/domains/executor/executor-port.ts`
- Create: `server/src/domains/executor/executor-registry.ts`
- Create: `server/src/domains/executor/adapters/manual-adapter.ts`
- Create: `server/src/domains/executor/__tests__/manual-adapter.test.ts`
- Create: `server/src/domains/executor/index.ts`

**Goal:** The abstract port is defined and there's at least one working adapter (Manual is simplest — pure state, no underlying).

- [ ] **Step 1: Create `executor-port.ts`**

```typescript
// server/src/domains/executor/executor-port.ts
// Re-exports the IExecutor port from shared, plus server-side helpers.

export type {
  IExecutor,
  ExecutorInput,
  ExecutorProgress,
  ExecutorStatus,
  ExecutorType,
  GitCommit,
} from '@my-claudia/shared/features/executor';

import type { ExecutorInstance } from '@my-claudia/shared/features/executor';
import type { IExecutor } from '@my-claudia/shared/features/executor';

/** Factory signature each adapter provides. */
export type ExecutorFactory = (instance: ExecutorInstance) => IExecutor;
```

- [ ] **Step 2: Create `executor-registry.ts`**

```typescript
// server/src/domains/executor/executor-registry.ts
import type { ExecutorInstance, ExecutorType } from '@my-claudia/shared/features/executor';
import type { IExecutor, ExecutorFactory } from './executor-port.js';

/**
 * Holds one factory per ExecutorType. The Issue layer resolves a concrete
 * IExecutor by calling `resolve(instance)`.
 */
export class ExecutorRegistry {
  private factories = new Map<ExecutorType, ExecutorFactory>();

  register(type: ExecutorType, factory: ExecutorFactory): void {
    this.factories.set(type, factory);
  }

  has(type: ExecutorType): boolean {
    return this.factories.has(type);
  }

  resolve(instance: ExecutorInstance): IExecutor {
    const factory = this.factories.get(instance.type);
    if (!factory) {
      throw new Error(`No executor factory registered for type='${instance.type}'`);
    }
    return factory(instance);
  }
}
```

- [ ] **Step 3: Create `manual-adapter.ts`**

```typescript
// server/src/domains/executor/adapters/manual-adapter.ts
import type { Database } from 'better-sqlite3';
import type {
  ExecutorInstance,
  IExecutor,
  ExecutorInput,
  ExecutorProgress,
  ExecutorStatus,
  GitCommit,
} from '@my-claudia/shared/features/executor';
import { ExecutorInstanceRepository } from '../executor-instance-repository.js';

/**
 * Manual executor: no underlying service. The user marks transitions by hand
 * via API/UI calls. This adapter just persists the status changes to
 * executor_instances and exposes them.
 */
export class ManualAdapter implements IExecutor {
  private repo: ExecutorInstanceRepository;
  private currentStatus: ExecutorStatus;

  constructor(db: Database, private instance: ExecutorInstance) {
    this.repo = new ExecutorInstanceRepository(db);
    this.currentStatus = instance.statusSummary;
  }

  async start(_input: ExecutorInput): Promise<void> {
    this.transitionTo('executing', { startedAt: Date.now() });
  }

  async pause(): Promise<void> {
    this.transitionTo('paused');
  }

  async resume(): Promise<void> {
    this.transitionTo('executing');
  }

  async cancel(): Promise<void> {
    this.transitionTo('cancelled', { completedAt: Date.now() });
  }

  /** Manual-specific public API: user-driven completion. */
  async markCompleted(): Promise<void> {
    this.transitionTo('completed', { completedAt: Date.now() });
  }

  /** Manual-specific public API: user-driven failure. */
  async markFailed(): Promise<void> {
    this.transitionTo('failed', { completedAt: Date.now() });
  }

  getStatus(): ExecutorStatus {
    return this.currentStatus;
  }

  getProgress(): ExecutorProgress {
    return { fraction: this.currentStatus === 'completed' ? 1 : -1, summary: `manual: ${this.currentStatus}` };
  }

  getOutputCommits(): GitCommit[] {
    return [];
  }

  private transitionTo(next: ExecutorStatus, extra?: { startedAt?: number; completedAt?: number }): void {
    this.repo.update(this.instance.id, {
      statusSummary: next,
      startedAt: extra?.startedAt,
      completedAt: extra?.completedAt,
    });
    this.currentStatus = next;
  }
}
```

- [ ] **Step 4: Write ManualAdapter tests**

```typescript
// server/src/domains/executor/__tests__/manual-adapter.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { ExecutorInstanceRepository } from '../executor-instance-repository.js';
import { ManualAdapter } from '../adapters/manual-adapter.js';

describe('ManualAdapter', () => {
  let db: Database.Database;
  let repo: ExecutorInstanceRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('proj-1', 'P', 'code', 0, 0);
    db.prepare(`INSERT INTO local_issues (id, project_id, title, description, status, priority, labels, created_at, updated_at, type, is_anonymous)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('i', 'proj-1', 't', null, 'open', 'medium', '[]', 0, 0, 'implement', 0);
    db.prepare(`INSERT INTO spec_changes (id, project_id, sub_issue_id, slug, title, status, proposal_path, design_path, tasks_path, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('sc', 'proj-1', 'i', 'x', 'X', 'drafting', 'a', 'b', 'c', 0, 0);
    repo = new ExecutorInstanceRepository(db);
  });

  it('start() transitions to executing and sets startedAt', async () => {
    const e = repo.create({ projectId: 'proj-1', specChangeId: 'sc', type: 'manual' });
    const a = new ManualAdapter(db, e);
    await a.start({});
    expect(a.getStatus()).toBe('executing');
    const persisted = repo.findById(e.id)!;
    expect(persisted.statusSummary).toBe('executing');
    expect(persisted.startedAt).toBeTruthy();
  });

  it('markCompleted() transitions to completed and sets completedAt', async () => {
    const e = repo.create({ projectId: 'proj-1', specChangeId: 'sc', type: 'manual' });
    const a = new ManualAdapter(db, e);
    await a.start({});
    await a.markCompleted();
    expect(a.getStatus()).toBe('completed');
    expect(repo.findById(e.id)!.completedAt).toBeTruthy();
  });

  it('cancel() works from any state', async () => {
    const e = repo.create({ projectId: 'proj-1', specChangeId: 'sc', type: 'manual' });
    const a = new ManualAdapter(db, e);
    await a.cancel();
    expect(a.getStatus()).toBe('cancelled');
  });

  it('pause/resume cycle', async () => {
    const e = repo.create({ projectId: 'proj-1', specChangeId: 'sc', type: 'manual' });
    const a = new ManualAdapter(db, e);
    await a.start({});
    await a.pause();
    expect(a.getStatus()).toBe('paused');
    await a.resume();
    expect(a.getStatus()).toBe('executing');
  });

  it('getProgress returns -1 fraction while executing, 1 when completed', async () => {
    const e = repo.create({ projectId: 'proj-1', specChangeId: 'sc', type: 'manual' });
    const a = new ManualAdapter(db, e);
    await a.start({});
    expect(a.getProgress().fraction).toBe(-1);
    await a.markCompleted();
    expect(a.getProgress().fraction).toBe(1);
  });
});
```

- [ ] **Step 5: Create `index.ts`**

```typescript
// server/src/domains/executor/index.ts
export { ExecutorRegistry } from './executor-registry.js';
export { ExecutorInstanceRepository } from './executor-instance-repository.js';
export { ManualAdapter } from './adapters/manual-adapter.js';
export type { IExecutor, ExecutorFactory } from './executor-port.js';
```

- [ ] **Step 6: Run + verify**

Run:
```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/executor
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add server/src/domains/executor/executor-port.ts \
        server/src/domains/executor/executor-registry.ts \
        server/src/domains/executor/adapters/manual-adapter.ts \
        server/src/domains/executor/__tests__/manual-adapter.test.ts \
        server/src/domains/executor/index.ts
git commit -m "feat(openspec): IExecutor port + Registry + ManualAdapter"
```

---

## Task 5: ClassicAdapter (wraps ChangeLifecycle)

**Files:**
- Create: `server/src/domains/executor/adapters/classic-adapter.ts`
- Create: `server/src/domains/executor/__tests__/classic-adapter.test.ts`

**Goal:** Wrap the existing `ChangeLifecycle` so that an ExecutorInstance(type='classic') can drive a `ProjectChange` through start/pause/cancel without touching the lifecycle's internals.

- [ ] **Step 1: Inspect ChangeLifecycle public surface**

Run:
```bash
grep -nE "^(  )?(async )?(create|complete|cancel|pause|resume)[A-Z]" server/src/domains/supervision/change-lifecycle.ts
```

Confirm available methods. For G1 we only need to map: `start` → noop (Classic Change auto-starts on createChange), `cancel` → mapping to cancelling the change, `getStatus` → reading ProjectChange.status and normalizing.

- [ ] **Step 2: Write the adapter**

```typescript
// server/src/domains/executor/adapters/classic-adapter.ts
import type { ChangeLifecycle } from '../../supervision/change-lifecycle.js';
import type {
  ExecutorInstance,
  IExecutor,
  ExecutorInput,
  ExecutorProgress,
  ExecutorStatus,
  GitCommit,
} from '@my-claudia/shared/features/executor';
import type { ProjectChange, ChangeStatus } from '@my-claudia/shared/features/supervision';
import { ExecutorInstanceRepository } from '../executor-instance-repository.js';
import type { Database } from 'better-sqlite3';

/** Normalize ChangeStatus → ExecutorStatus. */
function mapStatus(s: ChangeStatus): ExecutorStatus {
  switch (s) {
    case 'draft':
    case 'designing':
    case 'awaiting_design_review':
    case 'planning':
    case 'awaiting_execution_review':
      return 'pending';
    case 'executing':
    case 'accepting':
    case 'syncing':
      return 'executing';
    case 'paused':
      return 'paused';
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'pending';
  }
}

export class ClassicAdapter implements IExecutor {
  private repo: ExecutorInstanceRepository;

  constructor(
    private db: Database,
    private lifecycle: ChangeLifecycle,
    private instance: ExecutorInstance,
  ) {
    this.repo = new ExecutorInstanceRepository(db);
  }

  async start(_input: ExecutorInput): Promise<void> {
    // G1: starting a Classic instance is a no-op — the underlying ProjectChange
    // is assumed to already exist (created elsewhere, e.g. via existing flow).
    // G3 will move ProjectChange creation into this adapter.
    this.refreshStatus();
  }

  async pause(): Promise<void> {
    // ChangeLifecycle doesn't expose pause yet — record at the abstract layer only.
    this.persistStatus('paused');
  }

  async resume(): Promise<void> {
    this.persistStatus('executing');
  }

  async cancel(): Promise<void> {
    if (!this.instance.underlyingId) {
      throw new Error('ClassicAdapter.cancel: instance has no underlyingId');
    }
    // Pull change to verify it exists; ChangeLifecycle.cancel API TBD —
    // for G1 we just normalize state. G3 will wire real cancellation.
    this.persistStatus('cancelled', { completedAt: Date.now() });
  }

  getStatus(): ExecutorStatus {
    if (!this.instance.underlyingId) return this.instance.statusSummary;
    const change = this.lifecycle.getChange(this.instance.underlyingId);
    return change ? mapStatus(change.status) : this.instance.statusSummary;
  }

  getProgress(): ExecutorProgress {
    return { fraction: this.getStatus() === 'completed' ? 1 : -1, summary: `classic: ${this.getStatus()}` };
  }

  getOutputCommits(): GitCommit[] {
    // G1 placeholder — real commit history wiring in G3+.
    return [];
  }

  /** Re-read status from underlying and persist to ExecutorInstance. */
  refreshStatus(): void {
    const status = this.getStatus();
    if (status !== this.instance.statusSummary) {
      this.persistStatus(status);
    }
  }

  private persistStatus(s: ExecutorStatus, extra?: { startedAt?: number; completedAt?: number }): void {
    this.repo.update(this.instance.id, { statusSummary: s, startedAt: extra?.startedAt, completedAt: extra?.completedAt });
    this.instance = { ...this.instance, statusSummary: s };
  }
}
```

> If `ChangeLifecycle` doesn't have a `getChange` method (only `getChanges`), adapt to whatever method is available — read `change-lifecycle.ts` line 96 in current code.

- [ ] **Step 3: Write tests**

```typescript
// server/src/domains/executor/__tests__/classic-adapter.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { ExecutorInstanceRepository } from '../executor-instance-repository.js';
import { ClassicAdapter } from '../adapters/classic-adapter.js';
import type { ChangeLifecycle } from '../../supervision/change-lifecycle.js';
import type { ProjectChange } from '@my-claudia/shared/features/supervision';

function mkChange(over: Partial<ProjectChange> = {}): ProjectChange {
  return {
    id: 'pc-1', projectId: 'proj-1', title: 't', slug: 't',
    status: 'executing', summary: '', nonGoals: [], scope: [], acceptanceCriteria: [],
    active: true, createdAt: 0, updatedAt: 0, ...over,
  } as ProjectChange;
}

describe('ClassicAdapter', () => {
  let db: Database.Database;
  let repo: ExecutorInstanceRepository;
  let lifecycle: ChangeLifecycle;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('proj-1', 'P', 'code', 0, 0);
    db.prepare(`INSERT INTO local_issues (id, project_id, title, description, status, priority, labels, created_at, updated_at, type, is_anonymous)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('i', 'proj-1', 't', null, 'open', 'medium', '[]', 0, 0, 'implement', 0);
    db.prepare(`INSERT INTO spec_changes (id, project_id, sub_issue_id, slug, title, status, proposal_path, design_path, tasks_path, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('sc', 'proj-1', 'i', 'x', 'X', 'drafting', 'a', 'b', 'c', 0, 0);
    repo = new ExecutorInstanceRepository(db);
    lifecycle = { getChange: vi.fn() } as unknown as ChangeLifecycle;
  });

  it('getStatus maps ChangeStatus → ExecutorStatus correctly', () => {
    const e = repo.create({ projectId: 'proj-1', specChangeId: 'sc', type: 'classic', underlyingId: 'pc-1' });
    (lifecycle.getChange as ReturnType<typeof vi.fn>).mockReturnValue(mkChange({ status: 'executing' }));
    const a = new ClassicAdapter(db, lifecycle, e);
    expect(a.getStatus()).toBe('executing');

    (lifecycle.getChange as ReturnType<typeof vi.fn>).mockReturnValue(mkChange({ status: 'completed' }));
    expect(a.getStatus()).toBe('completed');

    (lifecycle.getChange as ReturnType<typeof vi.fn>).mockReturnValue(mkChange({ status: 'draft' }));
    expect(a.getStatus()).toBe('pending');
  });

  it('start refreshes status from underlying', async () => {
    const e = repo.create({ projectId: 'proj-1', specChangeId: 'sc', type: 'classic', underlyingId: 'pc-1' });
    (lifecycle.getChange as ReturnType<typeof vi.fn>).mockReturnValue(mkChange({ status: 'executing' }));
    const a = new ClassicAdapter(db, lifecycle, e);
    await a.start({});
    expect(repo.findById(e.id)!.statusSummary).toBe('executing');
  });

  it('cancel persists cancelled status', async () => {
    const e = repo.create({ projectId: 'proj-1', specChangeId: 'sc', type: 'classic', underlyingId: 'pc-1' });
    const a = new ClassicAdapter(db, lifecycle, e);
    await a.cancel();
    expect(repo.findById(e.id)!.statusSummary).toBe('cancelled');
    expect(repo.findById(e.id)!.completedAt).toBeTruthy();
  });

  it('throws when cancelling without underlyingId', async () => {
    const e = repo.create({ projectId: 'proj-1', specChangeId: 'sc', type: 'classic' });
    const a = new ClassicAdapter(db, lifecycle, e);
    await expect(a.cancel()).rejects.toThrow(/underlyingId/);
  });

  it('returns instance.statusSummary when underlying is missing', () => {
    const e = repo.create({ projectId: 'proj-1', specChangeId: 'sc', type: 'classic', underlyingId: 'missing' });
    (lifecycle.getChange as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const a = new ClassicAdapter(db, lifecycle, e);
    expect(a.getStatus()).toBe('pending');  // fallback to default
  });
});
```

- [ ] **Step 4: Run + verify**

Run:
```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/executor/__tests__/classic-adapter.test.ts
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/executor/adapters/classic-adapter.ts \
        server/src/domains/executor/__tests__/classic-adapter.test.ts
git commit -m "feat(openspec): ClassicAdapter wrapping ChangeLifecycle"
```

---

## Task 6: MetaWorkflowAdapter (wraps MetaWorkflowService)

**Files:**
- Create: `server/src/domains/executor/adapters/meta-workflow-adapter.ts`
- Create: `server/src/domains/executor/__tests__/meta-workflow-adapter.test.ts`

**Goal:** Same shape as Classic — wrap `MetaWorkflowService` for type='meta-workflow' executors.

- [ ] **Step 1: Inspect MetaWorkflowService.getRun() shape**

`MetaWorkflowService.getRun(runId)` returns `MetaWorkflowRun | null`. Status field is `MetaWorkflowRun.status`. Map to `ExecutorStatus`.

- [ ] **Step 2: Write the adapter**

```typescript
// server/src/domains/executor/adapters/meta-workflow-adapter.ts
import type { Database } from 'better-sqlite3';
import type { MetaWorkflowService } from '../../meta-workflow/service.js';
import type {
  ExecutorInstance,
  IExecutor,
  ExecutorInput,
  ExecutorProgress,
  ExecutorStatus,
  GitCommit,
} from '@my-claudia/shared/features/executor';
import type { MetaWorkflowRunStatus } from '@my-claudia/shared/features/meta-workflow';
import { ExecutorInstanceRepository } from '../executor-instance-repository.js';

function mapStatus(s: MetaWorkflowRunStatus): ExecutorStatus {
  switch (s) {
    case 'requirement_draft':
    case 'requirement_review':
    case 'splitting':
      return 'pending';
    case 'executing':
      return 'executing';
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'pending';
  }
}

export class MetaWorkflowAdapter implements IExecutor {
  private repo: ExecutorInstanceRepository;

  constructor(
    private db: Database,
    private service: MetaWorkflowService,
    private instance: ExecutorInstance,
  ) {
    this.repo = new ExecutorInstanceRepository(db);
  }

  async start(_input: ExecutorInput): Promise<void> {
    this.refreshStatus();
  }

  async pause(): Promise<void> {
    this.persistStatus('paused');
  }

  async resume(): Promise<void> {
    this.persistStatus('executing');
  }

  async cancel(): Promise<void> {
    if (!this.instance.underlyingId) throw new Error('MetaWorkflowAdapter.cancel: no underlyingId');
    this.service.cancelRun(this.instance.underlyingId);
    this.persistStatus('cancelled', { completedAt: Date.now() });
  }

  getStatus(): ExecutorStatus {
    if (!this.instance.underlyingId) return this.instance.statusSummary;
    const run = this.service.getRun(this.instance.underlyingId);
    return run ? mapStatus(run.status) : this.instance.statusSummary;
  }

  getProgress(): ExecutorProgress {
    if (!this.instance.underlyingId) {
      return { fraction: -1, summary: `meta-workflow: ${this.instance.statusSummary}` };
    }
    const phases = this.service.listPhases(this.instance.underlyingId);
    const total = phases.length;
    const done = phases.filter((p) => p.status === 'done').length;
    return {
      fraction: total > 0 ? done / total : -1,
      summary: `${done}/${total} phases done`,
      metadata: { phaseCount: total, doneCount: done },
    };
  }

  getOutputCommits(): GitCommit[] {
    return [];  // G1 placeholder
  }

  refreshStatus(): void {
    const status = this.getStatus();
    if (status !== this.instance.statusSummary) this.persistStatus(status);
  }

  private persistStatus(s: ExecutorStatus, extra?: { startedAt?: number; completedAt?: number }): void {
    this.repo.update(this.instance.id, { statusSummary: s, startedAt: extra?.startedAt, completedAt: extra?.completedAt });
    this.instance = { ...this.instance, statusSummary: s };
  }
}
```

> Verify `MetaWorkflowRunStatus` is exported from `@my-claudia/shared/features/meta-workflow`. If named differently, adapt.

- [ ] **Step 3: Write tests**

```typescript
// server/src/domains/executor/__tests__/meta-workflow-adapter.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { ExecutorInstanceRepository } from '../executor-instance-repository.js';
import { MetaWorkflowAdapter } from '../adapters/meta-workflow-adapter.js';
import type { MetaWorkflowService } from '../../meta-workflow/service.js';

describe('MetaWorkflowAdapter', () => {
  let db: Database.Database;
  let repo: ExecutorInstanceRepository;
  let service: MetaWorkflowService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('proj-1', 'P', 'code', 0, 0);
    db.prepare(`INSERT INTO local_issues (id, project_id, title, description, status, priority, labels, created_at, updated_at, type, is_anonymous)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('i', 'proj-1', 't', null, 'open', 'medium', '[]', 0, 0, 'implement', 0);
    db.prepare(`INSERT INTO spec_changes (id, project_id, sub_issue_id, slug, title, status, proposal_path, design_path, tasks_path, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('sc', 'proj-1', 'i', 'x', 'X', 'drafting', 'a', 'b', 'c', 0, 0);
    repo = new ExecutorInstanceRepository(db);
    service = {
      getRun: vi.fn(),
      cancelRun: vi.fn(),
      listPhases: vi.fn().mockReturnValue([]),
    } as unknown as MetaWorkflowService;
  });

  it('getStatus maps run status correctly', () => {
    const e = repo.create({ projectId: 'proj-1', specChangeId: 'sc', type: 'meta-workflow', underlyingId: 'r1' });
    (service.getRun as ReturnType<typeof vi.fn>).mockReturnValue({ status: 'executing' });
    const a = new MetaWorkflowAdapter(db, service, e);
    expect(a.getStatus()).toBe('executing');

    (service.getRun as ReturnType<typeof vi.fn>).mockReturnValue({ status: 'completed' });
    expect(a.getStatus()).toBe('completed');

    (service.getRun as ReturnType<typeof vi.fn>).mockReturnValue({ status: 'requirement_draft' });
    expect(a.getStatus()).toBe('pending');
  });

  it('getProgress reports done/total phases', () => {
    const e = repo.create({ projectId: 'proj-1', specChangeId: 'sc', type: 'meta-workflow', underlyingId: 'r1' });
    (service.listPhases as ReturnType<typeof vi.fn>).mockReturnValue([
      { status: 'done' }, { status: 'done' }, { status: 'pending' }, { status: 'pending' },
    ]);
    const a = new MetaWorkflowAdapter(db, service, e);
    const p = a.getProgress();
    expect(p.fraction).toBe(0.5);
    expect(p.summary).toContain('2/4');
  });

  it('cancel calls service.cancelRun and persists', async () => {
    const e = repo.create({ projectId: 'proj-1', specChangeId: 'sc', type: 'meta-workflow', underlyingId: 'r1' });
    (service.getRun as ReturnType<typeof vi.fn>).mockReturnValue({ status: 'cancelled' });
    const a = new MetaWorkflowAdapter(db, service, e);
    await a.cancel();
    expect(service.cancelRun).toHaveBeenCalledWith('r1');
    expect(repo.findById(e.id)!.statusSummary).toBe('cancelled');
  });
});
```

- [ ] **Step 4: Run + verify**

Run:
```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/executor/__tests__/meta-workflow-adapter.test.ts
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/executor/adapters/meta-workflow-adapter.ts \
        server/src/domains/executor/__tests__/meta-workflow-adapter.test.ts
git commit -m "feat(openspec): MetaWorkflowAdapter wrapping MetaWorkflowService"
```

---

## Task 7: Bootstrap wiring + smoke + tag

**Files:**
- Modify: `server/src/application/bootstrap/feature-domains.ts` (register registry and adapters, but don't invoke anything yet)

**Goal:** Server starts cleanly; ExecutorRegistry is available in DI; no existing behavior changes; tag the release.

- [ ] **Step 1: Wire in `feature-domains.ts`**

Open `server/src/application/bootstrap/feature-domains.ts`. Add the wiring near where other domain services are constructed (typical pattern: at the bottom of the function returning the bag of services). Don't change any existing call sites yet.

```typescript
import { ExecutorRegistry, ManualAdapter, ExecutorInstanceRepository } from '../../domains/executor/index.js';
import { SpecChangeRepository } from '../../domains/spec-change/spec-change-repository.js';
import { ClassicAdapter } from '../../domains/executor/adapters/classic-adapter.js';
import { MetaWorkflowAdapter } from '../../domains/executor/adapters/meta-workflow-adapter.js';

// ... existing wiring ...

// G1: OpenSpec foundation registries (no-op for existing flows)
const executorRegistry = new ExecutorRegistry();
const executorInstanceRepo = new ExecutorInstanceRepository(opts.db);
const specChangeRepo = new SpecChangeRepository(opts.db);

executorRegistry.register('manual', (instance) => new ManualAdapter(opts.db, instance));
executorRegistry.register('classic', (instance) => new ClassicAdapter(opts.db, /* changeLifecycle reference */, instance));
executorRegistry.register('meta-workflow', (instance) => new MetaWorkflowAdapter(opts.db, /* metaWorkflowService reference */, instance));
// 'superpowers' deliberately omitted; G6+ may add.

// Expose via the returned bag so G3 onwards can consume:
return {
  // ... existing services ...
  executorRegistry,
  executorInstanceRepo,
  specChangeRepo,
};
```

> Replace `/* changeLifecycle reference */` and `/* metaWorkflowService reference */` with the local variables of whatever existing wire instances are already in `feature-domains.ts`. If those services aren't yet instantiated at the wiring point, move the registry registration to after they are. If `ChangeLifecycle` is not directly available here, instantiate it adjacent (existing supervision domain registration shows how).

- [ ] **Step 2: Server starts**

Run:
```bash
pnpm --filter @my-claudia/server exec tsc --noEmit
pnpm --filter @my-claudia/server build
```

Expected: builds clean. (No need to actually boot a server for G1; the wiring is verified by TypeScript + tests.)

- [ ] **Step 3: Full server regression**

Run:
```bash
pnpm --filter @my-claudia/server exec vitest run
```

Expected: all pre-existing tests still pass; new G1 tests pass. Approximate net delta: +25 tests.

- [ ] **Step 4: Tag**

```bash
git add server/src/application/bootstrap/feature-domains.ts
git commit -m "feat(openspec): wire ExecutorRegistry + adapters into bootstrap"
git tag -a openspec/phase-g1-complete -m "OpenSpec × Supervisor Phase G1 data layer foundation landed"
```

---

## Phase G1 Acceptance Criteria

- [ ] All 7 tasks complete with individual commits.
- [ ] `pnpm build` passes for all packages.
- [ ] Server full regression green (no pre-existing test broken).
- [ ] Migration 070 applies cleanly on a fresh DB and on a DB that already has prior migrations.
- [ ] LocalIssue table has 4 new columns; existing rows have correct defaults.
- [ ] `executor_instances`, `spec_changes`, `project_spec_corpus_meta` tables exist with correct CHECK constraints.
- [ ] `IExecutor` port is defined; `ExecutorRegistry` resolves all 3 adapters (manual / classic / meta-workflow).
- [ ] Tag `openspec/phase-g1-complete` exists.

---

## What Phase G1 Deliberately Does NOT Cover

| Item | Phase |
|------|-------|
| SpecChange service (CRUD + file IO) | G2 |
| Delta merge + archive logic | G2 |
| Markdown validator | G2 |
| Sub-issue ↔ executor automatic creation | G3 |
| X2 anonymous sub-issue auto-creation | G3 |
| Status propagation up the layers (executor → spec_change → sub-issue) | G3 |
| Bootstrap (`/opsx:explore` equivalent) | G4 |
| Any UI changes | G5 |
| Real cancel / pause wiring for Classic / Meta Workflow | G3+ (adapters are placeholders in G1) |

---

*Plan version: 1 / 2026-05-21*
*Design reference: `docs/design/openspec-integration-v2.zh-CN.md` (commit `342651f6`)*
