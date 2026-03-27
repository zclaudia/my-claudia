import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GatewayBackendInfo, BackendSnapshot } from '@my-claudia/shared';

export type BackendAuthStatus = 'authenticated' | 'pending' | 'failed';

interface GatewayState {
  // ---------------------------------------------------------------------------
  // Runtime state — managed by facade sync bridge (NOT persisted)
  // When facade is active, these fields are written by useBackendFacade's
  // syncToGatewayStore(). Do NOT write to them from other sources.
  // ---------------------------------------------------------------------------
  gatewayUrl: string | null;
  gatewaySecret: string | null;
  isConnected: boolean;
  localBackendId: string | null;
  currentInstanceId: string | null;
  currentDeviceId: string | null;
  discoveredBackends: GatewayBackendInfo[];
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
  syncFromServer: (url: string | null, secret: string | null, backends: GatewayBackendInfo[], backendId?: string | null, connected?: boolean, instanceId?: string | null, deviceId?: string | null) => void;
  setConnected: (connected: boolean) => void;
  setDiscoveredBackends: (backends: GatewayBackendInfo[]) => void;
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

/** Mark identity flags on backends using instanceId/deviceId */
function markIdentity(backends: GatewayBackendInfo[], currentInstanceId: string | null, currentDeviceId: string | null): GatewayBackendInfo[] {
  return backends.map(b => ({
    ...b,
    isThisInstance: !!(currentInstanceId && b.instanceId === currentInstanceId),
    isThisDevice: !!(currentDeviceId && b.deviceId === currentDeviceId),
  }));
}

/**
 * Whether a backend should be shown in UI lists.
 * Hide "this instance" (the embedded server) unless showLocalBackend is on.
 * Accepts both GatewayBackendInfo and BackendSnapshot (facade model).
 */
export function shouldShowBackend(
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

export const useGatewayStore = create<GatewayState>()(
  persist(
    (set, get) => ({
      // Runtime state (synced from server)
      gatewayUrl: null,
      gatewaySecret: null,
      isConnected: false,
      localBackendId: null,
      currentInstanceId: null,
      currentDeviceId: null,
      discoveredBackends: [],
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

      syncFromServer: (url: string | null, secret: string | null, backends: GatewayBackendInfo[], backendId?: string | null, connected?: boolean, instanceId?: string | null, deviceId?: string | null) => {
        const localId = backendId !== undefined ? backendId : get().localBackendId;
        const curInstanceId = instanceId !== undefined ? instanceId : get().currentInstanceId;
        const curDeviceId = deviceId !== undefined ? deviceId : get().currentDeviceId;
        set({
          gatewayUrl: url,
          gatewaySecret: secret,
          localBackendId: localId,
          ...(instanceId !== undefined ? { currentInstanceId: instanceId } : {}),
          ...(deviceId !== undefined ? { currentDeviceId: deviceId } : {}),
          discoveredBackends: markIdentity(backends, curInstanceId, curDeviceId),
          ...(connected !== undefined ? { isConnected: connected } : {}),
        });
      },

      setConnected: (connected) => {
        set({ isConnected: connected });
        if (!connected) {
          // Clear auth status on disconnect (backends are managed by syncFromServer polling)
          set({ backendAuthStatus: {} });
        }
      },

      setDiscoveredBackends: (backends) => {
        const { currentInstanceId, currentDeviceId } = get();
        set({ discoveredBackends: markIdentity(backends, currentInstanceId, currentDeviceId) });
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
          localBackendId: null,
          currentInstanceId: null,
          currentDeviceId: null,
          discoveredBackends: [],
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
          discoveredBackends: [],
          backendAuthStatus: {},
        });
      },

      toggleBackendSubscription: (backendId) => {
        set((state) => {
          const current = state.subscribedBackendIds;
          if (current.length === 0) {
            // Currently "all subscribed" — switch to explicit list excluding this one
            const allIds = state.discoveredBackends.map(b => b.backendId);
            return { subscribedBackendIds: allIds.filter(id => id !== backendId) };
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
