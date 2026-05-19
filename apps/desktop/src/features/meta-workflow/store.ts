// apps/desktop/src/features/meta-workflow/store.ts
import { create } from 'zustand';
import type {
  MetaWorkflowRun,
  MetaWorkflowPhase,
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
  /** Projects waiting to auto-select the next created run */
  pendingSelectByProject: Record<ProjectId, true>;
  /** per-run, per-node position cache (in-memory, lost on reload) */
  layouts: Record<RunId, Record<string, { x: number; y: number }>>;

  // Actions — HTTP/WS handlers call these directly via getState()
  setRuns: (projectId: ProjectId, runs: MetaWorkflowRun[]) => void;
  upsertRun: (run: MetaWorkflowRun) => void;
  setPhases: (runId: RunId, phases: MetaWorkflowPhase[]) => void;
  upsertPhase: (runId: RunId, phase: MetaWorkflowPhase) => void;
  recordRecommendation: (runId: RunId, phaseId: string, rec: { kind: string; reason: string }) => void;
  setNodePosition: (runId: RunId, nodeId: string, pos: { x: number; y: number }) => void;
  // View
  setView: (projectId: ProjectId, view: MetaWorkflowViewState) => void;
  patchView: (projectId: ProjectId, patch: Partial<MetaWorkflowViewState>) => void;
  /** Flag a project so the next new run upserted is auto-selected and switches to requirements. */
  markPendingSelect: (projectId: ProjectId) => void;
  // Clear (e.g., when project changes)
  clearProject: (projectId: ProjectId) => void;
}

function recKey(runId: string, phaseId: string): string {
  return `${runId}:${phaseId}`;
}

export const useMetaWorkflowStore = create<MetaWorkflowStore>((set, _get) => ({
  runs: {},
  phases: {},
  recommendations: {},
  viewByProject: {},
  pendingSelectByProject: {},
  layouts: {},

  setRuns: (projectId, runs) => {
    set((state) => ({ runs: { ...state.runs, [projectId]: runs } }));
  },

  upsertRun: (run) => {
    set((state) => {
      const list = state.runs[run.projectId] ?? [];
      const idx = list.findIndex((r) => r.id === run.id);
      const isNew = idx === -1;
      const nextList = isNew
        ? [run, ...list]
        : [...list.slice(0, idx), run, ...list.slice(idx + 1)];
      const update: Partial<MetaWorkflowStore> = {
        runs: { ...state.runs, [run.projectId]: nextList },
      };
      if (isNew && state.pendingSelectByProject[run.projectId]) {
        const currentView = state.viewByProject[run.projectId] ?? INITIAL_VIEW_STATE;
        update.viewByProject = {
          ...state.viewByProject,
          [run.projectId]: { ...currentView, selectedRunId: run.id, screen: 'requirements' },
        };
        const { [run.projectId]: _omit, ...restPending } = state.pendingSelectByProject;
        void _omit;
        update.pendingSelectByProject = restPending;
      }
      return update;
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

  markPendingSelect: (projectId) => {
    set((state) => ({
      pendingSelectByProject: { ...state.pendingSelectByProject, [projectId]: true },
    }));
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
