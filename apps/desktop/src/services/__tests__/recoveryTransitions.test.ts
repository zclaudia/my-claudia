import { beforeEach, describe, expect, it } from 'vitest';
import { useRecoveryStore } from '../../stores/recoveryStore';
import { useOwnershipStore } from '../../stores/ownershipStore';
import {
  noteBackendUnavailable,
  noteDataSyncStarted,
  noteDataSyncSucceeded,
  noteSessionCatchUpStarted,
  noteSessionRecoverySucceeded,
  noteSessionStreamOpening,
  noteTransportRecoveryTimeout,
  noteTransportStaleConnection,
} from '../recoveryTransitions';

function resetRecoveryState(): void {
  useRecoveryStore.setState({
    coordinator: 'recovering',
    transport: {
      status: 'connected',
      mode: 'direct',
      generation: 1,
      error: null,
      peerSessionId: null,
      retryCount: 0,
      lastMessageAt: Date.now(),
      statusEnteredAt: Date.now(),
    },
    activeBackendId: 'b1',
    selectedSessionId: 's1',
    backends: {
      b1: {
        backendId: 'b1',
        status: 'ready',
        subscribed: true,
        dataReady: false,
        retryCount: 0,
        lastError: null,
        lastCloseReason: null,
        statusEnteredAt: Date.now(),
      },
    },
    dataSyncs: {
      b1: {
        backendId: 'b1',
        status: 'stale',
        ownershipVersion: 0,
        retryCount: 0,
        lastError: null,
        lastSyncAt: null,
        statusEnteredAt: Date.now(),
      },
    },
    activeSession: {
      sessionId: 's1',
      status: 'stale',
      backendId: 'b1',
      ownershipVersion: null,
      retryCount: 0,
      lastError: null,
      hasGapMarker: false,
      lastMessageAt: null,
      statusEnteredAt: Date.now(),
    },
    nextOwnershipVersion: 7,
    backgroundAt: null,
  } as any);
}

function resetOwnershipState(): void {
  useOwnershipStore.setState({
    sessionBackendIds: { s1: 'b1' },
    sessionOwnershipVersions: {},
    projectBackendIds: {},
    taskOwners: {},
  } as any);
}

describe('recoveryTransitions', () => {
  beforeEach(() => {
    resetRecoveryState();
    resetOwnershipState();
  });

  it('marks transport as reconnecting when reconcile detects a stale connection', () => {
    noteTransportStaleConnection();

    const transport = useRecoveryStore.getState().transport;
    expect(transport.status).toBe('reconnecting');
    expect(transport.error).toBe('reconciliation: stale connection');
  });

  it('marks transport as error on transport timeout', () => {
    useRecoveryStore.setState((state) => ({
      ...state,
      transport: {
        ...state.transport,
        status: 'connecting',
      },
    }));

    noteTransportRecoveryTimeout();

    const transport = useRecoveryStore.getState().transport;
    expect(transport.status).toBe('error');
    expect(transport.retryCount).toBe(1);
    expect(transport.error).toContain('Transport connect timeout');
  });

  it('stamps ownership versions and completes backend data recovery on sync success', () => {
    noteDataSyncStarted('b1', 'full');
    noteDataSyncSucceeded('b1', [{ id: 's1' }, { id: 's2' }]);

    const state = useRecoveryStore.getState();
    expect(state.dataSyncs.b1.status).toBe('ready');
    expect(state.dataSyncs.b1.ownershipVersion).toBe(7);
    expect(state.backends.b1.dataReady).toBe(true);
    expect(useOwnershipStore.getState().sessionOwnershipVersions).toEqual({
      s1: 7,
      s2: 7,
    });
  });

  it('moves the active session through opening stream, catch-up, and live transitions', () => {
    useRecoveryStore.setState((state) => ({
      ...state,
      dataSyncs: {
        ...state.dataSyncs,
        b1: {
          ...state.dataSyncs.b1,
          status: 'ready',
          ownershipVersion: 11,
          lastSyncAt: Date.now(),
        },
      },
    }));

    noteSessionStreamOpening('s1', 'b1', 11);

    let activeSession = useRecoveryStore.getState().activeSession;
    expect(activeSession.status).toBe('opening_stream');
    expect(activeSession.ownershipVersion).toBe(11);

    noteSessionCatchUpStarted('s1', 'b1', 11);
    activeSession = useRecoveryStore.getState().activeSession;
    expect(activeSession.status).toBe('catching_up');
    expect(activeSession.backendId).toBe('b1');

    noteSessionRecoverySucceeded('s1', 'b1');
    activeSession = useRecoveryStore.getState().activeSession;
    expect(activeSession.status).toBe('live');
    expect(activeSession.lastError).toBeNull();
    expect(useRecoveryStore.getState().coordinator).toBe('ready');
  });

  it('marks the active session as error when the backend is unavailable', () => {
    noteBackendUnavailable(true);

    const activeSession = useRecoveryStore.getState().activeSession;
    expect(activeSession.status).toBe('error');
    expect(activeSession.lastError).toContain('Backend unavailable after reconnect');
  });

  it('marks the coordinator ready when backend becomes unavailable without a selected session', () => {
    useRecoveryStore.setState((state) => ({
      ...state,
      selectedSessionId: null,
      activeSession: {
        ...state.activeSession,
        sessionId: null,
        status: 'idle',
        backendId: null,
      },
    }));

    noteBackendUnavailable(false);

    expect(useRecoveryStore.getState().coordinator).toBe('ready');
  });
});
