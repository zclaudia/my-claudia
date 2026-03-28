import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LocalReviewerConfig, LocalReviewerStatus } from '@my-claudia/shared';
import {
  DEFAULT_LOCAL_REVIEWER_CONFIG,
  DEFAULT_LOCAL_REVIEWER_STATUS,
} from '@my-claudia/shared';

interface LocalReviewerStoreState extends LocalReviewerConfig {
  status: LocalReviewerStatus;
  managedPid: number | null;

  setConfig: (updates: Partial<LocalReviewerConfig>) => void;
  setStatus: (updates: Partial<LocalReviewerStatus>) => void;
  setManagedPid: (pid: number | null) => void;
  resetRuntimeState: () => void;
}

function buildStatus(config: LocalReviewerConfig, overrides?: Partial<LocalReviewerStatus>): LocalReviewerStatus {
  return {
    ...DEFAULT_LOCAL_REVIEWER_STATUS,
    endpoint: config.endpoint,
    model: config.model,
    state: config.enabled ? DEFAULT_LOCAL_REVIEWER_STATUS.state : 'disabled',
    ...overrides,
  };
}

export const useLocalReviewerStore = create<LocalReviewerStoreState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_LOCAL_REVIEWER_CONFIG,
      status: buildStatus(DEFAULT_LOCAL_REVIEWER_CONFIG),
      managedPid: null,

      setConfig: (updates) => {
        set((state) => {
          const nextConfig: LocalReviewerConfig = {
            enabled: updates.enabled ?? state.enabled,
            provider: updates.provider ?? state.provider,
            endpoint: updates.endpoint ?? state.endpoint,
            model: updates.model ?? state.model,
            managedRuntime: updates.managedRuntime ?? state.managedRuntime,
            autoStart: updates.autoStart ?? state.autoStart,
          };

          return {
            ...updates,
            status: buildStatus(nextConfig, {
              ...state.status,
              endpoint: nextConfig.endpoint,
              model: nextConfig.model,
              state: nextConfig.enabled ? state.status.state : 'disabled',
              lastError: nextConfig.enabled ? state.status.lastError : undefined,
              managedRuntimeActive: nextConfig.enabled ? state.status.managedRuntimeActive : false,
              serverReachable: nextConfig.enabled ? state.status.serverReachable : false,
              modelAvailable: nextConfig.enabled ? state.status.modelAvailable : false,
            }),
            managedPid: nextConfig.enabled ? state.managedPid : null,
          };
        });
      },

      setStatus: (updates) => {
        set((state) => ({
          status: {
            ...state.status,
            endpoint: state.endpoint,
            model: state.model,
            ...updates,
          },
        }));
      },

      setManagedPid: (pid) => set({ managedPid: pid }),

      resetRuntimeState: () => {
        const state = get();
        set({
          managedPid: null,
          status: buildStatus(
            {
              enabled: state.enabled,
              provider: state.provider,
              endpoint: state.endpoint,
              model: state.model,
              managedRuntime: state.managedRuntime,
              autoStart: state.autoStart,
            },
            {
              state: state.enabled ? 'error' : 'disabled',
              lastError: undefined,
              binaryAvailable: false,
              serverReachable: false,
              modelAvailable: false,
              managedRuntimeActive: false,
            },
          ),
        });
      },
    }),
    {
      name: 'my-claudia-local-reviewer',
      version: 1,
      partialize: (state) => ({
        enabled: state.enabled,
        provider: state.provider,
        endpoint: state.endpoint,
        model: state.model,
        managedRuntime: state.managedRuntime,
        autoStart: state.autoStart,
      }),
    },
  ),
);
