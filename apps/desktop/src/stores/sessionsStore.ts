/**
 * Sessions Store - manages remote sessions from connected backends
 */
import { create } from 'zustand';
import type { Session } from '@my-claudia/shared';

export interface RemoteSession extends Session {
  isActive: boolean;  // Whether there's an active run
}

interface SessionsState {
  // Remote sessions organized by backendId
  remoteSessions: Map<string, RemoteSession[]>;

  // Actions
  setRemoteSessions: (backendId: string, sessions: RemoteSession[]) => void;
  handleSessionEvent: (
    backendId: string,
    eventType: 'created' | 'updated' | 'deleted',
    session: RemoteSession
  ) => void;
  reconcileActiveStatus: (backendId: string, activeSessionIds: Set<string>) => void;
  clearBackendSessions: (backendId: string) => void;
  clearAllSessions: () => void;
}

export const useSessionsStore = create<SessionsState>((set) => ({
  remoteSessions: new Map(),

  setRemoteSessions: (backendId: string, sessions: RemoteSession[]) => {
    set((state) => {
      const newMap = new Map(state.remoteSessions);
      newMap.set(backendId, sessions);
      return { remoteSessions: newMap };
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

      if (eventType === 'created') {
        // Add new session
        newMap.set(backendId, [...backendSessions, session]);
      } else if (eventType === 'updated') {
        // Update existing session
        newMap.set(
          backendId,
          backendSessions.map((s) => (s.id === session.id ? session : s))
        );
      } else if (eventType === 'deleted') {
        // Remove session
        newMap.set(
          backendId,
          backendSessions.filter((s) => s.id !== session.id)
        );
      }

      return { remoteSessions: newMap };
    });
  },

  // Update isActive status based on backend's state heartbeat
  reconcileActiveStatus: (backendId: string, activeSessionIds: Set<string>) => {
    set((state) => {
      const sessions = state.remoteSessions.get(backendId);
      if (!sessions) return state;

      const updated = sessions.map(s => ({
        ...s,
        isActive: activeSessionIds.has(s.id)
      }));

      // Only update if something changed
      const changed = sessions.some((s, i) => s.isActive !== updated[i].isActive);
      if (!changed) return state;

      const newMap = new Map(state.remoteSessions);
      newMap.set(backendId, updated);
      return { remoteSessions: newMap };
    });
  },

  clearBackendSessions: (backendId: string) => {
    set((state) => {
      const newMap = new Map(state.remoteSessions);
      newMap.delete(backendId);
      return { remoteSessions: newMap };
    });
  },

  clearAllSessions: () => {
    set({ remoteSessions: new Map() });
  },
}));
