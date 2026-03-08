import { create } from 'zustand';
import type { ScheduledTask, ScheduledTaskTemplate } from '@my-claudia/shared';
import {
  listScheduledTasks,
  listGlobalScheduledTasks,
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  triggerScheduledTask,
  listScheduledTaskTemplates,
  enableTemplateTask,
} from '../services/api';

const GLOBAL_KEY = '__global__';

interface ScheduledTaskState {
  /** projectId → tasks (GLOBAL_KEY for global tasks) */
  tasks: Record<string, ScheduledTask[]>;
  templates: ScheduledTaskTemplate[];

  loadTasks: (projectId: string) => Promise<void>;
  loadGlobalTasks: () => Promise<void>;
  loadTemplates: () => Promise<void>;
  create: (projectId: string | undefined, data: Partial<ScheduledTask>) => Promise<ScheduledTask>;
  update: (taskId: string, projectId: string | undefined, data: Partial<ScheduledTask>) => Promise<void>;
  remove: (taskId: string, projectId: string | undefined) => Promise<void>;
  trigger: (taskId: string, projectId: string | undefined) => Promise<void>;
  enableTemplate: (projectId: string, templateId: string) => Promise<ScheduledTask>;

  // Called from WebSocket handler
  upsertTask: (projectId: string | undefined, task: ScheduledTask) => void;
  removeTask: (projectId: string | undefined, taskId: string) => void;
}

export const useScheduledTaskStore = create<ScheduledTaskState>((set, get) => ({
  tasks: {},
  templates: [],

  loadTasks: async (projectId) => {
    const tasks = await listScheduledTasks(projectId);
    set((state) => ({ tasks: { ...state.tasks, [projectId]: tasks } }));
  },

  loadGlobalTasks: async () => {
    const tasks = await listGlobalScheduledTasks();
    set((state) => ({ tasks: { ...state.tasks, [GLOBAL_KEY]: tasks } }));
  },

  loadTemplates: async () => {
    const templates = await listScheduledTaskTemplates();
    set({ templates });
  },

  create: async (projectId, data) => {
    const task = await createScheduledTask(projectId, data);
    const key = projectId ?? GLOBAL_KEY;
    set((state) => {
      const existing = state.tasks[key] ?? [];
      return { tasks: { ...state.tasks, [key]: [task, ...existing] } };
    });
    return task;
  },

  update: async (taskId, projectId, data) => {
    const task = await updateScheduledTask(taskId, data);
    get().upsertTask(projectId, task);
  },

  remove: async (taskId, projectId) => {
    await deleteScheduledTask(taskId);
    get().removeTask(projectId, taskId);
  },

  trigger: async (taskId, projectId) => {
    const task = await triggerScheduledTask(taskId);
    get().upsertTask(projectId, task);
  },

  enableTemplate: async (projectId, templateId) => {
    const task = await enableTemplateTask(projectId, templateId);
    get().upsertTask(projectId, task);
    return task;
  },

  upsertTask: (projectId, task) =>
    set((state) => {
      const key = projectId ?? GLOBAL_KEY;
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
      return { tasks: { ...state.tasks, [key]: existing.filter((t) => t.id !== taskId) } };
    }),
}));
