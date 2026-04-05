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
  snapshotVersion: 0,
};

export const useFacadeStore = create<FacadeState>((set, get) => ({
  ...initialState,

  setFacade: (facade) => set({ facade }),

  clearFacade: () => set({ ...initialState }),

  applySnapshot: (snapshot) =>
    set((state) => {
      // Reuse existing array/object references if content hasn't changed.
      // This avoids re-rendering components that subscribe to specific fields
      // when periodic snapshot publishes arrive with identical data.
      const backendsChanged = state.backends.length !== snapshot.backends.length
        || state.backends.some((b, i) => {
          const nb = snapshot.backends[i];
          return b.backendId !== nb.backendId
            || b.runtimeState !== nb.runtimeState
            || b.openState !== nb.openState
            || b.online !== nb.online
            || b.lastError !== nb.lastError
            || b.capabilities?.length !== nb.capabilities?.length
            || b.capabilities?.some((c, j) => c !== nb.capabilities?.[j]);
        });

      const stateStreamKeys = Object.keys(state.sessionStreams);
      const snapshotStreamKeys = Object.keys(snapshot.sessionStreams);
      const streamsChanged = stateStreamKeys.length !== snapshotStreamKeys.length
        || stateStreamKeys.some(key =>
          !snapshot.sessionStreams[key]
          || state.sessionStreams[key].state !== snapshot.sessionStreams[key].state
        );

      // If nothing changed at all, return the existing state to avoid any re-render
      if (
        !backendsChanged
        && !streamsChanged
        && state.connectionState === snapshot.connectionState
        && state.mode === snapshot.mode
        && state.localBackendId === snapshot.localBackendId
        && state.currentInstanceId === snapshot.currentInstanceId
        && state.currentDeviceId === snapshot.currentDeviceId
      ) {
        return state;
      }

      return {
        mode: snapshot.mode,
        connectionState: snapshot.connectionState,
        connectionError: snapshot.connectionState === 'connected' ? null : state.connectionError,
        backends: backendsChanged ? snapshot.backends : state.backends,
        sessionStreams: streamsChanged ? snapshot.sessionStreams : state.sessionStreams,
        localBackendId: snapshot.localBackendId,
        currentInstanceId: snapshot.currentInstanceId,
        currentDeviceId: snapshot.currentDeviceId,
        snapshotVersion: snapshot.snapshotVersion,
      };
    }),

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

      // backend_data_snapshot, backend_data_event, run_event, content_patch
      // are consumed by sessionsStore / chatStore, not by facadeStore.
      // They pass through the event listeners but don't update facade state.
      default:
        break;
    }
  },
}));
