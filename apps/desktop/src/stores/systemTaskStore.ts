import { create } from 'zustand';
import type { SystemTaskInfo, TaskRun } from '@my-claudia/shared';
import { listSystemTasks, listTaskRuns } from '../services/api';

interface SystemTaskState {
  tasks: SystemTaskInfo[];
  taskRuns: Record<string, TaskRun[]>; // taskId → runs

  loadTasks: () => Promise<void>;
  loadTaskRuns: (taskId: string) => Promise<void>;

  // Called from WebSocket handler
  updateTask: (task: SystemTaskInfo) => void;
}

export const useSystemTaskStore = create<SystemTaskState>((set) => ({
  tasks: [],
  taskRuns: {},

  loadTasks: async () => {
    const tasks = await listSystemTasks();
    set({ tasks });
  },

  loadTaskRuns: async (taskId) => {
    const runs = await listTaskRuns(taskId);
    set((state) => ({ taskRuns: { ...state.taskRuns, [taskId]: runs } }));
  },

  updateTask: (task) =>
    set((state) => {
      const idx = state.tasks.findIndex((t) => t.id === task.id);
      const updated =
        idx >= 0
          ? state.tasks.map((t, i) => (i === idx ? task : t))
          : [...state.tasks, task];
      return { tasks: updated };
    }),
}));
