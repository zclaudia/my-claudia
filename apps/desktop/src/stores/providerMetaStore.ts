/**
 * Provider metadata store — commands, capabilities, and provider list.
 * Extracted from projectStore to separate provider concerns from project/session state.
 */
import { create } from 'zustand';
import type { ProviderConfig, ProviderCapabilities, SlashCommand } from '@my-claudia/shared';

interface ProviderMetaState {
  providers: ProviderConfig[];
  providerCommands: Record<string, SlashCommand[]>;
  providerCapabilities: Record<string, ProviderCapabilities>;

  setProviders: (providers: ProviderConfig[]) => void;
  setProviderCommands: (providerId: string, commands: SlashCommand[]) => void;
  setProviderCapabilities: (providerId: string, capabilities: ProviderCapabilities) => void;
}

export const useProviderMetaStore = create<ProviderMetaState>((set) => ({
  providers: [],
  providerCommands: {},
  providerCapabilities: {},

  setProviders: (providers) => set({ providers }),

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
