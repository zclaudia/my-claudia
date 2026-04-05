import { create } from 'zustand';
import { resolveCanonicalBackendId, resolveLocalBackendId } from '../utils/controlPlane';

interface OwnershipState {
  sessionBackendIds: Record<string, string>;
  sessionOwnershipVersions: Record<string, number>;
  projectBackendIds: Record<string, string>;
  taskOwners: Record<string, { backendId: string; projectId: string | null }>;
  setSessionOwner: (sessionId: string, backendId: string, ownershipVersion?: number) => void;
  setSessionOwners: (sessionIds: string[], backendId: string, ownershipVersion?: number) => void;
  removeSessionOwner: (sessionId: string) => void;
  removeSessionOwnersByBackend: (backendId: string) => void;
  clearSessionOwners: () => void;
  getSessionBackendId: (sessionId: string | null | undefined) => string | null;
  getSessionOwnershipVersion: (sessionId: string | null | undefined) => number | null;
  stampSessionOwnershipVersion: (sessionIds: string[], ownershipVersion: number) => void;
  stampBackendOwnershipVersion: (backendId: string, ownershipVersion: number) => void;
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
  sessionOwnershipVersions: {},
  projectBackendIds: {},
  taskOwners: {},

  setSessionOwner: (sessionId, backendId, ownershipVersion = 0) => set((state) => ({
    sessionBackendIds: {
      ...state.sessionBackendIds,
      [sessionId]: backendId,
    },
    sessionOwnershipVersions: {
      ...state.sessionOwnershipVersions,
      [sessionId]: ownershipVersion,
    },
  })),

  setSessionOwners: (sessionIds, backendId, ownershipVersion = 0) => set((state) => {
    if (sessionIds.length === 0) return state;

    const next = { ...state.sessionBackendIds };
    const nextVersions = { ...state.sessionOwnershipVersions };
    for (const sessionId of sessionIds) {
      next[sessionId] = backendId;
      nextVersions[sessionId] = ownershipVersion;
    }
    return {
      sessionBackendIds: next,
      sessionOwnershipVersions: nextVersions,
    };
  }),

  removeSessionOwner: (sessionId) => set((state) => {
    if (!(sessionId in state.sessionBackendIds)) return state;
    const next = { ...state.sessionBackendIds };
    const nextVersions = { ...state.sessionOwnershipVersions };
    delete next[sessionId];
    delete nextVersions[sessionId];
    return {
      sessionBackendIds: next,
      sessionOwnershipVersions: nextVersions,
    };
  }),

  removeSessionOwnersByBackend: (backendId) => set((state) => {
    const next = { ...state.sessionBackendIds };
    const nextVersions = { ...state.sessionOwnershipVersions };
    let changed = false;
    for (const [sessionId, ownerBackendId] of Object.entries(next)) {
      if (ownerBackendId === backendId) {
        delete next[sessionId];
        delete nextVersions[sessionId];
        changed = true;
      }
    }
    return changed
      ? {
          sessionBackendIds: next,
          sessionOwnershipVersions: nextVersions,
        }
      : state;
  }),

  clearSessionOwners: () => set({ sessionBackendIds: {}, sessionOwnershipVersions: {} }),

  getSessionBackendId: (sessionId) => {
    if (!sessionId) return null;
    const backendId = get().sessionBackendIds[sessionId] ?? null;
    if (!backendId) return null;
    return resolveCanonicalBackendId(backendId, resolveLocalBackendId() ?? backendId);
  },

  getSessionOwnershipVersion: (sessionId) => {
    if (!sessionId) return null;
    return get().sessionOwnershipVersions[sessionId] ?? null;
  },

  stampSessionOwnershipVersion: (sessionIds, ownershipVersion) => set((state) => {
    if (sessionIds.length === 0) return state;
    const allUpToDate = sessionIds.every(id => state.sessionOwnershipVersions[id] === ownershipVersion);
    if (allUpToDate) return state;
    const next = { ...state.sessionOwnershipVersions };
    for (const sessionId of sessionIds) {
      next[sessionId] = ownershipVersion;
    }
    return { sessionOwnershipVersions: next };
  }),

  stampBackendOwnershipVersion: (backendId, ownershipVersion) => set((state) => {
    const next = { ...state.sessionOwnershipVersions };
    let changed = false;
    for (const [sessionId, ownerBackendId] of Object.entries(state.sessionBackendIds)) {
      if (ownerBackendId === backendId) {
        next[sessionId] = ownershipVersion;
        changed = true;
      }
    }
    return changed ? { sessionOwnershipVersions: next } : state;
  }),

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
    const backendId = get().projectBackendIds[projectId] ?? null;
    if (!backendId) return null;
    return resolveCanonicalBackendId(backendId, resolveLocalBackendId() ?? backendId);
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
    const backendId = get().taskOwners[taskId]?.backendId ?? null;
    if (!backendId) return null;
    return resolveCanonicalBackendId(backendId, resolveLocalBackendId() ?? backendId);
  },

  getTaskProjectId: (taskId) => {
    if (!taskId) return null;
    return get().taskOwners[taskId]?.projectId ?? null;
  },
}));
