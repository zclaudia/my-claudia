import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GatewayBackendInfo, BackendRegistryEntry } from '@my-claudia/shared';

export type BackendAuthStatus = 'authenticated' | 'pending' | 'failed';

interface GatewayState {
  // Runtime state — synced from server (NOT persisted)
  gatewayUrl: string | null;
  gatewaySecret: string | null;
  isConnected: boolean;
  localBackendId: string | null;  // This server's own backendId (for isLocal filtering)
  currentInstanceId: string | null;  // This server's instanceId
  currentDeviceId: string | null;    // This server's deviceId
  discoveredBackends: GatewayBackendInfo[];
  backendAuthStatus: Record<string, BackendAuthStatus>;

  // Registry from gateway (Phase 2) — keyed by backendId
  registry: Record<string, BackendRegistryEntry>;

  // Direct gateway config — for mobile clients (persisted)
  directGatewayUrl: string | null;
  directGatewaySecret: string | null;
  lastActiveBackendId: string | null; // e.g. "gw:abc123"

  // Backend subscription — empty array means "subscribe to all" (default)
  subscribedBackendIds: string[];

  // Actions
  syncFromServer: (url: string | null, secret: string | null, backends: GatewayBackendInfo[], backendId?: string | null, connected?: boolean, instanceId?: string | null, deviceId?: string | null) => void;
  setConnected: (connected: boolean) => void;
  setDiscoveredBackends: (backends: GatewayBackendInfo[]) => void;
  setBackendAuthStatus: (backendId: string, status: BackendAuthStatus) => void;
  clearGateway: () => void;

  // Registry actions (Phase 2)
  setRegistrySnapshot: (entries: BackendRegistryEntry[]) => void;
  upsertRegistryEntry: (entry: BackendRegistryEntry) => void;
  removeRegistryEntry: (backendId: string) => void;

  // Mobile direct config actions
  setDirectGatewayConfig: (url: string, secret: string) => void;
  setLastActiveBackend: (serverId: string | null) => void;
  clearDirectGatewayConfig: () => void;

  // Subscription actions
  toggleBackendSubscription: (backendId: string) => void;
  isBackendSubscribed: (backendId: string) => boolean;

  // Dev debug
  showLocalBackend: boolean;
  setShowLocalBackend: (show: boolean) => void;

  // Getters
  isConfigured: () => boolean;
  hasDirectConfig: () => boolean;
}

/** Mark isLocal on backends by comparing with the local server's backendId */
function markIsLocal(backends: GatewayBackendInfo[], localBackendId: string | null): GatewayBackendInfo[] {
  if (!localBackendId) return backends;
  return backends.map(b => ({
    ...b,
    isLocal: b.backendId === localBackendId,
  }));
}

function deriveBackendsFromRegistry(
  registry: Record<string, BackendRegistryEntry>,
  localBackendId: string | null
): GatewayBackendInfo[] {
  return Object.values(registry)
    .filter(entry => entry.visible)
    .map(entry => ({
      backendId: entry.backendId,
      name: entry.name,
      online: entry.online,
      isLocal: entry.backendId === localBackendId,
      instanceId: entry.instanceId,
      deviceId: entry.deviceId,
      channel: entry.channel,
    }));
}

/**
 * Whether a backend should be shown in UI lists.
 * Hide local backend only when we know the current runtime local backend id.
 */
export function shouldShowBackend(
  backend: GatewayBackendInfo,
  localBackendId: string | null,
  showLocalBackend: boolean
): boolean {
  if (showLocalBackend) return true;
  if (!localBackendId) return true;
  return !backend.isLocal;
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
      registry: {},

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
        const { registry } = get();
        const hasRegistry = Object.keys(registry).length > 0;
        set({
          gatewayUrl: url,
          gatewaySecret: secret,
          localBackendId: localId,
          ...(instanceId !== undefined ? { currentInstanceId: instanceId } : {}),
          ...(deviceId !== undefined ? { currentDeviceId: deviceId } : {}),
          ...(hasRegistry
            ? { discoveredBackends: deriveBackendsFromRegistry(registry, localId) }
            : { discoveredBackends: markIsLocal(backends, localId) }),
          // Sync server-side gateway connected status when available
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
        set({ discoveredBackends: markIsLocal(backends, get().localBackendId) });
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
          registry: {},
        });
      },

      // Registry actions (Phase 2)
      setRegistrySnapshot: (entries) => {
        const registry: Record<string, BackendRegistryEntry> = {};
        for (const entry of entries) {
          registry[entry.backendId] = entry;
        }
        const localId = get().localBackendId;
        set({
          registry,
          discoveredBackends: deriveBackendsFromRegistry(registry, localId),
        });
      },

      upsertRegistryEntry: (entry) => {
        set((state) => {
          const registry = { ...state.registry, [entry.backendId]: entry };
          return {
            registry,
            discoveredBackends: deriveBackendsFromRegistry(registry, state.localBackendId),
          };
        });
      },

      removeRegistryEntry: (backendId) => {
        set((state) => {
          const { [backendId]: _, ...registry } = state.registry;
          return {
            registry,
            discoveredBackends: deriveBackendsFromRegistry(registry, state.localBackendId),
          };
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
