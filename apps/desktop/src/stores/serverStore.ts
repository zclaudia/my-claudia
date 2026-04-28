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

export type ConnectionQuality = 'good' | 'degraded';

// Per-backend connection metadata (features, latency, encryption keys)
export interface ServerConnection {
  isLocalConnection: boolean | null;
  features: ServerFeature[];
  latencyMs?: number | null;
  lastLatencyProbeAt?: number;
  /** RSA-OAEP public key PEM for E2E credential encryption */
  publicKey?: string;
  /** Timestamp of the last state_heartbeat received from this server */
  lastHeartbeatAt?: number;
  /** Connection quality — 'degraded' when heartbeats stop arriving */
  connectionQuality?: ConnectionQuality;
}

const DEFAULT_CONNECTION: ServerConnection = {
  isLocalConnection: null,
  features: [],
};

interface ServerState {
  activeServerId: string | null;
  connections: Record<string, ServerConnection>;
  localServerPort: number | null;
  controlPlaneMode: ControlPlaneMode;

  // Actions
  setActiveServer: (id: string | null) => void;
  setServerLocalConnection: (serverId: string, isLocal: boolean | null) => void;
  setServerFeatures: (serverId: string, features: ServerFeature[]) => void;
  setServerPublicKey: (serverId: string, publicKey: string | undefined) => void;
  setServerLatency: (serverId: string, latencyMs: number | null) => void;
  recordHeartbeat: (serverId: string) => void;
  setConnectionQuality: (serverId: string, quality: ConnectionQuality) => void;
  setLocalServerPort: (port: number) => void;
  setControlPlaneMode: (mode: ControlPlaneMode) => void;

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

  setActiveServer: (id) => {
    const prev = get().activeServerId;
    if (prev === id) return;
    console.log(`[ServerStore] setActiveServer: ${prev} → ${id}`, new Error().stack?.split('\n').slice(1, 4).join(' | '));
    set({ activeServerId: id });
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
    const existing = state.connections[serverId]?.features;
    // Skip if features haven't changed (avoids re-renders from periodic snapshot updates)
    if (existing && existing.length === features.length && existing.every((f, i) => f === features[i])) return;
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

  recordHeartbeat: (serverId) => {
    const state = get();
    const existing = state.connections[serverId];
    const wasDegraded = existing?.connectionQuality === 'degraded';
    set({
      connections: {
        ...state.connections,
        [serverId]: {
          ...DEFAULT_CONNECTION,
          ...existing,
          lastHeartbeatAt: Date.now(),
          ...(wasDegraded ? { connectionQuality: 'good' as ConnectionQuality } : {}),
        },
      },
    });
  },

  setConnectionQuality: (serverId, quality) => {
    const state = get();
    const existing = state.connections[serverId];
    if (existing?.connectionQuality === quality) return;
    set({
      connections: {
        ...state.connections,
        [serverId]: { ...DEFAULT_CONNECTION, ...existing, connectionQuality: quality },
      },
    });
  },

  setLocalServerPort: (port) => {
    set({ localServerPort: port });
  },

  setControlPlaneMode: (mode) => {
    set({ controlPlaneMode: mode });
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
