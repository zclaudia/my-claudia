import { create } from 'zustand';
import type { BackendServer, ServerFeature } from '@my-claudia/shared';
import { useGatewayStore, isGatewayTarget, parseBackendId } from './gatewayStore';

// Per-server connection state
export interface ServerConnection {
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  error: string | null;
  isLocalConnection: boolean | null;
  features: ServerFeature[];  // Empty = legacy server (no features advertised)
  /** RSA-OAEP public key PEM for E2E credential encryption */
  publicKey?: string;
}

export type ConnectionStatus = ServerConnection['status'];

interface ServerState {
  servers: BackendServer[];
  activeServerId: string | null;
  // Per-server connection states (serverId -> connection)
  connections: Record<string, ServerConnection>;

  // Legacy global state (for backward compatibility during migration)
  connectionStatus: ConnectionStatus;
  connectionError: string | null;
  isLocalConnection: boolean | null;

  // Actions
  setServers: (servers: BackendServer[]) => void;
  setActiveServer: (id: string | null) => void;
  // Legacy global setters (redirect to per-server)
  setConnectionStatus: (status: ConnectionStatus, error?: string) => void;
  setIsLocalConnection: (isLocal: boolean | null) => void;
  // New per-server setters
  setServerConnectionStatus: (serverId: string, status: ConnectionStatus, error?: string) => void;
  setServerLocalConnection: (serverId: string, isLocal: boolean | null) => void;
  setServerFeatures: (serverId: string, features: ServerFeature[]) => void;
  setServerPublicKey: (serverId: string, publicKey: string | undefined) => void;
  updateLastConnected: (id: string) => void;

  // Getters
  getActiveServer: () => BackendServer | undefined;
  getDefaultServer: () => BackendServer | undefined;
  getServerConnection: (serverId: string) => ServerConnection | undefined;
  getActiveServerConnection: () => ServerConnection | undefined;
  activeServerSupports: (feature: ServerFeature) => boolean;
}

// Note: Server list is now loaded from database via WebSocket
// The default local server is created in the database migration
const INITIAL_ACTIVE_SERVER = 'local';

// Hardcoded default server for initial connection
// This will be replaced by the server list from database once connected
const DEFAULT_SERVER: BackendServer = {
  id: 'local',
  name: 'Local Server',
  address: 'localhost:3100',
  isDefault: true,
  createdAt: Date.now()
};

// Default connection state for a server
const DEFAULT_CONNECTION: ServerConnection = {
  status: 'disconnected',
  error: null,
  isLocalConnection: null,
  features: [],
};

export const useServerStore = create<ServerState>()((set, get) => ({
  servers: [DEFAULT_SERVER],
  activeServerId: INITIAL_ACTIVE_SERVER,
  connections: {},
  // Legacy global state (computed from active server's connection)
  connectionStatus: 'disconnected',
  connectionError: null,
  isLocalConnection: null,

  setServers: (servers) => {
    // Guard against undefined or null
    if (!servers || !Array.isArray(servers)) {
      console.warn('[ServerStore] setServers called with invalid data:', servers);
      return;
    }

    const state = get();

    set({ servers });

    // If active server is not in the list, set to default or first server
    // Skip for gateway targets — they aren't in the direct servers list
    if (servers.length > 0 && !isGatewayTarget(state.activeServerId || '') && !servers.find(s => s.id === state.activeServerId)) {
      const defaultServer = servers.find(s => s.isDefault);
      const firstServer = servers[0];
      set({ activeServerId: defaultServer?.id || firstServer?.id || null });
    }
  },

  setActiveServer: (id) => {
    const state = get();
    // Get the connection state for the new active server
    const connection = id ? state.connections[id] : undefined;

    set({
      activeServerId: id,
      // Update legacy global state from the new active server's connection
      connectionStatus: connection?.status || 'disconnected',
      connectionError: connection?.error || null,
      isLocalConnection: connection?.isLocalConnection ?? null
    });
  },

  // Legacy global setters (redirect to active server)
  setConnectionStatus: (status, error) => {
    const state = get();
    if (state.activeServerId) {
      // Update both per-server and legacy global state
      const newConnection: ServerConnection = {
        ...state.connections[state.activeServerId],
        status,
        error: error || null
      };
      set({
        connectionStatus: status,
        connectionError: error || null,
        connections: {
          ...state.connections,
          [state.activeServerId]: newConnection
        }
      });
    } else {
      set({ connectionStatus: status, connectionError: error || null });
    }
  },

  setIsLocalConnection: (isLocal) => {
    const state = get();
    if (state.activeServerId) {
      const newConnection: ServerConnection = {
        ...state.connections[state.activeServerId],
        isLocalConnection: isLocal
      };
      set({
        isLocalConnection: isLocal,
        connections: {
          ...state.connections,
          [state.activeServerId]: newConnection
        }
      });
    } else {
      set({ isLocalConnection: isLocal });
    }
  },

  // New per-server setters
  setServerConnectionStatus: (serverId, status, error) => {
    const state = get();
    const newConnection: ServerConnection = {
      ...DEFAULT_CONNECTION,
      ...state.connections[serverId],
      status,
      error: error || null
    };

    const updates: Partial<ServerState> = {
      connections: {
        ...state.connections,
        [serverId]: newConnection
      }
    };

    // If this is the active server, also update legacy global state
    if (serverId === state.activeServerId) {
      updates.connectionStatus = status;
      updates.connectionError = error || null;
    }

    set(updates);
  },

  setServerLocalConnection: (serverId, isLocal) => {
    const state = get();
    const newConnection: ServerConnection = {
      ...DEFAULT_CONNECTION,
      ...state.connections[serverId],
      isLocalConnection: isLocal
    };

    const updates: Partial<ServerState> = {
      connections: {
        ...state.connections,
        [serverId]: newConnection
      }
    };

    // If this is the active server, also update legacy global state
    if (serverId === state.activeServerId) {
      updates.isLocalConnection = isLocal;
    }

    set(updates);
  },

  setServerFeatures: (serverId, features) => {
    const state = get();
    const newConnection: ServerConnection = {
      ...DEFAULT_CONNECTION,
      ...state.connections[serverId],
      features
    };

    set({
      connections: {
        ...state.connections,
        [serverId]: newConnection
      }
    });
  },

  setServerPublicKey: (serverId, publicKey) => {
    const state = get();
    const newConnection: ServerConnection = {
      ...DEFAULT_CONNECTION,
      ...state.connections[serverId],
      publicKey
    };

    set({
      connections: {
        ...state.connections,
        [serverId]: newConnection
      }
    });
  },

  updateLastConnected: (id) => {
    set((state) => ({
      servers: state.servers.map((s) =>
        s.id === id ? { ...s, lastConnected: Date.now() } : s
      )
    }));
  },

  getActiveServer: () => {
    const state = get();
    if (!state.activeServerId) return undefined;

    // Gateway backend: build virtual BackendServer from gateway store
    if (isGatewayTarget(state.activeServerId)) {
      const backendId = parseBackendId(state.activeServerId);
      const gwState = useGatewayStore.getState();
      const backend = gwState.discoveredBackends.find(b => b.backendId === backendId);
      if (!backend) return undefined;
      return {
        id: state.activeServerId,
        name: backend.name,
        address: gwState.gatewayUrl || '',
        isDefault: false,
        createdAt: 0
      } as BackendServer;
    }

    return state.servers.find((s) => s.id === state.activeServerId);
  },

  getDefaultServer: () => {
    const state = get();
    return state.servers.find((s) => s.isDefault);
  },

  getServerConnection: (serverId) => {
    const state = get();
    return state.connections[serverId];
  },

  getActiveServerConnection: () => {
    const state = get();
    if (!state.activeServerId) return undefined;
    return state.connections[state.activeServerId];
  },

  activeServerSupports: (feature) => {
    const state = get();
    if (!state.activeServerId) return false;
    const conn = state.connections[state.activeServerId];
    if (!conn || conn.features.length === 0) return false;
    return conn.features.includes(feature);
  }
}));
