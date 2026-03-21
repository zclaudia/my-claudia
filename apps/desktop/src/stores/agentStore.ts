import { create } from 'zustand';

interface AgentState {
  // UI state
  isExpanded: boolean;
  hasUnread: boolean;
  isLoading: boolean;
  clearRequestId: number;

  // Agent session
  agentSessionId: string | null;

  // Actions
  toggleExpanded: () => void;
  setExpanded: (v: boolean) => void;
  setHasUnread: (v: boolean) => void;
  setLoading: (v: boolean) => void;
  setAgentSessionId: (id: string | null) => void;
  requestClear: () => void;
  reset: () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  isExpanded: false,
  hasUnread: false,
  isLoading: false,
  clearRequestId: 0,
  agentSessionId: null,

  toggleExpanded: () => set((state) => ({ isExpanded: !state.isExpanded })),
  setExpanded: (v) => set({ isExpanded: v }),
  setHasUnread: (v) => set({ hasUnread: v }),
  setLoading: (v) => set({ isLoading: v }),
  setAgentSessionId: (id) => set({ agentSessionId: id }),
  requestClear: () => set((state) => ({
    clearRequestId: state.clearRequestId + 1,
    agentSessionId: null,  // Reset session on clear
  })),

  reset: () => set({
    isExpanded: false,
    hasUnread: false,
    isLoading: false,
    clearRequestId: 0,
    agentSessionId: null,
  }),
}));
