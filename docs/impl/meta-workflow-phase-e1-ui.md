# Meta Workflow — Phase E1: Desktop UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the full desktop UI for Meta Workflow: a `meta-workflow` feature module under `apps/desktop/src/features/` with store/handlers/api/components, 5 main screens (Requirements / PhaseGraph / PhaseBoard / PhaseDetail / Promotion), a "New ▾" dropdown integration in the Supervisor entry, and WebSocket handler registration. Phase A-D's HTTP routes + 10 WS message types are the backend contract.

**Architecture:** Pure React + Zustand following the existing `supervision` / `workflows` feature module patterns. State is keyed by `projectId`; WebSocket handlers dispatch into the store via direct `useMetaWorkflowStore.getState().upsertXxx()` calls (matching the existing convention). HTTP API uses the project's `apiCall` / `apiCallForBackend` helpers. PhaseGraphScreen reuses `@xyflow/react` (already in workspace, used by WorkflowGraphEditor). No Tauri invokes — pure web UI.

**Tech Stack:** TypeScript, React 19 (per workspace), Zustand, @xyflow/react (graph), Vite (dev), Vitest (tests). No new external dependencies.

**Spec reference:** `docs/design/supervisor-meta-workflow.zh-CN.md` (sections §UX 用户旅程, §UI 5 个屏, §产品定位 — Supervisor 入口下拉菜单).

**Phase A-D references:**
- A: `docs/impl/meta-workflow-phase-a-foundation.md` (shared types + schema)
- B: `docs/impl/meta-workflow-phase-b-core-domain.md` (aggregates + executor)
- C: `docs/impl/meta-workflow-phase-c-reuse-and-runtime.md` (service + routes + 6 CRUD messages)
- D: `docs/impl/meta-workflow-phase-d-production-and-stale.md` (bootstrap mounted + 4 stale messages + artifact + propagator)
- Latest tag: `meta-workflow/phase-d-complete`

---

## File Structure

```
apps/desktop/src/features/meta-workflow/                       NEW (entire feature)
├── index.ts                                                   NEW (exports)
├── api.ts                                                     NEW (HTTP + WS senders)
├── store.ts                                                   NEW (Zustand store)
├── handlers.ts                                                NEW (WS message dispatch)
├── view-state.ts                                              NEW (screen routing state)
└── components/
    ├── MetaWorkflowPanel.tsx                                  NEW (top-level container)
    ├── RequirementsScreen.tsx                                 NEW
    ├── PhaseGraphScreen.tsx                                   NEW
    ├── PhaseBoardScreen.tsx                                   NEW
    ├── PhaseCard.tsx                                          NEW
    ├── PhaseDetailScreen.tsx                                  NEW
    ├── PromotionDialog.tsx                                    NEW
    └── NewRunDropdown.tsx                                     NEW (dropdown menu, used by SupervisorWorkspacePanel)

apps/desktop/src/features/message-dispatcher.ts                MODIFY (register meta-workflow handler)
apps/desktop/src/features/supervision/components/
└── SupervisorWorkspacePanel.tsx                               MODIFY (mount NewRunDropdown + MetaWorkflowPanel)
```

14 tasks total. Two clusters:

```
Cluster A — Module scaffolding (Tasks 1-5)
  T1 view-state ─ independent
  T2 store     ─ needs T1 (uses view-state types)
  T3 api       ─ needs none (pure HTTP/WS helpers)
  T4 handlers  ─ needs T2 (calls store actions)
  T5 dispatcher registration ─ needs T4

Cluster B — Components (Tasks 6-13)
  T6 MetaWorkflowPanel container — needs T2 T3 T4
  T7 RequirementsScreen ─ needs T6
  T8 PhaseBoardScreen + PhaseCard ─ needs T6
  T9 PhaseGraphScreen ─ needs T6, @xyflow/react patterns from WorkflowGraphEditor
  T10 PhaseDetailScreen ─ needs T6
  T11 PromotionDialog ─ needs T6
  T12 NewRunDropdown + SupervisorWorkspacePanel integration ─ needs T6
  T13 index.ts export

Cluster C — Smoke (Task 14)
  T14 build + dev server visual verification + tag
```

---

## Task 1: view-state.ts (screen routing types)

**Files:**
- Create: `apps/desktop/src/features/meta-workflow/view-state.ts`

Pure type module — what screen is shown, what run/phase is selected. No Zustand here yet.

- [ ] **Step 1: Create the file**

```typescript
// apps/desktop/src/features/meta-workflow/view-state.ts

/**
 * The 5 screens a user can be on within a Meta Workflow Run.
 * Plus 'list' for the top-level "all runs in this project" view.
 */
export type MetaWorkflowScreen =
  | 'list'             // runs list (default for a project with no active run)
  | 'requirements'     // requirements dialog + approve/reject/challenge
  | 'phase-graph'      // phasesJson visualization + edit
  | 'phase-board'      // phase cards grid
  | 'phase-detail'     // single-phase drilldown
  | 'promotion';       // promotion dialog (modal over board)

export interface MetaWorkflowViewState {
  screen: MetaWorkflowScreen;
  selectedRunId?: string;
  selectedPhaseId?: string;
  /** When the user opens a promotion dialog, this holds the pool item id. */
  promotingPoolItemId?: string;
}

export const INITIAL_VIEW_STATE: MetaWorkflowViewState = {
  screen: 'list',
};
```

- [ ] **Step 2: tsc check**

Run: `pnpm --filter @my-claudia/desktop exec tsc --noEmit`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/features/meta-workflow/view-state.ts
git commit -m "feat(meta-workflow-ui): add view-state types for 5 screens"
```

---

## Task 2: store.ts (Zustand store)

**Files:**
- Create: `apps/desktop/src/features/meta-workflow/store.ts`

State + actions mirror the supervision/workflows store patterns.

- [ ] **Step 1: Create the file**

```typescript
// apps/desktop/src/features/meta-workflow/store.ts
import { create } from 'zustand';
import type {
  MetaWorkflowRun,
  MetaWorkflowPhase,
  ReusablePoolItem,
} from '@my-claudia/shared/features/meta-workflow';
import type { MetaWorkflowViewState } from './view-state.js';
import { INITIAL_VIEW_STATE } from './view-state.js';

type ProjectId = string;
type RunId = string;

interface MetaWorkflowStore {
  /** runs keyed by projectId */
  runs: Record<ProjectId, MetaWorkflowRun[]>;
  /** phases keyed by runId */
  phases: Record<RunId, MetaWorkflowPhase[]>;
  /** last impact recommendation per (runId, phaseId) */
  recommendations: Record<string, { runId: string; phaseId: string; kind: string; reason: string }>;
  /** view state per projectId so switching projects preserves position */
  viewByProject: Record<ProjectId, MetaWorkflowViewState>;

  // Actions — HTTP/WS handlers call these directly via getState()
  setRuns: (projectId: ProjectId, runs: MetaWorkflowRun[]) => void;
  upsertRun: (run: MetaWorkflowRun) => void;
  setPhases: (runId: RunId, phases: MetaWorkflowPhase[]) => void;
  upsertPhase: (runId: RunId, phase: MetaWorkflowPhase) => void;
  recordRecommendation: (runId: RunId, phaseId: string, rec: { kind: string; reason: string }) => void;
  // View
  setView: (projectId: ProjectId, view: MetaWorkflowViewState) => void;
  patchView: (projectId: ProjectId, patch: Partial<MetaWorkflowViewState>) => void;
  // Clear (e.g., when project changes)
  clearProject: (projectId: ProjectId) => void;
}

function recKey(runId: string, phaseId: string): string {
  return `${runId}:${phaseId}`;
}

export const useMetaWorkflowStore = create<MetaWorkflowStore>((set, get) => ({
  runs: {},
  phases: {},
  recommendations: {},
  viewByProject: {},

  setRuns: (projectId, runs) => {
    set((state) => ({ runs: { ...state.runs, [projectId]: runs } }));
  },

  upsertRun: (run) => {
    set((state) => {
      const list = state.runs[run.projectId] ?? [];
      const idx = list.findIndex((r) => r.id === run.id);
      const next = idx >= 0
        ? [...list.slice(0, idx), run, ...list.slice(idx + 1)]
        : [run, ...list];
      return { runs: { ...state.runs, [run.projectId]: next } };
    });
  },

  setPhases: (runId, phases) => {
    set((state) => ({ phases: { ...state.phases, [runId]: phases } }));
  },

  upsertPhase: (runId, phase) => {
    set((state) => {
      const list = state.phases[runId] ?? [];
      const idx = list.findIndex((p) => p.id === phase.id);
      const next = idx >= 0
        ? [...list.slice(0, idx), phase, ...list.slice(idx + 1)]
        : [...list, phase];
      return { phases: { ...state.phases, [runId]: next } };
    });
  },

  recordRecommendation: (runId, phaseId, rec) => {
    set((state) => ({
      recommendations: {
        ...state.recommendations,
        [recKey(runId, phaseId)]: { runId, phaseId, kind: rec.kind, reason: rec.reason },
      },
    }));
  },

  setView: (projectId, view) => {
    set((state) => ({ viewByProject: { ...state.viewByProject, [projectId]: view } }));
  },

  patchView: (projectId, patch) => {
    set((state) => {
      const current = state.viewByProject[projectId] ?? INITIAL_VIEW_STATE;
      return {
        viewByProject: {
          ...state.viewByProject,
          [projectId]: { ...current, ...patch },
        },
      };
    });
  },

  clearProject: (projectId) => {
    set((state) => {
      const { [projectId]: _omitRuns, ...restRuns } = state.runs;
      void _omitRuns;
      const { [projectId]: _omitView, ...restView } = state.viewByProject;
      void _omitView;
      return { runs: restRuns, viewByProject: restView };
    });
  },
}));
```

- [ ] **Step 2: tsc check**

Run: `pnpm --filter @my-claudia/desktop exec tsc --noEmit`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/features/meta-workflow/store.ts
git commit -m "feat(meta-workflow-ui): add Zustand store for runs/phases/view-state"
```

---

## Task 3: api.ts (HTTP + WS senders)

**Files:**
- Create: `apps/desktop/src/features/meta-workflow/api.ts`

Thin wrappers over the existing `apiCall*` helpers (HTTP GET/POST) and WS senders (build CRUD messages, hand off to the existing socket layer).

Reference for `apiCall`: `apps/desktop/src/features/workflows/api.ts:10-11`. Reference for WS sending: existing convention is each feature provides `send*` helpers that the **calling component** invokes with a socket reference — find the existing pattern by reading how `workflows/api.ts` does it (a `sendMessage(socket, msg)` helper or similar). For Phase E1 MVP, accept a `WebSocket | { send: (msg: string) => void }` parameter on each WS sender — keep coupling explicit.

- [ ] **Step 1: Read the workflow api.ts file in the repo to find the actual `apiCall` import path and signature**

Run: `cat apps/desktop/src/features/workflows/api.ts | head -25`

Note the import line for `apiCall`. Use the same import in `meta-workflow/api.ts`.

- [ ] **Step 2: Create the file**

```typescript
// apps/desktop/src/features/meta-workflow/api.ts
import type {
  MetaWorkflowRun,
  MetaWorkflowPhase,
  ReusablePoolItem,
} from '@my-claudia/shared/features/meta-workflow';
import type {
  CreateMetaWorkflowRunMessage,
  SubmitMetaWorkflowRequirementsMessage,
  ResolveMetaWorkflowRequirementsMessage,
  SetMetaWorkflowPhasesMessage,
  CancelMetaWorkflowRunMessage,
  RunMetaWorkflowPhaseMessage,
  RerunMetaWorkflowPhaseMessage,
  IgnoreMetaWorkflowPhaseStaleMessage,
  EvaluateMetaWorkflowPhaseImpactMessage,
  CascadeRerunMetaWorkflowPhaseMessage,
} from '@my-claudia/shared/protocol/messages';
// IMPORTANT: import path for `apiCall` / `apiCallForBackend` must match what workflows/api.ts uses.
// Read that file first (Step 1) and copy the exact import.
import { apiCall, apiCallForBackend } from '../../api/client.js'; // ADJUST if path differs

// ── HTTP ────────────────────────────────────────────────────────

export async function listRuns(projectId: string): Promise<MetaWorkflowRun[]> {
  const res = await apiCall<{ runs: MetaWorkflowRun[] }>(
    `/api/meta-workflow/runs?projectId=${encodeURIComponent(projectId)}`,
  );
  return res.runs;
}

export async function getRun(runId: string): Promise<MetaWorkflowRun | null> {
  const res = await apiCall<{ run: MetaWorkflowRun }>(`/api/meta-workflow/runs/${runId}`);
  return res.run;
}

export async function listPhases(runId: string): Promise<MetaWorkflowPhase[]> {
  const res = await apiCall<{ phases: MetaWorkflowPhase[] }>(`/api/meta-workflow/runs/${runId}/phases`);
  return res.phases;
}

export async function promotePoolItem(
  runId: string,
  itemId: string,
  newTags: string[],
  newName?: string,
  newDescription?: string,
): Promise<ReusablePoolItem> {
  const res = await apiCall<{ item: ReusablePoolItem }>(
    `/api/meta-workflow/runs/${runId}/promote-item`,
    { method: 'POST', body: JSON.stringify({ itemId, newTags, newName, newDescription }) },
  );
  return res.item;
}

// ── WebSocket senders ───────────────────────────────────────────

type Sendable = { send: (msg: string) => void };

function sendMsg(socket: Sendable, msg: unknown): void {
  socket.send(JSON.stringify(msg));
}

export function sendCreateRun(socket: Sendable, msg: Omit<CreateMetaWorkflowRunMessage, 'type'>): void {
  sendMsg(socket, { type: 'create_meta_workflow_run', ...msg });
}
export function sendSubmitRequirements(socket: Sendable, msg: Omit<SubmitMetaWorkflowRequirementsMessage, 'type'>): void {
  sendMsg(socket, { type: 'submit_meta_workflow_requirements', ...msg });
}
export function sendResolveRequirements(socket: Sendable, msg: Omit<ResolveMetaWorkflowRequirementsMessage, 'type'>): void {
  sendMsg(socket, { type: 'resolve_meta_workflow_requirements', ...msg });
}
export function sendSetPhases(socket: Sendable, msg: Omit<SetMetaWorkflowPhasesMessage, 'type'>): void {
  sendMsg(socket, { type: 'set_meta_workflow_phases', ...msg });
}
export function sendCancelRun(socket: Sendable, msg: Omit<CancelMetaWorkflowRunMessage, 'type'>): void {
  sendMsg(socket, { type: 'cancel_meta_workflow_run', ...msg });
}
export function sendRunPhase(socket: Sendable, msg: Omit<RunMetaWorkflowPhaseMessage, 'type'>): void {
  sendMsg(socket, { type: 'run_meta_workflow_phase', ...msg });
}
export function sendRerunPhase(socket: Sendable, msg: Omit<RerunMetaWorkflowPhaseMessage, 'type'>): void {
  sendMsg(socket, { type: 'rerun_meta_workflow_phase', ...msg });
}
export function sendIgnoreStale(socket: Sendable, msg: Omit<IgnoreMetaWorkflowPhaseStaleMessage, 'type'>): void {
  sendMsg(socket, { type: 'ignore_meta_workflow_phase_stale', ...msg });
}
export function sendEvaluateImpact(socket: Sendable, msg: Omit<EvaluateMetaWorkflowPhaseImpactMessage, 'type'>): void {
  sendMsg(socket, { type: 'evaluate_meta_workflow_phase_impact', ...msg });
}
export function sendCascadeRerun(socket: Sendable, msg: Omit<CascadeRerunMetaWorkflowPhaseMessage, 'type'>): void {
  sendMsg(socket, { type: 'cascade_rerun_meta_workflow_phase', ...msg });
}
```

> **NOTE on `apiCall` import path**: If the actual path is `'../shared-api/client.js'` or different, adapt. The other features in `apps/desktop/src/features/` show the canonical import. Don't invent a new helper.

- [ ] **Step 3: tsc check**

Run: `pnpm --filter @my-claudia/desktop exec tsc --noEmit`

Expected: clean. If errors, fix the import path.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/features/meta-workflow/api.ts
git commit -m "feat(meta-workflow-ui): add HTTP + WS senders module"
```

---

## Task 4: handlers.ts (WS message dispatch)

**Files:**
- Create: `apps/desktop/src/features/meta-workflow/handlers.ts`

Subscribes to the 3 Server→Client messages defined in Phase A/D:
- `meta_workflow_run_update` → `upsertRun`
- `meta_workflow_phase_update` → `upsertPhase`
- `meta_workflow_impact_recommendation` → `recordRecommendation`

Returns `boolean` from each handler dispatch (matching the existing `featureMessageHandler` contract): `true` if handled, `false` if not (so other handlers can try).

- [ ] **Step 1: Create the file**

```typescript
// apps/desktop/src/features/meta-workflow/handlers.ts
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import { useMetaWorkflowStore } from './store.js';

/**
 * Handle a ServerMessage that may belong to the meta-workflow feature.
 * Returns true if the message was a meta-workflow message (and was handled),
 * false otherwise so other feature handlers can try.
 */
export function handleMetaWorkflowMessage(msg: ServerMessage): boolean {
  switch (msg.type) {
    case 'meta_workflow_run_update':
      useMetaWorkflowStore.getState().upsertRun(msg.run);
      return true;

    case 'meta_workflow_phase_update':
      useMetaWorkflowStore.getState().upsertPhase(msg.runId, msg.phase);
      return true;

    case 'meta_workflow_impact_recommendation':
      useMetaWorkflowStore.getState().recordRecommendation(
        msg.runId,
        msg.phaseId,
        { kind: msg.recommendation.kind, reason: msg.recommendation.reason },
      );
      return true;

    default:
      return false;
  }
}
```

- [ ] **Step 2: tsc check**

Run: `pnpm --filter @my-claudia/desktop exec tsc --noEmit`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/features/meta-workflow/handlers.ts
git commit -m "feat(meta-workflow-ui): add WS message handler dispatch"
```

---

## Task 5: Register handler in message-dispatcher

**Files:**
- Modify: `apps/desktop/src/features/message-dispatcher.ts`

The dispatcher contains a `featureMessageHandlers` array. Add `handleMetaWorkflowMessage` to it.

- [ ] **Step 1: Read the dispatcher file**

Run: `cat apps/desktop/src/features/message-dispatcher.ts`

Locate the array (likely named `featureMessageHandlers` or similar).

- [ ] **Step 2: Add the import and array entry**

At the top, add:
```typescript
import { handleMetaWorkflowMessage } from './meta-workflow/handlers.js';
```

Append to the array:
```typescript
handleMetaWorkflowMessage,
```

(Don't replace the file; surgical insert. Look at the existing pattern — workflows handler is already registered.)

- [ ] **Step 3: tsc check**

Run: `pnpm --filter @my-claudia/desktop exec tsc --noEmit`

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/features/message-dispatcher.ts
git commit -m "feat(meta-workflow-ui): register WS handler in message-dispatcher"
```

---

## Task 6: MetaWorkflowPanel container

**Files:**
- Create: `apps/desktop/src/features/meta-workflow/components/MetaWorkflowPanel.tsx`

Top-level container. Takes `projectId` prop. Reads view state from store. Renders one of:
- list view (when no run is selected)
- one of 5 screens (when a run is selected, dispatch by `viewState.screen`)

For Phase E1, the **list view** is a simple list of runs in this project + a "New Meta Workflow Run" button.

- [ ] **Step 1: Create the file**

```tsx
// apps/desktop/src/features/meta-workflow/components/MetaWorkflowPanel.tsx
import React, { useEffect } from 'react';
import { useMetaWorkflowStore } from '../store.js';
import { INITIAL_VIEW_STATE } from '../view-state.js';
import * as api from '../api.js';
import { RequirementsScreen } from './RequirementsScreen.js';
import { PhaseGraphScreen } from './PhaseGraphScreen.js';
import { PhaseBoardScreen } from './PhaseBoardScreen.js';
import { PhaseDetailScreen } from './PhaseDetailScreen.js';
import { PromotionDialog } from './PromotionDialog.js';

interface MetaWorkflowPanelProps {
  projectId: string;
  socket: { send: (msg: string) => void };
}

export function MetaWorkflowPanel({ projectId, socket }: MetaWorkflowPanelProps): React.ReactElement {
  const runs = useMetaWorkflowStore((s) => s.runs[projectId] ?? []);
  const view = useMetaWorkflowStore((s) => s.viewByProject[projectId] ?? INITIAL_VIEW_STATE);
  const setRuns = useMetaWorkflowStore((s) => s.setRuns);
  const patchView = useMetaWorkflowStore((s) => s.patchView);

  // Load runs on mount + project change.
  useEffect(() => {
    let cancelled = false;
    api.listRuns(projectId).then((rs) => {
      if (!cancelled) setRuns(projectId, rs);
    }).catch((e) => console.error('[meta-workflow] listRuns failed', e));
    return () => { cancelled = true; };
  }, [projectId, setRuns]);

  const selectedRun = view.selectedRunId ? runs.find((r) => r.id === view.selectedRunId) : undefined;

  if (view.screen === 'list' || !selectedRun) {
    return (
      <div className="meta-workflow-panel">
        <header className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Meta Workflow Runs</h2>
        </header>
        {runs.length === 0 ? (
          <div className="text-gray-500 text-sm">No meta workflow runs yet. Click "New ▾ → Meta Workflow Run" above to start.</div>
        ) : (
          <ul className="space-y-2">
            {runs.map((r) => (
              <li key={r.id}
                  className="border rounded p-3 cursor-pointer hover:bg-gray-50"
                  onClick={() => patchView(projectId, {
                    selectedRunId: r.id,
                    screen: r.status === 'requirement_draft' || r.status === 'requirement_review'
                      ? 'requirements' : 'phase-board',
                  })}>
                <div className="font-medium">{r.title}</div>
                <div className="text-xs text-gray-500">Status: {r.status} · Reject count: {r.rejectCount}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // A run is selected — render the chosen screen.
  return (
    <div className="meta-workflow-panel">
      <BreadcrumbBar projectId={projectId} runTitle={selectedRun.title} screen={view.screen} />
      {view.screen === 'requirements'   && <RequirementsScreen projectId={projectId} run={selectedRun} socket={socket} />}
      {view.screen === 'phase-graph'    && <PhaseGraphScreen   projectId={projectId} run={selectedRun} socket={socket} />}
      {view.screen === 'phase-board'    && <PhaseBoardScreen   projectId={projectId} run={selectedRun} socket={socket} />}
      {view.screen === 'phase-detail'   && <PhaseDetailScreen  projectId={projectId} run={selectedRun} phaseId={view.selectedPhaseId} socket={socket} />}
      {view.screen === 'promotion'      && <PromotionDialog    projectId={projectId} run={selectedRun} poolItemId={view.promotingPoolItemId} socket={socket} />}
    </div>
  );
}

function BreadcrumbBar({ projectId, runTitle, screen }: { projectId: string; runTitle: string; screen: string }): React.ReactElement {
  const patchView = useMetaWorkflowStore((s) => s.patchView);
  return (
    <nav className="text-sm text-gray-600 mb-3 flex items-center gap-2">
      <button className="text-blue-600 hover:underline"
              onClick={() => patchView(projectId, { screen: 'list', selectedRunId: undefined })}>
        ← All Runs
      </button>
      <span>/</span>
      <span className="font-medium">{runTitle}</span>
      <span>/</span>
      <span className="capitalize">{screen.replace('-', ' ')}</span>
    </nav>
  );
}
```

- [ ] **Step 2: Create stub child components so this file compiles**

Create these 5 files with minimal stub content (each is filled out in tasks 7-11). Stub format:

```tsx
// apps/desktop/src/features/meta-workflow/components/RequirementsScreen.tsx
import React from 'react';
import type { MetaWorkflowRun } from '@my-claudia/shared/features/meta-workflow';

interface Props {
  projectId: string;
  run: MetaWorkflowRun;
  socket: { send: (msg: string) => void };
}

export function RequirementsScreen(_props: Props): React.ReactElement {
  return <div>RequirementsScreen (stub — Task 7)</div>;
}
```

Repeat for `PhaseGraphScreen`, `PhaseBoardScreen`, `PhaseDetailScreen`, `PromotionDialog` (the last with an extra `poolItemId?: string` prop, and `PhaseDetailScreen` with an extra `phaseId?: string` prop).

- [ ] **Step 3: tsc check**

Run: `pnpm --filter @my-claudia/desktop exec tsc --noEmit`

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/features/meta-workflow/components/MetaWorkflowPanel.tsx \
        apps/desktop/src/features/meta-workflow/components/RequirementsScreen.tsx \
        apps/desktop/src/features/meta-workflow/components/PhaseGraphScreen.tsx \
        apps/desktop/src/features/meta-workflow/components/PhaseBoardScreen.tsx \
        apps/desktop/src/features/meta-workflow/components/PhaseDetailScreen.tsx \
        apps/desktop/src/features/meta-workflow/components/PromotionDialog.tsx
git commit -m "feat(meta-workflow-ui): add MetaWorkflowPanel container + screen stubs"
```

---

## Task 7: RequirementsScreen

**Files:**
- Modify: `apps/desktop/src/features/meta-workflow/components/RequirementsScreen.tsx`

Screen behavior:
- Display the current `requirementsPath` from the run (read-only for Phase E1; editing is via a separate file-open or text area which Phase E2 can polish).
- 3 buttons: **Approve**, **Reject**, **Submit Requirements** (with a path input).
- Show `rejectCount` count + a warning when count ≥ 4 ("Approaching escape hatch — consider direct edit").
- The buttons send the corresponding ClientMessages via `socket`.

- [ ] **Step 1: Replace the stub**

```tsx
// apps/desktop/src/features/meta-workflow/components/RequirementsScreen.tsx
import React, { useState } from 'react';
import type { MetaWorkflowRun } from '@my-claudia/shared/features/meta-workflow';
import {
  sendSubmitRequirements,
  sendResolveRequirements,
} from '../api.js';
import { useMetaWorkflowStore } from '../store.js';

interface Props {
  projectId: string;
  run: MetaWorkflowRun;
  socket: { send: (msg: string) => void };
}

export function RequirementsScreen({ projectId, run, socket }: Props): React.ReactElement {
  const [path, setPath] = useState(run.requirementsPath ?? 'design/requirements.md');
  const patchView = useMetaWorkflowStore((s) => s.patchView);

  const isReview = run.status === 'requirement_review';
  const isDraft = run.status === 'requirement_draft';
  const approachingEscape = run.rejectCount >= 4;

  return (
    <div className="space-y-4 max-w-2xl">
      <h3 className="text-lg font-semibold">Requirements — {run.title}</h3>
      <div className="text-sm text-gray-600">Status: <span className="font-mono">{run.status}</span></div>

      {approachingEscape && (
        <div className="border border-yellow-400 bg-yellow-50 p-3 rounded text-sm">
          ⚠ Reject count: {run.rejectCount}. After the next reject the escape hatch (direct edit) becomes available.
        </div>
      )}

      <div className="space-y-2">
        <label className="block text-sm font-medium">Requirements document path</label>
        <input
          type="text"
          className="w-full border rounded px-3 py-2 font-mono text-sm"
          value={path}
          disabled={!isDraft}
          onChange={(e) => setPath(e.target.value)}
        />
      </div>

      <div className="flex gap-2">
        {isDraft && (
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            onClick={() => sendSubmitRequirements(socket, { runId: run.id, requirementsPath: path })}
          >
            Submit Requirements
          </button>
        )}
        {isReview && (
          <>
            <button
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              onClick={() => {
                sendResolveRequirements(socket, { runId: run.id, decision: 'approve' });
                patchView(projectId, { screen: 'phase-graph' });
              }}
            >
              Approve
            </button>
            <button
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              onClick={() => sendResolveRequirements(socket, { runId: run.id, decision: 'reject' })}
            >
              Reject
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: tsc check + commit**

```bash
pnpm --filter @my-claudia/desktop exec tsc --noEmit
git add apps/desktop/src/features/meta-workflow/components/RequirementsScreen.tsx
git commit -m "feat(meta-workflow-ui): RequirementsScreen with submit/approve/reject"
```

---

## Task 8: PhaseBoardScreen + PhaseCard

**Files:**
- Modify: `apps/desktop/src/features/meta-workflow/components/PhaseBoardScreen.tsx`
- Create: `apps/desktop/src/features/meta-workflow/components/PhaseCard.tsx`

PhaseBoardScreen behavior:
- Load phases for `run.id` on mount via `api.listPhases(runId)`.
- Render a grid of `PhaseCard` components.
- Each card shows: phase name, phaseType, status (colored), attempt/maxRetries, last gate result.
- Card click → drilldown to `phase-detail`.
- Card has 4 buttons when phase is `done`: "Re-run", "Stale Mark", "Evaluate", "Cascade Rerun"; when `stale`: "Re-run", "Ignore Stale", "Evaluate", "Cascade".

- [ ] **Step 1: Create `PhaseCard.tsx`**

```tsx
// apps/desktop/src/features/meta-workflow/components/PhaseCard.tsx
import React from 'react';
import type { MetaWorkflowPhase } from '@my-claudia/shared/features/meta-workflow';
import {
  sendRunPhase,
  sendRerunPhase,
  sendIgnoreStale,
  sendEvaluateImpact,
  sendCascadeRerun,
} from '../api.js';

interface Props {
  runId: string;
  phase: MetaWorkflowPhase;
  socket: { send: (msg: string) => void };
  onClick: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  searching_reuse: 'bg-blue-100 text-blue-700',
  generating: 'bg-blue-200 text-blue-800',
  ready_to_run: 'bg-yellow-100 text-yellow-700',
  running: 'bg-yellow-300 text-yellow-900',
  verifying_gates: 'bg-orange-200 text-orange-900',
  done: 'bg-green-100 text-green-800',
  failed: 'bg-red-200 text-red-900',
  stale: 'bg-purple-200 text-purple-900',
};

export function PhaseCard({ runId, phase, socket, onClick }: Props): React.ReactElement {
  const colorClass = STATUS_COLORS[phase.status] ?? 'bg-gray-100';
  const canRun = phase.status === 'pending';
  const canRerun = phase.status === 'done' || phase.status === 'failed' || phase.status === 'stale';
  const isStale = phase.status === 'stale';

  return (
    <div className="border rounded p-4 hover:shadow cursor-pointer" onClick={onClick}>
      <div className="flex justify-between items-start mb-2">
        <div>
          <div className="font-medium">{phase.phaseId}</div>
          <div className="text-xs text-gray-500">{phase.phaseType} · {phase.executeEntity}</div>
        </div>
        <span className={`px-2 py-1 rounded text-xs font-mono ${colorClass}`}>{phase.status}</span>
      </div>
      <div className="text-xs text-gray-500 mb-3">
        attempt {phase.attempt}/{phase.maxRetries}
      </div>
      <div className="flex gap-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
        {canRun && (
          <button className="px-2 py-1 text-xs bg-blue-600 text-white rounded"
                  onClick={() => sendRunPhase(socket, { runId, phaseId: phase.phaseId })}>
            Run
          </button>
        )}
        {canRerun && (
          <button className="px-2 py-1 text-xs bg-blue-600 text-white rounded"
                  onClick={() => sendRerunPhase(socket, { runId, phaseId: phase.phaseId })}>
            Re-run
          </button>
        )}
        {isStale && (
          <button className="px-2 py-1 text-xs bg-gray-200 rounded"
                  onClick={() => sendIgnoreStale(socket, { runId, phaseId: phase.phaseId })}>
            Ignore Stale
          </button>
        )}
        {canRerun && (
          <button className="px-2 py-1 text-xs bg-purple-200 text-purple-900 rounded"
                  onClick={() => sendEvaluateImpact(socket, { runId, phaseId: phase.phaseId })}>
            Evaluate
          </button>
        )}
        {canRerun && (
          <button className="px-2 py-1 text-xs bg-orange-200 text-orange-900 rounded"
                  onClick={() => sendCascadeRerun(socket, { runId, phaseId: phase.phaseId })}>
            Cascade
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace the PhaseBoardScreen stub**

```tsx
// apps/desktop/src/features/meta-workflow/components/PhaseBoardScreen.tsx
import React, { useEffect } from 'react';
import type { MetaWorkflowRun } from '@my-claudia/shared/features/meta-workflow';
import { useMetaWorkflowStore } from '../store.js';
import * as api from '../api.js';
import { PhaseCard } from './PhaseCard.js';

interface Props {
  projectId: string;
  run: MetaWorkflowRun;
  socket: { send: (msg: string) => void };
}

export function PhaseBoardScreen({ projectId, run, socket }: Props): React.ReactElement {
  const phases = useMetaWorkflowStore((s) => s.phases[run.id] ?? []);
  const setPhases = useMetaWorkflowStore((s) => s.setPhases);
  const patchView = useMetaWorkflowStore((s) => s.patchView);

  useEffect(() => {
    let cancelled = false;
    api.listPhases(run.id).then((ps) => {
      if (!cancelled) setPhases(run.id, ps);
    }).catch((e) => console.error('[meta-workflow] listPhases failed', e));
    return () => { cancelled = true; };
  }, [run.id, setPhases]);

  if (phases.length === 0) {
    return <div className="text-gray-500 text-sm">No phases yet. Set the phases.json to instantiate them.</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Phases — {run.title}</h3>
        <button
          className="px-3 py-1 text-sm border rounded"
          onClick={() => patchView(projectId, { screen: 'phase-graph' })}
        >
          View Graph
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {phases.map((p) => (
          <PhaseCard
            key={p.id}
            runId={run.id}
            phase={p}
            socket={socket}
            onClick={() => patchView(projectId, { screen: 'phase-detail', selectedPhaseId: p.phaseId })}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: tsc check + commit**

```bash
pnpm --filter @my-claudia/desktop exec tsc --noEmit
git add apps/desktop/src/features/meta-workflow/components/PhaseBoardScreen.tsx \
        apps/desktop/src/features/meta-workflow/components/PhaseCard.tsx
git commit -m "feat(meta-workflow-ui): PhaseBoardScreen with phase cards"
```

---

## Task 9: PhaseGraphScreen (using @xyflow/react)

**Files:**
- Modify: `apps/desktop/src/features/meta-workflow/components/PhaseGraphScreen.tsx`

Parses `run.phasesJson` (already on the run) into ReactFlow nodes + edges. Node label = `phaseId`, color = phase status, edges = `dependsOn`. View-only for Phase E1; drag-edit is Phase E2.

- [ ] **Step 1: Read the existing WorkflowGraphEditor for pattern**

Run: `head -80 apps/desktop/src/features/workflows/components/WorkflowGraphEditor.tsx`

Note: imports from `@xyflow/react`, custom node component, `ReactFlow` wrapper.

- [ ] **Step 2: Replace the stub**

```tsx
// apps/desktop/src/features/meta-workflow/components/PhaseGraphScreen.tsx
import React, { useMemo } from 'react';
import { ReactFlow, Background, Controls, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { MetaWorkflowRun, PhasesDoc, MetaWorkflowPhase } from '@my-claudia/shared/features/meta-workflow';
import { useMetaWorkflowStore } from '../store.js';

interface Props {
  projectId: string;
  run: MetaWorkflowRun;
  socket: { send: (msg: string) => void };
}

const STATUS_COLOR: Record<string, string> = {
  pending: '#f3f4f6',
  searching_reuse: '#dbeafe',
  generating: '#bfdbfe',
  ready_to_run: '#fef9c3',
  running: '#fde68a',
  verifying_gates: '#fed7aa',
  done: '#bbf7d0',
  failed: '#fecaca',
  stale: '#e9d5ff',
};

function toFlow(doc: PhasesDoc, phases: MetaWorkflowPhase[]): { nodes: Node[]; edges: Edge[] } {
  const statusByPhaseId: Record<string, string> = {};
  for (const p of phases) statusByPhaseId[p.phaseId] = p.status;

  // Simple horizontal layout: phases without dependsOn at x=0, others stepped right.
  const depth: Record<string, number> = {};
  function calcDepth(id: string): number {
    if (depth[id] !== undefined) return depth[id];
    const def = doc.phases.find((p) => p.id === id);
    if (!def || def.dependsOn.length === 0) { depth[id] = 0; return 0; }
    depth[id] = Math.max(...def.dependsOn.map((d) => calcDepth(d))) + 1;
    return depth[id];
  }
  doc.phases.forEach((p) => calcDepth(p.id));

  const byDepth: Record<number, string[]> = {};
  for (const [id, d] of Object.entries(depth)) {
    byDepth[d] = byDepth[d] ?? [];
    byDepth[d].push(id);
  }

  const nodes: Node[] = doc.phases.map((p) => {
    const d = depth[p.id];
    const lane = byDepth[d].indexOf(p.id);
    const status = statusByPhaseId[p.id] ?? 'pending';
    return {
      id: p.id,
      position: { x: d * 220, y: lane * 100 },
      data: {
        label: (
          <div style={{ padding: 6 }}>
            <div style={{ fontWeight: 600 }}>{p.id}</div>
            <div style={{ fontSize: 10, color: '#6b7280' }}>{p.phaseType}</div>
            <div style={{ fontSize: 10, fontFamily: 'monospace' }}>{status}</div>
          </div>
        ),
      },
      style: { background: STATUS_COLOR[status] ?? '#fff', border: '1px solid #cbd5e1', borderRadius: 6, width: 180 },
    };
  });

  const edges: Edge[] = [];
  for (const p of doc.phases) {
    for (const dep of p.dependsOn) {
      edges.push({ id: `${dep}->${p.id}`, source: dep, target: p.id, animated: false });
    }
  }
  return { nodes, edges };
}

export function PhaseGraphScreen({ projectId, run, socket: _socket }: Props): React.ReactElement {
  const phases = useMetaWorkflowStore((s) => s.phases[run.id] ?? []);
  const patchView = useMetaWorkflowStore((s) => s.patchView);

  const { nodes, edges } = useMemo(() => {
    if (!run.phasesJson) return { nodes: [], edges: [] };
    try {
      const doc = JSON.parse(run.phasesJson) as PhasesDoc;
      return toFlow(doc, phases);
    } catch {
      return { nodes: [], edges: [] };
    }
  }, [run.phasesJson, phases]);

  if (!run.phasesJson) {
    return (
      <div>
        <h3 className="text-lg font-semibold mb-3">Phase Graph — {run.title}</h3>
        <div className="text-sm text-gray-500">Run has no phases.json yet. Approve requirements to enter splitting.</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Phase Graph — {run.title}</h3>
        <button className="px-3 py-1 text-sm border rounded"
                onClick={() => patchView(projectId, { screen: 'phase-board' })}>
          View Board
        </button>
      </div>
      <div style={{ height: 500, border: '1px solid #e5e7eb', borderRadius: 6 }}>
        <ReactFlow nodes={nodes} edges={edges} fitView>
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: tsc check + commit**

```bash
pnpm --filter @my-claudia/desktop exec tsc --noEmit
git add apps/desktop/src/features/meta-workflow/components/PhaseGraphScreen.tsx
git commit -m "feat(meta-workflow-ui): PhaseGraphScreen with @xyflow visualization"
```

---

## Task 10: PhaseDetailScreen

**Files:**
- Modify: `apps/desktop/src/features/meta-workflow/components/PhaseDetailScreen.tsx`

Drill-down for one phase: show snapshots, gates, generated workflow/subagent id, attempt history, recommendation if present.

- [ ] **Step 1: Replace the stub**

```tsx
// apps/desktop/src/features/meta-workflow/components/PhaseDetailScreen.tsx
import React from 'react';
import type { MetaWorkflowRun } from '@my-claudia/shared/features/meta-workflow';
import { useMetaWorkflowStore } from '../store.js';
import {
  sendRunPhase,
  sendRerunPhase,
  sendIgnoreStale,
  sendEvaluateImpact,
  sendCascadeRerun,
} from '../api.js';

interface Props {
  projectId: string;
  run: MetaWorkflowRun;
  phaseId?: string;
  socket: { send: (msg: string) => void };
}

export function PhaseDetailScreen({ projectId, run, phaseId, socket }: Props): React.ReactElement {
  const phases = useMetaWorkflowStore((s) => s.phases[run.id] ?? []);
  const patchView = useMetaWorkflowStore((s) => s.patchView);
  const rec = useMetaWorkflowStore((s) =>
    phaseId ? s.recommendations[`${run.id}:${phaseId}`] : undefined,
  );

  const phase = phases.find((p) => p.phaseId === phaseId);

  if (!phase) {
    return (
      <div>
        <button className="text-sm text-blue-600 hover:underline"
                onClick={() => patchView(projectId, { screen: 'phase-board', selectedPhaseId: undefined })}>
          ← Back to Board
        </button>
        <div className="text-gray-500 mt-2">Phase not found.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <button className="text-sm text-blue-600 hover:underline"
              onClick={() => patchView(projectId, { screen: 'phase-board', selectedPhaseId: undefined })}>
        ← Back to Board
      </button>

      <div>
        <h3 className="text-xl font-semibold">{phase.phaseId}</h3>
        <div className="text-sm text-gray-600">
          {phase.phaseType} · {phase.executeEntity} · status:&nbsp;
          <span className="font-mono">{phase.status}</span> · attempt {phase.attempt}/{phase.maxRetries}
        </div>
      </div>

      {rec && (
        <div className="border border-purple-300 bg-purple-50 rounded p-3 text-sm">
          <div className="font-medium mb-1">Impact recommendation</div>
          <div>Kind: <span className="font-mono">{rec.kind}</span></div>
          <div className="text-gray-700">{rec.reason}</div>
        </div>
      )}

      <details className="border rounded p-3 text-sm">
        <summary className="cursor-pointer font-medium">Inputs / Outputs / Gates snapshot</summary>
        <pre className="text-xs mt-2 overflow-auto">
          {JSON.stringify({
            inputs: phase.inputsSnapshot,
            outputs: phase.outputsSnapshot,
            gates: phase.gatesSnapshot,
          }, null, 2)}
        </pre>
      </details>

      <div className="space-y-1 text-sm">
        {phase.generatedWorkflowId && <div>Generated workflow: <code>{phase.generatedWorkflowId}</code></div>}
        {phase.generatedSubagentId && <div>Generated subagent:  <code>{phase.generatedSubagentId}</code></div>}
        {phase.reusedFromPoolId && <div>Reused from pool item: <code>{phase.reusedFromPoolId}</code></div>}
        {phase.currentRunId && <div>Current sub-workflow run: <code>{phase.currentRunId}</code></div>}
        {phase.staleSourcePhaseId && <div>Stale source phase: <code>{phase.staleSourcePhaseId}</code></div>}
      </div>

      <div className="flex flex-wrap gap-2">
        {phase.status === 'pending' && (
          <button className="px-3 py-1 text-sm bg-blue-600 text-white rounded"
                  onClick={() => sendRunPhase(socket, { runId: run.id, phaseId: phase.phaseId })}>
            Run
          </button>
        )}
        {(phase.status === 'done' || phase.status === 'failed' || phase.status === 'stale') && (
          <>
            <button className="px-3 py-1 text-sm bg-blue-600 text-white rounded"
                    onClick={() => sendRerunPhase(socket, { runId: run.id, phaseId: phase.phaseId })}>
              Re-run
            </button>
            <button className="px-3 py-1 text-sm bg-purple-200 text-purple-900 rounded"
                    onClick={() => sendEvaluateImpact(socket, { runId: run.id, phaseId: phase.phaseId })}>
              Evaluate Impact
            </button>
            <button className="px-3 py-1 text-sm bg-orange-200 text-orange-900 rounded"
                    onClick={() => sendCascadeRerun(socket, { runId: run.id, phaseId: phase.phaseId })}>
              Cascade Re-run
            </button>
          </>
        )}
        {phase.status === 'stale' && (
          <button className="px-3 py-1 text-sm bg-gray-200 rounded"
                  onClick={() => sendIgnoreStale(socket, { runId: run.id, phaseId: phase.phaseId })}>
            Ignore Stale
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: tsc check + commit**

```bash
pnpm --filter @my-claudia/desktop exec tsc --noEmit
git add apps/desktop/src/features/meta-workflow/components/PhaseDetailScreen.tsx
git commit -m "feat(meta-workflow-ui): PhaseDetailScreen with snapshots + action buttons"
```

---

## Task 11: PromotionDialog

**Files:**
- Modify: `apps/desktop/src/features/meta-workflow/components/PromotionDialog.tsx`

Modal form for promoting a reuse-pool item. Phase E1 MVP: minimal — just lets the user enter `newTags`, `newName`, `newDescription` and POST to the promote endpoint. Triggered by `view.promotingPoolItemId`.

- [ ] **Step 1: Replace the stub**

```tsx
// apps/desktop/src/features/meta-workflow/components/PromotionDialog.tsx
import React, { useState } from 'react';
import type { MetaWorkflowRun } from '@my-claudia/shared/features/meta-workflow';
import { useMetaWorkflowStore } from '../store.js';
import * as api from '../api.js';

interface Props {
  projectId: string;
  run: MetaWorkflowRun;
  poolItemId?: string;
  socket: { send: (msg: string) => void };
}

export function PromotionDialog({ projectId, run, poolItemId, socket: _socket }: Props): React.ReactElement {
  const patchView = useMetaWorkflowStore((s) => s.patchView);
  const [tagsInput, setTagsInput] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!poolItemId) {
    return (
      <div>
        <button className="text-sm text-blue-600 hover:underline"
                onClick={() => patchView(projectId, { screen: 'phase-board', promotingPoolItemId: undefined })}>
          ← Close
        </button>
        <div className="text-gray-500 mt-2">No pool item selected for promotion.</div>
      </div>
    );
  }

  const onPromote = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api.promotePoolItem(
        run.id,
        poolItemId,
        tagsInput.split(',').map((t) => t.trim()).filter(Boolean),
        name || undefined,
        description || undefined,
      );
      patchView(projectId, { screen: 'phase-board', promotingPoolItemId: undefined });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-lg space-y-3">
      <h3 className="text-lg font-semibold">Promote Reusable Pool Item</h3>
      <div className="text-sm text-gray-600">Item: <code>{poolItemId}</code></div>

      <div>
        <label className="block text-sm font-medium">New tags (comma-separated)</label>
        <input type="text" className="w-full border rounded px-3 py-2"
               value={tagsInput} onChange={(e) => setTagsInput(e.target.value)}
               placeholder="my-template, jpa-impl" />
      </div>

      <div>
        <label className="block text-sm font-medium">New name (optional)</label>
        <input type="text" className="w-full border rounded px-3 py-2"
               value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div>
        <label className="block text-sm font-medium">New description (optional)</label>
        <textarea className="w-full border rounded px-3 py-2"
                  value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
      </div>

      {error && <div className="text-sm text-red-600">Error: {error}</div>}

      <div className="flex gap-2">
        <button className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
                disabled={submitting}
                onClick={onPromote}>
          {submitting ? 'Promoting…' : 'Promote'}
        </button>
        <button className="px-4 py-2 border rounded"
                onClick={() => patchView(projectId, { screen: 'phase-board', promotingPoolItemId: undefined })}>
          Cancel
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: tsc check + commit**

```bash
pnpm --filter @my-claudia/desktop exec tsc --noEmit
git add apps/desktop/src/features/meta-workflow/components/PromotionDialog.tsx
git commit -m "feat(meta-workflow-ui): PromotionDialog form"
```

---

## Task 12: NewRunDropdown + SupervisorWorkspacePanel integration

**Files:**
- Create: `apps/desktop/src/features/meta-workflow/components/NewRunDropdown.tsx`
- Modify: `apps/desktop/src/features/supervision/components/SupervisorWorkspacePanel.tsx`

The dropdown appears in the Supervisor header. Two options:
- "New Classic Change" — preserves the existing button's behavior
- "New Meta Workflow Run" — sends `create_meta_workflow_run` ClientMessage + switches the Meta Workflow panel's view to `requirements`

For SupervisorWorkspacePanel, mount the `MetaWorkflowPanel` as a tab alongside the existing Change view, OR as a separate row. For Phase E1 MVP: add a simple tab toggle at the top (`Classic Changes` | `Meta Workflows`) and render the corresponding panel.

- [ ] **Step 1: Create `NewRunDropdown.tsx`**

```tsx
// apps/desktop/src/features/meta-workflow/components/NewRunDropdown.tsx
import React, { useState } from 'react';
import { sendCreateRun } from '../api.js';
import { useMetaWorkflowStore } from '../store.js';

interface Props {
  projectId: string;
  socket: { send: (msg: string) => void };
  /** Called when "New Classic Change" is clicked — preserves existing behavior. */
  onNewClassicChange: () => void;
}

export function NewRunDropdown({ projectId, socket, onNewClassicChange }: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [showMetaForm, setShowMetaForm] = useState(false);
  const patchView = useMetaWorkflowStore((s) => s.patchView);

  const submitMeta = () => {
    if (!titleInput.trim()) return;
    sendCreateRun(socket, { projectId, title: titleInput.trim() });
    setTitleInput('');
    setShowMetaForm(false);
    setOpen(false);
    // The WS update will arrive and upsertRun; the user can then click into it.
  };

  return (
    <div className="relative inline-block">
      <button
        className="px-3 py-1 text-sm border rounded bg-white hover:bg-gray-50"
        onClick={() => setOpen((v) => !v)}
      >
        New ▾
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 border bg-white shadow-lg rounded z-10">
          <button
            className="w-full text-left px-3 py-2 hover:bg-gray-100 text-sm"
            onClick={() => { onNewClassicChange(); setOpen(false); }}
          >
            New Classic Change
          </button>
          <button
            className="w-full text-left px-3 py-2 hover:bg-gray-100 text-sm"
            onClick={() => setShowMetaForm(true)}
          >
            New Meta Workflow Run
          </button>
          {showMetaForm && (
            <div className="p-3 border-t space-y-2">
              <input
                className="w-full border rounded px-2 py-1 text-sm"
                placeholder="Title"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                autoFocus
              />
              <div className="flex gap-2">
                <button className="px-2 py-1 text-xs bg-blue-600 text-white rounded"
                        onClick={submitMeta}>
                  Create
                </button>
                <button className="px-2 py-1 text-xs border rounded"
                        onClick={() => setShowMetaForm(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

void useMetaWorkflowStore; // satisfies tooling if patchView is unused on this path
```

- [ ] **Step 2: Modify SupervisorWorkspacePanel.tsx**

Open `apps/desktop/src/features/supervision/components/SupervisorWorkspacePanel.tsx`. Around lines 360-410 there is a "New Change" button + form section.

Add imports at the top:

```typescript
import { NewRunDropdown } from '../../meta-workflow/components/NewRunDropdown.js';
import { MetaWorkflowPanel } from '../../meta-workflow/components/MetaWorkflowPanel.js';
```

Locate the existing "New Change" button (around `setShowCreateChange(value => !value)`). REPLACE it with:

```tsx
<NewRunDropdown
  projectId={projectId}
  socket={socket}
  onNewClassicChange={() => setShowCreateChange(value => !value)}
/>
```

The `projectId` and `socket` references should already exist in the component scope — verify by reading the file's context. If `socket` isn't a prop, find how other features get their socket reference (likely via a `useMultiServerSocket` hook or a context).

Add a tab toggle ABOVE the main change panel to switch between Classic and Meta Workflow views. Add this state:

```typescript
const [activeTab, setActiveTab] = useState<'classic' | 'meta'>('classic');
```

And wrap the existing change view + the new MetaWorkflowPanel in a conditional:

```tsx
<div className="flex gap-2 mb-3 border-b">
  <button className={`px-3 py-1 text-sm ${activeTab === 'classic' ? 'border-b-2 border-blue-600' : ''}`}
          onClick={() => setActiveTab('classic')}>
    Classic Changes
  </button>
  <button className={`px-3 py-1 text-sm ${activeTab === 'meta' ? 'border-b-2 border-blue-600' : ''}`}
          onClick={() => setActiveTab('meta')}>
    Meta Workflows
  </button>
</div>
{activeTab === 'classic' ? (
  /* existing change view JSX stays here */
) : (
  <MetaWorkflowPanel projectId={projectId} socket={socket} />
)}
```

**IMPORTANT**: The exact `socket` accessor depends on the file's existing conventions. Read the file first to find how it accesses the active websocket. If you can't find a clean socket reference, fall back to passing socket via an existing context hook.

- [ ] **Step 3: tsc + visual check**

```bash
pnpm --filter @my-claudia/desktop exec tsc --noEmit
```

Run `pnpm desktop:dev` in a separate terminal and visit the Supervisor panel to confirm the dropdown + tab toggle render. (No automated test here; visual verification only.)

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/features/meta-workflow/components/NewRunDropdown.tsx \
        apps/desktop/src/features/supervision/components/SupervisorWorkspacePanel.tsx
git commit -m "feat(meta-workflow-ui): NewRunDropdown + Supervisor tab integration"
```

---

## Task 13: index.ts public exports

**Files:**
- Create: `apps/desktop/src/features/meta-workflow/index.ts`

- [ ] **Step 1: Create the file**

```typescript
// apps/desktop/src/features/meta-workflow/index.ts
export { useMetaWorkflowStore } from './store.js';
export { handleMetaWorkflowMessage } from './handlers.js';
export * as metaWorkflowApi from './api.js';
export { MetaWorkflowPanel } from './components/MetaWorkflowPanel.js';
export { NewRunDropdown } from './components/NewRunDropdown.js';
export type { MetaWorkflowScreen, MetaWorkflowViewState } from './view-state.js';
```

- [ ] **Step 2: tsc check + commit**

```bash
pnpm --filter @my-claudia/desktop exec tsc --noEmit
git add apps/desktop/src/features/meta-workflow/index.ts
git commit -m "feat(meta-workflow-ui): add feature index exports"
```

---

## Task 14: Build + Visual smoke + Tag

- [ ] **Step 1: Full build**

```bash
pnpm build
```

Expected: clean (4 packages).

- [ ] **Step 2: Run dev server briefly to confirm no runtime errors on Supervisor page**

In a separate terminal:
```bash
pnpm desktop:dev
```

Navigate to Supervisor. Confirm:
- "New ▾" dropdown appears in the supervisor header
- Tabs "Classic Changes" / "Meta Workflows" render
- Clicking "Meta Workflows" shows the empty MetaWorkflowPanel (no errors)
- Clicking "New ▾ → New Meta Workflow Run" opens an inline form
- Submitting a title creates a run (visible after WS update arrives)

If the dev server requires a backend, also run `pnpm server:dev:isolated` in a third terminal.

Stop the dev server after verification.

- [ ] **Step 3: Tag**

```bash
git tag -a meta-workflow/phase-e1-complete -m "Meta Workflow Phase E1 desktop UI landed"
```

---

## Phase E1 Acceptance Criteria

- [ ] All 14 tasks complete and individually committed.
- [ ] `pnpm build` passes for all 4 packages.
- [ ] `tsc --noEmit` clean for desktop.
- [ ] Dev server renders Supervisor → Meta Workflows tab without runtime errors.
- [ ] Tag `meta-workflow/phase-e1-complete` created.

---

## What Phase E1 Deliberately Leaves to Phase E2 / F

| Item | Phase |
|------|-------|
| Drag-edit on PhaseGraphScreen (add/remove/edit phase nodes) | E2 |
| Standalone window for PhaseDetail / PhaseGraph | E2 |
| Sub-workflow run viewer embedded in PhaseDetail | E2 |
| Reuse-pool browser screen (search auto-generated items, promote inline) | E2 |
| Backend hardening (AI evaluateImpact / multi-turn subagent / WorktreeAllocator release / EventDispatcher.off / persistent worktree) | E2 or merged Phase F |
| End-to-end smoke on a real Java/TS project through the UI | F |
| Tailwind / design polish (current screens use minimal utility classes; adjust to MyClaudia's UI kit) | E2 |
| Vitest tests for screens (rendering, click handlers) | E2 |

---

*Plan version: 1 / 2026-05-19*
*Spec reference: `docs/design/supervisor-meta-workflow.zh-CN.md`*
*Phase A-D: complete (tags `meta-workflow/phase-{a,b,c,d}-complete`)*
