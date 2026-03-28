import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GatewayBackendInfo, BackendSnapshot } from '@my-claudia/shared';
import { useFacadeStore } from './facadeStore';

export type BackendAuthStatus = 'authenticated' | 'pending' | 'failed';
export const GATEWAY_SERVER_PREFIX = 'gw:';

export function toGatewayServerId(backendId: string): string {
  return `${GATEWAY_SERVER_PREFIX}${backendId}`;
}

export function isGatewayTarget(serverId: string | null | undefined): boolean {
  return !!serverId && serverId.startsWith(GATEWAY_SERVER_PREFIX);
}

export function parseBackendId(serverId: string | null | undefined): string | null {
  if (!serverId) return null;
  return isGatewayTarget(serverId) ? serverId.slice(GATEWAY_SERVER_PREFIX.length) : serverId;
}

interface GatewayState {
  // ---------------------------------------------------------------------------
  // Runtime gateway transport state (NOT persisted)
  // ---------------------------------------------------------------------------
  gatewayUrl: string | null;
  gatewaySecret: string | null;
  isConnected: boolean;
  backendAuthStatus: Record<string, BackendAuthStatus>;

  // ---------------------------------------------------------------------------
  // UI preferences — persisted, NOT managed by facade
  // These are user settings that survive across sessions.
  // ---------------------------------------------------------------------------
  directGatewayUrl: string | null;
  directGatewaySecret: string | null;
  lastActiveBackendId: string | null;
  subscribedBackendIds: string[];
  showLocalBackend: boolean;

  // ---------------------------------------------------------------------------
  // Runtime state actions
  // ---------------------------------------------------------------------------
  setConnected: (connected: boolean) => void;
  setBackendAuthStatus: (backendId: string, status: BackendAuthStatus) => void;
  clearGateway: () => void;

  // ---------------------------------------------------------------------------
  // UI preference actions
  // ---------------------------------------------------------------------------
  setDirectGatewayConfig: (url: string, secret: string) => void;
  setLastActiveBackend: (serverId: string | null) => void;
  clearDirectGatewayConfig: () => void;
  toggleBackendSubscription: (backendId: string) => void;
  isBackendSubscribed: (backendId: string) => boolean;
  setShowLocalBackend: (show: boolean) => void;

  // Getters
  isConfigured: () => boolean;
  hasDirectConfig: () => boolean;
}

/**
 * Whether a backend should be shown in UI lists.
 * Hide "this instance" (the embedded server) unless showLocalBackend is on.
 * Accepts both GatewayBackendInfo and BackendSnapshot (facade model).
 */
export function shouldShowNonCurrentInstanceBackend(
  backend: GatewayBackendInfo | BackendSnapshot,
  currentInstanceId: string | null,
  showLocalBackend: boolean
): boolean {
  if (showLocalBackend) return true;
  if (!currentInstanceId) return true;
  // Use direct instanceId comparison as primary check, fall back to pre-computed flag
  const isThisInstance = backend.instanceId
    ? backend.instanceId === currentInstanceId
    : !!backend.isThisInstance;
  return !isThisInstance;
}

export const shouldShowBackend = shouldShowNonCurrentInstanceBackend;

export const useGatewayStore = create<GatewayState>()(
  persist(
    (set, get) => ({
      // Runtime gateway state
      gatewayUrl: null,
      gatewaySecret: null,
      isConnected: false,
      backendAuthStatus: {},

      // Mobile direct config (persisted)
      directGatewayUrl: null,
      directGatewaySecret: null,
      lastActiveBackendId: null,

      // Backend subscription (persisted) — empty = all subscribed
      subscribedBackendIds: [],

      // Dev debug
      showLocalBackend: false,
      setShowLocalBackend: (show) => set({ showLocalBackend: show }),

      setConnected: (connected) => {
        set({ isConnected: connected });
        if (!connected) {
          set({ backendAuthStatus: {} });
        }
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
          backendAuthStatus: {},
        });
      },

      // Mobile: set gateway config directly (persisted)
      setDirectGatewayConfig: (url, secret) => {
        set({
          directGatewayUrl: url,
          directGatewaySecret: secret,
          // Also set runtime state so the connection hook picks it up
          gatewayUrl: url,
          gatewaySecret: secret,
        });
      },

      setLastActiveBackend: (serverId) => {
        set({ lastActiveBackendId: serverId });
      },

      clearDirectGatewayConfig: () => {
        set({
          directGatewayUrl: null,
          directGatewaySecret: null,
          lastActiveBackendId: null,
          gatewayUrl: null,
          gatewaySecret: null,
          isConnected: false,
          backendAuthStatus: {},
        });
      },

      toggleBackendSubscription: (backendId) => {
        set((state) => {
          const current = state.subscribedBackendIds;
          if (current.length === 0) {
            // Currently "all subscribed" — switch to explicit list excluding this one
            const facadeIds = useFacadeStore.getState().backends.map(b => b.backendId);
            return { subscribedBackendIds: facadeIds.filter(id => id !== backendId) };
          }
          if (current.includes(backendId)) {
            // Unsubscribe
            const updated = current.filter(id => id !== backendId);
            // If removing last one would make list empty, keep at least one
            return { subscribedBackendIds: updated };
          }
          // Subscribe
          return { subscribedBackendIds: [...current, backendId] };
        });
      },

      isBackendSubscribed: (backendId) => {
        const { subscribedBackendIds } = get();
        // Empty array = all subscribed
        return subscribedBackendIds.length === 0 || subscribedBackendIds.includes(backendId);
      },

      isConfigured: () => {
        const state = get();
        return !!state.gatewayUrl && !!state.gatewaySecret;
      },

      hasDirectConfig: () => {
        const state = get();
        return !!state.directGatewayUrl && !!state.directGatewaySecret;
      }
    }),
    {
      name: 'my-claudia-gateway',
      version: 5,
      partialize: (state) => ({
        directGatewayUrl: state.directGatewayUrl,
        directGatewaySecret: state.directGatewaySecret,
        lastActiveBackendId: state.lastActiveBackendId,
        subscribedBackendIds: state.subscribedBackendIds,
      }),
      migrate: (persisted: any, version: number) => {
        if (version < 2) {
          delete persisted.gatewayUrl;
          delete persisted.gatewaySecret;
        }
        if (version < 3) {
          delete persisted.backendApiKeys;
        }
        // v4: adds directGatewayUrl, directGatewaySecret, lastActiveBackendId
        // v5: adds subscribedBackendIds (defaults to [] = all subscribed)
        if (version < 5) {
          persisted.subscribedBackendIds = [];
        }
        return persisted;
      }
    }
  )
);
