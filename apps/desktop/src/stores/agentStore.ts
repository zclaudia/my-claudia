import { create } from 'zustand';
import type { AgentPermissionPolicy, BackgroundTaskStatus } from '@my-claudia/shared';

export interface BackgroundSessionInfo {
  sessionId: string;
  parentSessionId?: string;
  name?: string;
  status: BackgroundTaskStatus;
  pendingPermissions: Array<{
    requestId: string;
    toolName: string;
    detail: string;
    timeoutSeconds: number;
  }>;
}

interface AgentState {
  // Per-backend sessions (serverId → { projectId, sessionId })
  sessions: Record<string, { projectId: string; sessionId: string }>;

  // Derived from active server's session (backward compat)
  agentSessionId: string | null;
  agentProjectId: string | null;
  isConfigured: boolean;

  // UI state
  isExpanded: boolean;
  hasUnread: boolean;

  // Provider selection
  selectedProviderId: string | null;

  // Run tracking
  activeRunId: string | null;
  isLoading: boolean;

  // Permission interception tracking
  interceptionCount: number;
  lastInterception: { toolName: string; decision: string; sessionId: string } | null;

  // Permission policy (synced from server)
  permissionPolicy: AgentPermissionPolicy | null;

  // Background sessions
  backgroundSessions: Record<string, BackgroundSessionInfo>;

  // Actions
  toggleExpanded: () => void;
  setExpanded: (v: boolean) => void;
  setSelectedProviderId: (id: string | null) => void;
  /** Configure agent session for a specific backend */
  configureForServer: (serverId: string, projectId: string, sessionId: string) => void;
  /** Backward compat: sets derived fields directly (no per-backend tracking) */
  configure: (projectId: string, sessionId: string) => void;
  /** Sync derived fields (agentSessionId etc.) from sessions map for given server */
  syncToActiveServer: (serverId: string | null) => void;
  setActiveRunId: (runId: string | null) => void;
  setLoading: (v: boolean) => void;
  setHasUnread: (v: boolean) => void;
  updatePermissionPolicy: (policy: AgentPermissionPolicy) => void;
  recordInterception: (toolName: string, decision: string, sessionId: string) => void;

  // Background session actions
  updateBackgroundSession: (sessionId: string, update: Partial<BackgroundSessionInfo>) => void;
  addBackgroundPermission: (sessionId: string, permission: BackgroundSessionInfo['pendingPermissions'][0]) => void;
  removeBackgroundPermission: (sessionId: string, requestId: string) => void;
  removeBackgroundSession: (sessionId: string) => void;

  reset: () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  sessions: {},
  agentSessionId: null,
  agentProjectId: null,
  isConfigured: false,
  isExpanded: false,
  hasUnread: false,
  selectedProviderId: null,
  activeRunId: null,
  isLoading: false,
  interceptionCount: 0,
  lastInterception: null,
  permissionPolicy: null,
  backgroundSessions: {},

  toggleExpanded: () => set((state) => ({ isExpanded: !state.isExpanded })),
  setExpanded: (v) => set({ isExpanded: v }),
  setSelectedProviderId: (id) => set({ selectedProviderId: id }),

  configureForServer: (serverId, projectId, sessionId) => set((state) => ({
    sessions: { ...state.sessions, [serverId]: { projectId, sessionId } },
    agentProjectId: projectId,
    agentSessionId: sessionId,
    isConfigured: true,
  })),

  configure: (projectId, sessionId) => set({
    agentProjectId: projectId,
    agentSessionId: sessionId,
    isConfigured: true,
  }),

  syncToActiveServer: (serverId) => set((state) => {
    const session = serverId ? state.sessions[serverId] : null;
    return {
      agentSessionId: session?.sessionId ?? null,
      agentProjectId: session?.projectId ?? null,
      isConfigured: !!session,
    };
  }),

  setActiveRunId: (runId) => set({ activeRunId: runId }),
  setLoading: (v) => set({ isLoading: v }),
  setHasUnread: (v) => set({ hasUnread: v }),
  updatePermissionPolicy: (policy) => set({ permissionPolicy: policy }),

  recordInterception: (toolName, decision, sessionId) => set((state) => ({
    interceptionCount: state.interceptionCount + 1,
    lastInterception: { toolName, decision, sessionId },
  })),

  updateBackgroundSession: (sessionId, update) => set((state) => ({
    backgroundSessions: {
      ...state.backgroundSessions,
      [sessionId]: {
        ...state.backgroundSessions[sessionId] || { sessionId, status: 'running', pendingPermissions: [] },
        ...update,
        sessionId,
      },
    },
  })),

  addBackgroundPermission: (sessionId, permission) => set((state) => {
    const existing = state.backgroundSessions[sessionId];
    if (!existing) return state;
    return {
      backgroundSessions: {
        ...state.backgroundSessions,
        [sessionId]: {
          ...existing,
          pendingPermissions: [...existing.pendingPermissions, permission],
        },
      },
    };
  }),

  removeBackgroundPermission: (sessionId, requestId) => set((state) => {
    const existing = state.backgroundSessions[sessionId];
    if (!existing) return state;
    return {
      backgroundSessions: {
        ...state.backgroundSessions,
        [sessionId]: {
          ...existing,
          pendingPermissions: existing.pendingPermissions.filter(p => p.requestId !== requestId),
        },
      },
    };
  }),

  removeBackgroundSession: (sessionId) => set((state) => {
    const { [sessionId]: _, ...rest } = state.backgroundSessions;
    return { backgroundSessions: rest };
  }),

  reset: () => set({
    sessions: {},
    agentSessionId: null,
    agentProjectId: null,
    isConfigured: false,
    isExpanded: false,
    hasUnread: false,
    selectedProviderId: null,
    activeRunId: null,
    isLoading: false,
    interceptionCount: 0,
    lastInterception: null,
    permissionPolicy: null,
    backgroundSessions: {},
  }),
}));
