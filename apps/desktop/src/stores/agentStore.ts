import { create } from 'zustand';

interface AgentState {
  // UI state
  isExpanded: boolean;
  hasUnread: boolean;
  isLoading: boolean;

  // Actions
  toggleExpanded: () => void;
  setExpanded: (v: boolean) => void;
  setHasUnread: (v: boolean) => void;
  setLoading: (v: boolean) => void;
  reset: () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  isExpanded: false,
  hasUnread: false,
  isLoading: false,

  toggleExpanded: () => set((state) => ({ isExpanded: !state.isExpanded })),
  setExpanded: (v) => set({ isExpanded: v }),
  setHasUnread: (v) => set({ hasUnread: v }),
  setLoading: (v) => set({ isLoading: v }),

  reset: () => set({
    isExpanded: false,
    hasUnread: false,
    isLoading: false,
  }),
}));
