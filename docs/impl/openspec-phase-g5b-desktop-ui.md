# OpenSpec × Supervisor — Phase G5b: Desktop UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the desktop UI for the OpenSpec stack so end-users can drive the whole lifecycle through buttons + forms — without ever hitting curl. Mounts as a third tab inside `SupervisorWorkspacePanel` (next to "Classic" / "Meta") to keep navigation familiar during the transition.

**Architecture:** Standard MyClaudia desktop pattern (Zustand store + REST helpers + React components + view-state). Backend access is via the G5a REST routes (`/api/openspec/*` + `/api/issues/*`). Polling-based status sync for executors and bootstrap scans (WebSocket push deferred to G6 if needed). All components use the theme tokens established in Meta Workflow E2b (`bg-card`, `bg-popover`, `text-muted-foreground`, etc.).

**Tech Stack:** TypeScript strict, React, Zustand, Vitest + @testing-library/react, Tailwind theme tokens, the existing `apiCall` helper.

**Spec reference:**
- `docs/design/openspec-integration-v2.zh-CN.md` §10 (UI), §13.1 (Anonymous folding default), §13.2 (Bootstrap review semantics)
- G5a plan for REST endpoint shapes

**Phase predecessors:**
- G5a tag `openspec/phase-g5a-complete` (REST surface)
- All G1-G4 services live and tested

---

## File Structure

```
apps/desktop/src/features/openspec/                                NEW
├── api.ts                                                         NEW (REST helpers)
├── view-state.ts                                                  NEW (screen / selected ids)
├── store.ts                                                       NEW (Zustand)
├── components/
│   ├── OpenSpecPanel.tsx                                          NEW (top-level entry, routes by view)
│   ├── IssueListScreen.tsx                                        NEW
│   ├── FeatureIssueDetailScreen.tsx                               NEW
│   ├── SubIssueDetailScreen.tsx                                   NEW
│   ├── SpecCorpusScreen.tsx                                       NEW
│   ├── NewIssueDialog.tsx                                         NEW
│   ├── InitializeSpecsDialog.tsx                                  NEW
│   ├── ArchiveConfirmDialog.tsx                                   NEW
│   └── StatusBadge.tsx                                            NEW (small reusable)
└── __tests__/
    ├── store.test.ts                                              NEW
    ├── IssueListScreen.test.tsx                                   NEW
    ├── SubIssueDetailScreen.test.tsx                              NEW
    ├── SpecCorpusScreen.test.tsx                                  NEW
    ├── InitializeSpecsDialog.test.tsx                             NEW
    └── NewIssueDialog.test.tsx                                    NEW

apps/desktop/src/features/supervision/components/
└── SupervisorWorkspacePanel.tsx                                   MODIFY (add 'openspec' tab)
```

7 tasks total.

```
Task 1 — API + view-state + Zustand store                           ← independent
Task 2 — OpenSpecPanel + IssueListScreen (with anonymous fold)      ← needs T1
Task 3 — FeatureIssueDetailScreen + SubIssueDetailScreen            ← needs T2
Task 4 — SpecChange artifact tabs (in SubIssueDetailScreen)         ← needs T3
Task 5 — SpecCorpusScreen + InitializeSpecsDialog (bootstrap)       ← needs T1
Task 6 — NewIssueDialog + ArchiveConfirmDialog                      ← needs T2, T3
Task 7 — Mount tab + smoke + tag                                    ← final
```

---

## Task 1: API + view-state + Zustand store

**Files:**
- Create: `apps/desktop/src/features/openspec/api.ts`
- Create: `apps/desktop/src/features/openspec/view-state.ts`
- Create: `apps/desktop/src/features/openspec/store.ts`
- Create: `apps/desktop/src/features/openspec/__tests__/store.test.ts`

**Goal:** All foundational pieces. Tests cover store actions only (not React); API helpers are exercised in screen tests via `vi.spyOn`.

- [ ] **Step 1: Inspect existing `apiCall` helper for convention**

```bash
grep -n "export.*apiCall\|export function.*Call" apps/desktop/src/services/api/unwrap.ts apps/desktop/src/services/api.ts 2>/dev/null | head -5
```

Use the same `apiCall<T>(method, path, body?)` pattern that Meta Workflow's `api.ts` uses.

- [ ] **Step 2: Create `api.ts`**

```typescript
// apps/desktop/src/features/openspec/api.ts
import { apiCall } from '../../services/api/unwrap.js';
import type { LocalIssue, LocalIssueStatus, LocalIssueType, LocalIssuePriority } from '@my-claudia/shared/features/local-issue';
import type { SpecChange } from '@my-claudia/shared/features/spec-change';
import type { ExecutorInstance, ExecutorType } from '@my-claudia/shared/features/executor';
import type { BootstrapScan, BootstrapReviewItem } from '../../../../../server/src/domains/openspec/repositories/bootstrap-scan-repository.js';

// ---------- Corpus ----------

export interface CapabilitySummary {
  capability: string;
  requirementCount: number;
  scenarioCount: number;
  lastUpdatedAt: number;
}

export interface CorpusDetail {
  capability: string;
  raw: string;
  parsed: unknown;
}

export async function listCorpus(projectId: string): Promise<CapabilitySummary[]> {
  const body = await apiCall<{ capabilities: CapabilitySummary[] }>('GET', `/api/openspec/corpus?projectId=${encodeURIComponent(projectId)}`);
  return body.capabilities;
}

export async function getCapability(projectId: string, capability: string): Promise<CorpusDetail> {
  return apiCall<CorpusDetail>('GET', `/api/openspec/corpus/${encodeURIComponent(capability)}?projectId=${encodeURIComponent(projectId)}`);
}

// ---------- SpecChange ----------

export async function listSpecChanges(projectId: string): Promise<SpecChange[]> {
  const body = await apiCall<{ specChanges: SpecChange[] }>('GET', `/api/openspec/spec-changes?projectId=${encodeURIComponent(projectId)}`);
  return body.specChanges;
}

export async function getSpecChange(id: string): Promise<SpecChange> {
  const body = await apiCall<{ specChange: SpecChange }>('GET', `/api/openspec/spec-changes/${id}`);
  return body.specChange;
}

export async function readProposal(id: string): Promise<string> {
  const res = await fetch(`/api/openspec/spec-changes/${id}/proposal`, { credentials: 'include' });
  if (!res.ok) throw new Error(`readProposal failed: ${res.status}`);
  return res.text();
}

export async function readDesign(id: string): Promise<string> {
  const res = await fetch(`/api/openspec/spec-changes/${id}/design`, { credentials: 'include' });
  if (!res.ok) throw new Error(`readDesign failed: ${res.status}`);
  return res.text();
}

export async function readTasks(id: string): Promise<string> {
  const res = await fetch(`/api/openspec/spec-changes/${id}/tasks`, { credentials: 'include' });
  if (!res.ok) throw new Error(`readTasks failed: ${res.status}`);
  return res.text();
}

export async function readDeltaSpec(id: string, capability: string): Promise<string> {
  const res = await fetch(`/api/openspec/spec-changes/${id}/delta/${encodeURIComponent(capability)}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`readDeltaSpec failed: ${res.status}`);
  return res.text();
}

export async function writeProposal(id: string, content: string): Promise<SpecChange> {
  const body = await apiCall<{ specChange: SpecChange }>('PUT', `/api/openspec/spec-changes/${id}/proposal`, { content });
  return body.specChange;
}

export async function writeDesign(id: string, content: string): Promise<SpecChange> {
  const body = await apiCall<{ specChange: SpecChange }>('PUT', `/api/openspec/spec-changes/${id}/design`, { content });
  return body.specChange;
}

export async function writeTasks(id: string, content: string): Promise<SpecChange> {
  const body = await apiCall<{ specChange: SpecChange }>('PUT', `/api/openspec/spec-changes/${id}/tasks`, { content });
  return body.specChange;
}

export async function writeDeltaSpec(id: string, capability: string, content: string): Promise<SpecChange> {
  const body = await apiCall<{ specChange: SpecChange }>('PUT', `/api/openspec/spec-changes/${id}/delta/${encodeURIComponent(capability)}`, { content });
  return body.specChange;
}

// ---------- Executor ----------

export async function listExecutors(specChangeId: string): Promise<ExecutorInstance[]> {
  const body = await apiCall<{ executorInstances: ExecutorInstance[] }>('GET', `/api/openspec/executor-instances?specChangeId=${specChangeId}`);
  return body.executorInstances;
}

export async function createExecutor(input: { projectId: string; specChangeId: string; type: ExecutorType; underlyingId?: string }): Promise<ExecutorInstance> {
  const body = await apiCall<{ executorInstance: ExecutorInstance }>('POST', `/api/openspec/executor-instances`, input);
  return body.executorInstance;
}

async function executorAction(id: string, action: string): Promise<ExecutorInstance> {
  const body = await apiCall<{ executorInstance: ExecutorInstance }>('POST', `/api/openspec/executor-instances/${id}/${action}`, {});
  return body.executorInstance;
}
export const startExecutor    = (id: string): Promise<ExecutorInstance> => executorAction(id, 'start');
export const pauseExecutor    = (id: string): Promise<ExecutorInstance> => executorAction(id, 'pause');
export const resumeExecutor   = (id: string): Promise<ExecutorInstance> => executorAction(id, 'resume');
export const cancelExecutor   = (id: string): Promise<ExecutorInstance> => executorAction(id, 'cancel');
export const completeExecutor = (id: string): Promise<ExecutorInstance> => executorAction(id, 'mark-completed');
export const refreshExecutor  = (id: string): Promise<ExecutorInstance> => executorAction(id, 'refresh');

// ---------- Issues ----------

export interface CreateFeatureInput {
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
  slug?: string;
}

export async function createFeature(input: CreateFeatureInput): Promise<LocalIssue> {
  const body = await apiCall<{ issue: LocalIssue }>('POST', '/api/issues/features', input);
  return body.issue;
}

export async function createSubIssue(input: CreateSubIssueInput): Promise<{ issue: LocalIssue; specChange: SpecChange }> {
  return apiCall<{ issue: LocalIssue; specChange: SpecChange }>('POST', '/api/issues/sub', input);
}

export async function createAnonymous(input: { projectId: string; title: string }): Promise<{ issue: LocalIssue; specChange: SpecChange }> {
  return apiCall<{ issue: LocalIssue; specChange: SpecChange }>('POST', '/api/issues/anonymous', input);
}

export async function getIssue(id: string): Promise<LocalIssue> {
  const body = await apiCall<{ issue: LocalIssue }>('GET', `/api/issues/${id}`);
  return body.issue;
}

export async function listSubIssues(parentId: string): Promise<LocalIssue[]> {
  const body = await apiCall<{ subIssues: LocalIssue[] }>('GET', `/api/issues/${parentId}/sub-issues`);
  return body.subIssues;
}

export async function transitionStatus(id: string, status: LocalIssueStatus): Promise<LocalIssue> {
  const body = await apiCall<{ issue: LocalIssue }>('PATCH', `/api/issues/${id}/status`, { status });
  return body.issue;
}

export async function closeAndArchive(id: string): Promise<{ issue: LocalIssue; archive?: unknown }> {
  return apiCall('POST', `/api/issues/${id}/close-and-archive`, {});
}

// ---------- Bootstrap ----------

export async function startBootstrap(projectId: string, mode: 'initial' | 'rescan'): Promise<{ scan: BootstrapScan; appliedSummary: Record<string, number>; pendingSummary: Record<string, { modified: number; removed: number }> }> {
  return apiCall('POST', '/api/openspec/bootstrap/scans', { projectId, mode });
}

export async function listBootstrapScans(projectId: string): Promise<BootstrapScan[]> {
  const body = await apiCall<{ scans: BootstrapScan[] }>('GET', `/api/openspec/bootstrap/scans?projectId=${encodeURIComponent(projectId)}`);
  return body.scans;
}

export async function getBootstrapScan(id: string): Promise<BootstrapScan> {
  const body = await apiCall<{ scan: BootstrapScan }>('GET', `/api/openspec/bootstrap/scans/${id}`);
  return body.scan;
}

export async function listBootstrapItems(scanId: string, status: 'pending' | 'all' = 'all'): Promise<BootstrapReviewItem[]> {
  const body = await apiCall<{ items: BootstrapReviewItem[] }>('GET', `/api/openspec/bootstrap/scans/${scanId}/items?status=${status}`);
  return body.items;
}

export async function approveBootstrapItem(itemId: string): Promise<BootstrapReviewItem> {
  const body = await apiCall<{ item: BootstrapReviewItem }>('POST', `/api/openspec/bootstrap/items/${itemId}/approve`, {});
  return body.item;
}

export async function rejectBootstrapItem(itemId: string): Promise<BootstrapReviewItem> {
  const body = await apiCall<{ item: BootstrapReviewItem }>('POST', `/api/openspec/bootstrap/items/${itemId}/reject`, {});
  return body.item;
}

export async function finalizeBootstrap(scanId: string): Promise<{ scan: BootstrapScan; mergedSummary: Record<string, { modified: number; removed: number }> }> {
  return apiCall('POST', `/api/openspec/bootstrap/scans/${scanId}/finalize`, {});
}
```

> The import path `../../../../../server/...` for `BootstrapScan` types is **bad practice** but the types weren't exported in shared. For G5b leave the dirty path; G6 can promote them to shared. Or inline minimal types — implementer's choice. If you inline, just match the field names.

- [ ] **Step 3: Create `view-state.ts`**

```typescript
// apps/desktop/src/features/openspec/view-state.ts

export type OpenSpecScreen =
  | 'issues'
  | 'feature-detail'
  | 'sub-issue-detail'
  | 'corpus';

export interface OpenSpecViewState {
  screen: OpenSpecScreen;
  /** Currently selected feature (parent) issue. */
  selectedFeatureId?: string;
  /** Currently selected sub-issue. */
  selectedSubIssueId?: string;
  /** Whether the anonymous sub-issues are expanded in the list (default false). */
  anonymousExpanded: boolean;
  /** Filter on issue type chip (null = all). */
  typeFilter?: 'feature' | 'implement' | 'bug' | 'enhancement' | 'chore' | null;
  /** Active artifact tab on SubIssueDetailScreen. */
  activeArtifactTab: 'proposal' | 'design' | 'tasks' | 'delta';
  /** When opened, the delta tab focuses this capability. */
  selectedDeltaCapability?: string;
  /** Show bootstrap dialog. */
  showInitializeSpecs: boolean;
  /** Show new-issue dialog. */
  showNewIssue: boolean;
  /** Show archive confirm dialog (for current sub-issue). */
  showArchiveConfirm: boolean;
}

export const INITIAL_VIEW_STATE: OpenSpecViewState = {
  screen: 'issues',
  anonymousExpanded: false,
  activeArtifactTab: 'proposal',
  showInitializeSpecs: false,
  showNewIssue: false,
  showArchiveConfirm: false,
};
```

- [ ] **Step 4: Create `store.ts`**

```typescript
// apps/desktop/src/features/openspec/store.ts
import { create } from 'zustand';
import type { LocalIssue } from '@my-claudia/shared/features/local-issue';
import type { SpecChange } from '@my-claudia/shared/features/spec-change';
import type { ExecutorInstance } from '@my-claudia/shared/features/executor';
import type { OpenSpecViewState } from './view-state.js';
import { INITIAL_VIEW_STATE } from './view-state.js';
import type { CapabilitySummary } from './api.js';

type ProjectId = string;

interface OpenSpecStore {
  /** All issues for a project (parent features + sub-issues). */
  issuesByProject: Record<ProjectId, LocalIssue[]>;
  /** SpecChanges indexed by id. */
  specChangesById: Record<string, SpecChange>;
  /** Executor instances indexed by specChangeId → list. */
  executorsBySpecChange: Record<string, ExecutorInstance[]>;
  /** Corpus capability summaries per project. */
  corpusByProject: Record<ProjectId, CapabilitySummary[]>;
  /** Per-project view state. */
  viewByProject: Record<ProjectId, OpenSpecViewState>;

  // Issues
  setIssues: (projectId: ProjectId, issues: LocalIssue[]) => void;
  upsertIssue: (issue: LocalIssue) => void;
  // SpecChanges
  setSpecChange: (sc: SpecChange) => void;
  // Executors
  setExecutors: (specChangeId: string, list: ExecutorInstance[]) => void;
  upsertExecutor: (inst: ExecutorInstance) => void;
  // Corpus
  setCorpus: (projectId: ProjectId, items: CapabilitySummary[]) => void;
  // View
  patchView: (projectId: ProjectId, patch: Partial<OpenSpecViewState>) => void;
  // Clear
  clearProject: (projectId: ProjectId) => void;
}

export const useOpenSpecStore = create<OpenSpecStore>((set) => ({
  issuesByProject: {},
  specChangesById: {},
  executorsBySpecChange: {},
  corpusByProject: {},
  viewByProject: {},

  setIssues: (projectId, issues) => set((s) => ({ issuesByProject: { ...s.issuesByProject, [projectId]: issues } })),

  upsertIssue: (issue) => set((s) => {
    const list = s.issuesByProject[issue.projectId] ?? [];
    const idx = list.findIndex((i) => i.id === issue.id);
    const next = idx >= 0 ? [...list.slice(0, idx), issue, ...list.slice(idx + 1)] : [issue, ...list];
    return { issuesByProject: { ...s.issuesByProject, [issue.projectId]: next } };
  }),

  setSpecChange: (sc) => set((s) => ({ specChangesById: { ...s.specChangesById, [sc.id]: sc } })),

  setExecutors: (specChangeId, list) => set((s) => ({ executorsBySpecChange: { ...s.executorsBySpecChange, [specChangeId]: list } })),

  upsertExecutor: (inst) => set((s) => {
    const list = s.executorsBySpecChange[inst.specChangeId] ?? [];
    const idx = list.findIndex((e) => e.id === inst.id);
    const next = idx >= 0 ? [...list.slice(0, idx), inst, ...list.slice(idx + 1)] : [...list, inst];
    return { executorsBySpecChange: { ...s.executorsBySpecChange, [inst.specChangeId]: next } };
  }),

  setCorpus: (projectId, items) => set((s) => ({ corpusByProject: { ...s.corpusByProject, [projectId]: items } })),

  patchView: (projectId, patch) => set((s) => {
    const current = s.viewByProject[projectId] ?? INITIAL_VIEW_STATE;
    return { viewByProject: { ...s.viewByProject, [projectId]: { ...current, ...patch } } };
  }),

  clearProject: (projectId) => set((s) => {
    const { [projectId]: _a, ...issuesRest } = s.issuesByProject; void _a;
    const { [projectId]: _b, ...corpusRest } = s.corpusByProject; void _b;
    const { [projectId]: _c, ...viewRest } = s.viewByProject; void _c;
    return { issuesByProject: issuesRest, corpusByProject: corpusRest, viewByProject: viewRest };
  }),
}));
```

- [ ] **Step 5: Write store tests**

```typescript
// apps/desktop/src/features/openspec/__tests__/store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useOpenSpecStore } from '../store.js';
import { INITIAL_VIEW_STATE } from '../view-state.js';

describe('useOpenSpecStore', () => {
  beforeEach(() => {
    useOpenSpecStore.setState({
      issuesByProject: {}, specChangesById: {}, executorsBySpecChange: {},
      corpusByProject: {}, viewByProject: {},
    });
  });

  it('upsertIssue inserts new at front and replaces in-place on update', () => {
    const s = useOpenSpecStore.getState();
    s.upsertIssue({ id: 'a', projectId: 'p1', title: 'A', status: 'open', priority: 'medium', labels: [], type: 'implement', isAnonymous: false, createdAt: 0, updatedAt: 0 } as never);
    s.upsertIssue({ id: 'b', projectId: 'p1', title: 'B', status: 'open', priority: 'medium', labels: [], type: 'implement', isAnonymous: false, createdAt: 0, updatedAt: 0 } as never);
    expect(useOpenSpecStore.getState().issuesByProject.p1.map((i) => i.id)).toEqual(['b', 'a']);
    s.upsertIssue({ id: 'a', projectId: 'p1', title: 'A2', status: 'planning', priority: 'medium', labels: [], type: 'implement', isAnonymous: false, createdAt: 0, updatedAt: 0 } as never);
    expect(useOpenSpecStore.getState().issuesByProject.p1.find((i) => i.id === 'a')!.status).toBe('planning');
  });

  it('upsertExecutor groups by specChangeId', () => {
    const s = useOpenSpecStore.getState();
    s.upsertExecutor({ id: 'e1', projectId: 'p1', specChangeId: 'sc', type: 'manual', statusSummary: 'pending', createdAt: 0, updatedAt: 0 } as never);
    s.upsertExecutor({ id: 'e2', projectId: 'p1', specChangeId: 'sc', type: 'manual', statusSummary: 'executing', createdAt: 0, updatedAt: 0 } as never);
    expect(useOpenSpecStore.getState().executorsBySpecChange.sc.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('patchView seeds from INITIAL_VIEW_STATE on first patch', () => {
    const s = useOpenSpecStore.getState();
    s.patchView('p1', { screen: 'corpus' });
    const v = useOpenSpecStore.getState().viewByProject.p1;
    expect(v.screen).toBe('corpus');
    expect(v.anonymousExpanded).toBe(INITIAL_VIEW_STATE.anonymousExpanded);
    expect(v.activeArtifactTab).toBe('proposal');
  });

  it('clearProject removes project data', () => {
    const s = useOpenSpecStore.getState();
    s.setIssues('p1', [{ id: 'a' } as never]);
    s.patchView('p1', { screen: 'corpus' });
    s.clearProject('p1');
    expect(useOpenSpecStore.getState().issuesByProject.p1).toBeUndefined();
    expect(useOpenSpecStore.getState().viewByProject.p1).toBeUndefined();
  });
});
```

- [ ] **Step 6: Verify**

```bash
pnpm --filter @my-claudia/desktop exec vitest run src/features/openspec/__tests__/store.test.ts
pnpm --filter @my-claudia/desktop exec tsc --noEmit
```

Expected: 4 tests green, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/features/openspec/api.ts \
        apps/desktop/src/features/openspec/view-state.ts \
        apps/desktop/src/features/openspec/store.ts \
        apps/desktop/src/features/openspec/__tests__/store.test.ts
git commit -m "feat(openspec-ui): API helpers + view-state + Zustand store"
```

---

## Task 2: `OpenSpecPanel` + `IssueListScreen`

**Files:**
- Create: `apps/desktop/src/features/openspec/components/OpenSpecPanel.tsx`
- Create: `apps/desktop/src/features/openspec/components/IssueListScreen.tsx`
- Create: `apps/desktop/src/features/openspec/components/StatusBadge.tsx`
- Create: `apps/desktop/src/features/openspec/__tests__/IssueListScreen.test.tsx`

**Goal:** Top-level panel + issue list. List shows:
- Feature issues (with sub-issue count badge)
- Free-standing implement/bug sub-issues (parentIssueId=null, isAnonymous=false)
- Folded "Anonymous (N)" section that expands on click
- Type filter chips
- "+ New Feature" / "+ New Change" buttons (open NewIssueDialog — wired in Task 6)
- Click row → drill into FeatureIssueDetailScreen or SubIssueDetailScreen (Task 3)

- [ ] **Step 1: Create `StatusBadge.tsx`**

```tsx
// apps/desktop/src/features/openspec/components/StatusBadge.tsx
import React from 'react';
import type { LocalIssueStatus } from '@my-claudia/shared/features/local-issue';
import type { ExecutorStatus } from '@my-claudia/shared/features/executor';

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-secondary text-muted-foreground',
  planning: 'bg-blue-500/10 text-blue-500',
  tasks_ready: 'bg-blue-500/15 text-blue-600',
  executing: 'bg-yellow-500/10 text-yellow-600',
  reviewing: 'bg-orange-500/10 text-orange-500',
  closed: 'bg-green-500/10 text-green-600',
  cancelled: 'bg-red-500/10 text-red-500',
  // executor only:
  pending: 'bg-secondary text-muted-foreground',
  paused: 'bg-yellow-500/10 text-yellow-600',
  completed: 'bg-green-500/10 text-green-600',
  failed: 'bg-red-500/10 text-red-500',
};

export function StatusBadge({ status }: { status: LocalIssueStatus | ExecutorStatus }): React.ReactElement {
  const cls = STATUS_COLORS[status] ?? 'bg-secondary text-muted-foreground';
  return <span className={`px-2 py-0.5 rounded-md text-xs font-mono ${cls}`}>{status}</span>;
}
```

- [ ] **Step 2: Create `IssueListScreen.tsx`**

```tsx
// apps/desktop/src/features/openspec/components/IssueListScreen.tsx
import React, { useEffect, useMemo } from 'react';
import type { LocalIssue, LocalIssueType } from '@my-claudia/shared/features/local-issue';
import { useOpenSpecStore } from '../store.js';
import { listSubIssues, getIssue } from '../api.js';
import { StatusBadge } from './StatusBadge.js';

interface Props {
  projectId: string;
}

const TYPE_CHIPS: { value: LocalIssueType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'feature', label: 'Features' },
  { value: 'implement', label: 'Changes' },
  { value: 'bug', label: 'Bugs' },
  { value: 'enhancement', label: 'Enhancements' },
  { value: 'chore', label: 'Chores' },
];

export function IssueListScreen({ projectId }: Props): React.ReactElement {
  const issues = useOpenSpecStore((s) => s.issuesByProject[projectId] ?? []);
  const view = useOpenSpecStore((s) => s.viewByProject[projectId]);
  const patchView = useOpenSpecStore((s) => s.patchView);

  // Group: top-level (parent features OR sub-issues with no parent) + anonymous fold
  const { topLevel, anonymous } = useMemo(() => {
    const filter = view?.typeFilter;
    const matched = filter && filter !== null && filter !== ('all' as never)
      ? issues.filter((i) => i.type === filter)
      : issues;
    const top: LocalIssue[] = [];
    const anon: LocalIssue[] = [];
    for (const i of matched) {
      if (i.isAnonymous) anon.push(i);
      else if (i.parentIssueId === undefined || i.parentIssueId === null) top.push(i);
      // (sub-issues with a parent are shown inside parent's detail, not here)
    }
    // sort: open issues first, then updated_at desc
    const score = (i: LocalIssue): number => (i.status === 'closed' ? 1 : 0);
    top.sort((a, b) => score(a) - score(b) || b.updatedAt - a.updatedAt);
    return { topLevel: top, anonymous: anon };
  }, [issues, view?.typeFilter]);

  const subCountFor = (parentId: string): number => issues.filter((i) => i.parentIssueId === parentId).length;

  const openIssue = async (issueId: string): Promise<void> => {
    const issue = await getIssue(issueId);
    if (issue.type === 'feature') {
      patchView(projectId, { screen: 'feature-detail', selectedFeatureId: issue.id, selectedSubIssueId: undefined });
    } else {
      patchView(projectId, { screen: 'sub-issue-detail', selectedSubIssueId: issue.id });
    }
  };

  // For G5b, anonymous chip count + drill-in already shows; this hook re-fetches when expanded:
  useEffect(() => {
    void listSubIssues;  // suppress unused-import lint; consumed by detail screens in Task 3
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Issues</h3>
        <div className="flex items-center gap-2">
          <button
            className="px-2.5 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80"
            onClick={() => patchView(projectId, { showNewIssue: true })}
          >
            + New Issue
          </button>
        </div>
      </div>

      {/* Type filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {TYPE_CHIPS.map((c) => {
          const active = (view?.typeFilter ?? 'all') === c.value;
          return (
            <button
              key={c.value}
              className={`px-2 py-0.5 text-xs rounded-md ${
                active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => patchView(projectId, { typeFilter: c.value === 'all' ? null : (c.value as LocalIssueType) })}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Top-level rows */}
      {topLevel.length === 0 && anonymous.length === 0 ? (
        <div className="text-sm text-muted-foreground">No issues yet. Click "+ New Issue" to start.</div>
      ) : (
        <ul className="space-y-2">
          {topLevel.map((i) => (
            <li
              key={i.id}
              className="border border-border rounded-md p-3 bg-card cursor-pointer hover:bg-secondary/30 transition-colors"
              onClick={() => void openIssue(i.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-sm">{i.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {i.type}
                    {i.type === 'feature' && ` · ${subCountFor(i.id)} sub-issue${subCountFor(i.id) === 1 ? '' : 's'}`}
                  </div>
                </div>
                <StatusBadge status={i.status} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Anonymous fold */}
      {anonymous.length > 0 && (
        <div className="border border-border rounded-md bg-muted/30">
          <button
            className="w-full text-left px-3 py-2 text-sm hover:bg-secondary flex items-center justify-between"
            onClick={() => patchView(projectId, { anonymousExpanded: !view?.anonymousExpanded })}
          >
            <span>Anonymous ({anonymous.length})</span>
            <span className="text-xs opacity-60">{view?.anonymousExpanded ? '▾' : '▸'}</span>
          </button>
          {view?.anonymousExpanded && (
            <ul className="border-t border-border divide-y divide-border">
              {anonymous.map((i) => (
                <li
                  key={i.id}
                  className="px-3 py-2 cursor-pointer hover:bg-secondary/30"
                  onClick={() => void openIssue(i.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm">{i.title}</div>
                    <StatusBadge status={i.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `OpenSpecPanel.tsx`**

```tsx
// apps/desktop/src/features/openspec/components/OpenSpecPanel.tsx
import React, { useEffect } from 'react';
import { useOpenSpecStore } from '../store.js';
import { INITIAL_VIEW_STATE } from '../view-state.js';
import { IssueListScreen } from './IssueListScreen.js';

interface Props {
  projectId: string;
}

export function OpenSpecPanel({ projectId }: Props): React.ReactElement {
  const view = useOpenSpecStore((s) => s.viewByProject[projectId] ?? INITIAL_VIEW_STATE);

  useEffect(() => {
    // Initial issue load handled inside IssueListScreen (Task 6 wires this).
  }, [projectId]);

  // Detail screens come in Task 3; for now route only the list + corpus.
  // We add stubs for routes that don't have components yet so we don't blow up.
  if (view.screen === 'feature-detail' || view.screen === 'sub-issue-detail') {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Detail screen (Task 3 stub). selectedFeatureId={String(view.selectedFeatureId)} selectedSubIssueId={String(view.selectedSubIssueId)}
      </div>
    );
  }
  if (view.screen === 'corpus') {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Spec Corpus (Task 5 stub).
      </div>
    );
  }
  return <IssueListScreen projectId={projectId} />;
}
```

- [ ] **Step 4: Write tests**

```tsx
// apps/desktop/src/features/openspec/__tests__/IssueListScreen.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { IssueListScreen } from '../components/IssueListScreen.js';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';

function mkIssue(over: Partial<{ id: string; title: string; type: string; status: string; isAnonymous: boolean; parentIssueId?: string }>) {
  return {
    id: over.id ?? 'i', projectId: 'p1', title: over.title ?? 'T', status: over.status ?? 'open',
    priority: 'medium', labels: [], type: over.type ?? 'implement', isAnonymous: over.isAnonymous ?? false,
    parentIssueId: over.parentIssueId,
    createdAt: 0, updatedAt: 0,
  } as never;
}

describe('IssueListScreen', () => {
  beforeEach(() => {
    useOpenSpecStore.setState({
      issuesByProject: {}, specChangesById: {}, executorsBySpecChange: {},
      corpusByProject: {}, viewByProject: {},
    });
    vi.restoreAllMocks();
  });

  it('renders empty state when no issues', () => {
    render(<IssueListScreen projectId="p1" />);
    expect(screen.getByText(/No issues yet/i)).toBeInTheDocument();
  });

  it('renders a parent feature with sub-issue count', () => {
    useOpenSpecStore.setState({
      issuesByProject: { p1: [
        mkIssue({ id: 'f1', title: 'Add 2FA', type: 'feature' }),
        mkIssue({ id: 's1', title: 'Initial flow', type: 'implement', parentIssueId: 'f1' }),
        mkIssue({ id: 's2', title: 'Bug fix', type: 'bug', parentIssueId: 'f1' }),
      ] },
    } as never);
    render(<IssueListScreen projectId="p1" />);
    expect(screen.getByText('Add 2FA')).toBeInTheDocument();
    expect(screen.getByText(/2 sub-issues/)).toBeInTheDocument();
    // Sub-issues with parent are hidden from top list
    expect(screen.queryByText('Initial flow')).not.toBeInTheDocument();
  });

  it('renders free-standing sub-issue (no parent, not anonymous)', () => {
    useOpenSpecStore.setState({
      issuesByProject: { p1: [mkIssue({ id: 's1', title: 'Quick refactor', type: 'implement' })] },
    } as never);
    render(<IssueListScreen projectId="p1" />);
    expect(screen.getByText('Quick refactor')).toBeInTheDocument();
  });

  it('anonymous issues are folded by default', () => {
    useOpenSpecStore.setState({
      issuesByProject: { p1: [
        mkIssue({ id: 'a1', title: 'Anon 1', isAnonymous: true }),
        mkIssue({ id: 'a2', title: 'Anon 2', isAnonymous: true }),
      ] },
    } as never);
    render(<IssueListScreen projectId="p1" />);
    expect(screen.getByText('Anonymous (2)')).toBeInTheDocument();
    expect(screen.queryByText('Anon 1')).not.toBeInTheDocument();
  });

  it('expands anonymous list on click', () => {
    useOpenSpecStore.setState({
      issuesByProject: { p1: [mkIssue({ id: 'a1', title: 'Anon 1', isAnonymous: true })] },
    } as never);
    render(<IssueListScreen projectId="p1" />);
    fireEvent.click(screen.getByText(/Anonymous \(1\)/));
    expect(screen.getByText('Anon 1')).toBeInTheDocument();
  });

  it('type filter narrows the list', () => {
    useOpenSpecStore.setState({
      issuesByProject: { p1: [
        mkIssue({ id: 'b1', title: 'Bug A', type: 'bug' }),
        mkIssue({ id: 'i1', title: 'Impl A', type: 'implement' }),
      ] },
    } as never);
    render(<IssueListScreen projectId="p1" />);
    fireEvent.click(screen.getByText('Bugs'));
    expect(screen.getByText('Bug A')).toBeInTheDocument();
    expect(screen.queryByText('Impl A')).not.toBeInTheDocument();
  });

  it('clicking a feature row opens feature-detail', async () => {
    useOpenSpecStore.setState({
      issuesByProject: { p1: [mkIssue({ id: 'f1', title: 'F', type: 'feature' })] },
    } as never);
    vi.spyOn(api, 'getIssue').mockResolvedValue(mkIssue({ id: 'f1', title: 'F', type: 'feature' }) as never);
    render(<IssueListScreen projectId="p1" />);
    fireEvent.click(screen.getByText('F'));
    await waitFor(() => {
      const v = useOpenSpecStore.getState().viewByProject.p1;
      expect(v.screen).toBe('feature-detail');
      expect(v.selectedFeatureId).toBe('f1');
    });
  });

  it('clicking a sub-issue row opens sub-issue-detail', async () => {
    useOpenSpecStore.setState({
      issuesByProject: { p1: [mkIssue({ id: 's1', title: 'S', type: 'implement' })] },
    } as never);
    vi.spyOn(api, 'getIssue').mockResolvedValue(mkIssue({ id: 's1', title: 'S', type: 'implement' }) as never);
    render(<IssueListScreen projectId="p1" />);
    fireEvent.click(screen.getByText('S'));
    await waitFor(() => {
      const v = useOpenSpecStore.getState().viewByProject.p1;
      expect(v.screen).toBe('sub-issue-detail');
      expect(v.selectedSubIssueId).toBe('s1');
    });
  });

  it('"+ New Issue" sets showNewIssue=true', () => {
    render(<IssueListScreen projectId="p1" />);
    fireEvent.click(screen.getByText('+ New Issue'));
    expect(useOpenSpecStore.getState().viewByProject.p1.showNewIssue).toBe(true);
  });
});
```

- [ ] **Step 5: Run + verify**

```bash
pnpm --filter @my-claudia/desktop exec vitest run src/features/openspec/__tests__/IssueListScreen.test.tsx
pnpm --filter @my-claudia/desktop exec tsc --noEmit
```

Expected: 9 tests green, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/features/openspec/components/OpenSpecPanel.tsx \
        apps/desktop/src/features/openspec/components/IssueListScreen.tsx \
        apps/desktop/src/features/openspec/components/StatusBadge.tsx \
        apps/desktop/src/features/openspec/__tests__/IssueListScreen.test.tsx
git commit -m "feat(openspec-ui): IssueListScreen with anonymous fold + StatusBadge"
```

---

## Task 3: `FeatureIssueDetailScreen` + `SubIssueDetailScreen`

**Files:**
- Create: `apps/desktop/src/features/openspec/components/FeatureIssueDetailScreen.tsx`
- Create: `apps/desktop/src/features/openspec/components/SubIssueDetailScreen.tsx`
- Modify: `apps/desktop/src/features/openspec/components/OpenSpecPanel.tsx` (route the new screens)

**Goal:**
- `FeatureIssueDetailScreen`: title + sub-issue list with statuses + "Add Sub-Issue" / "Close Feature" buttons + back nav.
- `SubIssueDetailScreen`: title + breadcrumb + status badge + 4 placeholder artifact tabs (filled in Task 4) + executor list (basic — full lifecycle UI in Task 6 if needed; for G5b list + start/cancel/markCompleted is enough) + Close & Archive button.

- [ ] **Step 1: Create `FeatureIssueDetailScreen.tsx`**

```tsx
// apps/desktop/src/features/openspec/components/FeatureIssueDetailScreen.tsx
import React, { useEffect } from 'react';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';
import { StatusBadge } from './StatusBadge.js';

interface Props {
  projectId: string;
  featureId: string;
}

export function FeatureIssueDetailScreen({ projectId, featureId }: Props): React.ReactElement {
  const feature = useOpenSpecStore((s) => (s.issuesByProject[projectId] ?? []).find((i) => i.id === featureId));
  const subIssues = useOpenSpecStore((s) => (s.issuesByProject[projectId] ?? []).filter((i) => i.parentIssueId === featureId));
  const patchView = useOpenSpecStore((s) => s.patchView);
  const upsertIssue = useOpenSpecStore((s) => s.upsertIssue);

  useEffect(() => {
    void api.listSubIssues(featureId).then((list) => list.forEach(upsertIssue)).catch(() => undefined);
  }, [featureId, upsertIssue]);

  if (!feature) {
    return (
      <div className="p-4">
        <button className="text-sm text-primary hover:underline" onClick={() => patchView(projectId, { screen: 'issues', selectedFeatureId: undefined })}>← Back to Issues</button>
        <div className="mt-2 text-sm text-muted-foreground">Feature not found.</div>
      </div>
    );
  }

  const allClosed = subIssues.length > 0 && subIssues.every((i) => i.status === 'closed' || i.status === 'cancelled');

  const onClose = async (): Promise<void> => {
    try {
      const issue = await api.transitionStatus(feature.id, 'closed');
      upsertIssue(issue);
    } catch (e) {
      alert(`Close failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-4">
      <nav className="text-sm text-muted-foreground flex items-center gap-2">
        <button className="text-primary hover:underline" onClick={() => patchView(projectId, { screen: 'issues', selectedFeatureId: undefined })}>
          ← Issues
        </button>
        <span>/</span>
        <span className="font-medium text-foreground">{feature.title}</span>
      </nav>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold">{feature.title}</h3>
          <div className="text-sm text-muted-foreground">feature · {subIssues.length} sub-issue{subIssues.length === 1 ? '' : 's'}</div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={feature.status} />
          {feature.status === 'open' && (
            <button
              className="px-2.5 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80 disabled:opacity-50"
              disabled={!allClosed}
              title={allClosed ? 'Close this feature' : 'All sub-issues must be closed first'}
              onClick={() => void onClose()}
            >
              Close Feature
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Sub-Issues</h4>
        <button
          className="px-2.5 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80"
          onClick={() => patchView(projectId, { showNewIssue: true, selectedFeatureId: feature.id })}
        >
          + Add Sub-Issue
        </button>
      </div>

      {subIssues.length === 0 ? (
        <div className="text-sm text-muted-foreground">No sub-issues yet. Click "+ Add Sub-Issue" to add one.</div>
      ) : (
        <ul className="space-y-2">
          {subIssues.map((s) => (
            <li
              key={s.id}
              className="border border-border rounded-md p-3 bg-card cursor-pointer hover:bg-secondary/30 transition-colors"
              onClick={() => patchView(projectId, { screen: 'sub-issue-detail', selectedSubIssueId: s.id })}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-sm">{s.title}</div>
                  <div className="text-xs text-muted-foreground">{s.type}</div>
                </div>
                <StatusBadge status={s.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `SubIssueDetailScreen.tsx` (artifact-tab body is a stub for Task 4)**

```tsx
// apps/desktop/src/features/openspec/components/SubIssueDetailScreen.tsx
import React, { useEffect, useState } from 'react';
import type { ExecutorInstance } from '@my-claudia/shared/features/executor';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';
import { StatusBadge } from './StatusBadge.js';

interface Props {
  projectId: string;
  subIssueId: string;
}

export function SubIssueDetailScreen({ projectId, subIssueId }: Props): React.ReactElement {
  const issue = useOpenSpecStore((s) => (s.issuesByProject[projectId] ?? []).find((i) => i.id === subIssueId));
  const specChange = useOpenSpecStore((s) => (issue?.specChangeId ? s.specChangesById[issue.specChangeId] : undefined));
  const executors = useOpenSpecStore((s) => (issue?.specChangeId ? (s.executorsBySpecChange[issue.specChangeId] ?? []) : []));
  const patchView = useOpenSpecStore((s) => s.patchView);
  const upsertIssue = useOpenSpecStore((s) => s.upsertIssue);
  const setSpecChange = useOpenSpecStore((s) => s.setSpecChange);
  const setExecutors = useOpenSpecStore((s) => s.setExecutors);
  const upsertExecutor = useOpenSpecStore((s) => s.upsertExecutor);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!issue?.specChangeId) return;
    void api.getSpecChange(issue.specChangeId).then(setSpecChange).catch(() => undefined);
    void api.listExecutors(issue.specChangeId).then((list) => setExecutors(issue.specChangeId!, list)).catch(() => undefined);
  }, [issue?.specChangeId, setSpecChange, setExecutors]);

  if (!issue) {
    return (
      <div className="p-4">
        <button className="text-sm text-primary hover:underline" onClick={() => patchView(projectId, { screen: 'issues', selectedSubIssueId: undefined })}>← Back to Issues</button>
        <div className="mt-2 text-sm text-muted-foreground">Sub-Issue not found.</div>
      </div>
    );
  }

  const onTransition = async (status: 'planning' | 'tasks_ready' | 'executing' | 'reviewing'): Promise<void> => {
    setBusy(`status:${status}`);
    try {
      const updated = await api.transitionStatus(issue.id, status);
      upsertIssue(updated);
    } catch (e) {
      alert(`Transition failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const onCloseAndArchive = (): void => {
    patchView(projectId, { showArchiveConfirm: true });
  };

  const onCreateManualExecutor = async (): Promise<void> => {
    if (!issue.specChangeId) return;
    setBusy('exec-create');
    try {
      const inst = await api.createExecutor({ projectId, specChangeId: issue.specChangeId, type: 'manual' });
      upsertExecutor(inst);
    } catch (e) {
      alert(`Create executor failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const doExecAction = async (inst: ExecutorInstance, fn: (id: string) => Promise<ExecutorInstance>, label: string): Promise<void> => {
    setBusy(`exec:${inst.id}:${label}`);
    try {
      const updated = await fn(inst.id);
      upsertExecutor(updated);
    } catch (e) {
      alert(`${label} failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <nav className="text-sm text-muted-foreground flex items-center gap-2">
        <button className="text-primary hover:underline" onClick={() => patchView(projectId, { screen: 'issues', selectedSubIssueId: undefined })}>← Issues</button>
        {issue.parentIssueId && (
          <>
            <span>/</span>
            <button className="text-primary hover:underline" onClick={() => patchView(projectId, { screen: 'feature-detail', selectedFeatureId: issue.parentIssueId, selectedSubIssueId: undefined })}>
              {issue.parentIssueId.slice(0, 8)}
            </button>
          </>
        )}
        <span>/</span>
        <span className="font-medium text-foreground">{issue.title}</span>
      </nav>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold">{issue.title}</h3>
          <div className="text-sm text-muted-foreground">{issue.type}{issue.isAnonymous ? ' · anonymous' : ''}</div>
        </div>
        <StatusBadge status={issue.status} />
      </div>

      {/* Status transition controls */}
      <div className="flex flex-wrap gap-2">
        {issue.status === 'open' && (
          <button className="px-2.5 py-1 text-xs rounded-md bg-secondary hover:bg-secondary/80" disabled={busy !== null} onClick={() => void onTransition('planning')}>→ planning</button>
        )}
        {issue.status === 'planning' && (
          <button className="px-2.5 py-1 text-xs rounded-md bg-secondary hover:bg-secondary/80" disabled={busy !== null} onClick={() => void onTransition('tasks_ready')}>→ tasks_ready</button>
        )}
        {issue.status === 'tasks_ready' && (
          <button className="px-2.5 py-1 text-xs rounded-md bg-secondary hover:bg-secondary/80" disabled={busy !== null} onClick={() => void onTransition('executing')}>→ executing</button>
        )}
        {issue.status === 'executing' && (
          <button className="px-2.5 py-1 text-xs rounded-md bg-secondary hover:bg-secondary/80" disabled={busy !== null} onClick={() => void onTransition('reviewing')}>→ reviewing</button>
        )}
        {issue.status === 'reviewing' && (
          <button className="px-2.5 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90" disabled={busy !== null} onClick={onCloseAndArchive}>
            Close & Archive
          </button>
        )}
      </div>

      {/* Spec Change artifact tabs (body filled in Task 4) */}
      {specChange && (
        <div className="border border-border rounded-md bg-card">
          <div className="px-3 py-2 border-b border-border text-sm font-medium">
            Spec Change <code className="ml-1 px-1 py-0.5 rounded bg-muted font-mono text-xs">{specChange.slug}</code> · <StatusBadge status={'planning' as never} /> {/* showing spec_change status would need its own badge — left as-is */}
          </div>
          <div className="px-3 py-3 text-sm text-muted-foreground">
            Artifact tabs (proposal / design / tasks / delta) land in Task 4.
          </div>
        </div>
      )}

      {/* Executors */}
      <div className="border border-border rounded-md bg-card">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span className="text-sm font-medium">Executors</span>
          <button className="px-2.5 py-1 text-xs rounded-md bg-secondary hover:bg-secondary/80" onClick={() => void onCreateManualExecutor()}>
            + Manual Executor
          </button>
        </div>
        {executors.length === 0 ? (
          <div className="px-3 py-3 text-sm text-muted-foreground">No executors yet.</div>
        ) : (
          <ul className="divide-y divide-border">
            {executors.map((e) => (
              <li key={e.id} className="px-3 py-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono">{e.type}</span>
                  <span className="text-xs text-muted-foreground">{e.id.slice(0, 8)}</span>
                  <StatusBadge status={e.statusSummary} />
                </div>
                <div className="flex items-center gap-1">
                  {e.statusSummary === 'pending' && <button className="px-2 py-0.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90" disabled={busy !== null} onClick={() => void doExecAction(e, api.startExecutor, 'start')}>Start</button>}
                  {e.statusSummary === 'executing' && e.type === 'manual' && (
                    <button className="px-2 py-0.5 text-xs rounded-md bg-green-500/15 text-green-600 hover:bg-green-500/25" disabled={busy !== null} onClick={() => void doExecAction(e, api.completeExecutor, 'complete')}>Mark Completed</button>
                  )}
                  {(e.statusSummary === 'pending' || e.statusSummary === 'executing' || e.statusSummary === 'paused') && (
                    <button className="px-2 py-0.5 text-xs rounded-md bg-red-500/15 text-red-500 hover:bg-red-500/25" disabled={busy !== null} onClick={() => void doExecAction(e, api.cancelExecutor, 'cancel')}>Cancel</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update `OpenSpecPanel.tsx` to route to detail screens**

Replace the placeholder routing in `OpenSpecPanel.tsx`:

```tsx
import { FeatureIssueDetailScreen } from './FeatureIssueDetailScreen.js';
import { SubIssueDetailScreen } from './SubIssueDetailScreen.js';

// In the render:
if (view.screen === 'feature-detail' && view.selectedFeatureId) {
  return <FeatureIssueDetailScreen projectId={projectId} featureId={view.selectedFeatureId} />;
}
if (view.screen === 'sub-issue-detail' && view.selectedSubIssueId) {
  return <SubIssueDetailScreen projectId={projectId} subIssueId={view.selectedSubIssueId} />;
}
// fall back to IssueListScreen
```

- [ ] **Step 4: Quick smoke test**

Test both new screens render without crashing in a minimal store state. Spot-check one behavior per screen (parent close-feature button disabled state; sub-issue transition button shows for current status).

```tsx
// apps/desktop/src/features/openspec/__tests__/SubIssueDetailScreen.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SubIssueDetailScreen } from '../components/SubIssueDetailScreen.js';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';

function mkIssue(over: Record<string, unknown>) {
  return {
    id: 's', projectId: 'p1', title: 'S', status: 'open', priority: 'medium', labels: [],
    type: 'implement', isAnonymous: false, parentIssueId: undefined, specChangeId: 'sc1',
    createdAt: 0, updatedAt: 0, ...over,
  } as never;
}

describe('SubIssueDetailScreen', () => {
  beforeEach(() => {
    useOpenSpecStore.setState({
      issuesByProject: {}, specChangesById: {}, executorsBySpecChange: {},
      corpusByProject: {}, viewByProject: {},
    });
    vi.restoreAllMocks();
    vi.spyOn(api, 'getSpecChange').mockResolvedValue({ id: 'sc1', slug: 'x', status: 'drafting' } as never);
    vi.spyOn(api, 'listExecutors').mockResolvedValue([]);
  });

  it('renders title + breadcrumb', () => {
    useOpenSpecStore.setState({ issuesByProject: { p1: [mkIssue({ id: 's', title: 'My Change' })] } } as never);
    render(<SubIssueDetailScreen projectId="p1" subIssueId="s" />);
    expect(screen.getByText('My Change')).toBeInTheDocument();
  });

  it('shows "→ planning" button for open issue', () => {
    useOpenSpecStore.setState({ issuesByProject: { p1: [mkIssue({ id: 's', status: 'open' })] } } as never);
    render(<SubIssueDetailScreen projectId="p1" subIssueId="s" />);
    expect(screen.getByRole('button', { name: /→ planning/ })).toBeInTheDocument();
  });

  it('shows Close & Archive when status=reviewing', () => {
    useOpenSpecStore.setState({ issuesByProject: { p1: [mkIssue({ id: 's', status: 'reviewing' })] } } as never);
    render(<SubIssueDetailScreen projectId="p1" subIssueId="s" />);
    expect(screen.getByRole('button', { name: /Close & Archive/ })).toBeInTheDocument();
  });

  it('clicking Close & Archive opens the confirm dialog', () => {
    useOpenSpecStore.setState({ issuesByProject: { p1: [mkIssue({ id: 's', status: 'reviewing' })] } } as never);
    render(<SubIssueDetailScreen projectId="p1" subIssueId="s" />);
    fireEvent.click(screen.getByRole('button', { name: /Close & Archive/ }));
    expect(useOpenSpecStore.getState().viewByProject.p1.showArchiveConfirm).toBe(true);
  });

  it('clicking Manual Executor + button calls createExecutor', async () => {
    useOpenSpecStore.setState({ issuesByProject: { p1: [mkIssue({ id: 's' })] } } as never);
    const spy = vi.spyOn(api, 'createExecutor').mockResolvedValue({ id: 'e1', projectId: 'p1', specChangeId: 'sc1', type: 'manual', statusSummary: 'pending', createdAt: 0, updatedAt: 0 } as never);
    render(<SubIssueDetailScreen projectId="p1" subIssueId="s" />);
    fireEvent.click(screen.getByRole('button', { name: /\+ Manual Executor/ }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
  });
});
```

- [ ] **Step 5: Verify**

```bash
pnpm --filter @my-claudia/desktop exec vitest run src/features/openspec/__tests__/SubIssueDetailScreen.test.tsx
pnpm --filter @my-claudia/desktop exec tsc --noEmit
```

Expected: 5 tests green, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/features/openspec/components/FeatureIssueDetailScreen.tsx \
        apps/desktop/src/features/openspec/components/SubIssueDetailScreen.tsx \
        apps/desktop/src/features/openspec/components/OpenSpecPanel.tsx \
        apps/desktop/src/features/openspec/__tests__/SubIssueDetailScreen.test.tsx
git commit -m "feat(openspec-ui): FeatureIssueDetailScreen + SubIssueDetailScreen"
```

---

## Task 4: SpecChange artifact tabs (proposal / design / tasks / delta)

**Files:**
- Modify: `apps/desktop/src/features/openspec/components/SubIssueDetailScreen.tsx` (replace Task 3 placeholder with real tab bar + editor)

**Goal:** Inside the Spec Change card, render 4 tabs. Each tab loads markdown via the read API, lets the user edit in a `<textarea>`, and saves via the write API. Status badge for spec_change reflects the latest server response.

- [ ] **Step 1: Add `SpecChangeArtifactTabs` sub-component**

Refactor `SubIssueDetailScreen.tsx`'s Spec Change card into a child component:

```tsx
// (still in SubIssueDetailScreen.tsx, near the bottom or extract to its own file)
import { useCallback } from 'react';

interface ArtifactTabsProps {
  projectId: string;
  specChangeId: string;
  capabilitiesInDelta: string[];  // from specChange.deltaSpecPaths parsed for the capability segment
}

function SpecChangeArtifactTabs({ projectId, specChangeId, capabilitiesInDelta }: ArtifactTabsProps): React.ReactElement {
  const activeTab = useOpenSpecStore((s) => s.viewByProject[projectId]?.activeArtifactTab ?? 'proposal');
  const selectedCap = useOpenSpecStore((s) => s.viewByProject[projectId]?.selectedDeltaCapability);
  const patchView = useOpenSpecStore((s) => s.patchView);
  const setSpecChange = useOpenSpecStore((s) => s.setSpecChange);
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capInput, setCapInput] = useState('');

  const load = useCallback(async (): Promise<void> => {
    setLoading(true); setError(null);
    try {
      const text =
        activeTab === 'proposal' ? await api.readProposal(specChangeId)
        : activeTab === 'design'  ? await api.readDesign(specChangeId)
        : activeTab === 'tasks'   ? await api.readTasks(specChangeId)
        : selectedCap             ? await api.readDeltaSpec(specChangeId, selectedCap)
        : '';
      setContent(text);
    } catch (e) {
      setError((e as Error).message);
      setContent('');
    } finally {
      setLoading(false);
    }
  }, [activeTab, selectedCap, specChangeId]);

  useEffect(() => { void load(); }, [load]);

  const save = async (): Promise<void> => {
    setSaving(true); setError(null);
    try {
      const sc =
        activeTab === 'proposal' ? await api.writeProposal(specChangeId, content)
        : activeTab === 'design'  ? await api.writeDesign(specChangeId, content)
        : activeTab === 'tasks'   ? await api.writeTasks(specChangeId, content)
        : selectedCap             ? await api.writeDeltaSpec(specChangeId, selectedCap, content)
        : null;
      if (sc) setSpecChange(sc);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const addNewCapability = async (): Promise<void> => {
    const name = capInput.trim();
    if (!name) return;
    try {
      const sc = await api.writeDeltaSpec(specChangeId, name, '## ADDED Requirements\n');
      setSpecChange(sc);
      patchView(projectId, { activeArtifactTab: 'delta', selectedDeltaCapability: name });
      setCapInput('');
    } catch (e) {
      alert(`Add capability failed: ${(e as Error).message}`);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-1 border-b border-border bg-muted/30 px-3">
        {(['proposal', 'design', 'tasks', 'delta'] as const).map((t) => (
          <button
            key={t}
            className={`px-2.5 py-1.5 text-xs ${activeTab === t ? 'border-b-2 border-primary font-medium' : 'text-muted-foreground'}`}
            onClick={() => patchView(projectId, { activeArtifactTab: t })}
          >
            {t}
          </button>
        ))}
      </div>

      {activeTab === 'delta' && (
        <div className="px-3 py-2 border-b border-border flex items-center gap-2 flex-wrap">
          {capabilitiesInDelta.length === 0 && (
            <span className="text-xs text-muted-foreground">No delta files yet.</span>
          )}
          {capabilitiesInDelta.map((c) => (
            <button
              key={c}
              className={`px-2 py-0.5 text-xs rounded-md ${selectedCap === c ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-secondary/80'}`}
              onClick={() => patchView(projectId, { selectedDeltaCapability: c })}
            >
              {c}
            </button>
          ))}
          <div className="flex items-center gap-1 ml-auto">
            <input
              className="px-2 py-1 text-xs bg-background border border-border rounded-md"
              placeholder="new capability"
              value={capInput}
              onChange={(e) => setCapInput(e.target.value)}
            />
            <button
              className="px-2 py-1 text-xs rounded-md bg-secondary hover:bg-secondary/80"
              onClick={() => void addNewCapability()}
            >
              + Add
            </button>
          </div>
        </div>
      )}

      <div className="p-3 space-y-2">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <>
            <textarea
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono min-h-[240px] focus:outline-none focus:ring-1 focus:ring-primary/50"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
            />
            <div className="flex items-center gap-2">
              <button
                className="px-2.5 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                disabled={saving || (activeTab === 'delta' && !selectedCap)}
                onClick={() => void save()}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                className="px-2.5 py-1 text-xs rounded-md bg-secondary hover:bg-secondary/80"
                onClick={() => void load()}
              >
                Reload
              </button>
              {error && <span className="text-xs text-red-500">Error: {error}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the tabs into `SubIssueDetailScreen.tsx`**

Replace the Task 3 placeholder block:

```tsx
{/* Spec Change artifact tabs */}
{specChange && (
  <div className="border border-border rounded-md bg-card overflow-hidden">
    <div className="px-3 py-2 border-b border-border text-sm font-medium">
      Spec Change <code className="ml-1 px-1 py-0.5 rounded bg-muted font-mono text-xs">{specChange.slug}</code>
    </div>
    <SpecChangeArtifactTabs
      projectId={projectId}
      specChangeId={specChange.id}
      capabilitiesInDelta={(specChange.deltaSpecPaths ?? []).map((p) => p.split('/').slice(-2, -1)[0]).filter(Boolean) as string[]}
    />
  </div>
)}
```

- [ ] **Step 3: Extend the SubIssueDetailScreen test (or add new)**

Add cases:
- "switches between artifact tabs"
- "Save calls writeProposal when on proposal tab"
- "delta tab shows existing capabilities + Add input"

Mock `api.readProposal/Design/Tasks/DeltaSpec` to return canned strings; mock `api.writeProposal` to be a spy. Use `fireEvent.change` on textarea.

- [ ] **Step 4: Verify**

```bash
pnpm --filter @my-claudia/desktop exec vitest run src/features/openspec/__tests__/SubIssueDetailScreen.test.tsx
pnpm --filter @my-claudia/desktop exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/openspec/components/SubIssueDetailScreen.tsx \
        apps/desktop/src/features/openspec/__tests__/SubIssueDetailScreen.test.tsx
git commit -m "feat(openspec-ui): SpecChange artifact tabs (proposal/design/tasks/delta)"
```

---

## Task 5: `SpecCorpusScreen` + `InitializeSpecsDialog` (bootstrap)

**Files:**
- Create: `apps/desktop/src/features/openspec/components/SpecCorpusScreen.tsx`
- Create: `apps/desktop/src/features/openspec/components/InitializeSpecsDialog.tsx`
- Create: `apps/desktop/src/features/openspec/__tests__/SpecCorpusScreen.test.tsx`
- Create: `apps/desktop/src/features/openspec/__tests__/InitializeSpecsDialog.test.tsx`
- Modify: `apps/desktop/src/features/openspec/components/OpenSpecPanel.tsx` (route 'corpus' screen)

**Goal:**
- `SpecCorpusScreen`: list capabilities + counts + "Initialize Specs" / "Re-scan" button. Empty state when corpus is fresh.
- `InitializeSpecsDialog`: triggered by button, runs `POST /bootstrap/scans`, polls for awaiting_review state if `pendingCount > 0`, shows pending items list with approve/reject buttons, finalize button when no pending remain.

- [ ] **Step 1: Create `SpecCorpusScreen.tsx`**

```tsx
// apps/desktop/src/features/openspec/components/SpecCorpusScreen.tsx
import React, { useEffect, useState } from 'react';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';

interface Props {
  projectId: string;
}

export function SpecCorpusScreen({ projectId }: Props): React.ReactElement {
  const corpus = useOpenSpecStore((s) => s.corpusByProject[projectId] ?? []);
  const setCorpus = useOpenSpecStore((s) => s.setCorpus);
  const patchView = useOpenSpecStore((s) => s.patchView);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.listCorpus(projectId).then(setCorpus).catch((e) => setError((e as Error).message)).finally(() => setLoading(false));
    // re-run if projectId changes
  }, [projectId, setCorpus]);

  const isEmpty = corpus.length === 0 && !loading && !error;

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">📚 Spec Corpus</h3>
        <button
          className="px-2.5 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80"
          onClick={() => patchView(projectId, { showInitializeSpecs: true })}
        >
          {isEmpty ? 'Initialize Specs' : 'Re-scan'}
        </button>
      </div>

      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {error && <div className="text-sm text-red-500">Error: {error}</div>}
      {isEmpty && (
        <div className="border border-border rounded-md p-6 bg-muted/30 text-center">
          <div className="text-sm text-muted-foreground">No specs yet.</div>
          <div className="text-xs text-muted-foreground mt-1">Click "Initialize Specs" to scan the project and seed the corpus.</div>
        </div>
      )}
      {corpus.length > 0 && (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {corpus.map((c) => (
            <li key={c.capability} className="border border-border rounded-md p-3 bg-card">
              <div className="font-medium text-sm">{c.capability}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {c.requirementCount} requirement{c.requirementCount === 1 ? '' : 's'} · {c.scenarioCount} scenario{c.scenarioCount === 1 ? '' : 's'}
              </div>
              <div className="text-[10px] text-muted-foreground mt-2">
                Updated {new Date(c.lastUpdatedAt).toLocaleDateString()}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `InitializeSpecsDialog.tsx`**

```tsx
// apps/desktop/src/features/openspec/components/InitializeSpecsDialog.tsx
import React, { useEffect, useState } from 'react';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';

interface Props {
  projectId: string;
  mode: 'initial' | 'rescan';
  onClose: () => void;
}

interface PendingItem { id: string; capability: string; operation: 'modify' | 'remove'; payloadJson: string; status: string }
interface ScanLite { id: string; status: string; appliedCount: number; pendingCount: number }

export function InitializeSpecsDialog({ projectId, mode, onClose }: Props): React.ReactElement {
  const setCorpus = useOpenSpecStore((s) => s.setCorpus);
  const [scan, setScan] = useState<ScanLite | null>(null);
  const [items, setItems] = useState<PendingItem[]>([]);
  const [appliedSummary, setAppliedSummary] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBusy('start');
    api.startBootstrap(projectId, mode)
      .then((res) => {
        setScan(res.scan as never);
        setAppliedSummary(res.appliedSummary);
        if (res.scan.status === 'awaiting_review') {
          return api.listBootstrapItems(res.scan.id, 'pending').then(setItems);
        }
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(null));
  }, [projectId, mode]);

  const onApprove = async (id: string): Promise<void> => {
    setBusy(`approve:${id}`);
    try {
      await api.approveBootstrapItem(id);
      if (scan) setItems(await api.listBootstrapItems(scan.id, 'pending'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onReject = async (id: string): Promise<void> => {
    setBusy(`reject:${id}`);
    try {
      await api.rejectBootstrapItem(id);
      if (scan) setItems(await api.listBootstrapItems(scan.id, 'pending'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onFinalize = async (): Promise<void> => {
    if (!scan) return;
    setBusy('finalize');
    try {
      await api.finalizeBootstrap(scan.id);
      const fresh = await api.listCorpus(projectId);
      setCorpus(projectId, fresh);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-popover border border-border rounded-xl shadow-lg max-w-2xl w-full max-h-[80vh] flex flex-col">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-base font-semibold">{mode === 'initial' ? 'Initialize Specs' : 'Re-scan Specs'}</h3>
          <button className="text-xs text-muted-foreground hover:text-foreground" onClick={onClose}>Close</button>
        </div>

        <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
          {error && <div className="text-sm text-red-500">Error: {error}</div>}

          {!scan && busy === 'start' && (
            <div className="text-sm text-muted-foreground">Scanning project… AI is analyzing the codebase.</div>
          )}

          {scan && (
            <>
              <div className="text-sm">
                <div>Scan status: <span className="font-mono">{scan.status}</span></div>
                <div className="text-muted-foreground text-xs mt-1">
                  Applied {scan.appliedCount} requirement{scan.appliedCount === 1 ? '' : 's'} automatically (ADDED).
                  {scan.pendingCount > 0 && ` ${scan.pendingCount} item${scan.pendingCount === 1 ? '' : 's'} pending review.`}
                </div>
              </div>

              {Object.keys(appliedSummary).length > 0 && (
                <div className="border border-border rounded-md p-3 bg-muted/30 text-xs">
                  <div className="font-medium mb-1">Auto-applied per capability</div>
                  <ul className="space-y-0.5">
                    {Object.entries(appliedSummary).map(([cap, count]) => (
                      <li key={cap}>{cap}: +{count}</li>
                    ))}
                  </ul>
                </div>
              )}

              {items.length > 0 && (
                <div>
                  <div className="text-sm font-medium mb-2">Pending review ({items.length})</div>
                  <ul className="space-y-2">
                    {items.map((it) => {
                      let preview = '';
                      try {
                        const obj = JSON.parse(it.payloadJson) as { name?: string; body?: string };
                        preview = obj.name ? `${obj.name}${obj.body ? ' — ' + obj.body.slice(0, 80) : ''}` : it.payloadJson.slice(0, 120);
                      } catch {
                        preview = it.payloadJson.slice(0, 120);
                      }
                      return (
                        <li key={it.id} className="border border-border rounded-md p-2 bg-card">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs">
                              <span className="font-mono">{it.capability}</span> · <span className="text-muted-foreground">{it.operation}</span>
                            </div>
                            <div className="flex gap-1">
                              <button className="px-2 py-0.5 text-xs rounded-md bg-green-500/15 text-green-600 hover:bg-green-500/25" disabled={busy !== null} onClick={() => void onApprove(it.id)}>Approve</button>
                              <button className="px-2 py-0.5 text-xs rounded-md bg-red-500/15 text-red-500 hover:bg-red-500/25" disabled={busy !== null} onClick={() => void onReject(it.id)}>Reject</button>
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">{preview}</div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          {scan && scan.status === 'awaiting_review' && (
            <button
              className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              disabled={busy !== null || items.length > 0}
              title={items.length > 0 ? 'Resolve all pending items first' : 'Finalize'}
              onClick={() => void onFinalize()}
            >
              Finalize
            </button>
          )}
          {scan && scan.status === 'completed' && (
            <button className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90" onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Route the corpus screen in `OpenSpecPanel.tsx`**

```tsx
import { SpecCorpusScreen } from './SpecCorpusScreen.js';
import { InitializeSpecsDialog } from './InitializeSpecsDialog.js';

// In the render, after the existing routes:
if (view.screen === 'corpus') {
  return (
    <>
      <SpecCorpusScreen projectId={projectId} />
      {view.showInitializeSpecs && (
        <InitializeSpecsDialog
          projectId={projectId}
          mode={(useOpenSpecStore.getState().corpusByProject[projectId]?.length ?? 0) === 0 ? 'initial' : 'rescan'}
          onClose={() => useOpenSpecStore.getState().patchView(projectId, { showInitializeSpecs: false })}
        />
      )}
    </>
  );
}
```

Also add a "Corpus" link in `IssueListScreen.tsx`'s header (next to "+ New Issue"):

```tsx
<button
  className="px-2.5 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80"
  onClick={() => patchView(projectId, { screen: 'corpus' })}
>
  📚 Spec Corpus
</button>
```

- [ ] **Step 4: Write tests**

Two test files, one per component:

```tsx
// apps/desktop/src/features/openspec/__tests__/SpecCorpusScreen.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SpecCorpusScreen } from '../components/SpecCorpusScreen.js';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';

describe('SpecCorpusScreen', () => {
  beforeEach(() => {
    useOpenSpecStore.setState({
      issuesByProject: {}, specChangesById: {}, executorsBySpecChange: {},
      corpusByProject: {}, viewByProject: {},
    });
    vi.restoreAllMocks();
  });

  it('shows Initialize Specs CTA when corpus empty', async () => {
    vi.spyOn(api, 'listCorpus').mockResolvedValue([]);
    render(<SpecCorpusScreen projectId="p1" />);
    await waitFor(() => expect(screen.getByText(/No specs yet/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Initialize Specs/ })).toBeInTheDocument();
  });

  it('lists capabilities with counts', async () => {
    vi.spyOn(api, 'listCorpus').mockResolvedValue([
      { capability: 'auth', requirementCount: 3, scenarioCount: 5, lastUpdatedAt: Date.now() },
      { capability: 'billing', requirementCount: 1, scenarioCount: 2, lastUpdatedAt: Date.now() },
    ]);
    render(<SpecCorpusScreen projectId="p1" />);
    await waitFor(() => expect(screen.getByText('auth')).toBeInTheDocument());
    expect(screen.getByText('billing')).toBeInTheDocument();
    expect(screen.getByText('3 requirements · 5 scenarios')).toBeInTheDocument();
  });

  it('Re-scan button when corpus non-empty', async () => {
    vi.spyOn(api, 'listCorpus').mockResolvedValue([{ capability: 'auth', requirementCount: 1, scenarioCount: 1, lastUpdatedAt: 0 }]);
    render(<SpecCorpusScreen projectId="p1" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Re-scan/ })).toBeInTheDocument());
  });

  it('clicking Initialize Specs sets showInitializeSpecs=true', async () => {
    vi.spyOn(api, 'listCorpus').mockResolvedValue([]);
    render(<SpecCorpusScreen projectId="p1" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Initialize Specs/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Initialize Specs/ }));
    expect(useOpenSpecStore.getState().viewByProject.p1.showInitializeSpecs).toBe(true);
  });
});
```

```tsx
// apps/desktop/src/features/openspec/__tests__/InitializeSpecsDialog.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InitializeSpecsDialog } from '../components/InitializeSpecsDialog.js';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';

describe('InitializeSpecsDialog', () => {
  beforeEach(() => {
    useOpenSpecStore.setState({
      issuesByProject: {}, specChangesById: {}, executorsBySpecChange: {},
      corpusByProject: {}, viewByProject: {},
    });
    vi.restoreAllMocks();
  });

  it('starts the scan on mount and shows the auto-applied summary', async () => {
    vi.spyOn(api, 'startBootstrap').mockResolvedValue({
      scan: { id: 's1', status: 'completed', appliedCount: 2, pendingCount: 0 } as never,
      appliedSummary: { auth: 1, billing: 1 },
      pendingSummary: {},
    });
    render(<InitializeSpecsDialog projectId="p1" mode="initial" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Scan status:/)).toBeInTheDocument());
    expect(screen.getByText(/Applied 2 requirements/)).toBeInTheDocument();
    expect(screen.getByText('auth: +1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('shows pending items when scan returns awaiting_review and allows approve', async () => {
    vi.spyOn(api, 'startBootstrap').mockResolvedValue({
      scan: { id: 's1', status: 'awaiting_review', appliedCount: 1, pendingCount: 2 } as never,
      appliedSummary: { auth: 1 },
      pendingSummary: { auth: { modified: 1, removed: 1 } },
    });
    const items = [
      { id: 'it1', capability: 'auth', operation: 'modify' as const, payloadJson: JSON.stringify({ name: 'Login', body: 'MUST do new' }), status: 'pending' },
      { id: 'it2', capability: 'auth', operation: 'remove' as const, payloadJson: JSON.stringify({ name: 'Legacy' }), status: 'pending' },
    ];
    const listSpy = vi.spyOn(api, 'listBootstrapItems').mockResolvedValueOnce(items as never).mockResolvedValueOnce([items[1]] as never);
    const approveSpy = vi.spyOn(api, 'approveBootstrapItem').mockResolvedValue({ ...items[0], status: 'approved' } as never);
    render(<InitializeSpecsDialog projectId="p1" mode="rescan" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Pending review/)).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: 'Approve' })[0]);
    await waitFor(() => expect(approveSpy).toHaveBeenCalledWith('it1'));
    expect(listSpy).toHaveBeenCalled();
  });

  it('Finalize is disabled while pending items remain', async () => {
    vi.spyOn(api, 'startBootstrap').mockResolvedValue({
      scan: { id: 's1', status: 'awaiting_review', appliedCount: 0, pendingCount: 1 } as never,
      appliedSummary: {},
      pendingSummary: { auth: { modified: 1, removed: 0 } },
    });
    vi.spyOn(api, 'listBootstrapItems').mockResolvedValue([
      { id: 'it1', capability: 'auth', operation: 'modify', payloadJson: '{}', status: 'pending' },
    ] as never);
    render(<InitializeSpecsDialog projectId="p1" mode="rescan" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Finalize' })).toBeDisabled());
  });

  it('Finalize calls api.finalizeBootstrap when all items resolved and refreshes corpus', async () => {
    vi.spyOn(api, 'startBootstrap').mockResolvedValue({
      scan: { id: 's1', status: 'awaiting_review', appliedCount: 0, pendingCount: 0 } as never,
      appliedSummary: {},
      pendingSummary: {},
    });
    vi.spyOn(api, 'listBootstrapItems').mockResolvedValue([] as never);
    const finalizeSpy = vi.spyOn(api, 'finalizeBootstrap').mockResolvedValue({ scan: { id: 's1', status: 'completed' } as never, mergedSummary: {} });
    vi.spyOn(api, 'listCorpus').mockResolvedValue([] as never);
    const onClose = vi.fn();
    render(<InitializeSpecsDialog projectId="p1" mode="rescan" onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Finalize' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Finalize' }));
    await waitFor(() => expect(finalizeSpy).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
```

- [ ] **Step 5: Run + verify**

```bash
pnpm --filter @my-claudia/desktop exec vitest run src/features/openspec/__tests__/SpecCorpusScreen.test.tsx src/features/openspec/__tests__/InitializeSpecsDialog.test.tsx
pnpm --filter @my-claudia/desktop exec tsc --noEmit
```

Expected: 4 + 4 = 8 tests green, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/features/openspec/components/SpecCorpusScreen.tsx \
        apps/desktop/src/features/openspec/components/InitializeSpecsDialog.tsx \
        apps/desktop/src/features/openspec/components/OpenSpecPanel.tsx \
        apps/desktop/src/features/openspec/components/IssueListScreen.tsx \
        apps/desktop/src/features/openspec/__tests__/SpecCorpusScreen.test.tsx \
        apps/desktop/src/features/openspec/__tests__/InitializeSpecsDialog.test.tsx
git commit -m "feat(openspec-ui): SpecCorpusScreen + InitializeSpecsDialog (bootstrap)"
```

---

## Task 6: `NewIssueDialog` + `ArchiveConfirmDialog`

**Files:**
- Create: `apps/desktop/src/features/openspec/components/NewIssueDialog.tsx`
- Create: `apps/desktop/src/features/openspec/components/ArchiveConfirmDialog.tsx`
- Create: `apps/desktop/src/features/openspec/__tests__/NewIssueDialog.test.tsx`
- Modify: `apps/desktop/src/features/openspec/components/OpenSpecPanel.tsx` (render dialogs based on view-state flags)

**Goal:**
- `NewIssueDialog`: form with title + type radio (feature / implement / bug / enhancement / chore) + optional parent (if creating sub under existing feature). On submit:
  - type=feature → `createFeature(...)`
  - type≠feature + parentIssueId → `createSubIssue(...)`
  - type≠feature + no parent → `createSubIssue(...)` with no parent (standalone)
  Result is `upsertIssue`'d into store + dialog closes.
- `ArchiveConfirmDialog`: shows current sub-issue + delta paths preview, "Cancel" + "Close & Archive" buttons. On confirm calls `closeAndArchive`, updates issue, closes dialog.

- [ ] **Step 1: Create `NewIssueDialog.tsx`**

```tsx
// apps/desktop/src/features/openspec/components/NewIssueDialog.tsx
import React, { useState } from 'react';
import type { LocalIssueType } from '@my-claudia/shared/features/local-issue';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';

interface Props {
  projectId: string;
  /** Pre-fills parentIssueId — if set, the type is forced to non-feature. */
  parentFeatureId?: string;
  onClose: () => void;
}

const SUB_TYPES: { value: Exclude<LocalIssueType, 'feature'>; label: string }[] = [
  { value: 'implement', label: 'Implement' },
  { value: 'bug', label: 'Bug' },
  { value: 'enhancement', label: 'Enhancement' },
  { value: 'chore', label: 'Chore' },
];

export function NewIssueDialog({ projectId, parentFeatureId, onClose }: Props): React.ReactElement {
  const upsertIssue = useOpenSpecStore((s) => s.upsertIssue);
  const setSpecChange = useOpenSpecStore((s) => s.setSpecChange);
  const [type, setType] = useState<LocalIssueType>(parentFeatureId ? 'implement' : 'feature');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (): Promise<void> => {
    if (!title.trim()) return;
    setBusy(true); setError(null);
    try {
      if (type === 'feature') {
        const issue = await api.createFeature({ projectId, title: title.trim() });
        upsertIssue(issue);
      } else {
        const { issue, specChange } = await api.createSubIssue({
          projectId, type, title: title.trim(), parentIssueId: parentFeatureId,
        });
        upsertIssue(issue);
        setSpecChange(specChange);
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-popover border border-border rounded-xl shadow-lg max-w-md w-full">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-base font-semibold">New Issue</h3>
        </div>
        <div className="px-4 py-3 space-y-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Type</label>
            {parentFeatureId ? (
              <select
                className="w-full bg-background border border-border rounded-md px-2 py-1 text-sm"
                value={type as string}
                onChange={(e) => setType(e.target.value as LocalIssueType)}
              >
                {SUB_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            ) : (
              <select
                className="w-full bg-background border border-border rounded-md px-2 py-1 text-sm"
                value={type as string}
                onChange={(e) => setType(e.target.value as LocalIssueType)}
              >
                <option value="feature">Feature (organizational container)</option>
                {SUB_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label} (standalone)</option>)}
              </select>
            )}
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Title</label>
            <input
              type="text"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={type === 'feature' ? 'Feature title' : 'Change title'}
              autoFocus
            />
          </div>
          {error && <div className="text-xs text-red-500">Error: {error}</div>}
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          <button className="px-3 py-1.5 text-sm rounded-md bg-secondary hover:bg-secondary/80" onClick={onClose}>Cancel</button>
          <button
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled={busy || !title.trim()}
            onClick={() => void onSubmit()}
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `ArchiveConfirmDialog.tsx`**

```tsx
// apps/desktop/src/features/openspec/components/ArchiveConfirmDialog.tsx
import React, { useState } from 'react';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';

interface Props {
  projectId: string;
  subIssueId: string;
  onClose: () => void;
}

export function ArchiveConfirmDialog({ projectId, subIssueId, onClose }: Props): React.ReactElement {
  const issue = useOpenSpecStore((s) => (s.issuesByProject[projectId] ?? []).find((i) => i.id === subIssueId));
  const specChange = useOpenSpecStore((s) => (issue?.specChangeId ? s.specChangesById[issue.specChangeId] : undefined));
  const upsertIssue = useOpenSpecStore((s) => s.upsertIssue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<unknown | null>(null);

  const deltaCaps = (specChange?.deltaSpecPaths ?? []).map((p) => p.split('/').slice(-2, -1)[0]).filter(Boolean) as string[];

  const onConfirm = async (): Promise<void> => {
    setBusy(true); setError(null);
    try {
      const res = await api.closeAndArchive(subIssueId);
      upsertIssue(res.issue);
      setResult(res.archive ?? { ok: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-popover border border-border rounded-xl shadow-lg max-w-lg w-full">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-base font-semibold">Close & Archive Sub-Issue</h3>
        </div>
        <div className="px-4 py-3 space-y-3 text-sm">
          {issue ? (
            <>
              <div>Closing <span className="font-medium">{issue.title}</span> will:</div>
              <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
                <li>Validate {deltaCaps.length} delta capabilities: {deltaCaps.length === 0 ? '(none)' : deltaCaps.map((c) => <code key={c} className="mx-0.5 px-1 py-0.5 rounded bg-muted font-mono text-xs">{c}</code>)}</li>
                <li>Merge those deltas into <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs">openspec/specs/</code></li>
                <li>Move <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs">openspec/changes/{specChange?.slug ?? '?'}/</code> to <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs">archive/</code></li>
              </ul>
              {error && <div className="text-xs text-red-500">Error: {error}</div>}
              {result !== null && (
                <div className="text-xs text-green-600">Archive complete.</div>
              )}
            </>
          ) : (
            <div className="text-muted-foreground">Issue not found.</div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          <button className="px-3 py-1.5 text-sm rounded-md bg-secondary hover:bg-secondary/80" onClick={onClose}>
            {result !== null ? 'Done' : 'Cancel'}
          </button>
          {result === null && (
            <button
              className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              disabled={busy || !issue}
              onClick={() => void onConfirm()}
            >
              {busy ? 'Archiving…' : 'Close & Archive'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire dialogs into `OpenSpecPanel.tsx`**

Render the dialogs from the panel root so they overlay every screen:

```tsx
import { NewIssueDialog } from './NewIssueDialog.js';
import { ArchiveConfirmDialog } from './ArchiveConfirmDialog.js';

// At the bottom of the component, before the final return:
const dialogs = (
  <>
    {view.showNewIssue && (
      <NewIssueDialog
        projectId={projectId}
        parentFeatureId={view.selectedFeatureId}
        onClose={() => patchView(projectId, { showNewIssue: false, selectedFeatureId: undefined })}
      />
    )}
    {view.showArchiveConfirm && view.selectedSubIssueId && (
      <ArchiveConfirmDialog
        projectId={projectId}
        subIssueId={view.selectedSubIssueId}
        onClose={() => patchView(projectId, { showArchiveConfirm: false })}
      />
    )}
  </>
);

// Wrap each screen return: `return <>{screenJsx}{dialogs}</>;`
```

> `patchView` needs to be looked up here. Modify the `OpenSpecPanel` body to read it via `useOpenSpecStore`.

- [ ] **Step 4: Tests**

```tsx
// apps/desktop/src/features/openspec/__tests__/NewIssueDialog.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NewIssueDialog } from '../components/NewIssueDialog.js';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';

describe('NewIssueDialog', () => {
  beforeEach(() => {
    useOpenSpecStore.setState({
      issuesByProject: {}, specChangesById: {}, executorsBySpecChange: {},
      corpusByProject: {}, viewByProject: {},
    });
    vi.restoreAllMocks();
  });

  it('defaults to feature when no parentFeatureId', () => {
    render(<NewIssueDialog projectId="p1" onClose={() => {}} />);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('feature');
  });

  it('defaults to implement and hides feature option when parentFeatureId given', () => {
    render(<NewIssueDialog projectId="p1" parentFeatureId="f1" onClose={() => {}} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('implement');
    expect(Array.from(select.options).map((o) => o.value)).not.toContain('feature');
  });

  it('submits feature → calls createFeature + upserts + closes', async () => {
    const onClose = vi.fn();
    const createSpy = vi.spyOn(api, 'createFeature').mockResolvedValue({ id: 'f1', projectId: 'p1', title: 'My Feature', type: 'feature', status: 'open' } as never);
    render(<NewIssueDialog projectId="p1" onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('Feature title'), { target: { value: 'My Feature' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledWith({ projectId: 'p1', title: 'My Feature' }));
    expect(onClose).toHaveBeenCalled();
    expect(useOpenSpecStore.getState().issuesByProject.p1).toBeDefined();
  });

  it('submits sub-issue → calls createSubIssue and stores spec_change', async () => {
    const onClose = vi.fn();
    const createSpy = vi.spyOn(api, 'createSubIssue').mockResolvedValue({
      issue: { id: 's1', projectId: 'p1', type: 'bug', title: 'B', status: 'open' } as never,
      specChange: { id: 'sc1', projectId: 'p1', subIssueId: 's1', slug: 'b', title: 'B', status: 'drafting', deltaSpecPaths: [] } as never,
    });
    render(<NewIssueDialog projectId="p1" parentFeatureId="f1" onClose={onClose} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bug' } });
    fireEvent.change(screen.getByPlaceholderText('Change title'), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledWith({ projectId: 'p1', type: 'bug', title: 'B', parentIssueId: 'f1' }));
    expect(useOpenSpecStore.getState().specChangesById.sc1).toBeDefined();
  });

  it('Create button is disabled when title empty', () => {
    render(<NewIssueDialog projectId="p1" onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });

  it('shows error and stays open on failure', async () => {
    vi.spyOn(api, 'createFeature').mockRejectedValue(new Error('boom'));
    const onClose = vi.fn();
    render(<NewIssueDialog projectId="p1" onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('Feature title'), { target: { value: 'F' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(screen.getByText(/Error: boom/)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Verify**

```bash
pnpm --filter @my-claudia/desktop exec vitest run src/features/openspec/__tests__/NewIssueDialog.test.tsx
pnpm --filter @my-claudia/desktop exec tsc --noEmit
```

Expected: 5 tests green, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/features/openspec/components/NewIssueDialog.tsx \
        apps/desktop/src/features/openspec/components/ArchiveConfirmDialog.tsx \
        apps/desktop/src/features/openspec/components/OpenSpecPanel.tsx \
        apps/desktop/src/features/openspec/__tests__/NewIssueDialog.test.tsx
git commit -m "feat(openspec-ui): NewIssueDialog + ArchiveConfirmDialog wired into panel"
```

---

## Task 7: Mount tab + bootstrap data load + smoke + tag

**Files:**
- Modify: `apps/desktop/src/features/openspec/components/IssueListScreen.tsx` (load issues on mount)
- Modify: `apps/desktop/src/features/supervision/components/SupervisorWorkspacePanel.tsx` (add 'openspec' tab)

**Goal:** OpenSpec lives in Supervisor as a 3rd tab. Issues load on mount. Build + tests + tag.

- [ ] **Step 1: Make `IssueListScreen` load issues**

Add inside the component:

```tsx
import { useEffect } from 'react';
import { listSubIssues } from '../api.js';
// (file already has useOpenSpecStore, etc.)

// Load all top-level + sub-issues for the project. Since we have no
// list-by-project endpoint, we fetch by fanout: GET /api/issues isn't built
// (G5b deferred); instead we rely on cache + per-issue fetches. For first
// landing, we leave the list empty until users create issues OR open Spec
// Corpus (which navigates here after init). Track this gap as a G6 todo.

// Add the unused-import guard or remove if the lint blocks compilation:
useEffect(() => {
  // List-by-project endpoint not yet built (G6). Cache populated by
  // create-issue actions + drill-in fetches.
  void listSubIssues;  // keeps the import legal until G6
}, []);
```

> **Note**: We deliberately do NOT add a `GET /api/issues?projectId=...` endpoint in G5b — the issue list is built up lazily through user actions in the current cache. G6 can add the list endpoint + auto-load. Document this as a known shortcoming in the Acceptance section.

- [ ] **Step 2: Add 'openspec' tab to SupervisorWorkspacePanel**

In `apps/desktop/src/features/supervision/components/SupervisorWorkspacePanel.tsx`:

```tsx
import { OpenSpecPanel } from '../../openspec/components/OpenSpecPanel.js';

// Find: const [activeTab, setActiveTab] = useState<'classic' | 'meta'>('classic');
// Replace with:
const [activeTab, setActiveTab] = useState<'classic' | 'meta' | 'openspec'>('classic');

// Find the tab bar (look for "Meta Workflow" button). After it, add:
<button
  className={`px-3 py-1 text-sm ${activeTab === 'openspec' ? 'border-b-2 border-blue-600 font-medium' : 'text-muted-foreground'}`}
  onClick={() => setActiveTab('openspec')}
>
  OpenSpec
</button>

// In the activeTab branches at the bottom, add the OpenSpec case:
{activeTab === 'openspec' ? (
  <div className="flex-1 overflow-auto p-4">
    <OpenSpecPanel projectId={projectId} />
  </div>
) : activeTab === 'classic' ? (
  // ... existing classic branch
) : (
  // ... existing meta branch
)}
```

- [ ] **Step 3: Build all packages**

```bash
pnpm --filter @my-claudia/server exec tsc --noEmit
pnpm --filter @my-claudia/desktop exec tsc --noEmit
pnpm build
```

Expected: all packages clean.

- [ ] **Step 4: Full desktop tests**

```bash
pnpm --filter @my-claudia/desktop exec vitest run
```

Expected: existing tests still pass; G5b adds ~35 tests across the 6 files.

- [ ] **Step 5: Smoke (manual)**

Since this is the first UI in OpenSpec, automated smoke is limited. Steps to run manually:

```bash
# Start everything
pnpm dev:isolated  # if you have the isolated dev recipe, else pnpm dev
```

Then in the desktop app:
1. Navigate to a project with a configured `rootPath`
2. Open Supervisor → click "OpenSpec" tab
3. Click "+ New Issue" → create a feature
4. Click the feature → "+ Add Sub-Issue" → create an implement
5. Drill into the sub-issue → see SpecChange tabs + Executors section
6. Click "+ Manual Executor" → "Start" → "Mark Completed"
7. Step the sub-issue through planning → tasks_ready → executing → reviewing
8. Click "Close & Archive" → confirm → corpus updates
9. Click "📚 Spec Corpus" → see the new capability

If all 9 steps work without console errors, smoke passes.

- [ ] **Step 6: Commit + tag**

```bash
git add apps/desktop/src/features/openspec/components/IssueListScreen.tsx \
        apps/desktop/src/features/supervision/components/SupervisorWorkspacePanel.tsx
git commit -m "feat(openspec-ui): mount OpenSpec tab in SupervisorWorkspacePanel"
git tag -a openspec/phase-g5b-complete -m "OpenSpec × Supervisor Phase G5b desktop UI landed"
```

---

## Phase G5b Acceptance Criteria

- [ ] All 7 tasks complete with individual commits.
- [ ] `pnpm build` passes (both server + desktop).
- [ ] Desktop vitest green (~35 new tests).
- [ ] Manual smoke walks the full 9-step flow without console errors.
- [ ] Tag `openspec/phase-g5b-complete` exists.

---

## What Phase G5b Deliberately Does NOT Cover

| Item | Phase |
|------|-------|
| `GET /api/issues?projectId=...` list endpoint (cache is built lazily) | G6 |
| Real-time push (WebSocket) for executor/issue status changes | G6 |
| Markdown preview side-by-side with editor | G6 |
| Drag-drop for issue reordering | G6 |
| Search / filter beyond type chips | G6 |
| Inline diff view for delta files (currently raw textarea) | G6 |
| AI prompt fine-tuning | G6 |

---

*Plan version: 1 / 2026-05-22*
*Design reference: `docs/design/openspec-integration-v2.zh-CN.md` §10*
*Predecessors: G5a (`openspec/phase-g5a-complete`)*
