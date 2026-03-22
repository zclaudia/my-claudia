import { create } from 'zustand';
import type { ClaudiaTaskStatus } from '@my-claudia/shared';

const LAST_VIEWED_KEY = 'claudia-last-viewed-at';

function loadLastViewedAt(): number {
  if (typeof window === 'undefined') return 0;
  const raw = window.localStorage.getItem(LAST_VIEWED_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function persistLastViewedAt(value: number): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LAST_VIEWED_KEY, String(value));
}

export interface ClaudiaTask {
  id: string;              // orchestrator task ID
  sessionId: string | null; // backend agent session
  input: string;
  title: string;
  status: ClaudiaTaskStatus;
  summary?: string;
  error?: string;
  responseText?: string;   // Full assistant response
  toolCount?: number;
  createdAt: number;
  updatedAt: number;
}

export interface InlineResponse {
  clientRequestId: string;
  input: string;
  streamingText: string;
  status: 'streaming' | 'completed' | 'failed' | 'promoted';
  responseText?: string;
  error?: string;
  promotedTaskId?: string;
  createdAt: number;
}

interface ClaudiaState {
  // UI state
  isExpanded: boolean;
  claudiaSessionId: string | null;
  lastViewedAt: number;

  // Tasks (background)
  tasks: ClaudiaTask[];

  // Streaming text for running tasks
  streamingText: Record<string, string>;

  // Inline responses
  inlineResponses: InlineResponse[];

  // Continue mode
  continueTaskId: string | null;

  // Actions
  toggleExpanded: () => void;
  setExpanded: (v: boolean) => void;
  setClaudiaSessionId: (id: string | null) => void;
  markViewed: () => void;

  addTask: (task: ClaudiaTask) => void;
  setTasks: (tasks: ClaudiaTask[]) => void;
  updateTask: (taskId: string, updates: Partial<ClaudiaTask>) => void;
  removeTask: (taskId: string) => void;

  appendStreamingText: (taskId: string, content: string) => void;
  clearStreamingText: (taskId: string) => void;

  startInline: (clientRequestId: string, input: string) => void;
  appendInlineDelta: (clientRequestId: string, content: string) => void;
  completeInline: (clientRequestId: string, responseText: string) => void;
  failInline: (clientRequestId: string, error: string) => void;
  promoteInline: (clientRequestId: string, taskId: string) => void;

  setContinueTaskId: (id: string | null) => void;
  clearTasks: () => void;
  reset: () => void;
}

export const useClaudiaStore = create<ClaudiaState>((set) => ({
  isExpanded: false,
  claudiaSessionId: null,
  lastViewedAt: loadLastViewedAt(),
  tasks: [],
  streamingText: {},
  inlineResponses: [],
  continueTaskId: null,

  toggleExpanded: () => set((s) => {
    const isExpanded = !s.isExpanded;
    if (!isExpanded) return { isExpanded };
    const lastViewedAt = Date.now();
    persistLastViewedAt(lastViewedAt);
    return { isExpanded, lastViewedAt };
  }),
  setExpanded: (v) => set((s) => {
    if (!v) return { isExpanded: false };
    const lastViewedAt = Date.now();
    persistLastViewedAt(lastViewedAt);
    return { isExpanded: true, lastViewedAt: Math.max(s.lastViewedAt, lastViewedAt) };
  }),
  setClaudiaSessionId: (id) => set({ claudiaSessionId: id }),
  markViewed: () => set((s) => {
    const lastViewedAt = Date.now();
    persistLastViewedAt(lastViewedAt);
    return { lastViewedAt: Math.max(s.lastViewedAt, lastViewedAt) };
  }),

  addTask: (task) => set((s) => {
    const normalizedTask = { ...task, updatedAt: task.updatedAt || task.createdAt };
    const tasks = [normalizedTask, ...s.tasks.filter((existing) => existing.id !== normalizedTask.id)];
    if (!s.isExpanded) return { tasks };
    const lastViewedAt = Math.max(s.lastViewedAt, normalizedTask.updatedAt);
    persistLastViewedAt(lastViewedAt);
    return { tasks, lastViewedAt };
  }),

  setTasks: (tasks) => set((s) => {
    const normalizedTasks = tasks.map((task) => {
      const existing = s.tasks.find((current) => current.id === task.id);
      return {
        ...existing,
        ...task,
        updatedAt: task.updatedAt || task.createdAt,
      };
    });
    if (!s.isExpanded) return { tasks: normalizedTasks, continueTaskId: null };
    const latestUpdate = normalizedTasks.reduce((max, task) => Math.max(max, task.updatedAt), s.lastViewedAt);
    persistLastViewedAt(latestUpdate);
    return { tasks: normalizedTasks, continueTaskId: null, lastViewedAt: latestUpdate };
  }),

  updateTask: (taskId, updates) => set((s) => {
    let nextUpdatedAt = s.lastViewedAt;
    const tasks = s.tasks.map((task) => {
      if (task.id !== taskId) return task;
      const updatedTask = {
        ...task,
        ...updates,
        updatedAt: updates.updatedAt || Date.now(),
      };
      nextUpdatedAt = Math.max(nextUpdatedAt, updatedTask.updatedAt);
      return updatedTask;
    });
    if (!s.isExpanded) return { tasks };
    persistLastViewedAt(nextUpdatedAt);
    return { tasks, lastViewedAt: nextUpdatedAt };
  }),

  removeTask: (taskId) => set((s) => ({
    tasks: s.tasks.filter((t) => t.id !== taskId),
  })),

  appendStreamingText: (taskId, content) => set((s) => ({
    streamingText: { ...s.streamingText, [taskId]: (s.streamingText[taskId] || '') + content },
  })),

  clearStreamingText: (taskId) => set((s) => {
    const { [taskId]: _, ...rest } = s.streamingText;
    return { streamingText: rest };
  }),

  startInline: (clientRequestId, input) => set((s) => ({
    inlineResponses: [...s.inlineResponses, {
      clientRequestId,
      input,
      streamingText: '',
      status: 'streaming' as const,
      createdAt: Date.now(),
    }],
  })),

  appendInlineDelta: (clientRequestId, content) => set((s) => ({
    inlineResponses: s.inlineResponses.map((r) =>
      r.clientRequestId === clientRequestId
        ? { ...r, streamingText: r.streamingText + content }
        : r
    ),
  })),

  completeInline: (clientRequestId, responseText) => set((s) => ({
    inlineResponses: s.inlineResponses.map((r) =>
      r.clientRequestId === clientRequestId
        ? { ...r, status: 'completed' as const, responseText }
        : r
    ),
  })),

  failInline: (clientRequestId, error) => set((s) => ({
    inlineResponses: s.inlineResponses.map((r) =>
      r.clientRequestId === clientRequestId
        ? { ...r, status: 'failed' as const, error }
        : r
    ),
  })),

  promoteInline: (clientRequestId, taskId) => set((s) => ({
    inlineResponses: s.inlineResponses.map((r) =>
      r.clientRequestId === clientRequestId
        ? { ...r, status: 'promoted' as const, promotedTaskId: taskId }
        : r
    ),
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
    lastViewedAt: loadLastViewedAt(),
    tasks: [],
    streamingText: {},
    inlineResponses: [],
    continueTaskId: null,
  }),
}));
