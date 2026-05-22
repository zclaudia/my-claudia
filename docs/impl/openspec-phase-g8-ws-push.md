# OpenSpec × Supervisor — Phase G8: WebSocket Push + Refresh Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push three G3 status events (`executor.status_changed` / `sub_issue.status_changed` / `spec_change.status_changed`) over WebSocket to all connected clients of the originating project. Desktop store auto-updates on event arrival. Add manual ↻ Refresh buttons on every OpenSpec screen as a guaranteed fallback when WS drops, reconnects, or a third party mutates state outside our event flow.

**Architecture:** Mirrors the existing `LocalIssue` broadcast pattern (`server/src/domains/local-issues/service.ts`). 3 new typed `ServerMessage` variants in shared protocol. `registerIssueOrchestration` takes a `broadcast(projectId, msg)` callback, subscribes to its internal `EventDispatcher<IssueDomainEvent>`, and forwards each event as a typed `ServerMessage`. Desktop adds an `openspec/handlers.ts` switch that reads the messages and updates the `useOpenSpecStore`. Refresh buttons call the existing list/get APIs.

**Tech Stack:** TypeScript strict, vitest, the existing WS broadcast helper `broadcastToAuthenticatedClients` + `clients` registry, `useOpenSpecStore` actions.

**Spec reference:** `docs/design/openspec-integration-v2.zh-CN.md` §11 G6 deferred + earlier conversation re: WS as fallback over polling.

**Phase predecessors:**
- G7 tag `openspec/phase-g7-complete`
- Internal: G3's `EventDispatcher<IssueDomainEvent>` is already wired in `registerIssueOrchestration`

---

## File Structure

```
shared/src/protocol/messages/
├── openspec.ts                                                       NEW (3 message interfaces)
└── index.ts                                                          MODIFY (export + add to ServerMessage union)

server/src/domains/issue-orchestration/
├── register.ts                                                       MODIFY (+ broadcast wiring)
└── __tests__/register.test.ts                                        NEW (broadcast test)

server/src/application/bootstrap/
└── feature-domains.ts                                                MODIFY (pass broadcast into registerIssueOrchestration)

apps/desktop/src/features/openspec/
├── handlers.ts                                                       NEW (3 message-type switch + store updates)
├── components/
│   ├── IssueListScreen.tsx                                           MODIFY (+ ↻ button)
│   ├── SubIssueDetailScreen.tsx                                      MODIFY (+ ↻ button in header)
│   ├── SpecCorpusScreen.tsx                                          MODIFY (+ ↻ button)
│   └── AnonymousManagementPanel.tsx                                  MODIFY (+ ↻ button)
└── __tests__/
    ├── handlers.test.ts                                              NEW
    └── IssueListScreen.test.tsx                                      MODIFY (+ refresh button test)

apps/desktop/src/features/
└── message-dispatcher.ts                                             MODIFY (register openspec handler)
```

5 tasks total.

```
Task 1 — Shared protocol messages + ServerMessage union               ← independent
Task 2 — Server broadcast wiring (registerIssueOrchestration)         ← needs T1
Task 3 — Desktop handlers.ts + message-dispatcher registration         ← needs T1
Task 4 — ↻ Refresh buttons on 4 screens                               ← independent
Task 5 — Smoke + tag                                                  ← final
```

---

## Task 1: Shared protocol messages

**Files:**
- Create: `shared/src/protocol/messages/openspec.ts`
- Modify: `shared/src/protocol/messages/index.ts`

**Goal:** Define 3 typed messages + add them to `ServerMessage` union.

- [ ] **Step 1: Create `openspec.ts`**

```typescript
// shared/src/protocol/messages/openspec.ts
import type { ExecutorStatus } from '../../features/executor.js';
import type { LocalIssueStatus } from '../../features/local-issue.js';
import type { SpecChangeStatus } from '../../features/spec-change.js';

/**
 * Pushed when an ExecutorInstance.statusSummary changes. Subscribers
 * (typically desktop store) should refresh the underlying executor record
 * and any affected sub-issue/spec_change derived state.
 */
export interface OpenSpecExecutorStatusChangedMessage {
  type: 'openspec_executor_status_changed';
  projectId: string;
  executorInstanceId: string;
  specChangeId: string;
  prev: ExecutorStatus;
  next: ExecutorStatus;
  at: number;
}

export interface OpenSpecSubIssueStatusChangedMessage {
  type: 'openspec_sub_issue_status_changed';
  projectId: string;
  subIssueId: string;
  prev: LocalIssueStatus;
  next: LocalIssueStatus;
  at: number;
}

export interface OpenSpecSpecChangeStatusChangedMessage {
  type: 'openspec_spec_change_status_changed';
  projectId: string;
  specChangeId: string;
  prev: SpecChangeStatus;
  next: SpecChangeStatus;
  at: number;
}
```

- [ ] **Step 2: Wire into `index.ts`**

```typescript
// shared/src/protocol/messages/index.ts

// near the top exports:
export * from './openspec.js';

// Where imports go (around line 183 with LocalIssueUpdateMessage):
import type {
  OpenSpecExecutorStatusChangedMessage,
  OpenSpecSubIssueStatusChangedMessage,
  OpenSpecSpecChangeStatusChangedMessage,
} from './openspec.js';

// Add to ServerMessage union (around line 270):
  | OpenSpecExecutorStatusChangedMessage
  | OpenSpecSubIssueStatusChangedMessage
  | OpenSpecSpecChangeStatusChangedMessage
```

> Inspect the existing file structure — the imports block + ServerMessage union are well-grouped by domain. Place the new entries near `LocalIssueUpdateMessage` (similar lifecycle context).

- [ ] **Step 3: Verify shared builds**

```bash
pnpm --filter @my-claudia/shared exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add shared/src/protocol/messages/openspec.ts \
        shared/src/protocol/messages/index.ts
git commit -m "feat(openspec-protocol): 3 status-changed ServerMessage variants"
```

---

## Task 2: Server broadcast wiring

**Files:**
- Modify: `server/src/domains/issue-orchestration/register.ts`
- Create: `server/src/domains/issue-orchestration/__tests__/register.test.ts`
- Modify: `server/src/application/bootstrap/feature-domains.ts`

**Goal:** `registerIssueOrchestration` accepts an optional `broadcast` callback. After construction it subscribes the propagator's dispatcher (or a new dedicated subscription) so every `IssueDomainEvent` produces a typed `ServerMessage` and is broadcast.

- [ ] **Step 1: Extend `RegisterIssueOrchestrationDeps`**

In `server/src/domains/issue-orchestration/register.ts`:

```typescript
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import type { IssueDomainEvent } from './events.js';

export interface RegisterIssueOrchestrationDeps {
  db: Database;
  registry: ExecutorRegistry;
  specChangeService: SpecChangeService;
  archiveService: ArchiveService;
  /** Optional: when provided, IssueDomainEvent will be broadcast to all
   *  clients as typed ServerMessage. */
  broadcast?: (projectId: string, msg: ServerMessage) => void;
}
```

- [ ] **Step 2: Subscribe + translate events**

After `propagator.install()` already wires the propagator subscriber, add:

```typescript
// Translate domain events → typed ServerMessages for WS push.
let disposeBroadcast: (() => void) | undefined;
if (deps.broadcast) {
  const handler = (event: IssueDomainEvent): void => {
    const msg = translateEventToMessage(event);
    if (msg) deps.broadcast!(msg.projectId, msg);
  };
  dispatcher.onAny(handler);
  disposeBroadcast = () => dispatcher.offAny(handler);
}

return {
  dispatcher,
  executorService,
  lifecycle,
  propagator,
  anonymousService,
  dispose: (): void => {
    dispose();        // propagator dispose
    disposeBroadcast?.();
  },
};
```

> The existing `dispose` is the propagator's. Rename the local to `disposePropagator` and chain them in the returned `dispose`.

Add the translator at the bottom of the file:

```typescript
function translateEventToMessage(event: IssueDomainEvent): ServerMessage & { projectId: string } | null {
  switch (event.type) {
    case 'executor.status_changed':
      return {
        type: 'openspec_executor_status_changed',
        projectId: event.projectId,
        executorInstanceId: event.executorInstanceId,
        specChangeId: event.specChangeId,
        prev: event.prev,
        next: event.next,
        at: event.at,
      };
    case 'sub_issue.status_changed':
      return {
        type: 'openspec_sub_issue_status_changed',
        projectId: event.projectId,
        subIssueId: event.subIssueId,
        prev: event.prev,
        next: event.next,
        at: event.at,
      };
    case 'spec_change.status_changed':
      // Lookup spec_change to get projectId (or hold it on the event payload — preferred).
      // For now we expect the event to already carry projectId; if not, the propagator
      // should be updated to include it. See G3 events.ts for the actual shape.
      return null;  // TODO: enable when SpecChangeStatusChangedEvent gains projectId
    default:
      return null;
  }
}
```

> **Important**: `SpecChangeStatusChangedEvent` in G3 may not carry `projectId`. Check `server/src/domains/issue-orchestration/events.ts`; if missing, **add `projectId: string`** to it AND update emit sites (Task 3 search + replace). The plan's TODO above is a placeholder — close it in this same task.

- [ ] **Step 3: Update emit sites if SpecChangeStatusChangedEvent needs projectId**

```bash
grep -n "spec_change.status_changed" server/src/domains/issue-orchestration/
```

Today there are **no** emitters of `spec_change.status_changed` — G3 declared the event but didn't fire it. So Task 2 doesn't need to backfill anything; just leave the `case` returning `null` (or remove it from the union temporarily — your call). Document in the commit message.

- [ ] **Step 4: Wire `broadcast` in bootstrap**

In `server/src/application/bootstrap/feature-domains.ts`, find the existing `registerIssueOrchestration({...})` call. Add a `broadcast` field:

```typescript
const issueOrchestration = registerIssueOrchestration({
  db: opts.db,
  registry: executorRegistry,
  specChangeService,
  archiveService,
  broadcast: (_projectId, msg) => broadcastToAuthenticatedClients(clients, msg),
});
```

> `clients` is the WS client registry already used by other domains (e.g. `registerLocalIssueDomain`).

- [ ] **Step 5: Add a test**

```typescript
// server/src/domains/issue-orchestration/__tests__/register.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { ExecutorRegistry, ExecutorInstanceRepository, ManualAdapter } from '../../executor/index.js';
import { SpecChangeService, ArchiveService } from '../../openspec/index.js';
import { registerIssueOrchestration } from '../register.js';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';

describe('registerIssueOrchestration broadcast wiring', () => {
  let db: Database.Database;
  let projectRoot: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('proj-1', 'P', 'code', 0, 0);
    projectRoot = mkdtempSync(join(tmpdir(), 'wsbcast-'));
  });

  afterEach(() => {
    db.close();
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
  });

  it('broadcasts executor.status_changed as openspec_executor_status_changed', async () => {
    const registry = new ExecutorRegistry();
    registry.register('manual', (instance) => new ManualAdapter(db, instance));
    const sc = new SpecChangeService({ db, getProjectRoot: () => projectRoot });
    const ar = new ArchiveService({ db, getProjectRoot: () => projectRoot });
    const broadcast = vi.fn();

    const io = registerIssueOrchestration({ db, registry, specChangeService: sc, archiveService: ar, broadcast });

    // Setup: sub-issue + spec_change + executor
    const { issue, specChange } = io.lifecycle.createSubIssue({ projectId: 'proj-1', type: 'implement', title: 'A' });
    io.lifecycle.transitionStatus(issue.id, 'planning');
    io.lifecycle.transitionStatus(issue.id, 'tasks_ready');
    const repo = new ExecutorInstanceRepository(db);
    const inst = repo.create({ projectId: 'proj-1', specChangeId: specChange.id, type: 'manual' });

    // Trigger the event
    await io.executorService.start(inst.id);

    // Verify broadcast was called with a typed ServerMessage
    const calls = broadcast.mock.calls as [string, ServerMessage][];
    const execEvents = calls.filter(([, m]) => m.type === 'openspec_executor_status_changed');
    expect(execEvents.length).toBeGreaterThan(0);
    expect(execEvents[0][0]).toBe('proj-1');
    const event = execEvents[0][1];
    if (event.type === 'openspec_executor_status_changed') {
      expect(event.executorInstanceId).toBe(inst.id);
      expect(event.prev).toBe('pending');
      expect(event.next).toBe('executing');
    }

    io.dispose();
  });

  it('broadcasts sub_issue.status_changed as openspec_sub_issue_status_changed', () => {
    const registry = new ExecutorRegistry();
    const sc = new SpecChangeService({ db, getProjectRoot: () => projectRoot });
    const ar = new ArchiveService({ db, getProjectRoot: () => projectRoot });
    const broadcast = vi.fn();

    const io = registerIssueOrchestration({ db, registry, specChangeService: sc, archiveService: ar, broadcast });
    const { issue } = io.lifecycle.createSubIssue({ projectId: 'proj-1', type: 'implement', title: 'A' });
    broadcast.mockClear();
    io.lifecycle.transitionStatus(issue.id, 'planning');

    const calls = broadcast.mock.calls as [string, ServerMessage][];
    const subEvents = calls.filter(([, m]) => m.type === 'openspec_sub_issue_status_changed');
    expect(subEvents.length).toBeGreaterThan(0);
    const event = subEvents[0][1];
    if (event.type === 'openspec_sub_issue_status_changed') {
      expect(event.subIssueId).toBe(issue.id);
      expect(event.next).toBe('planning');
    }
    io.dispose();
  });

  it('dispose() unhooks the broadcast subscription', () => {
    const registry = new ExecutorRegistry();
    const sc = new SpecChangeService({ db, getProjectRoot: () => projectRoot });
    const ar = new ArchiveService({ db, getProjectRoot: () => projectRoot });
    const broadcast = vi.fn();
    const io = registerIssueOrchestration({ db, registry, specChangeService: sc, archiveService: ar, broadcast });
    io.dispose();
    const { issue } = io.lifecycle.createSubIssue({ projectId: 'proj-1', type: 'implement', title: 'A' });
    io.lifecycle.transitionStatus(issue.id, 'planning');
    // broadcast must not be called after dispose
    const subEvents = broadcast.mock.calls.filter(([, m]) => (m as ServerMessage).type === 'openspec_sub_issue_status_changed');
    expect(subEvents.length).toBe(0);
  });

  it('no-op when broadcast not provided (regression)', () => {
    const registry = new ExecutorRegistry();
    const sc = new SpecChangeService({ db, getProjectRoot: () => projectRoot });
    const ar = new ArchiveService({ db, getProjectRoot: () => projectRoot });
    const io = registerIssueOrchestration({ db, registry, specChangeService: sc, archiveService: ar });
    const { issue } = io.lifecycle.createSubIssue({ projectId: 'proj-1', type: 'implement', title: 'A' });
    // Should not throw
    expect(() => io.lifecycle.transitionStatus(issue.id, 'planning')).not.toThrow();
    io.dispose();
  });
});
```

- [ ] **Step 6: Verify**

```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/issue-orchestration
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: existing tests + 4 new = ~30+ green.

- [ ] **Step 7: Commit**

```bash
git add server/src/domains/issue-orchestration/register.ts \
        server/src/domains/issue-orchestration/__tests__/register.test.ts \
        server/src/application/bootstrap/feature-domains.ts
git commit -m "feat(openspec): pipe IssueDomainEvent to WS broadcast"
```

---

## Task 3: Desktop handlers + message-dispatcher

**Files:**
- Create: `apps/desktop/src/features/openspec/handlers.ts`
- Create: `apps/desktop/src/features/openspec/__tests__/handlers.test.ts`
- Modify: `apps/desktop/src/features/message-dispatcher.ts`

**Goal:** Switch on the 3 new message types and refresh store. We don't have raw event payloads in the store (executor / sub-issue status caches), so we re-fetch the affected entity via api on each event for guaranteed consistency.

- [ ] **Step 1: Create `handlers.ts`**

```typescript
// apps/desktop/src/features/openspec/handlers.ts
import type { ServerMessage } from '@my-claudia/shared';
import { useOpenSpecStore } from './store.js';
import * as api from './api.js';

/**
 * Handle openspec_* ServerMessage variants. Each handler triggers a small
 * refetch to keep the store accurate without depending on the event payload
 * being exhaustive.
 */
export function handleOpenSpecMessage(msg: ServerMessage): boolean {
  switch (msg.type) {
    case 'openspec_executor_status_changed': {
      const { specChangeId } = msg;
      // Refetch the executor list for this spec_change.
      api.listExecutors(specChangeId)
        .then((list) => useOpenSpecStore.getState().setExecutors(specChangeId, list))
        .catch(() => undefined);
      return true;
    }

    case 'openspec_sub_issue_status_changed': {
      const { subIssueId } = msg;
      api.getIssue(subIssueId)
        .then((issue) => useOpenSpecStore.getState().upsertIssue(issue))
        .catch(() => undefined);
      return true;
    }

    case 'openspec_spec_change_status_changed': {
      const { specChangeId } = msg;
      api.getSpecChange(specChangeId)
        .then((sc) => useOpenSpecStore.getState().setSpecChange(sc))
        .catch(() => undefined);
      return true;
    }

    default:
      return false;
  }
}
```

- [ ] **Step 2: Wire into `message-dispatcher.ts`**

```typescript
import { handleOpenSpecMessage } from './openspec/handlers';

const featureMessageHandlers: FeatureMessageHandler[] = [
  handleLocalPRMessage,
  handleLocalIssueMessage,
  handleWorkflowMessage,
  handleSupervisionMessage,
  handleAttachmentMessage,
  handleMetaWorkflowMessage,
  handleOpenSpecMessage,
];
```

- [ ] **Step 3: Tests**

```typescript
// apps/desktop/src/features/openspec/__tests__/handlers.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleOpenSpecMessage } from '../handlers.js';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';
import type { ServerMessage } from '@my-claudia/shared';

describe('handleOpenSpecMessage', () => {
  beforeEach(() => {
    useOpenSpecStore.setState({
      issuesByProject: {}, specChangesById: {}, executorsBySpecChange: {},
      corpusByProject: {}, viewByProject: {},
    });
    vi.restoreAllMocks();
  });

  it('executor_status_changed → refetches executors for the spec_change', async () => {
    const spy = vi.spyOn(api, 'listExecutors').mockResolvedValue([
      { id: 'e1', projectId: 'p1', specChangeId: 'sc1', type: 'manual', statusSummary: 'executing', createdAt: 0, updatedAt: 0 },
    ] as never);
    const msg: ServerMessage = {
      type: 'openspec_executor_status_changed',
      projectId: 'p1', executorInstanceId: 'e1', specChangeId: 'sc1',
      prev: 'pending', next: 'executing', at: Date.now(),
    };
    expect(handleOpenSpecMessage(msg)).toBe(true);
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith('sc1'));
    await vi.waitFor(() => expect(useOpenSpecStore.getState().executorsBySpecChange.sc1?.[0]?.statusSummary).toBe('executing'));
  });

  it('sub_issue_status_changed → refetches and upserts issue', async () => {
    const spy = vi.spyOn(api, 'getIssue').mockResolvedValue({
      id: 'i1', projectId: 'p1', title: 'A', status: 'planning', priority: 'medium',
      labels: [], type: 'implement', isAnonymous: false, createdAt: 0, updatedAt: 0,
    } as never);
    const msg: ServerMessage = {
      type: 'openspec_sub_issue_status_changed',
      projectId: 'p1', subIssueId: 'i1',
      prev: 'open', next: 'planning', at: Date.now(),
    };
    expect(handleOpenSpecMessage(msg)).toBe(true);
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith('i1'));
    await vi.waitFor(() => expect(useOpenSpecStore.getState().issuesByProject.p1?.[0]?.status).toBe('planning'));
  });

  it('spec_change_status_changed → refetches and sets spec_change', async () => {
    const spy = vi.spyOn(api, 'getSpecChange').mockResolvedValue({
      id: 'sc1', projectId: 'p1', subIssueId: 'i1', slug: 'x', title: 'X',
      status: 'tasks_ready', proposalPath: 'a', designPath: 'b', tasksPath: 'c',
      deltaSpecPaths: [], deltaPendingMerge: false, createdAt: 0, updatedAt: 0,
    } as never);
    const msg: ServerMessage = {
      type: 'openspec_spec_change_status_changed',
      projectId: 'p1', specChangeId: 'sc1',
      prev: 'designing', next: 'tasks_ready', at: Date.now(),
    };
    expect(handleOpenSpecMessage(msg)).toBe(true);
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith('sc1'));
    await vi.waitFor(() => expect(useOpenSpecStore.getState().specChangesById.sc1?.status).toBe('tasks_ready'));
  });

  it('returns false for unrelated messages', () => {
    const msg = { type: 'local_issue_update' } as ServerMessage;
    expect(handleOpenSpecMessage(msg)).toBe(false);
  });

  it('swallows api errors silently (no throw)', async () => {
    vi.spyOn(api, 'listExecutors').mockRejectedValue(new Error('network'));
    const msg: ServerMessage = {
      type: 'openspec_executor_status_changed',
      projectId: 'p1', executorInstanceId: 'e1', specChangeId: 'sc1',
      prev: 'pending', next: 'executing', at: Date.now(),
    };
    expect(() => handleOpenSpecMessage(msg)).not.toThrow();
  });
});
```

- [ ] **Step 4: Verify**

```bash
pnpm --filter @my-claudia/desktop exec vitest run src/features/openspec/__tests__/handlers.test.ts
pnpm --filter @my-claudia/desktop exec tsc --noEmit
```

Expected: 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/openspec/handlers.ts \
        apps/desktop/src/features/openspec/__tests__/handlers.test.ts \
        apps/desktop/src/features/message-dispatcher.ts
git commit -m "feat(openspec-ui): handle WS status events + register in dispatcher"
```

---

## Task 4: ↻ Refresh buttons on 4 screens

**Files:**
- Modify: `apps/desktop/src/features/openspec/components/IssueListScreen.tsx`
- Modify: `apps/desktop/src/features/openspec/components/SubIssueDetailScreen.tsx`
- Modify: `apps/desktop/src/features/openspec/components/SpecCorpusScreen.tsx`
- Modify: `apps/desktop/src/features/openspec/components/AnonymousManagementPanel.tsx`
- Modify: `apps/desktop/src/features/openspec/__tests__/IssueListScreen.test.tsx`

**Goal:** Each screen gets a small `↻` icon button in the header that calls the same fetch the mount-time useEffect calls. Trivial UX guarantee for WS-drop scenarios.

- [ ] **Step 1: Pattern (apply to each screen)**

Inside each component, extract the existing useEffect's fetch logic into a `refresh` function:

```tsx
// e.g. IssueListScreen.tsx
const refresh = useCallback((): void => {
  listIssues(projectId)
    .then((rows) => setIssues(projectId, rows))
    .catch((e) => console.error('[openspec] listIssues failed', e));
}, [projectId, setIssues]);

useEffect(() => {
  refresh();
}, [refresh]);
```

Then add the button in the header:

```tsx
<button
  className="px-2 py-1 text-xs rounded-md bg-secondary hover:bg-secondary/80"
  onClick={refresh}
  title="Refresh"
>
  ↻
</button>
```

- [ ] **Step 2: Apply to IssueListScreen**

Add `↻` between `📚 Spec Corpus` and `+ New Issue` in the header.

- [ ] **Step 3: Apply to SubIssueDetailScreen**

Refactor the `useEffect` at the top (the one fetching getSpecChange + listExecutors) into a `refresh` callback. Add the `↻` button in the breadcrumb header row (right side, before status badge).

- [ ] **Step 4: Apply to SpecCorpusScreen**

Add `↻` to the right of the title, before "Initialize Specs" / "Re-scan" button. Reuses `api.listCorpus`.

- [ ] **Step 5: Apply to AnonymousManagementPanel**

Add `↻` next to "Select all open" button. Reuses the same `listIssues` fetch as IssueListScreen (since the panel reads from the same `issuesByProject` store slice).

- [ ] **Step 6: Add one representative test**

In `IssueListScreen.test.tsx`, append:

```typescript
it('↻ button triggers another listIssues call', async () => {
  const spy = vi.spyOn(api, 'listIssues').mockResolvedValue([] as never);
  render(<IssueListScreen projectId="p1" />);
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: '↻' }));
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
});
```

- [ ] **Step 7: Verify**

```bash
pnpm --filter @my-claudia/desktop exec vitest run src/features/openspec
pnpm --filter @my-claudia/desktop exec tsc --noEmit
```

Expected: green.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/features/openspec/components/IssueListScreen.tsx \
        apps/desktop/src/features/openspec/components/SubIssueDetailScreen.tsx \
        apps/desktop/src/features/openspec/components/SpecCorpusScreen.tsx \
        apps/desktop/src/features/openspec/components/AnonymousManagementPanel.tsx \
        apps/desktop/src/features/openspec/__tests__/IssueListScreen.test.tsx
git commit -m "feat(openspec-ui): ↻ Refresh buttons on 4 screens (WS-drop fallback)"
```

---

## Task 5: Smoke + tag

- [ ] **Step 1: Build + tests**

```bash
pnpm --filter @my-claudia/server exec tsc --noEmit
pnpm --filter @my-claudia/desktop exec tsc --noEmit
pnpm build
pnpm --filter @my-claudia/server exec vitest run
pnpm --filter @my-claudia/desktop exec vitest run src/features/openspec
```

Expected: all green.

- [ ] **Step 2: Manual smoke**

Two windows of the desktop app pointing at the same project. In window A:
1. Create a sub-issue → window B's issue list should update **without manual refresh**
2. Create an executor + Start → window B's sub-issue detail (if open) should reflect 'executing' status

If WS push works, both should be live. If not, clicking `↻` in window B should fetch latest.

- [ ] **Step 3: Tag**

```bash
git tag -a openspec/phase-g8-complete -m "OpenSpec × Supervisor Phase G8 WS push + Refresh fallback landed"
```

---

## Phase G8 Acceptance Criteria

- [ ] All 5 tasks complete with individual commits.
- [ ] `pnpm build` passes both packages.
- [ ] ~10 new tests (4 broadcast + 5 desktop handlers + 1 refresh-button).
- [ ] Manual smoke shows live cross-window updates.
- [ ] Tag `openspec/phase-g8-complete` exists.

---

## What Phase G8 Deliberately Does NOT Cover

| Item | Status |
|------|--------|
| Push `corpus.updated` event after archive (currently re-fetches via existing list endpoint) | Deferred — corpus changes only on archive which is rare |
| Push `bootstrap_scan.updated` event during long scans | Deferred — InitializeSpecsDialog polls within itself already |
| WS reconnection state hydration (refresh all on reconnect) | Deferred — `↻` buttons cover this |
| Per-client subscription filtering (currently broadcasts to all clients) | Deferred — same as LocalIssue domain |
| Event idempotency / "this client just sent the action, ignore the event" | Deferred — refetches are cheap + safe to repeat |

---

*Plan version: 1 / 2026-05-22*
*Design reference: §11 G6 deferred + G6 deferred-list*
*Predecessors: G1-G7 (latest `openspec/phase-g7-complete`)*
