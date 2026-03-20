import { create } from 'zustand';
import { getProcessInfo } from '../services/api';

export interface BackgroundTask {
  id: string;                    // taskId from SDK
  serverId?: string;             // owning server/backend for heartbeat reconciliation
  toolUseId?: string;            // tool_use_id that triggered this background task
  sessionId: string;             // parent session ID
  description: string;           // task description
  source?: 'sdk_task' | 'background_run';
  stoppable?: boolean;
  status: 'started' | 'in_progress' | 'paused' | 'completed' | 'failed' | 'stopped';
  outputFile?: string;           // output file path (for completed tasks)
  summary?: string;              // summary message
  startedAt: number;             // timestamp when task started
  completedAt?: number;          // timestamp when task completed
  cliPid?: number;               // CLI subprocess PID (for display & process-tree killing)
  taskCommand?: string;          // Actual command being run (e.g. "npm test")
  taskRootPid?: number;          // Root PID of the task's process tree
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
  /** Start periodic PID liveness checking */
  startPidMonitor: () => void;
  /** Stop periodic PID liveness checking */
  stopPidMonitor: () => void;
}

const PID_CHECK_INTERVAL_MS = 10_000; // Check every 10 seconds

// Module-level state managed within the store's closure
let pidMonitorInterval: ReturnType<typeof setInterval> | null = null;

export const useBackgroundTaskStore = create<BackgroundTaskState>((set, get) => ({
  tasks: {},

  addTask: (task) => {
    set((state) => ({
      tasks: { ...state.tasks, [task.id]: task }
    }));
    // Auto-start PID monitor when a task with PID is added
    if (task.taskRootPid || task.cliPid) {
      get().startPidMonitor();
    }
  },

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
  },

  startPidMonitor: () => {
    if (pidMonitorInterval) return;
    pidMonitorInterval = setInterval(async () => {
      const { tasks, updateTask } = get();
      const runningTasks = Object.values(tasks).filter(
        t => (t.status === 'started' || t.status === 'in_progress') && (t.taskRootPid || t.cliPid),
      );

      if (runningTasks.length === 0) {
        // No running tasks with PIDs — stop monitoring
        get().stopPidMonitor();
        return;
      }

      for (const task of runningTasks) {
        const pid = task.taskRootPid || task.cliPid;
        if (!pid) continue;
        try {
          const info = await getProcessInfo(pid);
          if (!info.alive) {
            console.log(`[PidMonitor] PID ${pid} for task "${task.description}" is no longer alive, marking as stopped`);
            updateTask(task.id, {
              status: 'stopped',
              summary: (task.summary ? task.summary + '\n' : '') + `Process (PID ${pid}) exited unexpectedly`,
              completedAt: Date.now(),
            });
          }
        } catch {
          // API call failed, skip this check
        }
      }
    }, PID_CHECK_INTERVAL_MS);
  },

  stopPidMonitor: () => {
    if (pidMonitorInterval) {
      clearInterval(pidMonitorInterval);
      pidMonitorInterval = null;
    }
  },
}));

// Clean up interval on HMR module reload (Vite) and page unload
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    useBackgroundTaskStore.getState().stopPidMonitor();
  });
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    useBackgroundTaskStore.getState().stopPidMonitor();
  });
}
