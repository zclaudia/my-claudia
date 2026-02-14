import { create } from 'zustand';
import type { Project, Session, SlashCommand, ProviderConfig, ProviderCapabilities } from '@my-claudia/shared';

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
      const session = state.sessions.find((s) => s.id === id);
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
