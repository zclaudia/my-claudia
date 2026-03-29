/**
 * Facade Store
 *
 * Zustand store that holds BackendFacadeSnapshot state and the facade instance.
 * Replaces the gateway-related parts of gatewayStore for facade consumers.
 *
 * See docs/design/backend-facade.md § "Phase 2a"
 */

import { create } from 'zustand';
import type {
  BackendConnectionState,
  BackendFacade,
  BackendFacadeEvent,
  BackendFacadeSnapshot,
  BackendSnapshot,
  SessionStreamSnapshot,
} from '@my-claudia/shared';

interface FacadeState {
  // Facade instance (set once during initialization)
  facade: BackendFacade | null;

  // From BackendFacadeSnapshot
  mode: BackendFacadeSnapshot['mode'] | null;
  connectionState: BackendConnectionState;
  connectionError: string | null;
  backends: BackendSnapshot[];
  sessionStreams: Record<string, SessionStreamSnapshot>;
  localBackendId: string | null;
  currentInstanceId: string | null;
  currentDeviceId: string | null;
  registryRevision: number;
  snapshotVersion: number;

  // Actions
  setFacade: (facade: BackendFacade) => void;
  clearFacade: () => void;
  applySnapshot: (snapshot: BackendFacadeSnapshot) => void;
  applyEvent: (event: BackendFacadeEvent) => void;
}

const initialState = {
  facade: null,
  mode: null as BackendFacadeSnapshot['mode'] | null,
  connectionState: 'idle' as BackendConnectionState,
  connectionError: null as string | null,
  backends: [],
  sessionStreams: {},
  localBackendId: null,
  currentInstanceId: null,
  currentDeviceId: null,
  registryRevision: 0,
  snapshotVersion: 0,
};

export const useFacadeStore = create<FacadeState>((set, get) => ({
  ...initialState,

  setFacade: (facade) => set({ facade }),

  clearFacade: () => set({ ...initialState }),

  applySnapshot: (snapshot) =>
    set((state) => ({
      mode: snapshot.mode,
      connectionState: snapshot.connectionState,
      connectionError: snapshot.connectionState === 'connected' ? null : state.connectionError,
      backends: snapshot.backends,
      sessionStreams: snapshot.sessionStreams,
      localBackendId: snapshot.localBackendId,
      currentInstanceId: snapshot.currentInstanceId,
      currentDeviceId: snapshot.currentDeviceId,
      registryRevision: snapshot.registryRevision ?? 0,
      snapshotVersion: snapshot.snapshotVersion,
    })),

  applyEvent: (event) => {
    switch (event.type) {
      case 'connection_state_changed':
        set({
          connectionState: event.state,
          connectionError: event.state === 'error' ? (event.error ?? 'Connection failed') : null,
        });
        break;

      case 'snapshot_updated':
        get().applySnapshot(event.snapshot);
        break;

      case 'backend_state_changed': {
        const backends = get().backends.map((b) =>
          b.backendId === event.backendId
            ? { ...b, runtimeState: event.state, lastError: event.error }
            : b,
        );
        set({ backends });
        break;
      }

      case 'session_stream_state_changed': {
        const streams = { ...get().sessionStreams };
        streams[event.stream.streamKey] = event.stream;
        set({ sessionStreams: streams });
        break;
      }

      // catalog_snapshot, catalog_event, run_event, content_patch
      // are consumed by sessionsStore / chatStore, not by facadeStore.
      // They pass through the event listeners but don't update facade state.
      default:
        break;
    }
  },
}));
