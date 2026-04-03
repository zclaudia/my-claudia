/**
 * Provider metadata store — commands, capabilities, and provider list.
 * Extracted from projectStore to separate provider concerns from project/session state.
 */
import { create } from 'zustand';
import type { ProviderConfig, ProviderCapabilities, SlashCommand } from '@my-claudia/shared';
import { useServerStore } from './serverStore';

interface ProviderMetaState {
  providersByBackend: Record<string, ProviderConfig[]>;
  providerCommands: Record<string, SlashCommand[]>;
  providerCapabilities: Record<string, ProviderCapabilities>;

  setProviders: (providers: ProviderConfig[], backendId?: string | null) => void;
  getProviders: (backendId?: string | null) => ProviderConfig[];
  setProviderCommands: (providerId: string, commands: SlashCommand[]) => void;
  setProviderCapabilities: (providerId: string, capabilities: ProviderCapabilities) => void;
}

const EMPTY_PROVIDERS: ProviderConfig[] = [];

function resolveBackendId(backendId?: string | null): string | null {
  if (backendId) return backendId;
  const getState = (useServerStore as { getState?: () => { activeServerId?: string | null } }).getState;
  return getState?.().activeServerId ?? null;
}

export const useProviderMetaStore = create<ProviderMetaState>((set, get) => ({
  providersByBackend: {},
  providerCommands: {},
  providerCapabilities: {},

  setProviders: (providers, backendId) => set((state) => {
    const resolvedBackendId = resolveBackendId(backendId);
    if (!resolvedBackendId) return state;
    return {
      providersByBackend: {
        ...state.providersByBackend,
        [resolvedBackendId]: providers,
      },
    };
  }),

  getProviders: (backendId) => {
    const resolvedBackendId = resolveBackendId(backendId);
    if (!resolvedBackendId) return EMPTY_PROVIDERS;
    return get().providersByBackend[resolvedBackendId] ?? EMPTY_PROVIDERS;
  },

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
