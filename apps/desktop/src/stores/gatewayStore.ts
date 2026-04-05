import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GatewayBackendInfo, BackendSnapshot } from '@my-claudia/shared';


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

      // Dev debug
      showLocalBackend: false,
      setShowLocalBackend: (show) => set({ showLocalBackend: show }),

      setConnected: (connected) => {
        const current = get();
        if (current.isConnected === connected) return;
        set(connected
          ? { isConnected: true }
          : { isConnected: false, backendAuthStatus: {} }
        );
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
        // v5: subscribedBackendIds removed (was unused notification filter)
        return persisted;
      }
    }
  )
);
