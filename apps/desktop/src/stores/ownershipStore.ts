import { create } from 'zustand';

interface OwnershipState {
  sessionBackendIds: Record<string, string>;
  projectBackendIds: Record<string, string>;
  taskOwners: Record<string, { backendId: string; projectId: string | null }>;
  setSessionOwner: (sessionId: string, backendId: string) => void;
  setSessionOwners: (sessionIds: string[], backendId: string) => void;
  removeSessionOwner: (sessionId: string) => void;
  removeSessionOwnersByBackend: (backendId: string) => void;
  clearSessionOwners: () => void;
  getSessionBackendId: (sessionId: string | null | undefined) => string | null;
  setProjectOwner: (projectId: string, backendId: string) => void;
  setProjectOwners: (projectIds: string[], backendId: string) => void;
  removeProjectOwner: (projectId: string) => void;
  removeProjectOwnersByBackend: (backendId: string) => void;
  clearProjectOwners: () => void;
  getProjectBackendId: (projectId: string | null | undefined) => string | null;
  setTaskOwner: (taskId: string, backendId: string, projectId?: string | null) => void;
  setTaskOwners: (taskIds: string[], backendId: string, projectId?: string | null) => void;
  removeTaskOwner: (taskId: string) => void;
  removeTaskOwnersByBackend: (backendId: string) => void;
  clearTaskOwners: () => void;
  getTaskBackendId: (taskId: string | null | undefined) => string | null;
  getTaskProjectId: (taskId: string | null | undefined) => string | null;
}

export const useOwnershipStore = create<OwnershipState>()((set, get) => ({
  sessionBackendIds: {},
  projectBackendIds: {},
  taskOwners: {},

  setSessionOwner: (sessionId, backendId) => set((state) => ({
    sessionBackendIds: {
      ...state.sessionBackendIds,
      [sessionId]: backendId,
    },
  })),

  setSessionOwners: (sessionIds, backendId) => set((state) => {
    if (sessionIds.length === 0) return state;

    const next = { ...state.sessionBackendIds };
    for (const sessionId of sessionIds) {
      next[sessionId] = backendId;
    }
    return { sessionBackendIds: next };
  }),

  removeSessionOwner: (sessionId) => set((state) => {
    if (!(sessionId in state.sessionBackendIds)) return state;
    const next = { ...state.sessionBackendIds };
    delete next[sessionId];
    return { sessionBackendIds: next };
  }),

  removeSessionOwnersByBackend: (backendId) => set((state) => {
    const next = { ...state.sessionBackendIds };
    let changed = false;
    for (const [sessionId, ownerBackendId] of Object.entries(next)) {
      if (ownerBackendId === backendId) {
        delete next[sessionId];
        changed = true;
      }
    }
    return changed ? { sessionBackendIds: next } : state;
  }),

  clearSessionOwners: () => set({ sessionBackendIds: {} }),

  getSessionBackendId: (sessionId) => {
    if (!sessionId) return null;
    return get().sessionBackendIds[sessionId] ?? null;
  },

  setProjectOwner: (projectId, backendId) => set((state) => ({
    projectBackendIds: {
      ...state.projectBackendIds,
      [projectId]: backendId,
    },
  })),

  setProjectOwners: (projectIds, backendId) => set((state) => {
    if (projectIds.length === 0) return state;

    const next = { ...state.projectBackendIds };
    for (const projectId of projectIds) {
      next[projectId] = backendId;
    }
    return { projectBackendIds: next };
  }),

  removeProjectOwner: (projectId) => set((state) => {
    if (!(projectId in state.projectBackendIds)) return state;
    const next = { ...state.projectBackendIds };
    delete next[projectId];
    return { projectBackendIds: next };
  }),

  removeProjectOwnersByBackend: (backendId) => set((state) => {
    const next = { ...state.projectBackendIds };
    let changed = false;
    for (const [projectId, ownerBackendId] of Object.entries(next)) {
      if (ownerBackendId === backendId) {
        delete next[projectId];
        changed = true;
      }
    }
    return changed ? { projectBackendIds: next } : state;
  }),

  clearProjectOwners: () => set({ projectBackendIds: {} }),

  getProjectBackendId: (projectId) => {
    if (!projectId) return null;
    return get().projectBackendIds[projectId] ?? null;
  },

  setTaskOwner: (taskId, backendId, projectId = null) => set((state) => ({
    taskOwners: {
      ...state.taskOwners,
      [taskId]: { backendId, projectId },
    },
  })),

  setTaskOwners: (taskIds, backendId, projectId = null) => set((state) => {
    if (taskIds.length === 0) return state;
    const next = { ...state.taskOwners };
    for (const taskId of taskIds) {
      next[taskId] = { backendId, projectId };
    }
    return { taskOwners: next };
  }),

  removeTaskOwner: (taskId) => set((state) => {
    if (!(taskId in state.taskOwners)) return state;
    const next = { ...state.taskOwners };
    delete next[taskId];
    return { taskOwners: next };
  }),

  removeTaskOwnersByBackend: (backendId) => set((state) => {
    const next = { ...state.taskOwners };
    let changed = false;
    for (const [taskId, owner] of Object.entries(next)) {
      if (owner.backendId === backendId) {
        delete next[taskId];
        changed = true;
      }
    }
    return changed ? { taskOwners: next } : state;
  }),

  clearTaskOwners: () => set({ taskOwners: {} }),

  getTaskBackendId: (taskId) => {
    if (!taskId) return null;
    return get().taskOwners[taskId]?.backendId ?? null;
  },

  getTaskProjectId: (taskId) => {
    if (!taskId) return null;
    return get().taskOwners[taskId]?.projectId ?? null;
  },
}));
