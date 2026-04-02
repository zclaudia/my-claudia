import { create } from 'zustand';
import type { SystemTaskInfo } from '@my-claudia/shared';
import { fetchLocalApi } from '../services/api';

interface SystemTaskState {
  tasks: SystemTaskInfo[];

  loadTasks: () => Promise<void>;

  // Called from WebSocket handler
  updateTask: (task: SystemTaskInfo) => void;
}

export const useSystemTaskStore = create<SystemTaskState>((set) => ({
  tasks: [],

  loadTasks: async () => {
    const res = await fetchLocalApi<SystemTaskInfo[]>('/api/system-tasks');
    if (res.success) set({ tasks: res.data });
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
