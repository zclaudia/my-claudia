import { create } from 'zustand';
import { getAgentConfig, updateAgentConfig, type AgentConfig } from '../services/api/servers';

interface AgentConfigState {
  config: AgentConfig | null;
  isLoading: boolean;
  isSaving: boolean;
  hasLoaded: boolean;
  error: string | null;
  loadConfig: () => Promise<void>;
  updateConfig: (updates: {
    enabled?: boolean;
    providerId?: string | null;
    permissionWorkflowOverrideId?: string | null;
    permissionPolicy?: string | null;
  }) => Promise<boolean>;
}

export const useAgentConfigStore = create<AgentConfigState>((set) => ({
  config: null,
  isLoading: false,
  isSaving: false,
  hasLoaded: false,
  error: null,

  loadConfig: async () => {
    set({ isLoading: true, error: null });
    try {
      const config = await getAgentConfig();
      set({
        config,
        isLoading: false,
        hasLoaded: true,
        error: null,
      });
    } catch (err) {
      set({
        isLoading: false,
        hasLoaded: true,
        error: err instanceof Error ? err.message : 'Failed to load agent config',
      });
    }
  },

  updateConfig: async (updates) => {
    set({ isSaving: true, error: null });
    try {
      const config = await updateAgentConfig(updates);
      set({
        config,
        isSaving: false,
        hasLoaded: true,
        error: null,
      });
      return true;
    } catch (err) {
      set({
        isSaving: false,
        error: err instanceof Error ? err.message : 'Failed to update agent config',
      });
      return false;
    }
  },
}));
