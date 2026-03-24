import { create } from 'zustand';
import type { Project, Session, SlashCommand, ProviderConfig, ProviderCapabilities } from '@my-claudia/shared';
import { useSessionsStore } from './sessionsStore';
import { useChatStore } from './chatStore';
import { useProviderMetaStore } from './providerMetaStore';

export type ProjectDashboardView =
  | 'home'
  | 'tasks'
  | 'local-prs'
  | 'scheduled'
  | 'workflows'
  | 'supervisor';

interface ProjectState {
  projects: Project[];
  sessions: Session[];
  dataServerId: string | null;
  selectedProjectId: string | null;
  selectedSessionId: string | null;
  dashboardViews: Record<string, ProjectDashboardView>;

  /**
   * Provider data is kept here for backward compatibility.
   * New code should use useProviderMetaStore directly.
   * Writes are synced to providerMetaStore automatically.
   */
  providers: ProviderConfig[];
  providerCommands: Record<string, SlashCommand[]>;
  providerCapabilities: Record<string, ProviderCapabilities>;

  // Actions — projects
  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  reorderProjects: (orderedIds: string[]) => void;

  // Actions — sessions
  setSessions: (sessions: Session[]) => void;
  mergeSessions: (incoming: Session[]) => void;
  addSession: (session: Session) => void;
  updateSession: (id: string, updates: Partial<Session>) => void;
  deleteSession: (id: string) => void;
  setSessionActive: (sessionId: string, isActive: boolean) => void;
  reorderSessions: (projectId: string, orderedIds: string[]) => void;

  // Actions — providers (synced to providerMetaStore)
  setProviders: (providers: ProviderConfig[]) => void;
  setDataServerId: (serverId: string | null) => void;

  // Actions — selection & UI
  selectProject: (id: string | null) => void;
  selectSession: (id: string | null) => void;
  setDashboardView: (projectId: string, view: ProjectDashboardView) => void;

  // Actions — provider metadata (synced to providerMetaStore)
  setProviderCommands: (providerId: string, commands: SlashCommand[]) => void;
  setProviderCapabilities: (providerId: string, capabilities: ProviderCapabilities) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  sessions: [],
  providers: [],
  dataServerId: null,
  selectedProjectId: null,
  selectedSessionId: null,
  dashboardViews: {},
  providerCommands: {},
  providerCapabilities: {},

  // ── Project actions ──

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

  reorderProjects: (orderedIds) =>
    set((state) => {
      const idToProject = new Map(state.projects.map((p) => [p.id, p]));
      const reordered = orderedIds
        .map((id) => idToProject.get(id))
        .filter((p): p is Project => !!p);
      for (const p of state.projects) {
        if (!orderedIds.includes(p.id)) reordered.push(p);
      }
      return { projects: reordered };
    }),

  // ── Session actions ──

  setSessions: (sessions) => set({ sessions }),

  mergeSessions: (incoming) =>
    set((state) => {
      const merged = incoming.map((s) => {
        const existing = state.sessions.find((e) => e.id === s.id);
        if (!existing) {
          return { ...s, isActive: Boolean((s as Session & { isActive?: boolean }).isActive) };
        }

        const incomingIsActive = (s as Session & { isActive?: boolean }).isActive;
        const hasIncomingActive = typeof incomingIsActive === 'boolean';

        if (!hasIncomingActive) {
          return { ...s, isActive: Boolean((existing as Session & { isActive?: boolean }).isActive) };
        }

        if (existing.isActive && incomingIsActive === false) {
          const chat = useChatStore.getState();
          const hasForegroundRun = Object.entries(chat.activeRuns).some(
            ([runId, sid]) => sid === s.id && !chat.backgroundRunIds.has(runId)
          );
          if (hasForegroundRun) {
            return { ...s, isActive: true };
          }
        }

        return { ...s, isActive: incomingIsActive };
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

  reorderSessions: (projectId, orderedIds) =>
    set((state) => {
      const projectSessionIds = new Set(orderedIds);
      const idToSession = new Map(
        state.sessions.filter((s) => s.projectId === projectId).map((s) => [s.id, s])
      );
      const reordered = orderedIds
        .map((id) => idToSession.get(id))
        .filter((s): s is Session => !!s);
      for (const s of state.sessions) {
        if (s.projectId === projectId && !projectSessionIds.has(s.id)) reordered.push(s);
      }
      const nextSessions: Session[] = [];
      let inserted = false;
      for (const session of state.sessions) {
        if (session.projectId === projectId) {
          if (!inserted) {
            nextSessions.push(...reordered);
            inserted = true;
          }
          continue;
        }
        nextSessions.push(session);
      }
      if (!inserted) {
        nextSessions.push(...reordered);
      }
      return { sessions: nextSessions };
    }),

  // ── Provider actions (synced to providerMetaStore) ──

  setProviders: (providers) => {
    useProviderMetaStore.getState().setProviders(providers);
    set({ providers });
  },

  setDataServerId: (serverId) => set({ dataServerId: serverId }),

  // ── Selection & UI actions ──

  selectProject: (id) => set({ selectedProjectId: id }),

  selectSession: (id) =>
    set((state) => {
      let session = state.sessions.find((s) => s.id === id);
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

  setDashboardView: (projectId, view) =>
    set((state) => ({
      dashboardViews: {
        ...state.dashboardViews,
        [projectId]: view,
      },
    })),

  // ── Provider metadata (synced to providerMetaStore) ──

  setProviderCommands: (providerId, commands) => {
    useProviderMetaStore.getState().setProviderCommands(providerId, commands);
    set((state) => ({
      providerCommands: {
        ...state.providerCommands,
        [providerId]: commands,
      },
    }));
  },

  setProviderCapabilities: (providerId, capabilities) => {
    useProviderMetaStore.getState().setProviderCapabilities(providerId, capabilities);
    set((state) => ({
      providerCapabilities: {
        ...state.providerCapabilities,
        [providerId]: capabilities,
      },
    }));
  },
}));
