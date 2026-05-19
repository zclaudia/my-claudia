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

export const useMetaWorkflowStore = create<MetaWorkflowStore>((set, _get) => ({
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
