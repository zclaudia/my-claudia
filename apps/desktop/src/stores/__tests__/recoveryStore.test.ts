import { beforeEach, describe, expect, it } from 'vitest';
import { useRecoveryStore } from '../recoveryStore';

describe('recoveryStore', () => {
  beforeEach(() => {
    useRecoveryStore.setState({
      coordinator: 'ready',
      transport: {
        status: 'connected',
        mode: 'direct',
        generation: 0,
        error: null,
        peerSessionId: null,
        statusEnteredAt: Date.now(),
      },
      activeBackendId: null,
      selectedSessionId: null,
      backends: {},
      catalogs: {},
      activeSession: {
        sessionId: null,
        status: 'idle',
        backendId: null,
        ownershipVersion: null,
        lastError: null,
        hasGapMarker: false,
        statusEnteredAt: Date.now(),
      },
      nextOwnershipVersion: 1,
      backgroundAt: null,
    } as any);
  });

  it('maps degraded backends to backend_recovering', () => {
    useRecoveryStore.setState({
      activeBackendId: 'b1',
      backends: {
        b1: {
          backendId: 'b1',
          status: 'degraded',
          desiredOpen: true,
          lastError: null,
          lastCloseReason: 'transport_reconnecting',
          statusEnteredAt: Date.now(),
        },
      },
    } as any);

    expect(useRecoveryStore.getState().getBackendViewState('b1')).toBe('backend_recovering');
  });

  it('only returns verified backend for active session after owner verification', () => {
    useRecoveryStore.getState().setSelection('b1', 's1');
    expect(useRecoveryStore.getState().getVerifiedSessionBackendId('s1')).toBeNull();

    useRecoveryStore.getState().noteActiveSessionOwnerVerified('s1', 'b1', 3);
    expect(useRecoveryStore.getState().getVerifiedSessionBackendId('s1')).toBe('b1');
  });

  it('completes recovery when transport, backend, catalog, and active session are ready', () => {
    useRecoveryStore.setState({
      coordinator: 'recovering',
      transport: {
        status: 'connected',
        mode: 'direct',
        generation: 2,
        error: null,
        peerSessionId: null,
        statusEnteredAt: Date.now(),
      },
      activeBackendId: 'b1',
      selectedSessionId: 's1',
      backends: {
        b1: {
          backendId: 'b1',
          status: 'ready',
          desiredOpen: true,
          lastError: null,
          lastCloseReason: null,
          statusEnteredAt: Date.now(),
        },
      },
      catalogs: {
        b1: {
          backendId: 'b1',
          status: 'ready',
          ownershipVersion: 4,
          lastError: null,
          lastSyncAt: Date.now(),
          statusEnteredAt: Date.now(),
        },
      },
      activeSession: {
        sessionId: 's1',
        status: 'live',
        backendId: 'b1',
        ownershipVersion: 4,
        lastError: null,
        hasGapMarker: false,
        statusEnteredAt: Date.now(),
      },
    } as any);

    useRecoveryStore.getState().completeRecoveryIfPossible();
    expect(useRecoveryStore.getState().coordinator).toBe('ready');
  });

  it('treats stopped transport as offline even if stale backend state remains ready', () => {
    useRecoveryStore.setState({
      transport: {
        status: 'stopped',
        mode: 'direct',
        generation: 2,
        error: null,
        peerSessionId: null,
        statusEnteredAt: Date.now(),
      },
      activeBackendId: 'b1',
      backends: {
        b1: {
          backendId: 'b1',
          status: 'ready',
          desiredOpen: true,
          lastError: null,
          lastCloseReason: null,
          statusEnteredAt: Date.now(),
        },
      },
      catalogs: {
        b1: {
          backendId: 'b1',
          status: 'ready',
          ownershipVersion: 1,
          lastError: null,
          lastSyncAt: Date.now(),
          statusEnteredAt: Date.now(),
        },
      },
    } as any);

    expect(useRecoveryStore.getState().getBackendViewState('b1')).toBe('offline');
  });
});
