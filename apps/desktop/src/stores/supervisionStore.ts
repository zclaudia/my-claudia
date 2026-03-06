import { create } from 'zustand';
import type {
  Supervision,
  SupervisionTask,
  ProjectAgent,
} from '@my-claudia/shared';

interface SupervisionState {
  // ====== V1 (deprecated, kept for backward compat) ======
  supervisions: Record<string, Supervision>;
  pendingPlanningHints: Record<string, string>;

  setSupervision: (sessionId: string, supervision: Supervision | null) => void;
  updateSupervision: (supervision: Supervision) => void;
  removeSupervision: (sessionId: string) => void;
  setPendingHint: (sessionId: string, hint: string) => void;
  clearPendingHint: (sessionId: string) => void;

  // ====== V2: project-level supervision ======
  tasks: Record<string, SupervisionTask[]>;       // projectId -> tasks
  agents: Record<string, ProjectAgent>;            // projectId -> agent
  lastCheckpoint: Record<string, string>;          // projectId -> summary

  setTasks: (projectId: string, tasks: SupervisionTask[]) => void;
  upsertTask: (projectId: string, task: SupervisionTask) => void;
  removeTask: (projectId: string, taskId: string) => void;
  setAgent: (projectId: string, agent: ProjectAgent) => void;
  removeAgent: (projectId: string) => void;
  setCheckpointSummary: (projectId: string, summary: string) => void;
}

export const useSupervisionStore = create<SupervisionState>((set) => ({
  // V1 state
  supervisions: {},
  pendingPlanningHints: {},

  // V2 state
  tasks: {},
  agents: {},
  lastCheckpoint: {},

  // ====== V1 actions ======

  setSupervision: (sessionId, supervision) =>
    set((state) => {
      if (!supervision) {
        const { [sessionId]: _, ...rest } = state.supervisions;
        return { supervisions: rest };
      }
      return { supervisions: { ...state.supervisions, [sessionId]: supervision } };
    }),

  updateSupervision: (supervision) =>
    set((state) => ({
      supervisions: {
        ...state.supervisions,
        [supervision.sessionId]: supervision,
      },
    })),

  removeSupervision: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...rest } = state.supervisions;
      return { supervisions: rest };
    }),

  setPendingHint: (sessionId, hint) =>
    set((state) => ({
      pendingPlanningHints: { ...state.pendingPlanningHints, [sessionId]: hint },
    })),

  clearPendingHint: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...rest } = state.pendingPlanningHints;
      return { pendingPlanningHints: rest };
    }),

  // ====== V2 actions ======

  setTasks: (projectId, tasks) =>
    set((state) => ({
      tasks: { ...state.tasks, [projectId]: tasks },
    })),

  upsertTask: (projectId, task) =>
    set((state) => {
      const existing = state.tasks[projectId] ?? [];
      const idx = existing.findIndex((t) => t.id === task.id);
      const updated = idx >= 0
        ? existing.map((t, i) => (i === idx ? task : t))
        : [...existing, task];
      return { tasks: { ...state.tasks, [projectId]: updated } };
    }),

  removeTask: (projectId, taskId) =>
    set((state) => {
      const existing = state.tasks[projectId] ?? [];
      return { tasks: { ...state.tasks, [projectId]: existing.filter((t) => t.id !== taskId) } };
    }),

  setAgent: (projectId, agent) =>
    set((state) => ({
      agents: { ...state.agents, [projectId]: agent },
    })),

  removeAgent: (projectId) =>
    set((state) => {
      const { [projectId]: _, ...rest } = state.agents;
      return { agents: rest };
    }),

  setCheckpointSummary: (projectId, summary) =>
    set((state) => ({
      lastCheckpoint: { ...state.lastCheckpoint, [projectId]: summary },
    })),
}));
