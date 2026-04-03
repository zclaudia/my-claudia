import { create } from 'zustand';
import type {
  BackendConnectionState,
  BackendFacadeMode,
  BackendFacadeSnapshot,
  BackendRuntimeState,
  SessionStreamSnapshot,
} from '@my-claudia/shared';

export type RecoveryCoordinatorStatus = 'ready' | 'background' | 'recovering' | 'error';
export type TransportStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'stopped';
export type BackendRecoveryStatus = 'absent' | 'visible' | 'opening' | 'ready' | 'degraded' | 'error';
export type CatalogRecoveryStatus = 'idle' | 'stale' | 'syncing_full' | 'syncing_delta' | 'ready' | 'error';
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
  | 'backend_opening'
  | 'backend_recovering'
  | 'catalog_syncing'
  | 'session_syncing'
  | 'ready'
  | 'error';

export interface TransportState {
  status: TransportStatus;
  mode: BackendFacadeMode;
  generation: number;
  error: string | null;
  peerSessionId: string | null;
  statusEnteredAt: number;
}

export interface BackendRecoveryState {
  backendId: string;
  status: BackendRecoveryStatus;
  desiredOpen: boolean;
  lastError: string | null;
  lastCloseReason: string | null;
  statusEnteredAt: number;
}

export interface CatalogRecoveryState {
  backendId: string;
  status: CatalogRecoveryStatus;
  ownershipVersion: number;
  lastError: string | null;
  lastSyncAt: number | null;
  statusEnteredAt: number;
}

export interface ActiveSessionRecoveryState {
  sessionId: string | null;
  status: ActiveSessionRecoveryStatus;
  backendId: string | null;
  ownershipVersion: number | null;
  lastError: string | null;
  hasGapMarker: boolean;
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
    statusEnteredAt: now(),
  };
}

function initialActiveSession(): ActiveSessionRecoveryState {
  return {
    sessionId: null,
    status: 'idle',
    backendId: null,
    ownershipVersion: null,
    lastError: null,
    hasGapMarker: false,
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
  current: BackendRecoveryState | undefined,
): BackendRecoveryStatus {
  switch (runtimeState) {
    case 'ready':
      return 'ready';
    case 'opening':
      return 'opening';
    case 'visible':
      return current?.status === 'ready' || current?.status === 'degraded' ? 'degraded' : 'visible';
    case 'offline':
      return current?.desiredOpen || current?.status === 'ready' ? 'degraded' : 'absent';
    case 'error':
      return 'error';
    default:
      return 'absent';
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
    desiredOpen: current?.desiredOpen ?? false,
    lastError: current?.lastError ?? null,
    lastCloseReason: current?.lastCloseReason ?? null,
    ...current,
    ...overrides,
    backendId,
    status,
    statusEnteredAt: overrides.statusEnteredAt ?? enteredAt,
  };
}

function upsertCatalogState(
  current: CatalogRecoveryState | undefined,
  backendId: string,
  status: CatalogRecoveryStatus,
  overrides: Partial<CatalogRecoveryState> = {},
): CatalogRecoveryState {
  const enteredAt = current?.status === status ? current.statusEnteredAt : now();
  return {
    ownershipVersion: current?.ownershipVersion ?? 0,
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

interface RecoveryState {
  coordinator: RecoveryCoordinatorStatus;
  transport: TransportState;
  activeBackendId: string | null;
  selectedSessionId: string | null;
  backends: Record<string, BackendRecoveryState>;
  catalogs: Record<string, CatalogRecoveryState>;
  activeSession: ActiveSessionRecoveryState;
  nextOwnershipVersion: number;
  backgroundAt: number | null;

  setSelection: (activeBackendId: string | null, selectedSessionId: string | null) => void;
  noteBackground: () => void;
  startRecovery: (mode?: BackendFacadeMode) => void;
  setTransportState: (state: BackendConnectionState, error?: string | null) => void;
  applySnapshot: (snapshot: BackendFacadeSnapshot) => void;
  noteBackendDesiredOpen: (backendId: string) => void;
  noteCatalogSyncStarted: (backendId: string, mode: 'full' | 'delta') => void;
  noteCatalogSyncFailed: (backendId: string, error: string) => void;
  noteCatalogSyncSucceeded: (backendId: string) => number;
  noteActiveSessionResolving: (sessionId: string, backendId: string | null) => void;
  noteActiveSessionOwnerVerified: (sessionId: string, backendId: string, ownershipVersion: number) => void;
  noteActiveSessionWaiting: (sessionId: string, backendId: string | null) => void;
  noteActiveSessionOpeningStream: (sessionId: string, backendId: string) => void;
  noteActiveSessionCatchingUp: (sessionId: string, backendId: string) => void;
  noteActiveSessionHydrating: (sessionId: string, backendId: string) => void;
  noteActiveSessionLive: (sessionId: string, backendId: string) => void;
  noteActiveSessionStale: () => void;
  noteActiveSessionError: (error: string) => void;
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
  catalogs: {},
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
        lastError: null,
        hasGapMarker: false,
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
        status: backend.status === 'ready' ? 'degraded' : backend.status,
        lastCloseReason: backend.status === 'ready' ? 'transport_reconnecting' : backend.lastCloseReason,
        statusEnteredAt: now(),
      };
    }

    const catalogs: Record<string, CatalogRecoveryState> = {};
    for (const [backendId, catalog] of Object.entries(state.catalogs)) {
      catalogs[backendId] = {
        ...catalog,
        status: backendId === state.activeBackendId ? 'stale' : catalog.status,
        statusEnteredAt: backendId === state.activeBackendId ? now() : catalog.statusEnteredAt,
      };
    }

    const activeSession = state.selectedSessionId
      ? {
          ...state.activeSession,
          sessionId: state.selectedSessionId,
          status: 'stale' as const,
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
        status: state.transport.status === 'connected' ? 'reconnecting' : 'connecting',
        error: null,
        statusEnteredAt: now(),
      },
      backends,
      catalogs,
      activeSession,
      backgroundAt: null,
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
      backends[backend.backendId] = upsertBackendState(
        current,
        backend.backendId,
        mapBackendStatus(backend.runtimeState, current),
        { lastError: backend.lastError ?? current?.lastError ?? null },
      );
    }

    for (const backendId of Object.keys(backends)) {
      if (!seen.has(backendId)) {
        backends[backendId] = upsertBackendState(backends[backendId], backendId, 'absent');
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
        status: mapTransportStatus(snapshot.connectionState),
      },
      backends,
    };
  }),

  noteBackendDesiredOpen: (backendId) => set((state) => ({
    backends: {
      ...state.backends,
      [backendId]: upsertBackendState(state.backends[backendId], backendId, 'opening', {
        desiredOpen: true,
        lastError: null,
      }),
    },
  })),

  noteCatalogSyncStarted: (backendId, mode) => set((state) => ({
    catalogs: {
      ...state.catalogs,
      [backendId]: upsertCatalogState(
        state.catalogs[backendId],
        backendId,
        mode === 'delta' ? 'syncing_delta' : 'syncing_full',
        { lastError: null },
      ),
    },
  })),

  noteCatalogSyncFailed: (backendId, error) => set((state) => ({
    coordinator: state.coordinator === 'recovering' ? 'error' : state.coordinator,
    catalogs: {
      ...state.catalogs,
      [backendId]: upsertCatalogState(state.catalogs[backendId], backendId, 'error', { lastError: error }),
    },
  })),

  noteCatalogSyncSucceeded: (backendId) => {
    const ownershipVersion = get().nextOwnershipVersion;
    set((state) => ({
      catalogs: {
        ...state.catalogs,
        [backendId]: upsertCatalogState(state.catalogs[backendId], backendId, 'ready', {
          ownershipVersion,
          lastError: null,
          lastSyncAt: now(),
        }),
      },
      nextOwnershipVersion: ownershipVersion + 1,
      backends: {
        ...state.backends,
        [backendId]: upsertBackendState(state.backends[backendId], backendId, 'ready', {
          desiredOpen: state.backends[backendId]?.desiredOpen ?? true,
        }),
      },
    }));
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

  completeRecoveryIfPossible: () => set((state) => {
    if (state.coordinator !== 'recovering') return state;
    if (state.transport.status !== 'connected') return state;

    if (!state.activeBackendId) {
      return { coordinator: 'ready' };
    }

    const backend = state.backends[state.activeBackendId];
    const catalog = state.catalogs[state.activeBackendId];
    if (!backend || backend.status !== 'ready') return state;
    if (!catalog || catalog.status !== 'ready') return state;
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
    const catalog = backendId ? state.catalogs[backendId] ?? null : null;
    const activeSession = state.activeSession.sessionId && backendId === state.activeBackendId
      ? state.activeSession
      : null;

    if (state.transport.status === 'error' || backend?.status === 'error' || catalog?.status === 'error' || activeSession?.status === 'error') {
      return 'error';
    }
    if (state.transport.status === 'idle' || state.transport.status === 'stopped') {
      return 'offline';
    }
    if (state.transport.status === 'connecting' || state.transport.status === 'reconnecting') {
      return 'transport_reconnecting';
    }
    if (!backend || backend.status === 'absent') return 'offline';
    if (backend.status === 'degraded') return 'backend_recovering';
    if (backend.status === 'visible') return 'backend_visible';
    if (backend.status === 'opening') return 'backend_opening';
    if (!catalog || catalog.status === 'stale' || catalog.status === 'syncing_full' || catalog.status === 'syncing_delta' || catalog.status === 'idle') {
      return 'catalog_syncing';
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

export function getRecoverySessionStream(
  streams: Record<string, SessionStreamSnapshot>,
  backendId: string | null | undefined,
  sessionId: string | null | undefined,
): SessionStreamSnapshot | null {
  if (!backendId || !sessionId) return null;
  return streams[`${backendId}:${sessionId}`] ?? null;
}
