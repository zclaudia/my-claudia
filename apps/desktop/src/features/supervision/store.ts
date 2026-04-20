import { create } from 'zustand';
import type {
  ChangeExecutionPlan,
  ProjectChange,
  SupervisionTask,
  ProjectAgent,
} from '@my-claudia/shared';

interface SupervisionState {
  // Project-level supervision (V2)
  tasks: Record<string, SupervisionTask[]>;       // projectId -> tasks
  agents: Record<string, ProjectAgent>;            // projectId -> agent
  activeChanges: Record<string, ProjectChange | null>; // projectId -> active change
  executionPlans: Record<string, ChangeExecutionPlan>; // changeId -> execution plan
  lastCheckpoint: Record<string, string>;          // projectId -> summary

  setTasks: (projectId: string, tasks: SupervisionTask[]) => void;
  upsertTask: (projectId: string, task: SupervisionTask) => void;
  removeTask: (projectId: string, taskId: string) => void;
  setAgent: (projectId: string, agent: ProjectAgent) => void;
  removeAgent: (projectId: string) => void;
  setActiveChange: (projectId: string, change: ProjectChange | null) => void;
  setExecutionPlan: (changeId: string, plan: ChangeExecutionPlan) => void;
  setCheckpointSummary: (projectId: string, summary: string) => void;
}

export const useSupervisionStore = create<SupervisionState>((set) => ({
  tasks: {},
  agents: {},
  activeChanges: {},
  executionPlans: {},
  lastCheckpoint: {},

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

  setActiveChange: (projectId, change) =>
    set((state) => ({
      activeChanges: { ...state.activeChanges, [projectId]: change },
    })),

  setExecutionPlan: (changeId, plan) =>
    set((state) => ({
      executionPlans: { ...state.executionPlans, [changeId]: plan },
    })),

  setCheckpointSummary: (projectId, summary) =>
    set((state) => ({
      lastCheckpoint: { ...state.lastCheckpoint, [projectId]: summary },
    })),
}));
