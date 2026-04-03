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
  retryCount: number;
  lastMessageAt: number | null;
  statusEnteredAt: number;
}

export interface BackendRecoveryState {
  backendId: string;
  status: BackendRecoveryStatus;
  desiredOpen: boolean;
  channelReady: boolean;
  catalogReady: boolean;
  retryCount: number;
  lastError: string | null;
  lastCloseReason: string | null;
  statusEnteredAt: number;
}

export interface CatalogRecoveryState {
  backendId: string;
  status: CatalogRecoveryStatus;
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
  current: BackendRecoveryState | undefined,
): { status: BackendRecoveryStatus; channelReady: boolean } {
  switch (runtimeState) {
    case 'ready':
      return { status: 'ready', channelReady: true };
    case 'opening':
      return { status: 'opening', channelReady: false };
    case 'visible': {
      const wasPreviouslyActive = current?.status === 'ready' || current?.status === 'degraded';
      return { status: wasPreviouslyActive ? 'degraded' : 'visible', channelReady: false };
    }
    case 'offline':
      return {
        status: current?.desiredOpen || current?.status === 'ready' ? 'degraded' : 'absent',
        channelReady: false,
      };
    case 'error':
      return { status: 'error', channelReady: false };
    default:
      return { status: 'absent', channelReady: false };
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
    channelReady: current?.channelReady ?? false,
    catalogReady: current?.catalogReady ?? false,
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

function upsertCatalogState(
  current: CatalogRecoveryState | undefined,
  backendId: string,
  status: CatalogRecoveryStatus,
  overrides: Partial<CatalogRecoveryState> = {},
): CatalogRecoveryState {
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

export const RECOVERY_TIMEOUTS = {
  TRANSPORT_CONNECT: 10_000,
  BACKEND_OPEN: 15_000,
  CATALOG_SYNC: 10_000,
  SESSION_STREAM_OPEN: 10_000,
  SESSION_CATCHUP: 15_000,
  RECONCILE_INTERVAL: 30_000,
  CATALOG_STALENESS_ACTIVE: 5 * 60_000,
  CATALOG_STALENESS_INACTIVE: 15 * 60_000,
} as const;

export const RECOVERY_MAX_RETRIES = {
  TRANSPORT: 5,
  BACKEND: 3,
  CATALOG_FULL: 3,
  CATALOG_DELTA: 1,
  SESSION_STREAM: 2,
  SESSION_CATCHUP: 2,
} as const;

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
  startBackendRecovery: (backendId: string) => void;
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
  noteTransportMessage: () => void;
  noteActiveSessionMessage: () => void;
  noteTransportTimeout: () => void;
  noteBackendTimeout: (backendId: string) => void;
  noteCatalogSyncTimeout: (backendId: string) => void;
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
        status: backend.status === 'ready' ? 'degraded' : backend.status,
        channelReady: false,
        catalogReady: false,
        retryCount: 0,
        lastCloseReason: backend.status === 'ready' ? 'transport_reconnecting' : backend.lastCloseReason,
        statusEnteredAt: now(),
      };
    }

    const catalogs: Record<string, CatalogRecoveryState> = {};
    for (const [backendId, catalog] of Object.entries(state.catalogs)) {
      catalogs[backendId] = {
        ...catalog,
        status: backendId === state.activeBackendId ? 'stale' : catalog.status,
        retryCount: 0,
        statusEnteredAt: backendId === state.activeBackendId ? now() : catalog.statusEnteredAt,
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
      catalogs,
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

    // Only recover catalogs that were previously tracked (i.e. synced at least
    // once). Missing catalog entry means first boot, not a disruption.
    const catalogNeedsSync = state.catalogs[backendId] != null
      && state.catalogs[backendId].status !== 'ready';
    // Only recover sessions that were actively in use — idle means first boot.
    const sessionNeedsRecovery = state.selectedSessionId
      && state.activeSession.status !== 'live'
      && state.activeSession.status !== 'idle';

    if (!catalogNeedsSync && !sessionNeedsRecovery) return state;

    const catalogs = { ...state.catalogs };
    if (catalogs[backendId]) {
      catalogs[backendId] = {
        ...catalogs[backendId],
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
      catalogs,
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
      const mapped = mapBackendStatus(backend.runtimeState, current);
      backends[backend.backendId] = upsertBackendState(
        current,
        backend.backendId,
        mapped.status,
        {
          lastError: backend.lastError ?? current?.lastError ?? null,
          channelReady: mapped.channelReady,
          catalogReady: mapped.channelReady ? (current?.catalogReady ?? false) : false,
        },
      );
    }

    for (const backendId of Object.keys(backends)) {
      if (!seen.has(backendId)) {
        backends[backendId] = upsertBackendState(backends[backendId], backendId, 'absent', {
          channelReady: false,
          catalogReady: false,
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

  noteCatalogSyncFailed: (backendId, error) => set((state) => {
    const current = state.catalogs[backendId];
    const retryCount = (current?.retryCount ?? 0) + 1;
    const maxRetries = current?.status === 'syncing_delta'
      ? RECOVERY_MAX_RETRIES.CATALOG_DELTA
      : RECOVERY_MAX_RETRIES.CATALOG_FULL;
    const retriesExhausted = retryCount >= maxRetries;
    const nextStatus: CatalogRecoveryStatus = retriesExhausted
      ? 'error'
      : current?.status === 'syncing_delta' ? 'stale' : (current?.status ?? 'error');
    return {
      coordinator: retriesExhausted && state.coordinator === 'recovering' ? 'error' : state.coordinator,
      catalogs: {
        ...state.catalogs,
        [backendId]: upsertCatalogState(current, backendId, nextStatus, {
          lastError: error,
          retryCount,
        }),
      },
    };
  }),

  noteCatalogSyncSucceeded: (backendId) => {
    const ownershipVersion = get().nextOwnershipVersion;
    set((state) => {
      const backend = state.backends[backendId];
      const channelReady = backend?.channelReady ?? false;
      const backendStatus = channelReady ? 'ready' as const : (backend?.status ?? 'opening' as const);
      return {
        catalogs: {
          ...state.catalogs,
          [backendId]: upsertCatalogState(state.catalogs[backendId], backendId, 'ready', {
            ownershipVersion,
            retryCount: 0,
            lastError: null,
            lastSyncAt: now(),
          }),
        },
        nextOwnershipVersion: ownershipVersion + 1,
        backends: {
          ...state.backends,
          [backendId]: upsertBackendState(backend, backendId, backendStatus, {
            desiredOpen: backend?.desiredOpen ?? true,
            catalogReady: true,
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

  noteTransportMessage: () => set((state) => ({
    transport: { ...state.transport, lastMessageAt: now() },
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
          lastError: `Backend open timeout (attempt ${retryCount}/${RECOVERY_MAX_RETRIES.BACKEND})`,
          channelReady: false,
          catalogReady: false,
        }),
      },
    };
  }),

  noteCatalogSyncTimeout: (backendId) => set((state) => {
    const catalog = state.catalogs[backendId];
    if (!catalog) return state;
    const retryCount = catalog.retryCount + 1;
    const wasDelta = catalog.status === 'syncing_delta';
    const maxRetries = wasDelta ? RECOVERY_MAX_RETRIES.CATALOG_DELTA : RECOVERY_MAX_RETRIES.CATALOG_FULL;
    const retriesExhausted = retryCount >= maxRetries;
    const nextStatus: CatalogRecoveryStatus = wasDelta
      ? 'stale'
      : (retriesExhausted ? 'error' : catalog.status);
    return {
      coordinator: retriesExhausted && !wasDelta && state.coordinator === 'recovering' ? 'error' : state.coordinator,
      catalogs: {
        ...state.catalogs,
        [backendId]: upsertCatalogState(catalog, backendId, nextStatus, {
          retryCount,
          lastError: `Catalog sync timeout (attempt ${retryCount}/${maxRetries})`,
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

export function isBackendReady(backendId: string | null | undefined): boolean {
  if (!backendId) return false;
  return useRecoveryStore.getState().backends[backendId]?.status === 'ready';
}

export function isTransportReady(): boolean {
  return useRecoveryStore.getState().transport.status === 'connected';
}
