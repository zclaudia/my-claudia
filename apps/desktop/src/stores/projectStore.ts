import { create } from 'zustand';
import type { Project, Session, SlashCommand, ProviderConfig, ProviderCapabilities } from '@my-claudia/shared';
import { useSessionsStore } from './sessionsStore';
import { useChatStore } from './chatStore';
import { useProviderMetaStore } from './providerMetaStore';
import { useServerStore } from './serverStore';
import { useOwnershipStore } from './ownershipStore';
import { parseBackendId } from './gatewayStore';
import { getControlPlaneMode, resolveCanonicalBackendId, resolveLocalBackendId } from '../utils/controlPlane';

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

  setProjects: (projects) => {
    const activeBackendId = resolveOwnershipBackendId();
    if (activeBackendId) {
      useOwnershipStore.getState().removeProjectOwnersByBackend(activeBackendId);
      useOwnershipStore.getState().setProjectOwners(projects.map((p) => p.id), activeBackendId);
    }
    set({ projects });
  },

  addProject: (project) =>
    set((state) => {
      const activeBackendId = resolveOwnershipBackendId();
      if (activeBackendId) {
        useOwnershipStore.getState().setProjectOwner(project.id, activeBackendId);
      }
      return { projects: [...state.projects, project] };
    }),

  updateProject: (id, updates) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === id ? { ...p, ...updates } : p
      ),
    })),

  deleteProject: (id) =>
    set((state) => {
      useOwnershipStore.getState().removeProjectOwner(id);
      return {
        projects: state.projects.filter((p) => p.id !== id),
        sessions: state.sessions.filter((s) => s.projectId !== id),
        selectedProjectId:
          state.selectedProjectId === id ? null : state.selectedProjectId,
        selectedSessionId:
          state.sessions.find((s) => s.id === state.selectedSessionId)
            ?.projectId === id
            ? null
            : state.selectedSessionId,
      };
    }),

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

  setSessions: (sessions) => {
    const activeBackendId = resolveOwnershipBackendId();
    if (activeBackendId) {
      useOwnershipStore.getState().setSessionOwners(sessions.map((s) => s.id), activeBackendId);
    }
    set({ sessions });
  },

  mergeSessions: (incoming) =>
    set((state) => {
      const activeBackendId = resolveOwnershipBackendId();
      if (activeBackendId) {
        useOwnershipStore.getState().setSessionOwners(incoming.map((s) => s.id), activeBackendId);
      }
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
    set((state) => {
      const activeBackendId = resolveOwnershipBackendId();
      if (activeBackendId) {
        useOwnershipStore.getState().setSessionOwner(session.id, activeBackendId);
      }
      return { sessions: [...state.sessions, session] };
    }),

  updateSession: (id, updates) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, ...updates } : s
      ),
    })),

  deleteSession: (id) =>
    set((state) => {
      useOwnershipStore.getState().removeSessionOwner(id);
      return {
        sessions: state.sessions.filter((s) => s.id !== id),
        selectedSessionId:
          state.selectedSessionId === id ? null : state.selectedSessionId,
      };
    }),

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
    const getState = (useServerStore as { getState?: () => { activeServerId?: string | null } }).getState;
    useProviderMetaStore.getState().setProviders(providers, getState?.().activeServerId);
    set({ providers });
  },

  setDataServerId: (serverId) => set({ dataServerId: serverId }),

  // ── Selection & UI actions ──

  selectProject: (id) =>
    set((state) => {
      if (state.selectedProjectId === id) {
        return state;
      }
      return { selectedProjectId: id };
    }),

  selectSession: (id) =>
    set((state) => {
      if (state.selectedSessionId === id) {
        return state;
      }

      let session = state.sessions.find((s) => s.id === id);
      let targetBackendId: string | null = null;
      if (!session && id) {
        for (const [backendId, sessions] of useSessionsStore.getState().remoteSessions) {
          const remote = sessions.find((s) => s.id === id);
          if (remote) {
            session = remote;
            targetBackendId = backendId;
            break;
          }
        }
      }

      if (id) {
        if (targetBackendId) {
          // Session found on a specific remote backend — switch to it
          useServerStore.getState().setActiveServer(targetBackendId);
        } else if (!useServerStore.getState().activeServerId && session && getControlPlaneMode() === 'embedded-local') {
          // No active server yet (first boot) and session is local — set local backend.
          // Don't override if user has already selected a remote backend.
          const localBackendId = resolveLocalBackendId();
          if (localBackendId) {
            useServerStore.getState().setActiveServer(localBackendId);
          }
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

function resolveOwnershipBackendId(): string | null {
  const activeServerId = useServerStore.getState().activeServerId ?? null;
  if (!activeServerId) return null;

  const parsedBackendId = parseBackendId(activeServerId) ?? activeServerId;
  if (getControlPlaneMode() !== 'embedded-local') {
    return parsedBackendId;
  }

  return resolveCanonicalBackendId(parsedBackendId, resolveLocalBackendId() ?? parsedBackendId);
}
