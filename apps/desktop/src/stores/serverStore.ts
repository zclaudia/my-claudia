/**
 * Server Store
 *
 * Manages active backend selection and connection state.
 * All backend discovery comes from facadeStore (BackendFacadeSnapshot).
 * This store tracks: active selection, per-backend connection metadata,
 * and embedded server port.
 */

import { create } from 'zustand';
import type { ServerFeature } from '@my-claudia/shared';
import type { ControlPlaneMode } from '../utils/controlPlane';

// Per-backend connection metadata
export interface ServerConnection {
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  error: string | null;
  isLocalConnection: boolean | null;
  features: ServerFeature[];
  latencyMs?: number | null;
  lastLatencyProbeAt?: number;
  /** RSA-OAEP public key PEM for E2E credential encryption */
  publicKey?: string;
}

export type ConnectionStatus = ServerConnection['status'];

// Default connection state
const DEFAULT_CONNECTION: ServerConnection = {
  status: 'disconnected',
  error: null,
  isLocalConnection: null,
  features: [],
};

interface ServerState {
  activeServerId: string | null;
  // Per-backend connection metadata (backendId -> connection)
  connections: Record<string, ServerConnection>;
  // Runtime port for the embedded local server
  localServerPort: number | null;
  controlPlaneMode: ControlPlaneMode;
  controlPlaneState: 'connecting' | 'ready' | 'error';

  // Actions
  setActiveServer: (id: string | null) => void;
  // Per-backend setters
  setServerConnectionStatus: (serverId: string, status: ConnectionStatus, error?: string) => void;
  setServerLocalConnection: (serverId: string, isLocal: boolean | null) => void;
  setServerFeatures: (serverId: string, features: ServerFeature[]) => void;
  setServerPublicKey: (serverId: string, publicKey: string | undefined) => void;
  setServerLatency: (serverId: string, latencyMs: number | null) => void;
  updateLastConnected: (id: string) => void;
  setLocalServerPort: (port: number) => void;
  setControlPlaneMode: (mode: ControlPlaneMode) => void;
  setControlPlaneState: (state: 'connecting' | 'ready' | 'error') => void;

  // Getters
  getServerConnection: (serverId: string) => ServerConnection | undefined;
  getActiveServerConnection: () => ServerConnection | undefined;
  activeServerSupports: (feature: ServerFeature) => boolean;
}

export const useServerStore = create<ServerState>()((set, get) => ({
  activeServerId: null,
  connections: {},
  localServerPort: null,
  controlPlaneMode: 'embedded-local',
  controlPlaneState: 'connecting',

  setActiveServer: (id) => {
    const prev = get().activeServerId;
    if (prev !== id) {
      console.log(`[ServerStore] setActiveServer: ${prev} → ${id}`, new Error().stack?.split('\n').slice(1, 4).join(' | '));
    }
    set({
      activeServerId: id,
    });
  },

  setServerConnectionStatus: (serverId, status, error) => {
    const state = get();
    const newConnection: ServerConnection = {
      ...DEFAULT_CONNECTION,
      ...state.connections[serverId],
      status,
      error: error || null,
    };
    set({
      connections: { ...state.connections, [serverId]: newConnection },
    });
  },

  setServerLocalConnection: (serverId, isLocal) => {
    const state = get();
    const newConnection: ServerConnection = {
      ...DEFAULT_CONNECTION,
      ...state.connections[serverId],
      isLocalConnection: isLocal,
    };
    set({
      connections: { ...state.connections, [serverId]: newConnection },
    });
  },

  setServerFeatures: (serverId, features) => {
    const state = get();
    set({
      connections: {
        ...state.connections,
        [serverId]: { ...DEFAULT_CONNECTION, ...state.connections[serverId], features },
      },
    });
  },

  setServerPublicKey: (serverId, publicKey) => {
    const state = get();
    set({
      connections: {
        ...state.connections,
        [serverId]: { ...DEFAULT_CONNECTION, ...state.connections[serverId], publicKey },
      },
    });
  },

  setServerLatency: (serverId, latencyMs) => {
    const state = get();
    set({
      connections: {
        ...state.connections,
        [serverId]: {
          ...DEFAULT_CONNECTION,
          ...state.connections[serverId],
          latencyMs,
          lastLatencyProbeAt: Date.now(),
        },
      },
    });
  },

  updateLastConnected: (_id) => {
    // No-op: previously updated servers array which no longer exists
  },

  setLocalServerPort: (port) => {
    set({ localServerPort: port });
  },

  setControlPlaneMode: (mode) => {
    set({ controlPlaneMode: mode });
  },

  setControlPlaneState: (state) => {
    set({ controlPlaneState: state });
  },

  getServerConnection: (serverId) => {
    return get().connections[serverId];
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
  },
}));
