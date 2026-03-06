/**
 * Sessions Store - manages remote sessions from connected backends
 */
import { create } from 'zustand';
import type { Session } from '@my-claudia/shared';

export interface RemoteSession extends Session {
  isActive: boolean;  // Whether there's an active run
  lastMessageOffset?: number;  // Max message offset (for gap detection)
}

export const LOCAL_BACKEND_KEY = '__local__';

interface SessionsState {
  // Remote sessions organized by backendId
  remoteSessions: Map<string, RemoteSession[]>;
  // Single source of truth for active sessions by backend key
  // - local direct server: "__local__"
  // - gateway backend: raw backendId
  activeSessionIdsByBackend: Map<string, Set<string>>;

  // Actions
  setRemoteSessions: (backendId: string, sessions: RemoteSession[]) => void;
  handleSessionEvent: (
    backendId: string,
    eventType: 'created' | 'updated' | 'deleted',
    session: RemoteSession
  ) => void;
  setActiveSessionsForBackend: (backendId: string, activeSessionIds: Set<string>) => void;
  setSessionActiveFlag: (backendId: string, sessionId: string, isActive: boolean) => void;
  reconcileActiveStatus: (backendId: string, activeSessionIds: Set<string>) => void;
  setSessionActiveById: (backendId: string, sessionId: string, isActive: boolean) => void;
  clearBackendSessions: (backendId: string) => void;
  clearAllSessions: () => void;
}

export const useSessionsStore = create<SessionsState>((set) => ({
  remoteSessions: new Map(),
  activeSessionIdsByBackend: new Map(),

  setRemoteSessions: (backendId: string, sessions: RemoteSession[]) => {
    set((state) => {
      const newMap = new Map(state.remoteSessions);
      newMap.set(backendId, sessions);

      // Keep active index in sync with incoming snapshot
      const newActiveMap = new Map(state.activeSessionIdsByBackend);
      const activeIds = new Set<string>(sessions.filter(s => s.isActive).map(s => s.id));
      newActiveMap.set(backendId, activeIds);

      return {
        remoteSessions: newMap,
        activeSessionIdsByBackend: newActiveMap,
      };
    });
  },

  handleSessionEvent: (
    backendId: string,
    eventType: 'created' | 'updated' | 'deleted',
    session: RemoteSession
  ) => {
    set((state) => {
      const newMap = new Map(state.remoteSessions);
      const backendSessions = newMap.get(backendId) || [];
      const newActiveMap = new Map(state.activeSessionIdsByBackend);
      const backendActive = new Set(newActiveMap.get(backendId) || []);

      if (eventType === 'created') {
        // Dedup: skip if session already exists (e.g. both WebSocket push and sessionSync detected it)
        if (backendSessions.some((s) => s.id === session.id)) return state;
        newMap.set(backendId, [...backendSessions, session]);
        if (session.isActive) backendActive.add(session.id);
      } else if (eventType === 'updated') {
        // Update existing session
        newMap.set(
          backendId,
          backendSessions.map((s) => (s.id === session.id ? session : s))
        );
        if (session.isActive) backendActive.add(session.id);
        else backendActive.delete(session.id);
      } else if (eventType === 'deleted') {
        // Remove session
        newMap.set(
          backendId,
          backendSessions.filter((s) => s.id !== session.id)
        );
        backendActive.delete(session.id);
      }

      newActiveMap.set(backendId, backendActive);
      return {
        remoteSessions: newMap,
        activeSessionIdsByBackend: newActiveMap,
      };
    });
  },

  setActiveSessionsForBackend: (backendId: string, activeSessionIds: Set<string>) => {
    set((state) => {
      const current = state.activeSessionIdsByBackend.get(backendId);
      if (current && current.size === activeSessionIds.size) {
        let same = true;
        for (const id of activeSessionIds) {
          if (!current.has(id)) {
            same = false;
            break;
          }
        }
        if (same) return state;
      }

      const newActiveMap = new Map(state.activeSessionIdsByBackend);
      newActiveMap.set(backendId, new Set(activeSessionIds));
      return { activeSessionIdsByBackend: newActiveMap };
    });
  },

  setSessionActiveFlag: (backendId: string, sessionId: string, isActive: boolean) => {
    set((state) => {
      const newActiveMap = new Map(state.activeSessionIdsByBackend);
      const backendActive = new Set(newActiveMap.get(backendId) || []);

      const had = backendActive.has(sessionId);
      if (isActive) backendActive.add(sessionId);
      else backendActive.delete(sessionId);

      if (had === backendActive.has(sessionId)) return state;

      newActiveMap.set(backendId, backendActive);
      return { activeSessionIdsByBackend: newActiveMap };
    });
  },

  // Update isActive status based on backend's state heartbeat
  reconcileActiveStatus: (backendId: string, activeSessionIds: Set<string>) => {
    set((state) => {
      const sessions = state.remoteSessions.get(backendId);
      const newActiveMap = new Map(state.activeSessionIdsByBackend);
      newActiveMap.set(backendId, new Set(activeSessionIds));
      if (!sessions) return { activeSessionIdsByBackend: newActiveMap };

      const updated = sessions.map(s => ({
        ...s,
        isActive: activeSessionIds.has(s.id)
      }));

      // Only update if something changed
      const changed = sessions.some((s, i) => s.isActive !== updated[i].isActive);
      if (!changed) return { activeSessionIdsByBackend: newActiveMap };

      const newMap = new Map(state.remoteSessions);
      newMap.set(backendId, updated);
      return {
        remoteSessions: newMap,
        activeSessionIdsByBackend: newActiveMap,
      };
    });
  },

  // Set isActive for a specific session (used by run_started / run_failed / run_completed)
  setSessionActiveById: (backendId: string, sessionId: string, isActive: boolean) => {
    set((state) => {
      const newActiveMap = new Map(state.activeSessionIdsByBackend);
      const backendActive = new Set(newActiveMap.get(backendId) || []);
      if (isActive) backendActive.add(sessionId);
      else backendActive.delete(sessionId);
      newActiveMap.set(backendId, backendActive);

      const sessions = state.remoteSessions.get(backendId);
      if (!sessions) return { activeSessionIdsByBackend: newActiveMap };

      const idx = sessions.findIndex(s => s.id === sessionId);
      if (idx === -1 || sessions[idx].isActive === isActive) {
        return { activeSessionIdsByBackend: newActiveMap };
      }

      const newMap = new Map(state.remoteSessions);
      const updated = [...sessions];
      updated[idx] = { ...updated[idx], isActive };
      newMap.set(backendId, updated);
      return {
        remoteSessions: newMap,
        activeSessionIdsByBackend: newActiveMap,
      };
    });
  },

  clearBackendSessions: (backendId: string) => {
    set((state) => {
      const newMap = new Map(state.remoteSessions);
      newMap.delete(backendId);
      const newActiveMap = new Map(state.activeSessionIdsByBackend);
      newActiveMap.delete(backendId);
      return {
        remoteSessions: newMap,
        activeSessionIdsByBackend: newActiveMap,
      };
    });
  },

  clearAllSessions: () => {
    set({
      remoteSessions: new Map(),
      activeSessionIdsByBackend: new Map(),
    });
  },
}));
