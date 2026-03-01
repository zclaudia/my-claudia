import { create } from 'zustand';
import type { Project, Session, SlashCommand, ProviderConfig, ProviderCapabilities } from '@my-claudia/shared';
import { useSessionsStore } from './sessionsStore';

interface ProjectState {
  projects: Project[];
  sessions: Session[];
  providers: ProviderConfig[];
  selectedProjectId: string | null;
  selectedSessionId: string | null;
  providerCommands: Record<string, SlashCommand[]>;
  providerCapabilities: Record<string, ProviderCapabilities>;

  // Actions
  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;

  setSessions: (sessions: Session[]) => void;
  mergeSessions: (incoming: Session[]) => void;
  addSession: (session: Session) => void;
  updateSession: (id: string, updates: Partial<Session>) => void;
  deleteSession: (id: string) => void;
  setSessionActive: (sessionId: string, isActive: boolean) => void;

  setProviders: (providers: ProviderConfig[]) => void;

  selectProject: (id: string | null) => void;
  selectSession: (id: string | null) => void;

  setProviderCommands: (providerId: string, commands: SlashCommand[]) => void;
  setProviderCapabilities: (providerId: string, capabilities: ProviderCapabilities) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  sessions: [],
  providers: [],
  selectedProjectId: null,
  selectedSessionId: null,
  providerCommands: {},
  providerCapabilities: {},

  setProjects: (projects) => set({ projects }),

  addProject: (project) =>
    set((state) => ({ projects: [...state.projects, project] })),

  updateProject: (id, updates) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === id ? { ...p, ...updates } : p
      ),
    })),

  deleteProject: (id) =>
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      sessions: state.sessions.filter((s) => s.projectId !== id),
      selectedProjectId:
        state.selectedProjectId === id ? null : state.selectedProjectId,
      selectedSessionId:
        state.sessions.find((s) => s.id === state.selectedSessionId)
          ?.projectId === id
          ? null
          : state.selectedSessionId,
    })),

  setSessions: (sessions) => set({ sessions }),

  mergeSessions: (incoming) =>
    set((state) => {
      const merged = incoming.map((s) => {
        const existing = state.sessions.find((e) => e.id === s.id);
        // Preserve isActive from in-flight WebSocket updates
        if (existing?.isActive && !s.isActive) return { ...s, isActive: true };
        return s;
      });
      return { sessions: merged };
    }),

  addSession: (session) =>
    set((state) => ({ sessions: [...state.sessions, session] })),

  updateSession: (id, updates) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, ...updates } : s
      ),
    })),

  deleteSession: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      selectedSessionId:
        state.selectedSessionId === id ? null : state.selectedSessionId,
    })),

  setSessionActive: (sessionId, isActive) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, isActive } : s
      ),
    })),

  setProviders: (providers) => set({ providers }),

  selectProject: (id) => set({ selectedProjectId: id }),

  selectSession: (id) =>
    set((state) => {
      let session = state.sessions.find((s) => s.id === id);
      // Fall back to remote sessions (gateway) if not in local store
      if (!session && id) {
        for (const [, sessions] of useSessionsStore.getState().remoteSessions) {
          const remote = sessions.find((s) => s.id === id);
          if (remote) { session = remote; break; }
        }
      }
      return {
        selectedSessionId: id,
        selectedProjectId: session?.projectId || state.selectedProjectId,
      };
    }),

  setProviderCommands: (providerId, commands) =>
    set((state) => ({
      providerCommands: {
        ...state.providerCommands,
        [providerId]: commands,
      },
    })),

  setProviderCapabilities: (providerId, capabilities) =>
    set((state) => ({
      providerCapabilities: {
        ...state.providerCapabilities,
        [providerId]: capabilities,
      },
    })),
}));
