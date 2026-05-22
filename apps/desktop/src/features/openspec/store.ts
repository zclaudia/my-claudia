// apps/desktop/src/features/openspec/store.ts
//
// Zustand store for the OpenSpec tab. Indexes issues/specChanges/executors/
// corpus snapshots and a per-project view state. HTTP/WS handlers call the
// setters directly via `useOpenSpecStore.getState()`.

import { create } from 'zustand';
import type { LocalIssue } from '@my-claudia/shared/features/local-issue';
import type { SpecChange } from '@my-claudia/shared/features/spec-change';
import type { ExecutorInstance } from '@my-claudia/shared/features/executor';
import type { OpenSpecViewState } from './view-state';
import { INITIAL_VIEW_STATE } from './view-state';
import type { CapabilitySummary } from './api';

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
  // Clear (e.g., when project closes / data needs to refetch)
  clearProject: (projectId: ProjectId) => void;
}

export const useOpenSpecStore = create<OpenSpecStore>((set) => ({
  issuesByProject: {},
  specChangesById: {},
  executorsBySpecChange: {},
  corpusByProject: {},
  viewByProject: {},

  setIssues: (projectId, issues) =>
    set((s) => ({ issuesByProject: { ...s.issuesByProject, [projectId]: issues } })),

  upsertIssue: (issue) =>
    set((s) => {
      const list = s.issuesByProject[issue.projectId] ?? [];
      const idx = list.findIndex((i) => i.id === issue.id);
      const next =
        idx >= 0 ? [...list.slice(0, idx), issue, ...list.slice(idx + 1)] : [issue, ...list];
      return { issuesByProject: { ...s.issuesByProject, [issue.projectId]: next } };
    }),

  setSpecChange: (sc) =>
    set((s) => ({ specChangesById: { ...s.specChangesById, [sc.id]: sc } })),

  setExecutors: (specChangeId, list) =>
    set((s) => ({
      executorsBySpecChange: { ...s.executorsBySpecChange, [specChangeId]: list },
    })),

  upsertExecutor: (inst) =>
    set((s) => {
      const list = s.executorsBySpecChange[inst.specChangeId] ?? [];
      const idx = list.findIndex((e) => e.id === inst.id);
      const next =
        idx >= 0 ? [...list.slice(0, idx), inst, ...list.slice(idx + 1)] : [...list, inst];
      return {
        executorsBySpecChange: { ...s.executorsBySpecChange, [inst.specChangeId]: next },
      };
    }),

  setCorpus: (projectId, items) =>
    set((s) => ({ corpusByProject: { ...s.corpusByProject, [projectId]: items } })),

  patchView: (projectId, patch) =>
    set((s) => {
      const current = s.viewByProject[projectId] ?? INITIAL_VIEW_STATE;
      return {
        viewByProject: { ...s.viewByProject, [projectId]: { ...current, ...patch } },
      };
    }),

  clearProject: (projectId) =>
    set((s) => {
      const { [projectId]: _issues, ...issuesRest } = s.issuesByProject;
      void _issues;
      const { [projectId]: _corpus, ...corpusRest } = s.corpusByProject;
      void _corpus;
      const { [projectId]: _view, ...viewRest } = s.viewByProject;
      void _view;
      return {
        issuesByProject: issuesRest,
        corpusByProject: corpusRest,
        viewByProject: viewRest,
      };
    }),
}));
