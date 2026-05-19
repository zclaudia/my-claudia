# Meta Workflow — Phase E2c: UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Round out the Meta Workflow desktop UI by adding the reuse-pool browser screen, draggable node layout on PhaseGraphScreen, and an embedded sub-workflow run viewer inside PhaseDetailScreen.

**Architecture:** Three independent UI additions plus the one server endpoint they need; no new architectural concepts.
- Reuse-pool browser: extends repo (`listActive`), service (`listReusePool`), and REST routes (`GET /api/meta-workflow/reuse-pool`); new client API helper; new desktop screen `ReusePoolScreen.tsx`; new view-state entry `'reuse-pool'`.
- Drag-edit on PhaseGraphScreen: store gets a `layouts: Record<RunId, Record<NodeId, { x; y }>>` cache; `PhaseGraphScreen` switches from raw `nodes` prop to `useNodesState` + `onNodesChange` so xyflow handles drag, then persists positions to the store on drag stop.
- Sub-workflow viewer: when `phase.currentRunId` exists, embed `WorkflowRunViewer` (from `apps/desktop/src/features/workflows/components/WorkflowRunViewer.tsx`) inline inside a collapsible `<details>` block on PhaseDetailScreen.

**Tech Stack:** TypeScript, vitest, `@xyflow/react` (existing), `@testing-library/react`, better-sqlite3.

**Spec reference:** `docs/design/supervisor-meta-workflow.zh-CN.md` (§5.4 reuse pool, §6.5 sub-workflow execution).

**Phase E2b reference:**
- `docs/impl/meta-workflow-phase-e2b-hardening.md`
- Tag `meta-workflow/phase-e2b-complete`
- Latest commit: `e05cf63a` (theme token sweep)

---

## File Structure

```
server/src/domains/meta-workflow/
├── repositories/
│   └── meta-workflow-reuse-pool-repository.ts                     MODIFY (+ listActive)
├── service.ts                                                     MODIFY (+ listReusePool)
├── routes.ts                                                      MODIFY (+ GET /reuse-pool)
└── __tests__/
    └── reuse-pool-repository.test.ts                              MODIFY (+ listActive tests)

apps/desktop/src/features/meta-workflow/
├── api.ts                                                         MODIFY (+ listReusePool)
├── view-state.ts                                                  MODIFY (+ 'reuse-pool')
├── store.ts                                                       MODIFY (+ layouts)
├── components/
│   ├── ReusePoolScreen.tsx                                        NEW
│   ├── MetaWorkflowPanel.tsx                                      MODIFY (route 'reuse-pool')
│   ├── PhaseBoardScreen.tsx                                       MODIFY (+ "Browse Pool" entry)
│   ├── PhaseGraphScreen.tsx                                       MODIFY (drag-edit)
│   └── PhaseDetailScreen.tsx                                      MODIFY (+ sub-workflow viewer)
└── __tests__/
    ├── ReusePoolScreen.test.tsx                                   NEW
    └── store-layouts.test.ts                                      NEW
```

6 tasks total.

```
Task 1 — Server: reuse-pool list endpoint            ← independent
Task 2 — Client API + view-state                     ← needs T1
Task 3 — ReusePoolScreen + nav entry from board      ← needs T2
Task 4 — Drag-edit on PhaseGraphScreen               ← independent
Task 5 — Sub-workflow viewer in PhaseDetailScreen    ← independent
Task 6 — Smoke + tag                                 ← final
```

---

## Task 1: Server — `GET /api/meta-workflow/reuse-pool`

**Files:**
- Modify: `server/src/domains/meta-workflow/repositories/meta-workflow-reuse-pool-repository.ts` (+ `listActive`)
- Modify: `server/src/domains/meta-workflow/service.ts` (+ `listReusePool`)
- Modify: `server/src/domains/meta-workflow/routes.ts` (+ route)
- Modify: existing repo tests (`reuse-pool-repository.test.ts`) to cover `listActive`

**Goal:** A REST endpoint that returns active reuse-pool items, optionally filtered by `phaseType` and a free-text `search` term.

- [ ] **Step 1: Add the failing repo test**

Find `server/src/domains/meta-workflow/__tests__/reuse-pool-repository.test.ts` (created in Phase B). Append a new `describe`:

```typescript
describe('listActive', () => {
  it('returns all non-archived items ordered by source_type DESC, created_at DESC', () => {
    repo.insert({ id: 'a', kind: 'workflow', entityId: 'w1', phaseType: 'code-implement', description: 'first auto', tags: ['x'], sourceType: 'auto', metadata: { usageCount: 0 }, createdAt: 1 });
    repo.insert({ id: 'b', kind: 'workflow', entityId: 'w2', phaseType: 'code-test-write', description: 'second user', tags: ['y'], sourceType: 'user', metadata: { usageCount: 5 }, createdAt: 2 });
    repo.insert({ id: 'c', kind: 'workflow', entityId: 'w3', phaseType: 'code-implement', description: 'third archived', tags: ['z'], sourceType: 'auto', metadata: { usageCount: 0 }, createdAt: 3 });
    repo.archive('c');
    const items = repo.listActive();
    expect(items.map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('filters by phaseType when provided', () => {
    repo.insert({ id: 'a', kind: 'workflow', entityId: 'w1', phaseType: 'code-implement', description: 'impl', tags: [], sourceType: 'auto', metadata: { usageCount: 0 }, createdAt: 1 });
    repo.insert({ id: 'b', kind: 'workflow', entityId: 'w2', phaseType: 'code-test-write', description: 'test', tags: [], sourceType: 'auto', metadata: { usageCount: 0 }, createdAt: 2 });
    const items = repo.listActive('code-test-write');
    expect(items.map((i) => i.id)).toEqual(['b']);
  });
});
```

> If `repo.insert` doesn't accept this shape, adapt to the actual signature (check the file). The existing `findByPhaseType` shows the row contract.

- [ ] **Step 2: Run, see failure**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/reuse-pool-repository.test.ts`

Expected: `repo.listActive is not a function`.

- [ ] **Step 3: Add `listActive` to the repo**

In `meta-workflow-reuse-pool-repository.ts`, near `findByPhaseType` (line 89), add:

```typescript
/**
 * List all non-archived items, optionally filtered by phaseType.
 * Ordered: user-promoted first, then by creation time DESC.
 */
listActive(phaseType?: string): ReusablePoolItem[] {
  const rows = phaseType
    ? this.db.prepare(
        `SELECT * FROM meta_workflow_reuse_pool
           WHERE phase_type = ? AND archived_at IS NULL
           ORDER BY source_type DESC, created_at DESC`,
      ).all(phaseType)
    : this.db.prepare(
        `SELECT * FROM meta_workflow_reuse_pool
           WHERE archived_at IS NULL
           ORDER BY source_type DESC, created_at DESC`,
      ).all();
  return rows.map((r) => this.mapRow(r));
}
```

- [ ] **Step 4: Run tests; green**

Run: `pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow/__tests__/reuse-pool-repository.test.ts`

Expected: green.

- [ ] **Step 5: Add `listReusePool` to the service**

In `server/src/domains/meta-workflow/service.ts`, near `searchReusePool` (line 197), add:

```typescript
listReusePool(filters?: { phaseType?: string; search?: string }): ReusablePoolItem[] {
  const items = this.poolRepo.listActive(filters?.phaseType);
  const q = filters?.search?.trim().toLowerCase();
  if (!q) return items;
  return items.filter((it) => {
    const hay = [
      it.description ?? '',
      ...(it.tags ?? []),
      it.entityId ?? '',
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });
}
```

Make sure `ReusablePoolItem` is imported (it's already imported elsewhere in service.ts as part of the shared types).

- [ ] **Step 6: Add the REST route**

In `server/src/domains/meta-workflow/routes.ts`, just before `return router;`, add:

```typescript
router.get('/reuse-pool', (req: Request, res: Response) => {
  const phaseType = (req.query.phaseType as string | undefined) || undefined;
  const search = (req.query.search as string | undefined) || undefined;
  res.json({ items: service.listReusePool({ phaseType, search }) });
});
```

- [ ] **Step 7: Type-check + regression**

Run:
```bash
pnpm --filter @my-claudia/server exec tsc --noEmit
pnpm --filter @my-claudia/server exec vitest run src/domains/meta-workflow
```

Expected: both green.

- [ ] **Step 8: Commit**

```bash
git add server/src/domains/meta-workflow/repositories/meta-workflow-reuse-pool-repository.ts \
        server/src/domains/meta-workflow/service.ts \
        server/src/domains/meta-workflow/routes.ts \
        server/src/domains/meta-workflow/__tests__/reuse-pool-repository.test.ts
git commit -m "feat(meta-workflow): GET /reuse-pool with phaseType + search filters"
```

---

## Task 2: Client API + view-state for `'reuse-pool'` screen

**Files:**
- Modify: `apps/desktop/src/features/meta-workflow/api.ts` (+ `listReusePool`)
- Modify: `apps/desktop/src/features/meta-workflow/view-state.ts` (+ screen + filters)

**Goal:** Add the typed client helper for the new endpoint and the view-state extensions so the screen has a home.

- [ ] **Step 1: Find the HTTP base URL helper used by other meta-workflow API calls**

Read `apps/desktop/src/features/meta-workflow/api.ts` head + the existing `listRuns` / `promotePoolItem` implementations. Note the fetch base URL pattern.

- [ ] **Step 2: Add `listReusePool` helper**

Append to `api.ts` (near `promotePoolItem`):

```typescript
export async function listReusePool(filters?: {
  phaseType?: string;
  search?: string;
}): Promise<ReusablePoolItem[]> {
  const params = new URLSearchParams();
  if (filters?.phaseType) params.set('phaseType', filters.phaseType);
  if (filters?.search)    params.set('search', filters.search);
  const qs = params.toString();
  const url = `${BASE_URL}/api/meta-workflow/reuse-pool${qs ? `?${qs}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`listReusePool failed: ${res.status}`);
  const body = await res.json() as { items: ReusablePoolItem[] };
  return body.items;
}
```

Make sure `ReusablePoolItem` is imported from `@my-claudia/shared/features/meta-workflow`. The `BASE_URL` constant should already exist in this file; if it's named differently (e.g. `API_BASE`), use that.

- [ ] **Step 3: Extend view-state**

Edit `apps/desktop/src/features/meta-workflow/view-state.ts`:

```typescript
export type MetaWorkflowScreen =
  | 'list'
  | 'requirements'
  | 'phase-graph'
  | 'phase-board'
  | 'phase-detail'
  | 'promotion'
  | 'reuse-pool';

export interface MetaWorkflowViewState {
  screen: MetaWorkflowScreen;
  selectedRunId?: string;
  selectedPhaseId?: string;
  promotingPoolItemId?: string;
  /** Filters active on the reuse-pool screen. */
  poolFilters?: { phaseType?: string; search?: string };
}

export const INITIAL_VIEW_STATE: MetaWorkflowViewState = {
  screen: 'list',
};
```

- [ ] **Step 4: Type-check**

Run: `pnpm --filter @my-claudia/desktop exec tsc --noEmit`

Expected: exit 0. (No callers consume the new field yet — that's Task 3.)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/meta-workflow/api.ts \
        apps/desktop/src/features/meta-workflow/view-state.ts
git commit -m "feat(meta-workflow-ui): client listReusePool + reuse-pool view state"
```

---

## Task 3: `ReusePoolScreen` + navigation entry from board

**Files:**
- Create: `apps/desktop/src/features/meta-workflow/components/ReusePoolScreen.tsx`
- Modify: `apps/desktop/src/features/meta-workflow/components/MetaWorkflowPanel.tsx` (route `'reuse-pool'`)
- Modify: `apps/desktop/src/features/meta-workflow/components/PhaseBoardScreen.tsx` (add a "Browse Reuse Pool" button)
- Create: `apps/desktop/src/features/meta-workflow/__tests__/ReusePoolScreen.test.tsx`

**Goal:** A screen that lists reuse-pool items with a phaseType filter and a search input.

- [ ] **Step 1: Create the screen**

Write `ReusePoolScreen.tsx`:

```tsx
// apps/desktop/src/features/meta-workflow/components/ReusePoolScreen.tsx
import React, { useEffect, useState } from 'react';
import type { ReusablePoolItem } from '@my-claudia/shared/features/meta-workflow';
import { useMetaWorkflowStore } from '../store.js';
import { listReusePool } from '../api.js';

interface Props {
  projectId: string;
}

const PHASE_TYPES = [
  'code-implement',
  'code-refactor',
  'code-test-write',
  'design-doc',
  'dep-update',
  'investigation',
] as const;

export function ReusePoolScreen({ projectId }: Props): React.ReactElement {
  const view = useMetaWorkflowStore((s) => s.viewByProject[projectId]);
  const patchView = useMetaWorkflowStore((s) => s.patchView);
  const filters = view?.poolFilters ?? {};
  const [items, setItems] = useState<ReusablePoolItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listReusePool(filters)
      .then((rows) => { if (!cancelled) setItems(rows); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters.phaseType, filters.search]);

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Reusable Pool</h3>
        <button
          className="px-2.5 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80"
          onClick={() => patchView(projectId, { screen: 'phase-board' })}
        >
          ← Back to Board
        </button>
      </div>

      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Phase Type</label>
          <select
            className="bg-background border border-border rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
            value={filters.phaseType ?? ''}
            onChange={(e) => patchView(projectId, {
              poolFilters: { ...filters, phaseType: e.target.value || undefined },
            })}
          >
            <option value="">All</option>
            {PHASE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-muted-foreground mb-1">Search</label>
          <input
            type="text"
            className="w-full bg-background border border-border rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
            placeholder="tag, description, entity id…"
            value={filters.search ?? ''}
            onChange={(e) => patchView(projectId, {
              poolFilters: { ...filters, search: e.target.value || undefined },
            })}
          />
        </div>
      </div>

      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {error && <div className="text-sm text-red-500">Error: {error}</div>}
      {!loading && !error && items && items.length === 0 && (
        <div className="text-sm text-muted-foreground">No items match the current filters.</div>
      )}
      {!loading && items && items.length > 0 && (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map((it) => (
            <li
              key={it.id}
              className="border border-border rounded-md p-3 bg-card hover:bg-secondary/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-sm">
                    {it.kind} · <span className="font-mono text-xs">{it.entityId}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {it.phaseType} · {it.sourceType}{' '}
                    {(it.metadata?.usageCount ?? 0) > 0 && (
                      <span>· used {it.metadata?.usageCount}×</span>
                    )}
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(it.createdAt).toLocaleDateString()}
                </span>
              </div>
              {it.description && (
                <p className="text-xs mt-2 text-muted-foreground line-clamp-2">{it.description}</p>
              )}
              {it.tags && it.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {it.tags.map((t) => (
                    <span key={t} className="px-1.5 py-0.5 text-[10px] rounded bg-secondary text-foreground">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire into `MetaWorkflowPanel`**

Open `apps/desktop/src/features/meta-workflow/components/MetaWorkflowPanel.tsx`. The `view.screen === 'list'` branch returns a top-level listing — `'reuse-pool'` should sit alongside the per-run screens (it doesn't need a selected run).

Add the screen rendering inside the `view.screen === 'list' || !selectedRun` branch with a small early return:

```tsx
// Inside MetaWorkflowPanel, replace this block:
if (view.screen === 'list' || !selectedRun) {
  // existing "Meta Workflow Runs" listing
}

// With:
if (view.screen === 'reuse-pool') {
  return (
    <div className="meta-workflow-panel">
      <ReusePoolScreen projectId={projectId} />
    </div>
  );
}

if (view.screen === 'list' || !selectedRun) {
  // existing listing — UNCHANGED
}
```

Add the import at the top:

```tsx
import { ReusePoolScreen } from './ReusePoolScreen.js';
```

- [ ] **Step 3: Add "Browse Reuse Pool" entry on `PhaseBoardScreen`**

In `apps/desktop/src/features/meta-workflow/components/PhaseBoardScreen.tsx`, the header currently has one "View Graph" button. Add a second:

```tsx
<div className="flex items-center gap-2">
  <button
    className="px-2.5 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80"
    onClick={() => patchView(projectId, { screen: 'phase-graph' })}
  >
    View Graph
  </button>
  <button
    className="px-2.5 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80"
    onClick={() => patchView(projectId, { screen: 'reuse-pool', poolFilters: {} })}
  >
    Browse Pool
  </button>
</div>
```

Wrap the existing `<button>` with the surrounding `<div className="flex items-center gap-2">` if it's not already in one. (Right now it's a bare button next to the title.)

- [ ] **Step 4: Add screen tests**

Create `apps/desktop/src/features/meta-workflow/__tests__/ReusePoolScreen.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReusePoolScreen } from '../components/ReusePoolScreen.js';
import { useMetaWorkflowStore } from '../store.js';
import * as api from '../api.js';
import type { ReusablePoolItem } from '@my-claudia/shared/features/meta-workflow';

function makeItem(overrides: Partial<ReusablePoolItem> = {}): ReusablePoolItem {
  return {
    id: 'a',
    kind: 'workflow',
    entityId: 'w1',
    phaseType: 'code-implement',
    description: 'desc-a',
    tags: ['x', 'y'],
    sourceType: 'auto',
    metadata: { usageCount: 3 },
    createdAt: Date.now(),
    ...overrides,
  } as ReusablePoolItem;
}

describe('ReusePoolScreen', () => {
  beforeEach(() => {
    useMetaWorkflowStore.setState({
      runs: {},
      phases: {},
      recommendations: {},
      viewByProject: { p1: { screen: 'reuse-pool', poolFilters: {} } },
      pendingSelectByProject: {},
    });
    vi.restoreAllMocks();
  });

  it('renders loading state then items', async () => {
    vi.spyOn(api, 'listReusePool').mockResolvedValue([
      makeItem({ id: 'a', entityId: 'w1' }),
      makeItem({ id: 'b', entityId: 'w2', sourceType: 'user' }),
    ]);
    render(<ReusePoolScreen projectId="p1" />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/w1/)).toBeInTheDocument();
      expect(screen.getByText(/w2/)).toBeInTheDocument();
    });
  });

  it('changing phaseType filter triggers a new API call', async () => {
    const spy = vi.spyOn(api, 'listReusePool').mockResolvedValue([]);
    const user = userEvent.setup();
    render(<ReusePoolScreen projectId="p1" />);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    await user.selectOptions(screen.getByLabelText(/Phase Type/i), 'code-test-write');
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[1][0]).toMatchObject({ phaseType: 'code-test-write' });
  });

  it('empty state when API returns no items', async () => {
    vi.spyOn(api, 'listReusePool').mockResolvedValue([]);
    render(<ReusePoolScreen projectId="p1" />);
    await waitFor(() => {
      expect(screen.getByText(/No items match/i)).toBeInTheDocument();
    });
  });

  it('shows API error', async () => {
    vi.spyOn(api, 'listReusePool').mockRejectedValue(new Error('boom'));
    render(<ReusePoolScreen projectId="p1" />);
    await waitFor(() => {
      expect(screen.getByText(/Error: boom/)).toBeInTheDocument();
    });
  });

  it('Back to Board switches view', async () => {
    vi.spyOn(api, 'listReusePool').mockResolvedValue([]);
    const user = userEvent.setup();
    render(<ReusePoolScreen projectId="p1" />);
    await user.click(screen.getByRole('button', { name: /Back to Board/i }));
    expect(useMetaWorkflowStore.getState().viewByProject['p1'].screen).toBe('phase-board');
  });
});
```

> The `getByLabelText(/Phase Type/i)` query works if you place the label as a sibling of the `<select>` (the snippet in Step 1 has them as siblings inside a `<div>`). If RTL can't find it (no `htmlFor`), fall back to `screen.getAllByRole('combobox')[0]`.

- [ ] **Step 5: Run new tests + type-check**

Run:
```bash
pnpm --filter @my-claudia/desktop exec vitest run src/features/meta-workflow/__tests__/ReusePoolScreen.test.tsx
pnpm --filter @my-claudia/desktop exec tsc --noEmit
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/features/meta-workflow/components/ReusePoolScreen.tsx \
        apps/desktop/src/features/meta-workflow/components/MetaWorkflowPanel.tsx \
        apps/desktop/src/features/meta-workflow/components/PhaseBoardScreen.tsx \
        apps/desktop/src/features/meta-workflow/__tests__/ReusePoolScreen.test.tsx
git commit -m "feat(meta-workflow-ui): ReusePoolScreen + Browse Pool entry"
```

---

## Task 4: Drag-edit on `PhaseGraphScreen`

**Files:**
- Modify: `apps/desktop/src/features/meta-workflow/store.ts` (+ `layouts` field + `setNodePosition` action)
- Modify: `apps/desktop/src/features/meta-workflow/components/PhaseGraphScreen.tsx` (use `useNodesState` + persist on drag stop)
- Create: `apps/desktop/src/features/meta-workflow/__tests__/store-layouts.test.ts`

**Goal:** Let the user drag a node; the new position survives screen switches within the same session.

- [ ] **Step 1: Add the failing store test**

Create `apps/desktop/src/features/meta-workflow/__tests__/store-layouts.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useMetaWorkflowStore } from '../store.js';

describe('useMetaWorkflowStore — layouts', () => {
  beforeEach(() => {
    useMetaWorkflowStore.setState({
      runs: {}, phases: {}, recommendations: {},
      viewByProject: {}, pendingSelectByProject: {},
      layouts: {},
    });
  });

  it('setNodePosition stores per-run per-node coordinates', () => {
    const s = useMetaWorkflowStore.getState();
    s.setNodePosition('run-1', 'p1', { x: 100, y: 200 });
    s.setNodePosition('run-1', 'p2', { x: 50, y: 75 });
    s.setNodePosition('run-2', 'p1', { x: 0, y: 0 });
    const state = useMetaWorkflowStore.getState();
    expect(state.layouts['run-1']).toEqual({ p1: { x: 100, y: 200 }, p2: { x: 50, y: 75 } });
    expect(state.layouts['run-2']).toEqual({ p1: { x: 0, y: 0 } });
  });

  it('subsequent setNodePosition for same node overwrites', () => {
    const s = useMetaWorkflowStore.getState();
    s.setNodePosition('run-1', 'p1', { x: 10, y: 20 });
    s.setNodePosition('run-1', 'p1', { x: 30, y: 40 });
    expect(useMetaWorkflowStore.getState().layouts['run-1'].p1).toEqual({ x: 30, y: 40 });
  });
});
```

- [ ] **Step 2: Run, see failure**

Run: `pnpm --filter @my-claudia/desktop exec vitest run src/features/meta-workflow/__tests__/store-layouts.test.ts`

Expected: fails (`s.setNodePosition is not a function`).

- [ ] **Step 3: Add `layouts` to the store**

Edit `apps/desktop/src/features/meta-workflow/store.ts`:

Add to the `MetaWorkflowStore` interface:

```typescript
  /** per-run, per-node position cache (in-memory, lost on reload) */
  layouts: Record<string, Record<string, { x: number; y: number }>>;
  setNodePosition: (runId: string, nodeId: string, pos: { x: number; y: number }) => void;
```

Add to the store body (near `pendingSelectByProject`):

```typescript
  layouts: {},

  setNodePosition: (runId, nodeId, pos) => {
    set((state) => {
      const runLayout = state.layouts[runId] ?? {};
      return {
        layouts: {
          ...state.layouts,
          [runId]: { ...runLayout, [nodeId]: pos },
        },
      };
    });
  },
```

Also add `layouts: {}` to the `clearProject` action's reset bucket so deleted projects don't leak (look at the existing reset shape — if it omits `layouts`, leave it; only add if other per-project resets are there).

- [ ] **Step 4: Run, see green**

Run: `pnpm --filter @my-claudia/desktop exec vitest run src/features/meta-workflow/__tests__/store-layouts.test.ts`

Expected: green.

- [ ] **Step 5: Wire drag-edit into `PhaseGraphScreen`**

Edit `apps/desktop/src/features/meta-workflow/components/PhaseGraphScreen.tsx`. Imports:

```typescript
import { useEffect, useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  type Node,
  type Edge,
  type NodeChange,
  type NodeDragHandler,
} from '@xyflow/react';
```

Inside the component, after the existing `useMemo({ nodes, edges })` block:

```tsx
const layouts = useMetaWorkflowStore((s) => s.layouts[run.id] ?? {});
const setNodePosition = useMetaWorkflowStore((s) => s.setNodePosition);

// Merge stored positions on top of the computed initial layout.
const initialNodes = useMemo<Node[]>(() => nodes.map((n) => {
  const saved = layouts[n.id];
  return saved ? { ...n, position: saved } : n;
  // eslint-disable-next-line react-hooks/exhaustive-deps
}), [nodes]);  // Only when computed nodes change (status update etc). Saved positions reapplied below via state init.

const [rfNodes, setRfNodes, onNodesChange] = useNodesState(initialNodes);

// Keep rfNodes in sync when phases data changes (status badges) — preserves x/y from rfNodes.
useEffect(() => {
  setRfNodes((prev) => {
    const byId = new Map(prev.map((n) => [n.id, n]));
    return initialNodes.map((n) => {
      const existing = byId.get(n.id);
      return existing ? { ...n, position: existing.position } : n;
    });
  });
}, [initialNodes, setRfNodes]);

const onNodeDragStop = useCallback<NodeDragHandler>((_event, node) => {
  setNodePosition(run.id, node.id, { x: node.position.x, y: node.position.y });
}, [run.id, setNodePosition]);
```

Replace the `<ReactFlow nodes={nodes} edges={edges} fitView>` JSX with:

```tsx
<ReactFlow
  nodes={rfNodes}
  edges={edges}
  onNodesChange={onNodesChange}
  onNodeDragStop={onNodeDragStop}
  fitView
>
  <Background />
  <Controls />
</ReactFlow>
```

> Don't import or wire the `applyNodeChanges` helper directly — `useNodesState` returns `onNodesChange` already pre-bound. The `NodeChange` type can stay unused; remove from the import list if your linter complains.

- [ ] **Step 6: Update existing PhaseGraphScreen test if needed**

Run: `pnpm --filter @my-claudia/desktop exec vitest run src/features/meta-workflow/__tests__/PhaseGraphScreen.test.tsx`

Expected: green. The Phase E2b test mocks `@xyflow/react` with a div stub that simply takes nodes/edges — it should still pass since we're calling `useNodesState` internally and the stub doesn't invoke any of the drag handlers. If anything breaks, the most likely cause is the `useNodesState` hook isn't mocked — add it to the existing `vi.mock('@xyflow/react', () => ({ ... }))` in `PhaseGraphScreen.test.tsx`:

```typescript
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes, edges }: { nodes: unknown[]; edges: unknown[] }) => (
    <div data-testid="reactflow" data-nodes={JSON.stringify(nodes)} data-edges={JSON.stringify(edges)} />
  ),
  Background: () => null,
  Controls: () => null,
  useNodesState: (initial: unknown[]) => [initial, () => {}, () => {}],
}));
```

(If the mock already covers extra hooks, leave it alone.)

- [ ] **Step 7: Type-check + full meta-workflow tests**

Run:
```bash
pnpm --filter @my-claudia/desktop exec tsc --noEmit
pnpm --filter @my-claudia/desktop exec vitest run src/features/meta-workflow
```

Expected: green.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/features/meta-workflow/store.ts \
        apps/desktop/src/features/meta-workflow/components/PhaseGraphScreen.tsx \
        apps/desktop/src/features/meta-workflow/__tests__/store-layouts.test.ts \
        apps/desktop/src/features/meta-workflow/__tests__/PhaseGraphScreen.test.tsx
git commit -m "feat(meta-workflow-ui): drag-edit node layout on PhaseGraphScreen"
```

---

## Task 5: Sub-workflow viewer embedded in `PhaseDetailScreen`

**Files:**
- Modify: `apps/desktop/src/features/meta-workflow/components/PhaseDetailScreen.tsx`
- Modify: `apps/desktop/src/features/meta-workflow/__tests__/PhaseDetailScreen.test.tsx` (cover the new section)

**Goal:** Whenever `phase.currentRunId` is set, render `WorkflowRunViewer` inline inside a collapsible `<details>` block beneath the phase metadata so the user can watch the sub-workflow's progress without leaving PhaseDetailScreen.

- [ ] **Step 1: Update `PhaseDetailScreen.tsx`**

Add the import near the top:

```tsx
import { WorkflowRunViewer } from '../../workflows/components/WorkflowRunViewer.js';
```

Just below the existing `currentRunId` info line in the metadata block (it currently reads `Current sub-workflow run: <code>{phase.currentRunId}</code>`), insert a collapsible viewer:

```tsx
{phase.currentRunId && (
  <details className="border border-border rounded-md bg-muted/30" open>
    <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
      Sub-workflow run · <span className="font-mono text-xs">{phase.currentRunId}</span>
    </summary>
    <div className="border-t border-border">
      <WorkflowRunViewer runId={phase.currentRunId} onBack={() => undefined} />
    </div>
  </details>
)}
```

> `WorkflowRunViewer` is the workflow domain's run viewer and expects `runId` + `onBack`. We pass a no-op `onBack` because the user navigates via the meta-workflow breadcrumb / phase-board, not the workflow viewer's back button. The viewer internally calls `useWorkflowStore.loadRun(runId)`. If `runId` doesn't resolve to a workflow run in the store (e.g. meta-workflow runs use their own engine), the viewer renders its "Loading run..." state — that's acceptable graceful fallback for E2c MVP. Phase F can refine.

- [ ] **Step 2: Add a focused test**

Append to `apps/desktop/src/features/meta-workflow/__tests__/PhaseDetailScreen.test.tsx`. We mock `WorkflowRunViewer` to a stub so the viewer's internal store dependencies don't run:

```tsx
import { vi } from 'vitest';

vi.mock('../../workflows/components/WorkflowRunViewer.js', () => ({
  WorkflowRunViewer: ({ runId }: { runId: string }) => (
    <div data-testid="sub-workflow-stub" data-run-id={runId}>SUB:{runId}</div>
  ),
}));
```

Place the `vi.mock(...)` call at the **top of the file** (mocks are hoisted) — alongside any existing module mocks. Then add a test inside the existing `describe`:

```tsx
it('renders the sub-workflow viewer when phase.currentRunId is set', () => {
  useMetaWorkflowStore.setState({
    runs: { p1: [{ id: 'r1', projectId: 'p1', title: 't', status: 'executing', createdAt: 0, updatedAt: 0 } as never] },
    phases: { r1: [{
      id: 'phase-pk', runId: 'r1', phaseId: 'p1', phaseType: 'code-implement',
      executeEntity: 'workflow', status: 'running', attempt: 1, maxRetries: 3,
      currentRunId: 'sub-run-xyz',
      inputsSnapshot: [], outputsSnapshot: [], gatesSnapshot: [],
    } as never] },
    viewByProject: { p1: { screen: 'phase-detail', selectedRunId: 'r1', selectedPhaseId: 'p1' } },
  });
  render(<PhaseDetailScreen projectId="p1" run={{ id: 'r1' } as never} phaseId="p1" socket={{ send: vi.fn() }} />);
  const stub = screen.getByTestId('sub-workflow-stub');
  expect(stub).toHaveAttribute('data-run-id', 'sub-run-xyz');
});

it('does not render the viewer when currentRunId is absent', () => {
  useMetaWorkflowStore.setState({
    runs: { p1: [{ id: 'r1', projectId: 'p1', title: 't', status: 'executing', createdAt: 0, updatedAt: 0 } as never] },
    phases: { r1: [{
      id: 'phase-pk', runId: 'r1', phaseId: 'p1', phaseType: 'code-implement',
      executeEntity: 'workflow', status: 'pending', attempt: 0, maxRetries: 3,
      inputsSnapshot: [], outputsSnapshot: [], gatesSnapshot: [],
    } as never] },
    viewByProject: { p1: { screen: 'phase-detail', selectedRunId: 'r1', selectedPhaseId: 'p1' } },
  });
  render(<PhaseDetailScreen projectId="p1" run={{ id: 'r1' } as never} phaseId="p1" socket={{ send: vi.fn() }} />);
  expect(screen.queryByTestId('sub-workflow-stub')).not.toBeInTheDocument();
});
```

> The existing 5 tests in `PhaseDetailScreen.test.tsx` already set up `useMetaWorkflowStore` with `beforeEach` — these two append to the suite and reuse the helper pattern.

- [ ] **Step 3: Run, verify green**

Run: `pnpm --filter @my-claudia/desktop exec vitest run src/features/meta-workflow/__tests__/PhaseDetailScreen.test.tsx`

Expected: 5 existing + 2 new = 7 tests green.

- [ ] **Step 4: Type-check**

Run: `pnpm --filter @my-claudia/desktop exec tsc --noEmit`

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/meta-workflow/components/PhaseDetailScreen.tsx \
        apps/desktop/src/features/meta-workflow/__tests__/PhaseDetailScreen.test.tsx
git commit -m "feat(meta-workflow-ui): embed sub-workflow viewer in PhaseDetailScreen"
```

---

## Task 6: Smoke + Tag

- [ ] **Step 1: Build**

Run: `pnpm build`

Expected: 4 packages clean.

- [ ] **Step 2: Test sweeps**

Run:
```bash
pnpm --filter @my-claudia/server  exec vitest run src/domains/meta-workflow
pnpm --filter @my-claudia/shared  exec vitest run src/features
pnpm --filter @my-claudia/desktop exec vitest run src/features/meta-workflow
```

Expected: all green.

- [ ] **Step 3: Quick reuse-pool REST smoke (only if Step 1-2 are green)**

```bash
cd /Users/haozhang/SourceCode/zhvala/my-claudia && node --input-type=module -e "
import Database from 'better-sqlite3';
import express from 'express';
import { migrations } from './server/dist/infrastructure/storage/migrations/index.js';
import { MetaWorkflowService } from './server/dist/domains/meta-workflow/service.js';
import { createMetaWorkflowRoutes } from './server/dist/domains/meta-workflow/routes.js';

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
for (const m of migrations) {
  try { db.exec(m.sql); } catch (e) {
    if (m.idempotent && /duplicate column|already exists/i.test(e.message)) continue;
    throw e;
  }
}

const service = new MetaWorkflowService({
  db,
  runEntityForWorkflow: async () => ({ exitOk: true }),
  runEntityForSubagent: async () => ({ exitOk: true }),
  worktreeAllocator: { acquire: async () => '/tmp', release: async () => {}, releaseRun: async () => {} },
});

// Insert an item directly via repo internals.
db.prepare(\`INSERT INTO meta_workflow_reuse_pool
  (id, kind, entity_id, phase_type, description, tags_json, source_type, metadata_json, created_at)
  VALUES ('seed', 'workflow', 'wf-1', 'code-implement', 'Hello world', '[\\\"hello\\\"]', 'auto', '{\\\"usageCount\\\":0}', \${Date.now()})\`).run();

const app = express();
app.use(express.json());
app.use('/api/meta-workflow', createMetaWorkflowRoutes(service));
const server = app.listen(0, async () => {
  const port = server.address().port;
  const res = await fetch(\`http://127.0.0.1:\${port}/api/meta-workflow/reuse-pool?phaseType=code-implement&search=hello\`);
  const body = await res.json();
  if (!body.items || body.items.length !== 1 || body.items[0].id !== 'seed') {
    console.error('Smoke failed:', body); process.exit(1);
  }
  console.log('Phase E2c smoke: PASS', body.items[0].id);
  server.close(); process.exit(0);
});
"
```

Expected: `Phase E2c smoke: PASS seed`. If the dist/ bundles aren't built, run `pnpm build` first (Step 1 should have done that).

- [ ] **Step 4: Tag**

```bash
git tag -a meta-workflow/phase-e2c-complete -m "Meta Workflow Phase E2c UI polish (reuse-pool browser, drag-edit graph, sub-workflow viewer) landed"
```

---

## Phase E2c Acceptance Criteria

- [ ] All 6 tasks complete with individual commits.
- [ ] `pnpm build` passes.
- [ ] meta-workflow tests green across server + shared + desktop.
- [ ] Reuse-pool REST smoke returns the seeded item.
- [ ] Tag `meta-workflow/phase-e2c-complete` exists.

---

## What Phase E2c Deliberately Leaves to Phase F

| Item | Phase |
|------|-------|
| Reuse-pool item detail / edit screen | F |
| Persisting node layout to DB (per-run, per-user) | F |
| Workflow run viewer fully compatible with meta-workflow sub-runs (currently degrades to "Loading…" if the run isn't loaded in `useWorkflowStore`) | F |
| End-to-end smoke on a real Java/TS project | F |

---

*Plan version: 1 / 2026-05-19*
*Phase A-E2b: complete (latest tag `meta-workflow/phase-e2b-complete`, commit `e05cf63a`)*
