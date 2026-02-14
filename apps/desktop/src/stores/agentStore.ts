import { create } from 'zustand';
import type { AgentPermissionPolicy } from '@my-claudia/shared';

interface AgentState {
  // Config
  agentSessionId: string | null;
  agentProjectId: string | null;
  isConfigured: boolean;

  // UI state
  isExpanded: boolean;
  hasUnread: boolean;
  showSettings: boolean;

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

  // Actions
  toggleExpanded: () => void;
  setExpanded: (v: boolean) => void;
  setShowSettings: (v: boolean) => void;
  setSelectedProviderId: (id: string | null) => void;
  configure: (projectId: string, sessionId: string) => void;
  setActiveRunId: (runId: string | null) => void;
  setLoading: (v: boolean) => void;
  setHasUnread: (v: boolean) => void;
  updatePermissionPolicy: (policy: AgentPermissionPolicy) => void;
  recordInterception: (toolName: string, decision: string, sessionId: string) => void;
  reset: () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agentSessionId: null,
  agentProjectId: null,
  isConfigured: false,
  isExpanded: false,
  hasUnread: false,
  showSettings: false,
  selectedProviderId: null,
  activeRunId: null,
  isLoading: false,
  interceptionCount: 0,
  lastInterception: null,
  permissionPolicy: null,

  toggleExpanded: () => set((state) => ({ isExpanded: !state.isExpanded })),
  setExpanded: (v) => set({ isExpanded: v }),
  setShowSettings: (v) => set({ showSettings: v }),
  setSelectedProviderId: (id) => set({ selectedProviderId: id }),

  configure: (projectId, sessionId) => set({
    agentProjectId: projectId,
    agentSessionId: sessionId,
    isConfigured: true,
  }),

  setActiveRunId: (runId) => set({ activeRunId: runId }),
  setLoading: (v) => set({ isLoading: v }),
  setHasUnread: (v) => set({ hasUnread: v }),
  updatePermissionPolicy: (policy) => set({ permissionPolicy: policy }),

  recordInterception: (toolName, decision, sessionId) => set((state) => ({
    interceptionCount: state.interceptionCount + 1,
    lastInterception: { toolName, decision, sessionId },
  })),

  reset: () => set({
    agentSessionId: null,
    agentProjectId: null,
    isConfigured: false,
    isExpanded: false,
    hasUnread: false,
    showSettings: false,
    selectedProviderId: null,
    activeRunId: null,
    isLoading: false,
    interceptionCount: 0,
    lastInterception: null,
    permissionPolicy: null,
  }),
}));
