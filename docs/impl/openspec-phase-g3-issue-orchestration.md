# OpenSpec × Supervisor — Phase G3: Issue Orchestration + Status Propagation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the three layers (Issue / SpecChange / ExecutorInstance) into a coherent runtime. Sub-issue creation auto-scaffolds a SpecChange. Executor status changes propagate up to the sub-issue status. Closing a sub-issue triggers archive. X2 anonymous helper exists for lightweight changes.

**Architecture:** New `issue-orchestration` domain layered on top of G1 (LocalIssue / SpecChange / ExecutorInstance repos + adapter registry) and G2 (SpecChangeService / ArchiveService). Three services collaborate via a typed `EventDispatcher<IssueDomainEvent>`:
- `ExecutorService` wraps `ExecutorRegistry.resolve(...)` and **emits** `executor.status_changed` events after every mutation.
- `IssueLifecycle` is the entry point for issue CRUD (createParent / createSubIssue / closeSubIssue) and owns the sub-issue status state machine. `createSubIssue` for non-feature types auto-invokes `SpecChangeService.createSpecChange`.
- `IssueStatusPropagator` is an event consumer: on `executor.status_changed` it recomputes the parent sub-issue's status from ALL its executor instances and writes back. On sub-issue close it triggers `ArchiveService.archive(specChangeId)`.

X2 anonymous helper lives in `AnonymousIssueService`.

**Tech Stack:** TypeScript strict, vitest, the existing `EventDispatcher` (`server/src/domains/supervision/event-dispatcher.ts`), G1/G2 services.

**Spec reference:** `docs/design/openspec-integration-v2.zh-CN.md` §11 G3 acceptance + §7 (lifecycles) + §13.1 (Anonymous) + §13.3 (Manual executor stays compatible).

**Phase predecessors:**
- G1 tag `openspec/phase-g1-complete` (data layer + adapters)
- G2 tag `openspec/phase-g2-complete` (spec runtime + archive)
- Plan commit `68dcd8a4`

---

## File Structure

```
server/src/domains/issue-orchestration/                          NEW domain
├── index.ts                                                     NEW
├── events.ts                                                    NEW (IssueDomainEvent union)
├── executor-service.ts                                          NEW (wraps registry + emits)
├── issue-lifecycle.ts                                           NEW (parent/sub creation + status machine + auto-SpecChange)
├── status-propagator.ts                                         NEW (executor event → sub-issue.status)
├── anonymous-issue-service.ts                                   NEW (X2 helper)
├── register.ts                                                  NEW (DI wiring helper)
└── __tests__/
    ├── executor-service.test.ts                                 NEW
    ├── issue-lifecycle.test.ts                                  NEW
    ├── status-propagator.test.ts                                NEW
    └── anonymous-issue-service.test.ts                          NEW

server/src/application/bootstrap/
└── feature-domains.ts                                           MODIFY (wire IssueLifecycle + ExecutorService + propagator)
```

5 tasks total.

```
Task 1 — ExecutorService (wraps registry + emits events)         ← independent (uses G1)
Task 2 — IssueLifecycle (parent/sub + auto SpecChange + close)   ← uses G2 SpecChangeService
Task 3 — IssueStatusPropagator (event consumer)                  ← needs T1, T2
Task 4 — AnonymousIssueService + close→archive integration       ← needs T2, T3
Task 5 — Bootstrap wire + smoke + tag                            ← final
```

---

## Task 1: `ExecutorService` — wraps adapter, emits events

**Files:**
- Create: `server/src/domains/issue-orchestration/events.ts`
- Create: `server/src/domains/issue-orchestration/executor-service.ts`
- Create: `server/src/domains/issue-orchestration/__tests__/executor-service.test.ts`

**Goal:** A single service every caller goes through to mutate `ExecutorInstance`. After each mutation, it observes the pre/post status of the underlying instance and emits an event if it changed.

- [ ] **Step 1: Define event union**

```typescript
// server/src/domains/issue-orchestration/events.ts
import type { ExecutorStatus } from '@my-claudia/shared/features/executor';
import type { LocalIssueStatus } from '@my-claudia/shared/features/local-issue';
import type { SpecChangeStatus } from '@my-claudia/shared/features/spec-change';

export interface ExecutorStatusChangedEvent {
  type: 'executor.status_changed';
  executorInstanceId: string;
  specChangeId: string;
  projectId: string;
  prev: ExecutorStatus;
  next: ExecutorStatus;
  at: number;
}

export interface SubIssueStatusChangedEvent {
  type: 'sub_issue.status_changed';
  subIssueId: string;
  projectId: string;
  prev: LocalIssueStatus;
  next: LocalIssueStatus;
  at: number;
}

export interface SpecChangeStatusChangedEvent {
  type: 'spec_change.status_changed';
  specChangeId: string;
  prev: SpecChangeStatus;
  next: SpecChangeStatus;
  at: number;
}

export type IssueDomainEvent =
  | ExecutorStatusChangedEvent
  | SubIssueStatusChangedEvent
  | SpecChangeStatusChangedEvent;
```

- [ ] **Step 2: Create `ExecutorService`**

```typescript
// server/src/domains/issue-orchestration/executor-service.ts
import type { Database } from 'better-sqlite3';
import type {
  ExecutorInput,
  ExecutorStatus,
  IExecutor,
} from '@my-claudia/shared/features/executor';
import { ExecutorRegistry, ExecutorInstanceRepository } from '../executor/index.js';
import { EventDispatcher } from '../supervision/event-dispatcher.js';
import type { IssueDomainEvent } from './events.js';

export interface ExecutorServiceDeps {
  db: Database;
  registry: ExecutorRegistry;
  dispatcher: EventDispatcher<IssueDomainEvent>;
}

export class ExecutorService {
  private repo: ExecutorInstanceRepository;

  constructor(private deps: ExecutorServiceDeps) {
    this.repo = new ExecutorInstanceRepository(deps.db);
  }

  async start(executorInstanceId: string, input: ExecutorInput = {}): Promise<void> {
    await this.withStatusEvent(executorInstanceId, (executor) => executor.start(input));
  }

  async pause(executorInstanceId: string): Promise<void> {
    await this.withStatusEvent(executorInstanceId, (executor) => executor.pause());
  }

  async resume(executorInstanceId: string): Promise<void> {
    await this.withStatusEvent(executorInstanceId, (executor) => executor.resume());
  }

  async cancel(executorInstanceId: string): Promise<void> {
    await this.withStatusEvent(executorInstanceId, (executor) => executor.cancel());
  }

  /** For Manual executor: caller pushes completion via this method. */
  async markCompleted(executorInstanceId: string): Promise<void> {
    await this.withStatusEvent(executorInstanceId, async (executor) => {
      const manual = executor as IExecutor & { markCompleted?: () => Promise<void> };
      if (typeof manual.markCompleted !== 'function') {
        throw new Error(`Executor does not support markCompleted (type mismatch)`);
      }
      await manual.markCompleted();
    });
  }

  /** Re-read status from underlying without invoking an action; emit if changed. */
  async refresh(executorInstanceId: string): Promise<void> {
    await this.withStatusEvent(executorInstanceId, async () => undefined);
  }

  /** Read-through helper used by propagator + UI. */
  getStatus(executorInstanceId: string): ExecutorStatus | null {
    const inst = this.repo.findById(executorInstanceId);
    return inst ? inst.statusSummary : null;
  }

  private async withStatusEvent(
    executorInstanceId: string,
    op: (executor: IExecutor) => Promise<void> | void,
  ): Promise<void> {
    const before = this.repo.findById(executorInstanceId);
    if (!before) throw new Error(`ExecutorInstance not found: ${executorInstanceId}`);

    const executor = this.deps.registry.resolve(before);
    await op(executor);

    const after = this.repo.findById(executorInstanceId);
    if (!after) return;  // could happen if cancelled+deleted; shouldn't, but defensive
    if (after.statusSummary !== before.statusSummary) {
      this.deps.dispatcher.dispatch({
        type: 'executor.status_changed',
        executorInstanceId: after.id,
        specChangeId: after.specChangeId,
        projectId: after.projectId,
        prev: before.statusSummary,
        next: after.statusSummary,
        at: Date.now(),
      });
    }
  }
}
```

> The event intentionally does not carry `subIssueId` — the propagator (Task 3) resolves it via `SpecChangeRepository.findById(specChangeId).subIssueId`. Keeping it off the event avoids a redundant join here.

- [ ] **Step 3: Write tests**

```typescript
// server/src/domains/issue-orchestration/__tests__/executor-service.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { ExecutorInstanceRepository, ExecutorRegistry, ManualAdapter } from '../../executor/index.js';
import { EventDispatcher } from '../../supervision/event-dispatcher.js';
import { ExecutorService } from '../executor-service.js';
import type { IssueDomainEvent } from '../events.js';

describe('ExecutorService', () => {
  let db: Database.Database;
  let dispatcher: EventDispatcher<IssueDomainEvent>;
  let service: ExecutorService;
  let executorInstanceId: string;

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

    const registry = new ExecutorRegistry();
    registry.register('manual', (instance) => new ManualAdapter(db, instance));

    const repo = new ExecutorInstanceRepository(db);
    const inst = repo.create({ projectId: 'proj-1', specChangeId: 'sc', type: 'manual' });
    executorInstanceId = inst.id;

    dispatcher = new EventDispatcher<IssueDomainEvent>();
    service = new ExecutorService({ db, registry, dispatcher });
  });

  it('start() advances pending → executing and dispatches an event', async () => {
    const events: IssueDomainEvent[] = [];
    dispatcher.on('executor.status_changed', (e) => events.push(e));
    await service.start(executorInstanceId);
    expect(service.getStatus(executorInstanceId)).toBe('executing');
    expect(events).toHaveLength(1);
    if (events[0].type === 'executor.status_changed') {
      expect(events[0].prev).toBe('pending');
      expect(events[0].next).toBe('executing');
    }
  });

  it('does NOT dispatch when status unchanged (refresh on stable state)', async () => {
    await service.start(executorInstanceId);
    const events: IssueDomainEvent[] = [];
    dispatcher.on('executor.status_changed', (e) => events.push(e));
    await service.refresh(executorInstanceId);
    expect(events).toHaveLength(0);
  });

  it('cancel() dispatches executing → cancelled', async () => {
    await service.start(executorInstanceId);
    const events: IssueDomainEvent[] = [];
    dispatcher.on('executor.status_changed', (e) => events.push(e));
    await service.cancel(executorInstanceId);
    expect(events).toHaveLength(1);
    if (events[0].type === 'executor.status_changed') {
      expect(events[0].prev).toBe('executing');
      expect(events[0].next).toBe('cancelled');
    }
  });

  it('markCompleted() dispatches executing → completed for ManualAdapter', async () => {
    await service.start(executorInstanceId);
    const events: IssueDomainEvent[] = [];
    dispatcher.on('executor.status_changed', (e) => events.push(e));
    await service.markCompleted(executorInstanceId);
    expect(service.getStatus(executorInstanceId)).toBe('completed');
    expect(events).toHaveLength(1);
  });

  it('throws on unknown instance id', async () => {
    await expect(service.start('nope')).rejects.toThrow(/ExecutorInstance not found/);
  });

  it('markCompleted on non-Manual adapter throws', async () => {
    // Register a fake non-manual adapter that does not expose markCompleted.
    const fakeAdapter = {
      start: vi.fn(), pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(),
      getStatus: () => 'executing' as const, getProgress: () => ({ fraction: -1, summary: '' }),
      getOutputCommits: () => [],
    };
    const registry2 = new ExecutorRegistry();
    registry2.register('classic', () => fakeAdapter);
    const repo = new ExecutorInstanceRepository(db);
    const inst = repo.create({ projectId: 'proj-1', specChangeId: 'sc', type: 'classic', underlyingId: 'x' });
    const svc2 = new ExecutorService({ db, registry: registry2, dispatcher });
    await expect(svc2.markCompleted(inst.id)).rejects.toThrow(/markCompleted/);
  });
});
```

- [ ] **Step 4: Run + verify**

```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/issue-orchestration/__tests__/executor-service.test.ts
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: 6 tests green, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/issue-orchestration/events.ts \
        server/src/domains/issue-orchestration/executor-service.ts \
        server/src/domains/issue-orchestration/__tests__/executor-service.test.ts
git commit -m "feat(issue-orchestration): ExecutorService + IssueDomainEvent dispatcher"
```

---

## Task 2: `IssueLifecycle` — parent/sub creation + status machine + auto SpecChange

**Files:**
- Create: `server/src/domains/issue-orchestration/issue-lifecycle.ts`
- Create: `server/src/domains/issue-orchestration/__tests__/issue-lifecycle.test.ts`

**Goal:** Entry point for issue CRUD that enforces the design contracts:
- `createParent({ projectId, title, ... })` — creates `type='feature'`, no SpecChange
- `createSubIssue({ projectId, parentIssueId?, type, title, slug? })` — creates `type ∈ {implement/bug/enhancement/chore}` + auto-invokes `SpecChangeService.createSpecChange` + stores `specChangeId` on the LocalIssue
- `transitionSubIssueStatus(id, next)` — enforces legal transitions
- `closeSubIssue(id)` — sets status='closed' and emits an event (Task 4 wires the actual archive)

- [ ] **Step 1: Create the service**

```typescript
// server/src/domains/issue-orchestration/issue-lifecycle.ts
import type { Database } from 'better-sqlite3';
import type {
  LocalIssue,
  LocalIssueStatus,
  LocalIssueType,
  LocalIssuePriority,
} from '@my-claudia/shared/features/local-issue';
import type { SpecChange } from '@my-claudia/shared/features/spec-change';
import { LocalIssueRepository } from '../local-issues/repository.js';
import { SpecChangeService } from '../openspec/spec-change-service.js';
import { EventDispatcher } from '../supervision/event-dispatcher.js';
import type { IssueDomainEvent } from './events.js';

export interface IssueLifecycleDeps {
  db: Database;
  specChangeService: SpecChangeService;
  dispatcher: EventDispatcher<IssueDomainEvent>;
}

export interface CreateParentInput {
  projectId: string;
  title: string;
  description?: string;
  priority?: LocalIssuePriority;
  labels?: string[];
}

export interface CreateSubIssueInput {
  projectId: string;
  type: Exclude<LocalIssueType, 'feature'>;
  title: string;
  parentIssueId?: string;
  description?: string;
  priority?: LocalIssuePriority;
  labels?: string[];
  /** Override the auto-derived slug. Must be kebab-case, unique per project. */
  slug?: string;
  isAnonymous?: boolean;
}

/** Allowed sub-issue status transitions. Parent (feature) only does open ↔ closed/cancelled. */
const SUB_ISSUE_TRANSITIONS: Record<LocalIssueStatus, LocalIssueStatus[]> = {
  open: ['planning', 'cancelled'],
  planning: ['tasks_ready', 'cancelled'],
  tasks_ready: ['executing', 'cancelled'],
  executing: ['reviewing', 'cancelled'],
  reviewing: ['executing', 'closed', 'cancelled'],  // reviewing → executing allows revert if review surfaces issues
  closed: [],
  cancelled: [],
  in_progress: ['executing', 'closed', 'cancelled'],  // legacy fallback
};

const PARENT_TRANSITIONS: Record<LocalIssueStatus, LocalIssueStatus[]> = {
  open: ['closed', 'cancelled'],
  closed: ['open'],
  cancelled: [],
  // unused for parent:
  planning: [], tasks_ready: [], executing: [], reviewing: [], in_progress: [],
};

export class IssueLifecycle {
  private issueRepo: LocalIssueRepository;

  constructor(private deps: IssueLifecycleDeps) {
    this.issueRepo = new LocalIssueRepository(deps.db);
  }

  createParent(input: CreateParentInput): LocalIssue {
    return this.issueRepo.create({
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      priority: input.priority ?? 'medium',
      labels: input.labels ?? [],
      status: 'open',
      type: 'feature',
      isAnonymous: false,
    });
  }

  createSubIssue(input: CreateSubIssueInput): { issue: LocalIssue; specChange: SpecChange } {
    // Validate parent if provided
    if (input.parentIssueId) {
      const parent = this.issueRepo.findById(input.parentIssueId);
      if (!parent) throw new Error(`Parent issue not found: ${input.parentIssueId}`);
      if (parent.type !== 'feature') {
        throw new Error(`Parent issue must be of type 'feature', got '${parent.type}'`);
      }
      if (parent.projectId !== input.projectId) {
        throw new Error(`Parent issue belongs to a different project`);
      }
    }

    // Create the sub-issue first (so spec_change.subIssueId FK is valid).
    const issue = this.issueRepo.create({
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      priority: input.priority ?? 'medium',
      labels: input.labels ?? [],
      status: 'open',
      type: input.type,
      parentIssueId: input.parentIssueId,
      isAnonymous: input.isAnonymous ?? false,
    });

    // Derive slug if not supplied
    const slug = input.slug ?? slugify(input.title) || issue.id.slice(0, 8);

    // Auto-create SpecChange + scaffold files
    const specChange = this.deps.specChangeService.createSpecChange({
      projectId: input.projectId,
      subIssueId: issue.id,
      slug,
      title: input.title,
    });

    // Back-link spec_change_id onto the issue
    const updatedIssue = this.issueRepo.update(issue.id, { specChangeId: specChange.id });

    return { issue: updatedIssue, specChange };
  }

  /** Apply a manual status transition (or no-op if already at target). Validates legality. */
  transitionStatus(issueId: string, next: LocalIssueStatus): LocalIssue {
    const current = this.issueRepo.findById(issueId);
    if (!current) throw new Error(`Issue not found: ${issueId}`);
    if (current.status === next) return current;
    const allowed = (current.type === 'feature' ? PARENT_TRANSITIONS : SUB_ISSUE_TRANSITIONS)[current.status] ?? [];
    if (!allowed.includes(next)) {
      throw new Error(`Illegal status transition for ${current.type} issue: ${current.status} → ${next}`);
    }
    const updated = this.issueRepo.update(issueId, {
      status: next,
      closedAt: (next === 'closed' || next === 'cancelled') ? Date.now() : undefined,
    });
    this.deps.dispatcher.dispatch({
      type: 'sub_issue.status_changed',
      subIssueId: issueId,
      projectId: current.projectId,
      prev: current.status,
      next,
      at: Date.now(),
    });
    return updated;
  }

  /** Convenience: close sub-issue + emit. Archive trigger lives in Task 4. */
  closeSubIssue(issueId: string): LocalIssue {
    return this.transitionStatus(issueId, 'closed');
  }

  cancelSubIssue(issueId: string): LocalIssue {
    return this.transitionStatus(issueId, 'cancelled');
  }

  getIssue(issueId: string): LocalIssue | null {
    return this.issueRepo.findById(issueId);
  }

  listSubIssues(parentIssueId: string): LocalIssue[] {
    const rows = this.deps.db.prepare(
      `SELECT * FROM local_issues WHERE parent_issue_id = ? ORDER BY created_at ASC`,
    ).all(parentIssueId);
    // Reuse repo's mapping
    return rows.map((r) => (this.issueRepo as unknown as { mapRow(r: unknown): LocalIssue }).mapRow(r));
  }
}

/** Convert a title to a kebab-case slug. Strips non-alphanumeric except hyphens. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}
```

> **Note on `listSubIssues`**: I'm accessing the repo's `mapRow` via a cast. If `LocalIssueRepository` exposes a public list method matching this need (`findByParent` or similar), prefer that. Inspect `server/src/domains/local-issues/repository.ts` before finalizing.

- [ ] **Step 2: Write tests**

```typescript
// server/src/domains/issue-orchestration/__tests__/issue-lifecycle.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { SpecChangeService } from '../../openspec/spec-change-service.js';
import { EventDispatcher } from '../../supervision/event-dispatcher.js';
import { IssueLifecycle } from '../issue-lifecycle.js';
import type { IssueDomainEvent } from '../events.js';

describe('IssueLifecycle', () => {
  let db: Database.Database;
  let projectRoot: string;
  let dispatcher: EventDispatcher<IssueDomainEvent>;
  let lifecycle: IssueLifecycle;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run('proj-1', 'P', 'code', 0, 0);
    projectRoot = mkdtempSync(join(tmpdir(), 'issue-lc-'));
    const specChangeService = new SpecChangeService({ db, getProjectRoot: () => projectRoot });
    dispatcher = new EventDispatcher<IssueDomainEvent>();
    lifecycle = new IssueLifecycle({ db, specChangeService, dispatcher });
  });

  afterEach(() => {
    db.close();
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
  });

  it('createParent creates a feature-type issue with no SpecChange', () => {
    const parent = lifecycle.createParent({ projectId: 'proj-1', title: 'Add 2FA' });
    expect(parent.type).toBe('feature');
    expect(parent.status).toBe('open');
    expect(parent.specChangeId).toBeUndefined();
  });

  it('createSubIssue auto-creates a SpecChange and scaffolds files', () => {
    const parent = lifecycle.createParent({ projectId: 'proj-1', title: 'Add 2FA' });
    const { issue, specChange } = lifecycle.createSubIssue({
      projectId: 'proj-1', type: 'implement', title: 'Initial 2FA flow', parentIssueId: parent.id,
    });
    expect(issue.type).toBe('implement');
    expect(issue.parentIssueId).toBe(parent.id);
    expect(issue.specChangeId).toBe(specChange.id);
    expect(specChange.slug).toBe('initial-2fa-flow');
    expect(fs.existsSync(join(projectRoot, 'openspec', 'changes', specChange.slug, 'proposal.md'))).toBe(true);
  });

  it('createSubIssue without parentIssueId creates a standalone sub-issue', () => {
    const { issue, specChange } = lifecycle.createSubIssue({
      projectId: 'proj-1', type: 'bug', title: 'Fix login redirect',
    });
    expect(issue.parentIssueId).toBeUndefined();
    expect(issue.specChangeId).toBe(specChange.id);
  });

  it('createSubIssue rejects when parent is not a feature', () => {
    const sub = lifecycle.createSubIssue({ projectId: 'proj-1', type: 'implement', title: 'A' });
    expect(() => lifecycle.createSubIssue({
      projectId: 'proj-1', type: 'bug', title: 'B', parentIssueId: sub.issue.id,
    })).toThrow(/must be of type 'feature'/);
  });

  it('createSubIssue rejects mismatched projectId', () => {
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('proj-2', 'B', 'code', 0, 0);
    const parent = lifecycle.createParent({ projectId: 'proj-1', title: 'F' });
    expect(() => lifecycle.createSubIssue({
      projectId: 'proj-2', type: 'implement', title: 'X', parentIssueId: parent.id,
    })).toThrow(/different project/);
  });

  it('transitionStatus enforces legal transitions', () => {
    const { issue } = lifecycle.createSubIssue({ projectId: 'proj-1', type: 'implement', title: 'A' });
    lifecycle.transitionStatus(issue.id, 'planning');
    expect(lifecycle.getIssue(issue.id)!.status).toBe('planning');
    // Illegal: planning → reviewing (must go through tasks_ready → executing first)
    expect(() => lifecycle.transitionStatus(issue.id, 'reviewing')).toThrow(/Illegal status transition/);
  });

  it('reviewing can revert to executing if review surfaces issues', () => {
    const { issue } = lifecycle.createSubIssue({ projectId: 'proj-1', type: 'implement', title: 'A' });
    lifecycle.transitionStatus(issue.id, 'planning');
    lifecycle.transitionStatus(issue.id, 'tasks_ready');
    lifecycle.transitionStatus(issue.id, 'executing');
    lifecycle.transitionStatus(issue.id, 'reviewing');
    expect(() => lifecycle.transitionStatus(issue.id, 'executing')).not.toThrow();
  });

  it('closeSubIssue dispatches a sub_issue.status_changed event', () => {
    const { issue } = lifecycle.createSubIssue({ projectId: 'proj-1', type: 'implement', title: 'A' });
    lifecycle.transitionStatus(issue.id, 'planning');
    lifecycle.transitionStatus(issue.id, 'tasks_ready');
    lifecycle.transitionStatus(issue.id, 'executing');
    lifecycle.transitionStatus(issue.id, 'reviewing');
    const events: IssueDomainEvent[] = [];
    dispatcher.on('sub_issue.status_changed', (e) => events.push(e));
    lifecycle.closeSubIssue(issue.id);
    expect(events).toHaveLength(1);
    if (events[0].type === 'sub_issue.status_changed') {
      expect(events[0].prev).toBe('reviewing');
      expect(events[0].next).toBe('closed');
    }
    expect(lifecycle.getIssue(issue.id)!.closedAt).toBeTruthy();
  });

  it('parent feature uses simpler status machine', () => {
    const parent = lifecycle.createParent({ projectId: 'proj-1', title: 'F' });
    lifecycle.transitionStatus(parent.id, 'closed');
    expect(lifecycle.getIssue(parent.id)!.status).toBe('closed');
    expect(() => lifecycle.transitionStatus(parent.id, 'planning')).toThrow(/Illegal/);
  });
});
```

- [ ] **Step 3: Run + verify**

```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/issue-orchestration/__tests__/issue-lifecycle.test.ts
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: 9 tests green, tsc clean.

- [ ] **Step 4: Commit**

```bash
git add server/src/domains/issue-orchestration/issue-lifecycle.ts \
        server/src/domains/issue-orchestration/__tests__/issue-lifecycle.test.ts
git commit -m "feat(issue-orchestration): IssueLifecycle — parent/sub + auto SpecChange + status machine"
```

---

## Task 3: `IssueStatusPropagator` — event consumer

**Files:**
- Create: `server/src/domains/issue-orchestration/status-propagator.ts`
- Create: `server/src/domains/issue-orchestration/__tests__/status-propagator.test.ts`

**Goal:** Subscribe to `executor.status_changed` events. When one fires, look up all executors belonging to the same spec_change, derive a sub-issue status from the aggregate, and call `IssueLifecycle.transitionStatus` (which itself emits a `sub_issue.status_changed` event).

Derivation rules (from §4.1 of design v0.2):

| Executor states across spec_change | Derived sub-issue state |
|------------------------------------|------------------------|
| All `pending` | (no transition — sub-issue stays at current state, e.g. `tasks_ready`) |
| Any `executing` or `paused` | `executing` |
| All terminal (`completed` / `failed` / `cancelled`) | `reviewing` |
| All `cancelled` (no completed / failed) | `cancelled` |

The function never forces a transition into `closed` — that's a user action.

- [ ] **Step 1: Create propagator**

```typescript
// server/src/domains/issue-orchestration/status-propagator.ts
import type { Database } from 'better-sqlite3';
import type { ExecutorInstance, ExecutorStatus } from '@my-claudia/shared/features/executor';
import type { LocalIssueStatus } from '@my-claudia/shared/features/local-issue';
import { ExecutorInstanceRepository } from '../executor/index.js';
import { SpecChangeRepository } from '../spec-change/spec-change-repository.js';
import { LocalIssueRepository } from '../local-issues/repository.js';
import type { EventDispatcher } from '../supervision/event-dispatcher.js';
import type { IssueLifecycle } from './issue-lifecycle.js';
import type { ExecutorStatusChangedEvent, IssueDomainEvent } from './events.js';

export interface IssueStatusPropagatorDeps {
  db: Database;
  dispatcher: EventDispatcher<IssueDomainEvent>;
  lifecycle: IssueLifecycle;
}

export class IssueStatusPropagator {
  private execRepo: ExecutorInstanceRepository;
  private specRepo: SpecChangeRepository;
  private issueRepo: LocalIssueRepository;

  constructor(private deps: IssueStatusPropagatorDeps) {
    this.execRepo = new ExecutorInstanceRepository(deps.db);
    this.specRepo = new SpecChangeRepository(deps.db);
    this.issueRepo = new LocalIssueRepository(deps.db);
  }

  /** Wire up the subscriber. Returns an unsubscribe function. */
  install(): () => void {
    const handler = (event: IssueDomainEvent): void => {
      if (event.type !== 'executor.status_changed') return;
      try {
        this.onExecutorStatusChanged(event);
      } catch (err) {
        console.error('[IssueStatusPropagator] error:', err);
      }
    };
    this.deps.dispatcher.on('executor.status_changed', handler);
    return () => this.deps.dispatcher.off('executor.status_changed', handler);
  }

  /** Pure-ish: given an event, compute and apply the derived sub-issue status. */
  onExecutorStatusChanged(event: ExecutorStatusChangedEvent): void {
    // Resolve the sub-issue.
    const spec = this.specRepo.findById(event.specChangeId);
    if (!spec) return;
    const issue = this.issueRepo.findById(spec.subIssueId);
    if (!issue) return;

    // Aggregate over all executors for this spec_change.
    const executors = this.execRepo.listBySpecChange(spec.id);
    const derived = deriveSubIssueStatus(executors, issue.status);
    if (!derived || derived === issue.status) return;
    try {
      this.deps.lifecycle.transitionStatus(issue.id, derived);
    } catch {
      // Illegal transition (e.g. already closed) — silently drop. Race conditions are fine.
    }
  }
}

/** Pure helper exposed for testing. */
export function deriveSubIssueStatus(
  executors: ExecutorInstance[],
  currentSubIssueStatus: LocalIssueStatus,
): LocalIssueStatus | null {
  if (executors.length === 0) return null;

  const states = executors.map((e) => e.statusSummary);
  const has = (s: ExecutorStatus): boolean => states.includes(s);
  const all = (s: ExecutorStatus): boolean => states.every((x) => x === s);

  // Strict terminal-only cases first.
  if (all('cancelled')) return 'cancelled';
  const terminalSet: ExecutorStatus[] = ['completed', 'failed', 'cancelled'];
  if (states.every((s) => terminalSet.includes(s))) return 'reviewing';

  if (has('executing') || has('paused')) return 'executing';
  // All pending — no transition.
  if (all('pending')) return null;

  // Mixed pending + others — treat as executing once any executor has been touched.
  return 'executing';
}
```

- [ ] **Step 2: Write tests**

```typescript
// server/src/domains/issue-orchestration/__tests__/status-propagator.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { ExecutorInstanceRepository, ExecutorRegistry, ManualAdapter } from '../../executor/index.js';
import { SpecChangeService } from '../../openspec/spec-change-service.js';
import { EventDispatcher } from '../../supervision/event-dispatcher.js';
import { ExecutorService } from '../executor-service.js';
import { IssueLifecycle } from '../issue-lifecycle.js';
import { IssueStatusPropagator, deriveSubIssueStatus } from '../status-propagator.js';
import type { IssueDomainEvent } from '../events.js';
import type { ExecutorInstance } from '@my-claudia/shared/features/executor';

function mkInst(status: ExecutorInstance['statusSummary']): ExecutorInstance {
  return {
    id: Math.random().toString(36).slice(2), projectId: 'proj-1', specChangeId: 'sc',
    type: 'manual', statusSummary: status, createdAt: 0, updatedAt: 0,
  };
}

describe('deriveSubIssueStatus (pure)', () => {
  it('all pending → null (no transition)', () => {
    expect(deriveSubIssueStatus([mkInst('pending'), mkInst('pending')], 'tasks_ready')).toBeNull();
  });

  it('any executing → executing', () => {
    expect(deriveSubIssueStatus([mkInst('pending'), mkInst('executing')], 'tasks_ready')).toBe('executing');
  });

  it('any paused → executing', () => {
    expect(deriveSubIssueStatus([mkInst('paused')], 'executing')).toBe('executing');
  });

  it('all terminal mixed (completed + failed) → reviewing', () => {
    expect(deriveSubIssueStatus([mkInst('completed'), mkInst('failed')], 'executing')).toBe('reviewing');
  });

  it('all cancelled → cancelled', () => {
    expect(deriveSubIssueStatus([mkInst('cancelled'), mkInst('cancelled')], 'executing')).toBe('cancelled');
  });

  it('all completed → reviewing', () => {
    expect(deriveSubIssueStatus([mkInst('completed')], 'executing')).toBe('reviewing');
  });

  it('mixed pending + completed → executing (touched but not done)', () => {
    expect(deriveSubIssueStatus([mkInst('pending'), mkInst('completed')], 'tasks_ready')).toBe('executing');
  });

  it('empty list → null', () => {
    expect(deriveSubIssueStatus([], 'open')).toBeNull();
  });
});

describe('IssueStatusPropagator (integration)', () => {
  let db: Database.Database;
  let projectRoot: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('proj-1', 'P', 'code', 0, 0);
    projectRoot = mkdtempSync(join(tmpdir(), 'prop-'));
  });

  afterEach(() => {
    db.close();
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
  });

  it('executor start triggers sub_issue → executing via propagator', async () => {
    const specChangeService = new SpecChangeService({ db, getProjectRoot: () => projectRoot });
    const dispatcher = new EventDispatcher<IssueDomainEvent>();
    const lifecycle = new IssueLifecycle({ db, specChangeService, dispatcher });
    const { issue, specChange } = lifecycle.createSubIssue({ projectId: 'proj-1', type: 'implement', title: 'A' });
    lifecycle.transitionStatus(issue.id, 'planning');
    lifecycle.transitionStatus(issue.id, 'tasks_ready');

    const registry = new ExecutorRegistry();
    registry.register('manual', (inst) => new ManualAdapter(db, inst));
    const execService = new ExecutorService({ db, registry, dispatcher });
    const execRepo = new ExecutorInstanceRepository(db);
    const inst = execRepo.create({ projectId: 'proj-1', specChangeId: specChange.id, type: 'manual' });

    const propagator = new IssueStatusPropagator({ db, dispatcher, lifecycle });
    propagator.install();

    await execService.start(inst.id);
    expect(lifecycle.getIssue(issue.id)!.status).toBe('executing');
  });

  it('manual markCompleted (single executor) triggers sub_issue → reviewing', async () => {
    const specChangeService = new SpecChangeService({ db, getProjectRoot: () => projectRoot });
    const dispatcher = new EventDispatcher<IssueDomainEvent>();
    const lifecycle = new IssueLifecycle({ db, specChangeService, dispatcher });
    const { issue, specChange } = lifecycle.createSubIssue({ projectId: 'proj-1', type: 'implement', title: 'A' });
    lifecycle.transitionStatus(issue.id, 'planning');
    lifecycle.transitionStatus(issue.id, 'tasks_ready');

    const registry = new ExecutorRegistry();
    registry.register('manual', (inst) => new ManualAdapter(db, inst));
    const execService = new ExecutorService({ db, registry, dispatcher });
    const execRepo = new ExecutorInstanceRepository(db);
    const inst = execRepo.create({ projectId: 'proj-1', specChangeId: specChange.id, type: 'manual' });

    new IssueStatusPropagator({ db, dispatcher, lifecycle }).install();

    await execService.start(inst.id);
    await execService.markCompleted(inst.id);
    expect(lifecycle.getIssue(issue.id)!.status).toBe('reviewing');
  });
});
```

- [ ] **Step 3: Run + verify**

```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/issue-orchestration/__tests__/status-propagator.test.ts
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: 10 tests green, tsc clean.

- [ ] **Step 4: Commit**

```bash
git add server/src/domains/issue-orchestration/status-propagator.ts \
        server/src/domains/issue-orchestration/__tests__/status-propagator.test.ts
git commit -m "feat(issue-orchestration): IssueStatusPropagator (executor → sub-issue)"
```

---

## Task 4: `AnonymousIssueService` + close→archive integration

**Files:**
- Create: `server/src/domains/issue-orchestration/anonymous-issue-service.ts`
- Create: `server/src/domains/issue-orchestration/__tests__/anonymous-issue-service.test.ts`
- Modify: `server/src/domains/issue-orchestration/issue-lifecycle.ts` (call ArchiveService on closeSubIssue)

**Goal:** Two related additions:
1. X2 helper: `AnonymousIssueService.createAnonymous({ projectId, title })` — does in one call: createSubIssue with `type='implement'`, `isAnonymous=true`, no parent. Returns the issue + spec_change.
2. Close → archive: when `IssueLifecycle.closeSubIssue` succeeds, automatically invoke `ArchiveService.archive(specChangeId)`. Failures don't roll back the close — they're returned in the result.

- [ ] **Step 1: Create `AnonymousIssueService`**

```typescript
// server/src/domains/issue-orchestration/anonymous-issue-service.ts
import type { LocalIssue } from '@my-claudia/shared/features/local-issue';
import type { SpecChange } from '@my-claudia/shared/features/spec-change';
import type { IssueLifecycle } from './issue-lifecycle.js';

export interface CreateAnonymousInput {
  projectId: string;
  title: string;
}

export class AnonymousIssueService {
  constructor(private lifecycle: IssueLifecycle) {}

  /** Create an anonymous sub-issue (X2 quick path). */
  createAnonymous(input: CreateAnonymousInput): { issue: LocalIssue; specChange: SpecChange } {
    return this.lifecycle.createSubIssue({
      projectId: input.projectId,
      type: 'implement',
      title: input.title,
      isAnonymous: true,
    });
  }
}
```

- [ ] **Step 2: Modify `IssueLifecycle.closeSubIssue` to optionally trigger archive**

In `issue-lifecycle.ts`, extend `IssueLifecycleDeps` with an optional `archiveService` and modify `closeSubIssue`:

```typescript
import type { ArchiveService, ArchiveResult } from '../openspec/archive-service.js';

export interface IssueLifecycleDeps {
  db: Database;
  specChangeService: SpecChangeService;
  dispatcher: EventDispatcher<IssueDomainEvent>;
  /** When provided, closeSubIssue auto-invokes archive. */
  archiveService?: ArchiveService;
}

// ... inside the class:

/**
 * Close + (if archiveService configured) archive in one call.
 * Returns both the updated issue and the archive result.
 */
async closeSubIssueAndArchive(issueId: string): Promise<{ issue: LocalIssue; archive?: ArchiveResult }> {
  const issue = this.closeSubIssue(issueId);
  if (!this.deps.archiveService) return { issue };
  if (!issue.specChangeId) return { issue };  // no spec_change attached (defensive)
  const archive = await this.deps.archiveService.archive(issue.specChangeId);
  return { issue, archive };
}
```

Keep the existing synchronous `closeSubIssue` for callers that want just the state transition.

- [ ] **Step 3: Write tests**

```typescript
// server/src/domains/issue-orchestration/__tests__/anonymous-issue-service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fs from 'node:fs';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { SpecChangeService } from '../../openspec/spec-change-service.js';
import { ArchiveService } from '../../openspec/archive-service.js';
import { EventDispatcher } from '../../supervision/event-dispatcher.js';
import { IssueLifecycle } from '../issue-lifecycle.js';
import { AnonymousIssueService } from '../anonymous-issue-service.js';
import type { IssueDomainEvent } from '../events.js';

const SAMPLE_DELTA = `## ADDED Requirements
### Requirement: Anon test
System MUST do.

#### Scenario: x
- **WHEN** x
- **THEN** y
`;

describe('AnonymousIssueService + close→archive integration', () => {
  let db: Database.Database;
  let projectRoot: string;
  let lifecycle: IssueLifecycle;
  let scService: SpecChangeService;
  let archive: ArchiveService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('proj-1', 'P', 'code', 0, 0);
    projectRoot = mkdtempSync(join(tmpdir(), 'anon-'));
    scService = new SpecChangeService({ db, getProjectRoot: () => projectRoot });
    archive = new ArchiveService({ db, getProjectRoot: () => projectRoot });
    const dispatcher = new EventDispatcher<IssueDomainEvent>();
    lifecycle = new IssueLifecycle({ db, specChangeService: scService, dispatcher, archiveService: archive });
  });

  afterEach(() => {
    db.close();
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
  });

  it('createAnonymous creates a sub-issue with isAnonymous=true and no parent', () => {
    const anon = new AnonymousIssueService(lifecycle);
    const { issue, specChange } = anon.createAnonymous({ projectId: 'proj-1', title: 'Rename foo to bar' });
    expect(issue.type).toBe('implement');
    expect(issue.isAnonymous).toBe(true);
    expect(issue.parentIssueId).toBeUndefined();
    expect(specChange.slug).toBe('rename-foo-to-bar');
  });

  it('closeSubIssueAndArchive moves the change folder and merges delta', async () => {
    const anon = new AnonymousIssueService(lifecycle);
    const { issue, specChange } = anon.createAnonymous({ projectId: 'proj-1', title: 'Quick fix' });
    scService.writeDeltaSpec(specChange.id, 'core', SAMPLE_DELTA);
    lifecycle.transitionStatus(issue.id, 'planning');
    lifecycle.transitionStatus(issue.id, 'tasks_ready');
    lifecycle.transitionStatus(issue.id, 'executing');
    lifecycle.transitionStatus(issue.id, 'reviewing');

    const result = await lifecycle.closeSubIssueAndArchive(issue.id);
    expect(result.issue.status).toBe('closed');
    expect(result.archive?.ok).toBe(true);
    expect(result.archive?.archivedDir).toBeDefined();
    expect(fs.existsSync(result.archive!.archivedDir!)).toBe(true);
    // Corpus written
    const corpus = fs.readFileSync(join(projectRoot, 'openspec', 'specs', 'core', 'spec.md'), 'utf-8');
    expect(corpus).toContain('Anon test');
  });

  it('closeSubIssueAndArchive without archiveService returns issue only', async () => {
    const dispatcher = new EventDispatcher<IssueDomainEvent>();
    const lc2 = new IssueLifecycle({ db, specChangeService: scService, dispatcher });  // no archiveService
    const { issue } = lc2.createSubIssue({ projectId: 'proj-1', type: 'implement', title: 'A' });
    lc2.transitionStatus(issue.id, 'planning');
    lc2.transitionStatus(issue.id, 'tasks_ready');
    lc2.transitionStatus(issue.id, 'executing');
    lc2.transitionStatus(issue.id, 'reviewing');
    const result = await lc2.closeSubIssueAndArchive(issue.id);
    expect(result.issue.status).toBe('closed');
    expect(result.archive).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run + verify**

```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/issue-orchestration/__tests__/anonymous-issue-service.test.ts
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: 3 tests green, tsc clean. Existing 6 + 9 + 10 = 25 in earlier tasks still pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/issue-orchestration/anonymous-issue-service.ts \
        server/src/domains/issue-orchestration/issue-lifecycle.ts \
        server/src/domains/issue-orchestration/__tests__/anonymous-issue-service.test.ts
git commit -m "feat(issue-orchestration): AnonymousIssueService + closeSubIssueAndArchive"
```

---

## Task 5: Bootstrap wire + smoke + tag

**Files:**
- Create: `server/src/domains/issue-orchestration/index.ts`
- Create: `server/src/domains/issue-orchestration/register.ts`
- Modify: `server/src/application/bootstrap/feature-domains.ts`

**Goal:** Wire all three services into the bootstrap, install the propagator subscriber, expose in DI bag. Run the full regression. Tag.

- [ ] **Step 1: Create domain index**

```typescript
// server/src/domains/issue-orchestration/index.ts
export { ExecutorService } from './executor-service.js';
export { IssueLifecycle } from './issue-lifecycle.js';
export { IssueStatusPropagator, deriveSubIssueStatus } from './status-propagator.js';
export { AnonymousIssueService } from './anonymous-issue-service.js';
export type {
  IssueDomainEvent,
  ExecutorStatusChangedEvent,
  SubIssueStatusChangedEvent,
  SpecChangeStatusChangedEvent,
} from './events.js';
export { registerIssueOrchestration } from './register.js';
```

- [ ] **Step 2: Create `register.ts`**

```typescript
// server/src/domains/issue-orchestration/register.ts
import type { Database } from 'better-sqlite3';
import type { ExecutorRegistry } from '../executor/index.js';
import type { SpecChangeService } from '../openspec/spec-change-service.js';
import type { ArchiveService } from '../openspec/archive-service.js';
import { EventDispatcher } from '../supervision/event-dispatcher.js';
import { ExecutorService } from './executor-service.js';
import { IssueLifecycle } from './issue-lifecycle.js';
import { IssueStatusPropagator } from './status-propagator.js';
import { AnonymousIssueService } from './anonymous-issue-service.js';
import type { IssueDomainEvent } from './events.js';

export interface RegisterIssueOrchestrationDeps {
  db: Database;
  registry: ExecutorRegistry;
  specChangeService: SpecChangeService;
  archiveService: ArchiveService;
}

export interface IssueOrchestration {
  dispatcher: EventDispatcher<IssueDomainEvent>;
  executorService: ExecutorService;
  lifecycle: IssueLifecycle;
  propagator: IssueStatusPropagator;
  anonymousService: AnonymousIssueService;
  /** Stop propagator subscription. */
  dispose: () => void;
}

export function registerIssueOrchestration(deps: RegisterIssueOrchestrationDeps): IssueOrchestration {
  const dispatcher = new EventDispatcher<IssueDomainEvent>();
  const executorService = new ExecutorService({ db: deps.db, registry: deps.registry, dispatcher });
  const lifecycle = new IssueLifecycle({
    db: deps.db,
    specChangeService: deps.specChangeService,
    dispatcher,
    archiveService: deps.archiveService,
  });
  const propagator = new IssueStatusPropagator({ db: deps.db, dispatcher, lifecycle });
  const dispose = propagator.install();
  const anonymousService = new AnonymousIssueService(lifecycle);
  return { dispatcher, executorService, lifecycle, propagator, anonymousService, dispose };
}
```

- [ ] **Step 3: Wire into `feature-domains.ts`**

Open `server/src/application/bootstrap/feature-domains.ts`. After the G1 wiring (where `executorRegistry`, `specChangeRepo`, etc. are constructed), add:

```typescript
import { registerIssueOrchestration } from '../../domains/issue-orchestration/index.js';
import { SpecChangeService, ArchiveService } from '../../domains/openspec/index.js';

// ... existing wiring including executorRegistry ...

// G2/G3: SpecChange / Archive services + Issue orchestration
// NOTE: getProjectRoot needs a real project → path lookup. For G3 we expose a thin
// placeholder that throws if invoked without a registered project. Real wiring lands
// when ProjectService.getProjectRoot is wired up (likely G5+ UI consumes this).
const specChangeService = new SpecChangeService({
  db: opts.db,
  getProjectRoot: (projectId) => {
    // TODO(G5): wire to ProjectService.getRoot(projectId)
    throw new Error(`getProjectRoot not yet wired for project ${projectId}`);
  },
});
const archiveService = new ArchiveService({
  db: opts.db,
  getProjectRoot: (projectId) => {
    throw new Error(`getProjectRoot not yet wired for project ${projectId}`);
  },
});

const issueOrchestration = registerIssueOrchestration({
  db: opts.db,
  registry: executorRegistry,
  specChangeService,
  archiveService,
});

return {
  // ... existing services ...
  specChangeService,
  archiveService,
  issueOrchestration,
};
```

> The `getProjectRoot` placeholder is intentional. G3 has no UI yet, so no live caller exercises the service through bootstrap. Tests use their own injected `getProjectRoot`. G5 will replace with a real lookup against `ProjectService` (or whatever the registry of project roots is).

- [ ] **Step 4: Verify build + full server tests**

```bash
pnpm --filter @my-claudia/server exec tsc --noEmit
pnpm build
pnpm --filter @my-claudia/server exec vitest run
```

Expected: tsc clean; build clean (all 4 packages); ~3600 tests green (G2's 3572 + roughly 28 new G3 tests).

- [ ] **Step 5: Programmatic end-to-end smoke**

```bash
cd /Users/haozhang/SourceCode/zhvala/my-claudia && node --input-type=module -e "
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fs from 'node:fs';
import Database from 'better-sqlite3';
import { applyMigrations } from './server/dist/infrastructure/storage/migrations/index.js';
import { ExecutorInstanceRepository, ExecutorRegistry, ManualAdapter } from './server/dist/domains/executor/index.js';
import { SpecChangeService, ArchiveService } from './server/dist/domains/openspec/index.js';
import { registerIssueOrchestration } from './server/dist/domains/issue-orchestration/index.js';

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
applyMigrations(db);
db.prepare(\"INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)\").run('proj-1','P','code',0,0);
const root = mkdtempSync(join(tmpdir(), 'g3-smoke-'));

const registry = new ExecutorRegistry();
registry.register('manual', (inst) => new ManualAdapter(db, inst));
const sc = new SpecChangeService({ db, getProjectRoot: () => root });
const ar = new ArchiveService({ db, getProjectRoot: () => root });
const io = registerIssueOrchestration({ db, registry, specChangeService: sc, archiveService: ar });

const parent = io.lifecycle.createParent({ projectId: 'proj-1', title: 'Add 2FA' });
const { issue, specChange } = io.lifecycle.createSubIssue({
  projectId: 'proj-1', type: 'implement', title: 'Initial 2FA flow', parentIssueId: parent.id,
});

sc.writeDeltaSpec(specChange.id, 'auth', \`## ADDED Requirements
### Requirement: 2FA enrollment
System SHALL provision TOTP.

#### Scenario: User enrolls
- **WHEN** user opts in
- **THEN** system SHALL provision
\`);

io.lifecycle.transitionStatus(issue.id, 'planning');
io.lifecycle.transitionStatus(issue.id, 'tasks_ready');

const execRepo = new ExecutorInstanceRepository(db);
const inst = execRepo.create({ projectId: 'proj-1', specChangeId: specChange.id, type: 'manual' });
await io.executorService.start(inst.id);
if (io.lifecycle.getIssue(issue.id).status !== 'executing') {
  console.error('Expected executing'); process.exit(1);
}
await io.executorService.markCompleted(inst.id);
if (io.lifecycle.getIssue(issue.id).status !== 'reviewing') {
  console.error('Expected reviewing'); process.exit(1);
}

const result = await io.lifecycle.closeSubIssueAndArchive(issue.id);
if (!result.archive?.ok) { console.error('Archive failed', result.archive); process.exit(1); }
if (!fs.existsSync(join(root, 'openspec', 'specs', 'auth', 'spec.md'))) {
  console.error('Corpus not created'); process.exit(1);
}
console.log('OpenSpec G3 smoke: PASS — issue closed + corpus updated + archived at', result.archive.archivedDir);
io.dispose();
"
```

Expected output: `OpenSpec G3 smoke: PASS — issue closed + corpus updated + archived at <path>`.

- [ ] **Step 6: Tag**

```bash
git add server/src/domains/issue-orchestration/index.ts \
        server/src/domains/issue-orchestration/register.ts \
        server/src/application/bootstrap/feature-domains.ts
git commit -m "feat(issue-orchestration): bootstrap wire + propagator install"
git tag -a openspec/phase-g3-complete -m "OpenSpec × Supervisor Phase G3 issue orchestration + status propagation landed"
```

---

## Phase G3 Acceptance Criteria

- [ ] All 5 tasks complete with individual commits.
- [ ] `pnpm build` passes (all 4 packages — server + desktop must build, per G2 lesson).
- [ ] Full server vitest green (~3600 tests).
- [ ] Programmatic smoke produces the full chain: create parent → sub-issue → spec_change scaffolded → executor start → sub-issue executing → markCompleted → sub-issue reviewing → close → archive → corpus updated.
- [ ] Tag `openspec/phase-g3-complete` exists.

---

## What Phase G3 Deliberately Does NOT Cover

| Item | Phase |
|------|-------|
| `getProjectRoot` real wiring (currently throws placeholder) | G5 (paired with UI) |
| Bootstrap (`/opsx:explore` equivalent) | G4 |
| REST routes for issue CRUD | G5 |
| UI: 3-layer drill-in, anonymous folding, archive review dialog | G5 |
| Multi-executor sub-issues in production flow | G5+ (no UI exercises it yet) |
| Sync between SpecChange.status and Sub-Issue.status | G5 (events exist; consumers come with UI) |

---

*Plan version: 1 / 2026-05-21*
*Design reference: `docs/design/openspec-integration-v2.zh-CN.md` (commit `342651f6`)*
*Predecessors: G1 (`openspec/phase-g1-complete`), G2 (`openspec/phase-g2-complete`)*
