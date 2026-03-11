import { create } from 'zustand';

export interface BackgroundTask {
  id: string;                    // taskId from SDK
  toolUseId?: string;            // tool_use_id that triggered this background task
  sessionId: string;             // parent session ID
  description: string;           // task description
  status: 'started' | 'in_progress' | 'completed' | 'failed' | 'stopped';
  outputFile?: string;           // output file path (for completed tasks)
  summary?: string;              // summary message
  startedAt: number;             // timestamp when task started
  completedAt?: number;          // timestamp when task completed
  usage?: {
    total_tokens: number;
    tool_uses: number;
    duration_ms: number;
  };
}

interface BackgroundTaskState {
  // Background tasks keyed by task ID
  tasks: Record<string, BackgroundTask>;

  // Actions
  addTask: (task: BackgroundTask) => void;
  updateTask: (taskId: string, updates: Partial<BackgroundTask>) => void;
  removeTask: (taskId: string) => void;
  clearTasks: (sessionId?: string) => void;
  getTasksBySession: (sessionId: string) => BackgroundTask[];
}

export const useBackgroundTaskStore = create<BackgroundTaskState>((set, get) => ({
  tasks: {},

  addTask: (task) => set((state) => ({
    tasks: { ...state.tasks, [task.id]: task }
  })),

  updateTask: (taskId, updates) => {
    set((state) => ({
      tasks: {
        ...state.tasks,
        [taskId]: { ...state.tasks[taskId], ...updates }
      }
    }));
    // Auto-remove completed/failed/stopped tasks after 15 seconds
    const status = updates.status || get().tasks[taskId]?.status;
    if (status === 'completed' || status === 'failed' || status === 'stopped') {
      setTimeout(() => get().removeTask(taskId), 15_000);
    }
  },

  removeTask: (taskId) => set((state) => {
    const { [taskId]: _, ...rest } = state.tasks;
    return { tasks: rest };
  }),

  clearTasks: (sessionId) => set((state) => {
    if (!sessionId) return { tasks: {} };
    const filteredTasks = Object.fromEntries(
      Object.entries(state.tasks).filter(([_, task]) => task.sessionId !== sessionId)
    );
    return { tasks: filteredTasks };
  }),

  getTasksBySession: (sessionId) => {
    const state = get();
    return Object.values(state.tasks).filter(task => task.sessionId === sessionId);
  }
}));
