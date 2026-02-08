import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GatewayBackendInfo } from '@my-claudia/shared';

export type BackendAuthStatus = 'authenticated' | 'pending' | 'failed';

interface GatewayState {
  // Runtime state — synced from server (NOT persisted)
  gatewayUrl: string | null;
  gatewaySecret: string | null;
  isConnected: boolean;
  discoveredBackends: GatewayBackendInfo[];
  backendAuthStatus: Record<string, BackendAuthStatus>;

  // Actions
  syncFromServer: (url: string | null, secret: string | null, backends: GatewayBackendInfo[]) => void;
  setConnected: (connected: boolean) => void;
  setDiscoveredBackends: (backends: GatewayBackendInfo[]) => void;
  setBackendAuthStatus: (backendId: string, status: BackendAuthStatus) => void;
  clearGateway: () => void;

  // Getters
  isConfigured: () => boolean;
}

export const useGatewayStore = create<GatewayState>()(
  persist(
    (set, get) => ({
      // Runtime state (synced from server)
      gatewayUrl: null,
      gatewaySecret: null,
      isConnected: false,
      discoveredBackends: [],
      backendAuthStatus: {},

      syncFromServer: (url, secret, backends) => {
        set({
          gatewayUrl: url,
          gatewaySecret: secret,
          discoveredBackends: backends
        });
      },

      setConnected: (connected) => {
        set({ isConnected: connected });
        if (!connected) {
          // Clear runtime state on disconnect
          set({ discoveredBackends: [], backendAuthStatus: {} });
        }
      },

      setDiscoveredBackends: (backends) => {
        set({ discoveredBackends: backends });
      },

      setBackendAuthStatus: (backendId, status) => {
        set((state) => ({
          backendAuthStatus: { ...state.backendAuthStatus, [backendId]: status }
        }));
      },

      clearGateway: () => {
        set({
          gatewayUrl: null,
          gatewaySecret: null,
          isConnected: false,
          discoveredBackends: [],
          backendAuthStatus: {}
        });
      },

      isConfigured: () => {
        const state = get();
        return !!state.gatewayUrl && !!state.gatewaySecret;
      }
    }),
    {
      name: 'my-claudia-gateway',
      version: 3,
      partialize: () => ({}), // Nothing to persist — all state is runtime
      migrate: (persisted: any, version: number) => {
        if (version < 2) {
          delete persisted.gatewayUrl;
          delete persisted.gatewaySecret;
        }
        if (version < 3) {
          delete persisted.backendApiKeys;
        }
        return persisted;
      }
    }
  )
);

// Helper to construct a gateway-target serverId
export function toGatewayServerId(backendId: string): string {
  return `gw:${backendId}`;
}

// Helper to check if a serverId is a gateway target
export function isGatewayTarget(serverId: string | null): boolean {
  return !!serverId && serverId.startsWith('gw:');
}

// Helper to extract backendId from a gateway serverId
export function parseBackendId(serverId: string): string {
  return serverId.slice(3);
}
