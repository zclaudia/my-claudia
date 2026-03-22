import { create } from 'zustand';
import type { ClaudiaTaskStatus } from '@my-claudia/shared';

export interface ClaudiaTask {
  id: string;              // orchestrator task ID
  sessionId: string | null; // backend agent session
  input: string;
  title: string;
  status: ClaudiaTaskStatus;
  summary?: string;
  error?: string;
  createdAt: number;
}

interface ClaudiaState {
  // UI state
  isExpanded: boolean;
  claudiaSessionId: string | null; // hub session for Claudia chat history

  // Tasks
  tasks: ClaudiaTask[];

  // Continue mode
  continueTaskId: string | null;

  // Actions
  toggleExpanded: () => void;
  setExpanded: (v: boolean) => void;
  setClaudiaSessionId: (id: string | null) => void;

  addTask: (task: ClaudiaTask) => void;
  setTasks: (tasks: ClaudiaTask[]) => void;
  updateTask: (taskId: string, updates: Partial<ClaudiaTask>) => void;
  removeTask: (taskId: string) => void;

  setContinueTaskId: (id: string | null) => void;
  clearTasks: () => void;
  reset: () => void;
}

export const useClaudiaStore = create<ClaudiaState>((set) => ({
  isExpanded: false,
  claudiaSessionId: null,
  tasks: [],
  continueTaskId: null,

  toggleExpanded: () => set((s) => ({ isExpanded: !s.isExpanded })),
  setExpanded: (v) => set({ isExpanded: v }),
  setClaudiaSessionId: (id) => set({ claudiaSessionId: id }),

  addTask: (task) => set((s) => ({
    tasks: [task, ...s.tasks],
  })),

  setTasks: (tasks) => set({ tasks, continueTaskId: null }),

  updateTask: (taskId, updates) => set((s) => ({
    tasks: s.tasks.map((t) => t.id === taskId ? { ...t, ...updates } : t),
  })),

  removeTask: (taskId) => set((s) => ({
    tasks: s.tasks.filter((t) => t.id !== taskId),
  })),

  setContinueTaskId: (id) => set({ continueTaskId: id }),

  clearTasks: () => set((s) => ({
    tasks: s.tasks.filter((t) => t.status === 'running' || t.status === 'queued'),
    continueTaskId: s.continueTaskId && s.tasks.some((t) => t.id === s.continueTaskId && (t.status === 'running' || t.status === 'queued'))
      ? s.continueTaskId
      : null,
  })),

  reset: () => set({
    isExpanded: false,
    claudiaSessionId: null,
    tasks: [],
    continueTaskId: null,
  }),
}));
