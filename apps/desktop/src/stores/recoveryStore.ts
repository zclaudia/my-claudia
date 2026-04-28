import { create } from 'zustand';
import type {
  BackendConnectionState,
  BackendFacadeMode,
  BackendFacadeSnapshot,
  BackendRuntimeState,
} from '@my-claudia/shared';

export type RecoveryCoordinatorStatus = 'ready' | 'background' | 'recovering' | 'error';
export type TransportStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'stopped';
export type BackendRecoveryStatus = 'absent' | 'visible' | 'subscribing' | 'ready' | 'error';
export type DataSyncStatus = 'idle' | 'stale' | 'syncing_full' | 'syncing_delta' | 'ready' | 'error';
export type ActiveSessionRecoveryStatus =
  | 'idle'
  | 'resolving_owner'
  | 'waiting_backend_ready'
  | 'opening_stream'
  | 'catching_up'
  | 'hydrating_tail'
  | 'live'
  | 'stale'
  | 'error';

export type BackendRecoveryViewState =
  | 'offline'
  | 'transport_reconnecting'
  | 'backend_visible'
  | 'backend_subscribing'
  | 'data_syncing'
  | 'session_syncing'
  | 'ready'
  | 'error';

export interface TransportState {
  status: TransportStatus;
  mode: BackendFacadeMode;
  generation: number;
  error: string | null;
  peerSessionId: string | null;
  retryCount: number;
  lastMessageAt: number | null;
  statusEnteredAt: number;
}

export interface BackendRecoveryState {
  backendId: string;
  status: BackendRecoveryStatus;
  subscribed: boolean;
  dataReady: boolean;
  retryCount: number;
  lastError: string | null;
  lastCloseReason: string | null;
  statusEnteredAt: number;
}

export interface DataSyncState {
  backendId: string;
  status: DataSyncStatus;
  ownershipVersion: number;
  retryCount: number;
  lastError: string | null;
  lastSyncAt: number | null;
  statusEnteredAt: number;
}

export interface ActiveSessionRecoveryState {
  sessionId: string | null;
  status: ActiveSessionRecoveryStatus;
  backendId: string | null;
  ownershipVersion: number | null;
  retryCount: number;
  lastError: string | null;
  hasGapMarker: boolean;
  lastMessageAt: number | null;
  statusEnteredAt: number;
}

function now(): number {
  return Date.now();
}

function initialTransport(): TransportState {
  return {
    status: 'idle',
    mode: 'embedded',
    generation: 0,
    error: null,
    peerSessionId: null,
    retryCount: 0,
    lastMessageAt: null,
    statusEnteredAt: now(),
  };
}

function initialActiveSession(): ActiveSessionRecoveryState {
  return {
    sessionId: null,
    status: 'idle',
    backendId: null,
    ownershipVersion: null,
    retryCount: 0,
    lastError: null,
    hasGapMarker: false,
    lastMessageAt: null,
    statusEnteredAt: now(),
  };
}

function mapTransportStatus(state: BackendConnectionState): TransportStatus {
  switch (state) {
    case 'connected':
      return 'connected';
    case 'reconnecting':
      return 'reconnecting';
    case 'connecting':
      return 'connecting';
    case 'error':
      return 'error';
    case 'disconnected':
      return 'stopped';
    default:
      return 'idle';
  }
}

function mapBackendStatus(
  runtimeState: BackendRuntimeState,
): { status: BackendRecoveryStatus; subscribed: boolean } {
  switch (runtimeState) {
    case 'ready':
      return { status: 'ready', subscribed: true };
    case 'subscribing':
      return { status: 'subscribing', subscribed: false };
    case 'visible':
      return { status: 'visible', subscribed: false };
    case 'offline':
      return { status: 'absent', subscribed: false };
    case 'error':
      return { status: 'error', subscribed: false };
    default:
      return { status: 'absent', subscribed: false };
  }
}

function upsertBackendState(
  current: BackendRecoveryState | undefined,
  backendId: string,
  status: BackendRecoveryStatus,
  overrides: Partial<BackendRecoveryState> = {},
): BackendRecoveryState {
  const enteredAt = current?.status === status ? current.statusEnteredAt : now();
  return {
    subscribed: current?.subscribed ?? false,
    dataReady: current?.dataReady ?? false,
    retryCount: current?.retryCount ?? 0,
    lastError: current?.lastError ?? null,
    lastCloseReason: current?.lastCloseReason ?? null,
    ...current,
    ...overrides,
    backendId,
    status,
    statusEnteredAt: overrides.statusEnteredAt ?? enteredAt,
  };
}

function upsertDataSyncState(
  current: DataSyncState | undefined,
  backendId: string,
  status: DataSyncStatus,
  overrides: Partial<DataSyncState> = {},
): DataSyncState {
  const enteredAt = current?.status === status ? current.statusEnteredAt : now();
  return {
    ownershipVersion: current?.ownershipVersion ?? 0,
    retryCount: current?.retryCount ?? 0,
    lastError: current?.lastError ?? null,
    lastSyncAt: current?.lastSyncAt ?? null,
    ...current,
    ...overrides,
    backendId,
    status,
    statusEnteredAt: overrides.statusEnteredAt ?? enteredAt,
  };
}

function updateActiveSession(
  current: ActiveSessionRecoveryState,
  status: ActiveSessionRecoveryStatus,
  overrides: Partial<ActiveSessionRecoveryState> = {},
): ActiveSessionRecoveryState {
  const enteredAt = current.status === status ? current.statusEnteredAt : now();
  return {
    ...current,
    status,
    statusEnteredAt: overrides.statusEnteredAt ?? enteredAt,
    ...overrides,
  };
}


export const RECOVERY_MAX_RETRIES = {
  TRANSPORT: 5,
  BACKEND: 3,
  DATA_SYNC_FULL: 3,
  DATA_SYNC_DELTA: 1,
  SESSION_STREAM: 2,
  SESSION_CATCHUP: 2,
} as const;

interface RecoveryState {
  coordinator: RecoveryCoordinatorStatus;
  transport: TransportState;
  activeBackendId: string | null;
  selectedSessionId: string | null;
  backends: Record<string, BackendRecoveryState>;
  dataSyncs: Record<string, DataSyncState>;
  activeSession: ActiveSessionRecoveryState;
  nextOwnershipVersion: number;
  backgroundAt: number | null;

  setSelection: (activeBackendId: string | null, selectedSessionId: string | null) => void;
  noteBackground: () => void;
  startRecovery: (mode?: BackendFacadeMode) => void;
  startBackendRecovery: (backendId: string) => void;
  setTransportState: (state: BackendConnectionState, error?: string | null) => void;
  applySnapshot: (snapshot: BackendFacadeSnapshot) => void;
  noteBackendSubscribing: (backendId: string) => void;
  noteDataSyncStarted: (backendId: string, mode: 'full' | 'delta') => void;
  noteDataSyncFailed: (backendId: string, error: string) => void;
  noteDataSyncSucceeded: (backendId: string) => number;
  noteActiveSessionResolving: (sessionId: string, backendId: string | null) => void;
  noteActiveSessionOwnerVerified: (sessionId: string, backendId: string, ownershipVersion: number) => void;
  noteActiveSessionWaiting: (sessionId: string, backendId: string | null) => void;
  noteActiveSessionOpeningStream: (sessionId: string, backendId: string) => void;
  noteActiveSessionCatchingUp: (sessionId: string, backendId: string) => void;
  noteActiveSessionHydrating: (sessionId: string, backendId: string) => void;
  noteActiveSessionLive: (sessionId: string, backendId: string) => void;
  noteActiveSessionStale: () => void;
  noteActiveSessionError: (error: string) => void;
  noteActiveSessionMessage: () => void;
  noteTransportTimeout: () => void;
  noteBackendTimeout: (backendId: string) => void;
  noteDataSyncTimeout: (backendId: string) => void;
  noteActiveSessionTimeout: () => void;
  completeRecoveryIfPossible: () => void;
  markReady: () => void;
  getVerifiedSessionBackendId: (sessionId: string | null | undefined) => string | null;
  getBackendViewState: (backendId: string | null | undefined) => BackendRecoveryViewState;
}

export const useRecoveryStore = create<RecoveryState>()((set, get) => ({
  coordinator: 'ready',
  transport: initialTransport(),
  activeBackendId: null,
  selectedSessionId: null,
  backends: {},
  dataSyncs: {},
  activeSession: initialActiveSession(),
  nextOwnershipVersion: 1,
  backgroundAt: null,

  setSelection: (activeBackendId, selectedSessionId) => set((state) => {
    if (
      state.activeBackendId === activeBackendId
      && state.selectedSessionId === selectedSessionId
      && (
        (!selectedSessionId && state.activeSession.sessionId === null)
        || state.activeSession.sessionId === selectedSessionId
      )
    ) {
      return state;
    }

    let activeSession = state.activeSession;
    if (!selectedSessionId) {
      activeSession = initialActiveSession();
    } else if (state.activeSession.sessionId !== selectedSessionId) {
      activeSession = {
        sessionId: selectedSessionId,
        status: state.coordinator === 'recovering' ? 'stale' : 'idle',
        backendId: null,
        ownershipVersion: null,
        retryCount: 0,
        lastError: null,
        hasGapMarker: false,
        lastMessageAt: null,
        statusEnteredAt: now(),
      };
    }

    return {
      activeBackendId,
      selectedSessionId,
      activeSession,
    };
  }),

  noteBackground: () => set({
    coordinator: 'background',
    backgroundAt: now(),
  }),

  startRecovery: (mode) => set((state) => {
    const nextGeneration = state.transport.generation + 1;
    const backends: Record<string, BackendRecoveryState> = {};
    for (const [backendId, backend] of Object.entries(state.backends)) {
      backends[backendId] = {
        ...backend,
        // Preserve subscribed — it reflects the facade's actual subscription state.
        // If still subscribed (common in embedded mode), keeping this true
        // lets noteDataSyncSucceeded restore the backend to ready after sync.
        dataReady: false,
        retryCount: 0,
        lastCloseReason: backend.status === 'ready' ? 'transport_reconnecting' : backend.lastCloseReason,
        statusEnteredAt: now(),
      };
    }

    const dataSyncs: Record<string, DataSyncState> = {};
    for (const [backendId, dataSync] of Object.entries(state.dataSyncs)) {
      dataSyncs[backendId] = {
        ...dataSync,
        status: backendId === state.activeBackendId ? 'stale' : dataSync.status,
        retryCount: 0,
        statusEnteredAt: backendId === state.activeBackendId ? now() : dataSync.statusEnteredAt,
      };
    }

    const activeSession = state.selectedSessionId
      ? {
          ...state.activeSession,
          sessionId: state.selectedSessionId,
          status: 'stale' as const,
          retryCount: 0,
          lastError: null,
          statusEnteredAt: now(),
        }
      : initialActiveSession();

    return {
      coordinator: 'recovering',
      transport: {
        ...state.transport,
        mode: mode ?? state.transport.mode,
        generation: nextGeneration,
        // Don't override transport.status — it's managed by connection_state_changed
        // events from the WS lifecycle. If the WS is still connected (common in
        // embedded mode), the coordinator can proceed immediately.
        error: null,
        retryCount: 0,
      },
      backends,
      dataSyncs,
      activeSession,
      backgroundAt: null,
    };
  }),

  startBackendRecovery: (backendId) => set((state) => {
    if (state.coordinator === 'recovering') return state;
    if (state.transport.status !== 'connected') return state;
    if (state.activeBackendId !== backendId) return state;

    const backend = state.backends[backendId];
    if (!backend) return state;

    // Only recover data syncs that were previously tracked (i.e. synced at least
    // once). Missing data sync entry means first boot, not a disruption.
    const dataNeedsSync = state.dataSyncs[backendId] != null
      && state.dataSyncs[backendId].status !== 'ready';
    // Only recover sessions that were actively in use — idle means first boot.
    const sessionNeedsRecovery = state.selectedSessionId
      && state.activeSession.status !== 'live'
      && state.activeSession.status !== 'idle';

    if (!dataNeedsSync && !sessionNeedsRecovery) return state;

    const dataSyncs = { ...state.dataSyncs };
    if (dataSyncs[backendId]) {
      dataSyncs[backendId] = {
        ...dataSyncs[backendId],
        status: 'stale',
        retryCount: 0,
        lastError: null,
        statusEnteredAt: now(),
      };
    }

    const activeSession = state.selectedSessionId
      ? {
          ...state.activeSession,
          sessionId: state.selectedSessionId,
          status: 'stale' as const,
          retryCount: 0,
          lastError: null,
          statusEnteredAt: now(),
        }
      : state.activeSession;

    return {
      coordinator: 'recovering',
      dataSyncs,
      activeSession,
    };
  }),

  setTransportState: (state, error) => set((current) => {
    const status = mapTransportStatus(state);
    const coordinator =
      status === 'error' && current.coordinator === 'recovering'
        ? 'error'
        : current.coordinator;
    return {
      coordinator,
      transport: {
        ...current.transport,
        status,
        error: error ?? null,
        statusEnteredAt: now(),
      },
    };
  }),

  applySnapshot: (snapshot) => set((state) => {
    const backends = { ...state.backends };
    const seen = new Set<string>();

    for (const backend of snapshot.backends) {
      seen.add(backend.backendId);
      const current = backends[backend.backendId];
      const mapped = mapBackendStatus(backend.runtimeState);
      backends[backend.backendId] = upsertBackendState(
        current,
        backend.backendId,
        mapped.status,
        {
          lastError: backend.lastError ?? current?.lastError ?? null,
          subscribed: mapped.subscribed,
          dataReady: mapped.subscribed ? (current?.dataReady ?? false) : false,
        },
      );
    }

    for (const backendId of Object.keys(backends)) {
      if (!seen.has(backendId)) {
        backends[backendId] = upsertBackendState(backends[backendId], backendId, 'absent', {
          subscribed: false,
          dataReady: false,
        });
      }
    }

    let coordinator = state.coordinator;
    if (coordinator === 'recovering' && snapshot.connectionState === 'connected' && !state.activeBackendId) {
      coordinator = 'ready';
    }

    return {
      coordinator,
      transport: {
        ...state.transport,
        mode: snapshot.mode,
        // Don't override transport.status from snapshot — the snapshot's
        // connectionState reflects server-side state (e.g. gateway connection),
        // not the client WS state. Transport is managed by setTransportState.
        lastMessageAt: now(),
      },
      backends,
    };
  }),

  noteBackendSubscribing: (backendId) => set((state) => ({
    backends: {
      ...state.backends,
      [backendId]: upsertBackendState(state.backends[backendId], backendId, 'subscribing', {
        lastError: null,
      }),
    },
  })),

  noteDataSyncStarted: (backendId, mode) => set((state) => ({
    dataSyncs: {
      ...state.dataSyncs,
      [backendId]: upsertDataSyncState(
        state.dataSyncs[backendId],
        backendId,
        mode === 'delta' ? 'syncing_delta' : 'syncing_full',
        { lastError: null },
      ),
    },
  })),

  noteDataSyncFailed: (backendId, error) => set((state) => {
    const current = state.dataSyncs[backendId];
    const retryCount = (current?.retryCount ?? 0) + 1;
    const maxRetries = current?.status === 'syncing_delta'
      ? RECOVERY_MAX_RETRIES.DATA_SYNC_DELTA
      : RECOVERY_MAX_RETRIES.DATA_SYNC_FULL;
    const retriesExhausted = retryCount >= maxRetries;
    // On failure (not exhausted), reset to 'stale' so the planner can re-trigger sync.
    // Previously syncing_full stayed as syncing_full, causing the planner to think a sync
    // was still in flight and only recovering via the 30s reconciliation tick.
    const nextStatus: DataSyncStatus = retriesExhausted ? 'error' : 'stale';
    return {
      coordinator: retriesExhausted && state.coordinator === 'recovering' ? 'error' : state.coordinator,
      dataSyncs: {
        ...state.dataSyncs,
        [backendId]: upsertDataSyncState(current, backendId, nextStatus, {
          lastError: error,
          retryCount,
        }),
      },
    };
  }),

  noteDataSyncSucceeded: (backendId) => {
    const state = get();
    const dataSync = state.dataSyncs[backendId];
    const backend = state.backends[backendId];
    // If already in ready state with data, skip store write to avoid re-renders
    if (dataSync?.status === 'ready' && backend?.dataReady) {
      return dataSync.ownershipVersion ?? state.nextOwnershipVersion;
    }
    const ownershipVersion = state.nextOwnershipVersion;
    set((s) => {
      const b = s.backends[backendId];
      const subscribed = b?.subscribed ?? false;
      const backendStatus = subscribed ? 'ready' as const : (b?.status ?? 'subscribing' as const);
      return {
        dataSyncs: {
          ...s.dataSyncs,
          [backendId]: upsertDataSyncState(s.dataSyncs[backendId], backendId, 'ready', {
            ownershipVersion,
            retryCount: 0,
            lastError: null,
            lastSyncAt: now(),
          }),
        },
        nextOwnershipVersion: ownershipVersion + 1,
        backends: {
          ...s.backends,
          [backendId]: upsertBackendState(b, backendId, backendStatus, {
            dataReady: true,
          }),
        },
      };
    });
    return ownershipVersion;
  },

  noteActiveSessionResolving: (sessionId, backendId) => set((state) => ({
    activeSession: updateActiveSession(state.activeSession, 'resolving_owner', {
      sessionId,
      backendId,
      ownershipVersion: null,
      lastError: null,
      hasGapMarker: false,
    }),
  })),

  noteActiveSessionOwnerVerified: (sessionId, backendId, ownershipVersion) => set((state) => ({
    activeSession: updateActiveSession(state.activeSession, 'opening_stream', {
      sessionId,
      backendId,
      ownershipVersion,
      lastError: null,
    }),
  })),

  noteActiveSessionWaiting: (sessionId, backendId) => set((state) => ({
    activeSession: updateActiveSession(state.activeSession, 'waiting_backend_ready', {
      sessionId,
      backendId,
    }),
  })),

  noteActiveSessionOpeningStream: (sessionId, backendId) => set((state) => ({
    activeSession: updateActiveSession(state.activeSession, 'opening_stream', {
      sessionId,
      backendId,
    }),
  })),

  noteActiveSessionCatchingUp: (sessionId, backendId) => set((state) => ({
    activeSession: updateActiveSession(state.activeSession, 'catching_up', {
      sessionId,
      backendId,
    }),
  })),

  noteActiveSessionHydrating: (sessionId, backendId) => set((state) => ({
    activeSession: updateActiveSession(state.activeSession, 'hydrating_tail', {
      sessionId,
      backendId,
    }),
  })),

  noteActiveSessionLive: (sessionId, backendId) => set((state) => ({
    activeSession: updateActiveSession(state.activeSession, 'live', {
      sessionId,
      backendId,
      lastError: null,
    }),
  })),

  noteActiveSessionStale: () => set((state) => ({
    activeSession: state.activeSession.sessionId
      ? updateActiveSession(state.activeSession, 'stale')
      : state.activeSession,
  })),

  noteActiveSessionError: (error) => set((state) => ({
    coordinator: state.coordinator === 'recovering' ? 'error' : state.coordinator,
    activeSession: updateActiveSession(state.activeSession, 'error', { lastError: error }),
  })),

  noteActiveSessionMessage: () => set((state) => ({
    activeSession: { ...state.activeSession, lastMessageAt: now() },
  })),

  noteTransportTimeout: () => set((state) => {
    const retryCount = state.transport.retryCount + 1;
    const retriesExhausted = retryCount >= RECOVERY_MAX_RETRIES.TRANSPORT;
    return {
      coordinator: retriesExhausted && state.coordinator === 'recovering' ? 'error' : state.coordinator,
      transport: {
        ...state.transport,
        status: 'error' as const,
        retryCount,
        error: `Transport connect timeout (attempt ${retryCount}/${RECOVERY_MAX_RETRIES.TRANSPORT})`,
        statusEnteredAt: now(),
      },
    };
  }),

  noteBackendTimeout: (backendId) => set((state) => {
    const backend = state.backends[backendId];
    if (!backend) return state;
    const retryCount = backend.retryCount + 1;
    return {
      backends: {
        ...state.backends,
        [backendId]: upsertBackendState(backend, backendId, 'error', {
          retryCount,
          lastError: `Backend subscribe timeout (attempt ${retryCount}/${RECOVERY_MAX_RETRIES.BACKEND})`,
          subscribed: false,
          dataReady: false,
        }),
      },
    };
  }),

  noteDataSyncTimeout: (backendId) => set((state) => {
    const dataSync = state.dataSyncs[backendId];
    if (!dataSync) return state;
    const retryCount = dataSync.retryCount + 1;
    const wasDelta = dataSync.status === 'syncing_delta';
    const maxRetries = wasDelta ? RECOVERY_MAX_RETRIES.DATA_SYNC_DELTA : RECOVERY_MAX_RETRIES.DATA_SYNC_FULL;
    const retriesExhausted = retryCount >= maxRetries;
    const nextStatus: DataSyncStatus = wasDelta
      ? 'stale'
      : (retriesExhausted ? 'error' : dataSync.status);
    return {
      coordinator: retriesExhausted && !wasDelta && state.coordinator === 'recovering' ? 'error' : state.coordinator,
      dataSyncs: {
        ...state.dataSyncs,
        [backendId]: upsertDataSyncState(dataSync, backendId, nextStatus, {
          retryCount,
          lastError: `Data sync timeout (attempt ${retryCount}/${maxRetries})`,
        }),
      },
    };
  }),

  noteActiveSessionTimeout: () => set((state) => {
    const session = state.activeSession;
    const retryCount = session.retryCount + 1;
    const inCatchUpPhase = session.status === 'catching_up' || session.status === 'hydrating_tail';
    if (inCatchUpPhase) {
      return {
        activeSession: updateActiveSession(session, 'live', {
          retryCount,
          hasGapMarker: true,
          lastError: null,
        }),
      };
    }
    const retriesExhausted = retryCount >= RECOVERY_MAX_RETRIES.SESSION_STREAM;
    return {
      coordinator: retriesExhausted && state.coordinator === 'recovering' ? 'error' : state.coordinator,
      activeSession: updateActiveSession(session, 'error', {
        retryCount,
        lastError: `Active session recovery timeout (attempt ${retryCount}/${RECOVERY_MAX_RETRIES.SESSION_STREAM})`,
      }),
    };
  }),

  completeRecoveryIfPossible: () => set((state) => {
    if (state.coordinator !== 'recovering') return state;
    if (state.transport.status !== 'connected') return state;

    if (!state.activeBackendId) {
      return { coordinator: 'ready' };
    }

    const backend = state.backends[state.activeBackendId];
    const dataSync = state.dataSyncs[state.activeBackendId];
    if (!backend || backend.status !== 'ready') return state;
    if (!dataSync || dataSync.status !== 'ready') return state;
    if (!state.selectedSessionId) {
      return { coordinator: 'ready' };
    }
    if (
      state.activeSession.sessionId === state.selectedSessionId
      && state.activeSession.status === 'live'
    ) {
      return { coordinator: 'ready' };
    }
    return state;
  }),

  markReady: () => set({ coordinator: 'ready' }),

  getVerifiedSessionBackendId: (sessionId) => {
    if (!sessionId) return null;
    const activeSession = get().activeSession;
    if (activeSession.sessionId !== sessionId) return null;
    if (
      activeSession.status === 'opening_stream'
      || activeSession.status === 'catching_up'
      || activeSession.status === 'hydrating_tail'
      || activeSession.status === 'live'
    ) {
      return activeSession.backendId;
    }
    return null;
  },

  getBackendViewState: (backendId) => {
    const state = get();
    const backend = backendId ? state.backends[backendId] ?? null : null;
    const dataSync = backendId ? state.dataSyncs[backendId] ?? null : null;
    const activeSession = state.activeSession.sessionId && backendId === state.activeBackendId
      ? state.activeSession
      : null;

    if (state.transport.status === 'error' || backend?.status === 'error' || dataSync?.status === 'error' || activeSession?.status === 'error') {
      return 'error';
    }
    if (state.transport.status === 'idle' || state.transport.status === 'stopped') {
      return 'offline';
    }
    if (state.transport.status === 'connecting' || state.transport.status === 'reconnecting') {
      return 'transport_reconnecting';
    }
    if (!backend || backend.status === 'absent') return 'offline';
    if (backend.status === 'visible') return 'backend_visible';
    if (backend.status === 'subscribing') return 'backend_subscribing';
    if (!dataSync || dataSync.status === 'stale' || dataSync.status === 'syncing_full' || dataSync.status === 'syncing_delta' || dataSync.status === 'idle') {
      return 'data_syncing';
    }
    if (
      state.selectedSessionId
      && activeSession
      && ['resolving_owner', 'waiting_backend_ready', 'opening_stream', 'catching_up', 'hydrating_tail', 'stale'].includes(activeSession.status)
    ) {
      return 'session_syncing';
    }
    return 'ready';
  },
}));

export function isBackendReady(backendId: string | null | undefined): boolean {
  if (!backendId) return false;
  const state = useRecoveryStore.getState();
  return state.transport.status === 'connected' && state.backends[backendId]?.status === 'ready';
}

export function isTransportReady(): boolean {
  return useRecoveryStore.getState().transport.status === 'connected';
}
