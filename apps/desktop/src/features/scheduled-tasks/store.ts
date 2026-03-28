import { create } from 'zustand';
import type { ScheduledTask, ScheduledTaskTemplate, TaskRun } from '@my-claudia/shared';
import {
  listScheduledTasks,
  listGlobalScheduledTasks,
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  triggerScheduledTask,
  listScheduledTaskTemplates,
  enableTemplateTask,
  listTaskRuns,
} from './api';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { useServerStore } from '../../stores/serverStore';

const GLOBAL_KEY = '__global__';

function toBackendArg(backendId: string | null | undefined): string | undefined {
  return backendId ?? undefined;
}

interface ScheduledTaskState {
  /** projectId → tasks (GLOBAL_KEY for global tasks) */
  tasks: Record<string, ScheduledTask[]>;
  templates: ScheduledTaskTemplate[];
  /** taskId → run history */
  taskRuns: Record<string, TaskRun[]>;

  loadTasks: (projectId: string) => Promise<void>;
  loadGlobalTasks: () => Promise<void>;
  loadTemplates: () => Promise<void>;
  loadTaskRuns: (taskId: string) => Promise<void>;
  create: (projectId: string | undefined, data: Partial<ScheduledTask>) => Promise<ScheduledTask>;
  update: (taskId: string, projectId: string | undefined, data: Partial<ScheduledTask>) => Promise<void>;
  remove: (taskId: string, projectId: string | undefined) => Promise<void>;
  trigger: (taskId: string, projectId: string | undefined) => Promise<void>;
  enableTemplate: (projectId: string, templateId: string) => Promise<ScheduledTask>;

  // Called from WebSocket handler
  upsertTask: (projectId: string | undefined, task: ScheduledTask) => void;
  removeTask: (projectId: string | undefined, taskId: string) => void;
  getTaskProjectId: (taskId: string) => string | null;
  getTaskBackendId: (taskId: string) => string | null;
}

export const useScheduledTaskStore = create<ScheduledTaskState>((set, get) => ({
  tasks: {},
  templates: [],
  taskRuns: {},

  loadTasks: async (projectId) => {
    const backendId =
      useOwnershipStore.getState().getProjectBackendId(projectId)
      ?? useServerStore.getState().activeServerId;
    const tasks = await listScheduledTasks(projectId, toBackendArg(backendId));
    if (backendId) {
      useOwnershipStore.getState().setTaskOwners(tasks.map((task) => task.id), backendId, projectId);
    }
    set((state) => ({ tasks: { ...state.tasks, [projectId]: tasks } }));
  },

  loadGlobalTasks: async () => {
    const backendId = useServerStore.getState().activeServerId;
    const tasks = await listGlobalScheduledTasks(toBackendArg(backendId));
    if (backendId) {
      useOwnershipStore.getState().setTaskOwners(tasks.map((task) => task.id), backendId, null);
    }
    set((state) => ({ tasks: { ...state.tasks, [GLOBAL_KEY]: tasks } }));
  },

  loadTemplates: async () => {
    const templates = await listScheduledTaskTemplates();
    set({ templates });
  },

  loadTaskRuns: async (taskId) => {
    const backendId = useOwnershipStore.getState().getTaskBackendId(taskId);
    const runs = await listTaskRuns(taskId, 50, toBackendArg(backendId));
    set((state) => ({ taskRuns: { ...state.taskRuns, [taskId]: runs } }));
  },

  create: async (projectId, data) => {
    const backendId = projectId
      ? (useOwnershipStore.getState().getProjectBackendId(projectId) ?? useServerStore.getState().activeServerId)
      : useServerStore.getState().activeServerId;
    const task = await createScheduledTask(projectId, data, toBackendArg(backendId));
    const key = projectId ?? GLOBAL_KEY;
    if (backendId) {
      useOwnershipStore.getState().setTaskOwner(task.id, backendId, projectId ?? null);
    }
    set((state) => {
      const existing = state.tasks[key] ?? [];
      return { tasks: { ...state.tasks, [key]: [task, ...existing] } };
    });
    return task;
  },

  update: async (taskId, projectId, data) => {
    const backendId =
      useOwnershipStore.getState().getTaskBackendId(taskId)
      ?? (projectId
        ? (useOwnershipStore.getState().getProjectBackendId(projectId) ?? useServerStore.getState().activeServerId)
        : useServerStore.getState().activeServerId);
    const task = await updateScheduledTask(taskId, data, toBackendArg(backendId));
    get().upsertTask(projectId, task);
  },

  remove: async (taskId, projectId) => {
    const backendId =
      useOwnershipStore.getState().getTaskBackendId(taskId)
      ?? (projectId
        ? (useOwnershipStore.getState().getProjectBackendId(projectId) ?? useServerStore.getState().activeServerId)
        : useServerStore.getState().activeServerId);
    await deleteScheduledTask(taskId, toBackendArg(backendId));
    get().removeTask(projectId, taskId);
  },

  trigger: async (taskId, projectId) => {
    const backendId =
      useOwnershipStore.getState().getTaskBackendId(taskId)
      ?? (projectId
        ? (useOwnershipStore.getState().getProjectBackendId(projectId) ?? useServerStore.getState().activeServerId)
        : useServerStore.getState().activeServerId);
    const task = await triggerScheduledTask(taskId, toBackendArg(backendId));
    get().upsertTask(projectId, task);
  },

  enableTemplate: async (projectId, templateId) => {
    const backendId =
      useOwnershipStore.getState().getProjectBackendId(projectId)
      ?? useServerStore.getState().activeServerId;
    const task = await enableTemplateTask(projectId, templateId, toBackendArg(backendId));
    get().upsertTask(projectId, task);
    return task;
  },

  upsertTask: (projectId, task) =>
    set((state) => {
      const key = projectId ?? GLOBAL_KEY;
      const backendId =
        (projectId
          ? (useOwnershipStore.getState().getProjectBackendId(projectId) ?? useServerStore.getState().activeServerId)
          : useServerStore.getState().activeServerId)
        ?? useOwnershipStore.getState().getTaskBackendId(task.id);
      if (backendId) {
        useOwnershipStore.getState().setTaskOwner(task.id, backendId, projectId ?? null);
      }
      const existing = state.tasks[key] ?? [];
      const idx = existing.findIndex((t) => t.id === task.id);
      const updated =
        idx >= 0 ? existing.map((t, i) => (i === idx ? task : t)) : [task, ...existing];
      return { tasks: { ...state.tasks, [key]: updated } };
    }),

  removeTask: (projectId, taskId) =>
    set((state) => {
      const key = projectId ?? GLOBAL_KEY;
      const existing = state.tasks[key] ?? [];
      useOwnershipStore.getState().removeTaskOwner(taskId);
      return { tasks: { ...state.tasks, [key]: existing.filter((t) => t.id !== taskId) } };
    }),

  getTaskProjectId: (taskId) => useOwnershipStore.getState().getTaskProjectId(taskId),
  getTaskBackendId: (taskId) => useOwnershipStore.getState().getTaskBackendId(taskId),
}));
