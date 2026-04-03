import { beforeEach, describe, expect, it } from 'vitest';
import { useRecoveryStore, RECOVERY_MAX_RETRIES } from '../recoveryStore';

function resetStore() {
  useRecoveryStore.setState({
    coordinator: 'ready',
    transport: {
      status: 'connected',
      mode: 'direct',
      generation: 0,
      error: null,
      peerSessionId: null,
      retryCount: 0,
      lastMessageAt: null,
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
      retryCount: 0,
      lastError: null,
      hasGapMarker: false,
      lastMessageAt: null,
      statusEnteredAt: Date.now(),
    },
    nextOwnershipVersion: 1,
    backgroundAt: null,
  } as any);
}

describe('recoveryStore', () => {
  beforeEach(resetStore);

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
        retryCount: 0,
        lastMessageAt: null,
        statusEnteredAt: Date.now(),
      },
      activeBackendId: 'b1',
      backends: {
        b1: {
          backendId: 'b1',
          status: 'ready',
          desiredOpen: true,
          channelReady: true,
          catalogReady: true,
          retryCount: 0,
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
          retryCount: 0,
          lastError: null,
          lastSyncAt: Date.now(),
          statusEnteredAt: Date.now(),
        },
      },
    } as any);

    expect(useRecoveryStore.getState().getBackendViewState('b1')).toBe('offline');
  });

  describe('channelReady / catalogReady', () => {
    it('backend stays in opening until both channel and catalog are ready', () => {
      useRecoveryStore.getState().noteBackendDesiredOpen('b1');
      const b1 = useRecoveryStore.getState().backends.b1;
      expect(b1.status).toBe('opening');
      expect(b1.channelReady).toBe(false);
      expect(b1.catalogReady).toBe(false);
    });

    it('noteCatalogSyncSucceeded sets catalogReady and transitions to ready when channelReady is true', () => {
      useRecoveryStore.setState({
        backends: {
          b1: {
            backendId: 'b1', status: 'opening', desiredOpen: true,
            channelReady: true, catalogReady: false, retryCount: 0,
            lastError: null, lastCloseReason: null, statusEnteredAt: Date.now(),
          },
        },
      } as any);

      useRecoveryStore.getState().noteCatalogSyncSucceeded('b1');

      const b1 = useRecoveryStore.getState().backends.b1;
      expect(b1.catalogReady).toBe(true);
      expect(b1.status).toBe('ready');
    });

    it('noteCatalogSyncSucceeded does NOT mark backend ready when channelReady is false', () => {
      useRecoveryStore.setState({
        backends: {
          b1: {
            backendId: 'b1', status: 'opening', desiredOpen: true,
            channelReady: false, catalogReady: false, retryCount: 0,
            lastError: null, lastCloseReason: null, statusEnteredAt: Date.now(),
          },
        },
      } as any);

      useRecoveryStore.getState().noteCatalogSyncSucceeded('b1');

      const b1 = useRecoveryStore.getState().backends.b1;
      expect(b1.catalogReady).toBe(true);
      expect(b1.status).toBe('opening');
    });

    it('applySnapshot sets channelReady when runtimeState is ready', () => {
      useRecoveryStore.getState().applySnapshot({
        snapshotVersion: 1, capturedAt: Date.now(), mode: 'direct',
        connectionState: 'connected', localBackendId: null,
        currentInstanceId: null, currentDeviceId: null,
        backends: [{ backendId: 'b1', runtimeState: 'ready', online: true } as any],
        sessionStreams: {},
      });

      const b1 = useRecoveryStore.getState().backends.b1;
      expect(b1.channelReady).toBe(true);
    });
  });

  describe('startBackendRecovery', () => {
    it('enters recovering when active backend catalog needs sync', () => {
      useRecoveryStore.setState({
        coordinator: 'ready',
        activeBackendId: 'b1',
        selectedSessionId: null,
        backends: {
          b1: { backendId: 'b1', status: 'ready', desiredOpen: true, channelReady: true, catalogReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
        },
        catalogs: {
          b1: { backendId: 'b1', status: 'stale', ownershipVersion: 1, retryCount: 0, lastError: null, lastSyncAt: null, statusEnteredAt: Date.now() },
        },
      } as any);

      useRecoveryStore.getState().startBackendRecovery('b1');

      const state = useRecoveryStore.getState();
      expect(state.coordinator).toBe('recovering');
      expect(state.catalogs.b1.status).toBe('stale');
      expect(state.catalogs.b1.retryCount).toBe(0);
    });

    it('enters recovering when active session needs recovery', () => {
      useRecoveryStore.setState({
        coordinator: 'ready',
        activeBackendId: 'b1',
        selectedSessionId: 's1',
        backends: {
          b1: { backendId: 'b1', status: 'ready', desiredOpen: true, channelReady: true, catalogReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
        },
        catalogs: {
          b1: { backendId: 'b1', status: 'ready', ownershipVersion: 3, retryCount: 0, lastError: null, lastSyncAt: Date.now(), statusEnteredAt: Date.now() },
        },
        activeSession: {
          sessionId: 's1', status: 'stale', backendId: 'b1',
          ownershipVersion: null, retryCount: 0, lastError: null,
          hasGapMarker: false, lastMessageAt: null, statusEnteredAt: Date.now(),
        },
      } as any);

      useRecoveryStore.getState().startBackendRecovery('b1');

      const state = useRecoveryStore.getState();
      expect(state.coordinator).toBe('recovering');
      expect(state.activeSession.status).toBe('stale');
      expect(state.catalogs.b1.status).toBe('stale');
    });

    it('no-ops when already recovering', () => {
      useRecoveryStore.setState({ coordinator: 'recovering' } as any);
      useRecoveryStore.getState().startBackendRecovery('b1');
      expect(useRecoveryStore.getState().coordinator).toBe('recovering');
    });

    it('no-ops when transport is not connected', () => {
      useRecoveryStore.setState({
        coordinator: 'ready',
        transport: { ...useRecoveryStore.getState().transport, status: 'reconnecting' },
        activeBackendId: 'b1',
      } as any);

      useRecoveryStore.getState().startBackendRecovery('b1');
      expect(useRecoveryStore.getState().coordinator).toBe('ready');
    });

    it('no-ops for non-active backend', () => {
      useRecoveryStore.setState({
        coordinator: 'ready',
        activeBackendId: 'b1',
        backends: {
          b2: { backendId: 'b2', status: 'ready', desiredOpen: true, channelReady: true, catalogReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
        },
      } as any);

      useRecoveryStore.getState().startBackendRecovery('b2');
      expect(useRecoveryStore.getState().coordinator).toBe('ready');
    });

    it('no-ops when catalog and session are already healthy', () => {
      useRecoveryStore.setState({
        coordinator: 'ready',
        activeBackendId: 'b1',
        selectedSessionId: 's1',
        backends: {
          b1: { backendId: 'b1', status: 'ready', desiredOpen: true, channelReady: true, catalogReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
        },
        catalogs: {
          b1: { backendId: 'b1', status: 'ready', ownershipVersion: 3, retryCount: 0, lastError: null, lastSyncAt: Date.now(), statusEnteredAt: Date.now() },
        },
        activeSession: {
          sessionId: 's1', status: 'live', backendId: 'b1',
          ownershipVersion: 3, retryCount: 0, lastError: null,
          hasGapMarker: false, lastMessageAt: Date.now(), statusEnteredAt: Date.now(),
        },
      } as any);

      useRecoveryStore.getState().startBackendRecovery('b1');
      expect(useRecoveryStore.getState().coordinator).toBe('ready');
    });

    it('does not touch transport or other backends', () => {
      useRecoveryStore.setState({
        coordinator: 'ready',
        activeBackendId: 'b1',
        selectedSessionId: 's1',
        backends: {
          b1: { backendId: 'b1', status: 'ready', desiredOpen: true, channelReady: true, catalogReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
          b2: { backendId: 'b2', status: 'ready', desiredOpen: true, channelReady: true, catalogReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() },
        },
        catalogs: {
          b1: { backendId: 'b1', status: 'stale', ownershipVersion: 1, retryCount: 0, lastError: null, lastSyncAt: null, statusEnteredAt: Date.now() },
          b2: { backendId: 'b2', status: 'ready', ownershipVersion: 2, retryCount: 0, lastError: null, lastSyncAt: Date.now(), statusEnteredAt: Date.now() },
        },
        activeSession: {
          sessionId: 's1', status: 'stale', backendId: 'b1',
          ownershipVersion: null, retryCount: 0, lastError: null,
          hasGapMarker: false, lastMessageAt: null, statusEnteredAt: Date.now(),
        },
      } as any);

      const transportBefore = useRecoveryStore.getState().transport;
      useRecoveryStore.getState().startBackendRecovery('b1');

      const state = useRecoveryStore.getState();
      expect(state.transport).toBe(transportBefore);
      expect(state.backends.b2.status).toBe('ready');
      expect(state.catalogs.b2.status).toBe('ready');
      expect(state.coordinator).toBe('recovering');
    });
  });

  describe('startRecovery', () => {
    it('resets retry counts and clears channelReady/catalogReady', () => {
      useRecoveryStore.setState({
        coordinator: 'ready',
        backends: {
          b1: {
            backendId: 'b1', status: 'ready', desiredOpen: true,
            channelReady: true, catalogReady: true, retryCount: 2,
            lastError: null, lastCloseReason: null, statusEnteredAt: Date.now(),
          },
        },
        catalogs: {
          b1: {
            backendId: 'b1', status: 'ready', ownershipVersion: 3, retryCount: 1,
            lastError: null, lastSyncAt: Date.now(), statusEnteredAt: Date.now(),
          },
        },
        activeBackendId: 'b1',
      } as any);

      useRecoveryStore.getState().startRecovery('direct');

      const state = useRecoveryStore.getState();
      expect(state.coordinator).toBe('recovering');
      expect(state.transport.retryCount).toBe(0);
      expect(state.backends.b1.retryCount).toBe(0);
      expect(state.backends.b1.channelReady).toBe(false);
      expect(state.backends.b1.catalogReady).toBe(false);
      expect(state.backends.b1.status).toBe('degraded');
      expect(state.catalogs.b1.retryCount).toBe(0);
      expect(state.catalogs.b1.status).toBe('stale');
    });
  });

  describe('timeout actions', () => {
    it('noteTransportTimeout increments retryCount and sets error status', () => {
      useRecoveryStore.setState({ coordinator: 'recovering' } as any);
      useRecoveryStore.getState().noteTransportTimeout();

      const state = useRecoveryStore.getState();
      expect(state.transport.status).toBe('error');
      expect(state.transport.retryCount).toBe(1);
      expect(state.transport.error).toContain('timeout');
    });

    it('noteTransportTimeout sets coordinator to error when retries exhausted', () => {
      useRecoveryStore.setState({
        coordinator: 'recovering',
        transport: {
          ...useRecoveryStore.getState().transport,
          retryCount: RECOVERY_MAX_RETRIES.TRANSPORT - 1,
        },
      } as any);

      useRecoveryStore.getState().noteTransportTimeout();

      expect(useRecoveryStore.getState().coordinator).toBe('error');
    });

    it('noteBackendTimeout marks backend as error', () => {
      useRecoveryStore.setState({
        backends: {
          b1: {
            backendId: 'b1', status: 'opening', desiredOpen: true,
            channelReady: false, catalogReady: false, retryCount: 0,
            lastError: null, lastCloseReason: null, statusEnteredAt: Date.now(),
          },
        },
      } as any);

      useRecoveryStore.getState().noteBackendTimeout('b1');

      const b1 = useRecoveryStore.getState().backends.b1;
      expect(b1.status).toBe('error');
      expect(b1.retryCount).toBe(1);
      expect(b1.lastError).toContain('timeout');
    });

    it('noteCatalogSyncTimeout transitions delta sync to stale', () => {
      useRecoveryStore.setState({
        catalogs: {
          b1: {
            backendId: 'b1', status: 'syncing_delta', ownershipVersion: 1,
            retryCount: 0, lastError: null, lastSyncAt: null, statusEnteredAt: Date.now(),
          },
        },
      } as any);

      useRecoveryStore.getState().noteCatalogSyncTimeout('b1');

      expect(useRecoveryStore.getState().catalogs.b1.status).toBe('stale');
    });

    it('noteActiveSessionTimeout gracefully degrades catch-up to live with gap marker', () => {
      useRecoveryStore.setState({
        activeSession: {
          sessionId: 's1', status: 'catching_up', backendId: 'b1',
          ownershipVersion: 1, retryCount: 0, lastError: null,
          hasGapMarker: false, lastMessageAt: null, statusEnteredAt: Date.now(),
        },
      } as any);

      useRecoveryStore.getState().noteActiveSessionTimeout();

      const session = useRecoveryStore.getState().activeSession;
      expect(session.status).toBe('live');
      expect(session.hasGapMarker).toBe(true);
    });

    it('noteActiveSessionTimeout marks error for non-catchup phases', () => {
      useRecoveryStore.setState({
        coordinator: 'recovering',
        activeSession: {
          sessionId: 's1', status: 'opening_stream', backendId: 'b1',
          ownershipVersion: 1, retryCount: RECOVERY_MAX_RETRIES.SESSION_STREAM - 1,
          lastError: null, hasGapMarker: false, lastMessageAt: null,
          statusEnteredAt: Date.now(),
        },
      } as any);

      useRecoveryStore.getState().noteActiveSessionTimeout();

      expect(useRecoveryStore.getState().activeSession.status).toBe('error');
      expect(useRecoveryStore.getState().coordinator).toBe('error');
    });
  });

  describe('message tracking', () => {
    it('noteTransportMessage updates lastMessageAt', () => {
      expect(useRecoveryStore.getState().transport.lastMessageAt).toBeNull();
      useRecoveryStore.getState().noteTransportMessage();
      expect(useRecoveryStore.getState().transport.lastMessageAt).toBeGreaterThan(0);
    });

    it('noteActiveSessionMessage updates activeSession.lastMessageAt', () => {
      useRecoveryStore.setState({
        activeSession: {
          sessionId: 's1', status: 'live', backendId: 'b1',
          ownershipVersion: 1, retryCount: 0, lastError: null,
          hasGapMarker: false, lastMessageAt: null, statusEnteredAt: Date.now(),
        },
      } as any);

      useRecoveryStore.getState().noteActiveSessionMessage();
      expect(useRecoveryStore.getState().activeSession.lastMessageAt).toBeGreaterThan(0);
    });
  });

  describe('getBackendViewState', () => {
    it('returns offline when transport is idle', () => {
      useRecoveryStore.setState({
        transport: { ...useRecoveryStore.getState().transport, status: 'idle' },
        backends: { b1: { backendId: 'b1', status: 'ready', desiredOpen: true, channelReady: true, catalogReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() } },
      } as any);
      expect(useRecoveryStore.getState().getBackendViewState('b1')).toBe('offline');
    });

    it('returns transport_reconnecting when transport is connecting', () => {
      useRecoveryStore.setState({
        transport: { ...useRecoveryStore.getState().transport, status: 'connecting' },
        backends: { b1: { backendId: 'b1', status: 'ready', desiredOpen: true, channelReady: true, catalogReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() } },
      } as any);
      expect(useRecoveryStore.getState().getBackendViewState('b1')).toBe('transport_reconnecting');
    });

    it('returns transport_reconnecting when transport is reconnecting', () => {
      useRecoveryStore.setState({
        transport: { ...useRecoveryStore.getState().transport, status: 'reconnecting' },
      } as any);
      expect(useRecoveryStore.getState().getBackendViewState('b1')).toBe('transport_reconnecting');
    });

    it('returns error when transport has error', () => {
      useRecoveryStore.setState({
        transport: { ...useRecoveryStore.getState().transport, status: 'error' },
        backends: { b1: { backendId: 'b1', status: 'ready', desiredOpen: true, channelReady: true, catalogReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() } },
      } as any);
      expect(useRecoveryStore.getState().getBackendViewState('b1')).toBe('error');
    });

    it('returns error when backend has error', () => {
      useRecoveryStore.setState({
        backends: { b1: { backendId: 'b1', status: 'error', desiredOpen: true, channelReady: false, catalogReady: false, retryCount: 3, lastError: 'timeout', lastCloseReason: null, statusEnteredAt: Date.now() } },
      } as any);
      expect(useRecoveryStore.getState().getBackendViewState('b1')).toBe('error');
    });

    it('returns error when catalog has error', () => {
      useRecoveryStore.setState({
        activeBackendId: 'b1',
        backends: { b1: { backendId: 'b1', status: 'ready', desiredOpen: true, channelReady: true, catalogReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() } },
        catalogs: { b1: { backendId: 'b1', status: 'error', ownershipVersion: 1, retryCount: 3, lastError: 'sync fail', lastSyncAt: null, statusEnteredAt: Date.now() } },
      } as any);
      expect(useRecoveryStore.getState().getBackendViewState('b1')).toBe('error');
    });

    it('returns offline when backend is absent', () => {
      useRecoveryStore.setState({
        backends: { b1: { backendId: 'b1', status: 'absent', desiredOpen: false, channelReady: false, catalogReady: false, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() } },
      } as any);
      expect(useRecoveryStore.getState().getBackendViewState('b1')).toBe('offline');
    });

    it('returns offline when backend is unknown', () => {
      expect(useRecoveryStore.getState().getBackendViewState('unknown')).toBe('offline');
    });

    it('returns backend_visible for visible backend', () => {
      useRecoveryStore.setState({
        backends: { b1: { backendId: 'b1', status: 'visible', desiredOpen: false, channelReady: false, catalogReady: false, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() } },
      } as any);
      expect(useRecoveryStore.getState().getBackendViewState('b1')).toBe('backend_visible');
    });

    it('returns backend_opening for opening backend', () => {
      useRecoveryStore.setState({
        backends: { b1: { backendId: 'b1', status: 'opening', desiredOpen: true, channelReady: false, catalogReady: false, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() } },
      } as any);
      expect(useRecoveryStore.getState().getBackendViewState('b1')).toBe('backend_opening');
    });

    it('returns catalog_syncing when backend is ready but catalog is stale', () => {
      useRecoveryStore.setState({
        backends: { b1: { backendId: 'b1', status: 'ready', desiredOpen: true, channelReady: true, catalogReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() } },
        catalogs: { b1: { backendId: 'b1', status: 'stale', ownershipVersion: 1, retryCount: 0, lastError: null, lastSyncAt: null, statusEnteredAt: Date.now() } },
      } as any);
      expect(useRecoveryStore.getState().getBackendViewState('b1')).toBe('catalog_syncing');
    });

    it('returns catalog_syncing when catalog is syncing_full', () => {
      useRecoveryStore.setState({
        backends: { b1: { backendId: 'b1', status: 'ready', desiredOpen: true, channelReady: true, catalogReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() } },
        catalogs: { b1: { backendId: 'b1', status: 'syncing_full', ownershipVersion: 1, retryCount: 0, lastError: null, lastSyncAt: null, statusEnteredAt: Date.now() } },
      } as any);
      expect(useRecoveryStore.getState().getBackendViewState('b1')).toBe('catalog_syncing');
    });

    it('returns catalog_syncing when no catalog exists for backend', () => {
      useRecoveryStore.setState({
        backends: { b1: { backendId: 'b1', status: 'ready', desiredOpen: true, channelReady: true, catalogReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() } },
        catalogs: {},
      } as any);
      expect(useRecoveryStore.getState().getBackendViewState('b1')).toBe('catalog_syncing');
    });

    it('returns session_syncing when active session is in recovery phase', () => {
      useRecoveryStore.setState({
        activeBackendId: 'b1',
        selectedSessionId: 's1',
        backends: { b1: { backendId: 'b1', status: 'ready', desiredOpen: true, channelReady: true, catalogReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() } },
        catalogs: { b1: { backendId: 'b1', status: 'ready', ownershipVersion: 1, retryCount: 0, lastError: null, lastSyncAt: Date.now(), statusEnteredAt: Date.now() } },
        activeSession: { sessionId: 's1', status: 'catching_up', backendId: 'b1', ownershipVersion: 1, retryCount: 0, lastError: null, hasGapMarker: false, lastMessageAt: null, statusEnteredAt: Date.now() },
      } as any);
      expect(useRecoveryStore.getState().getBackendViewState('b1')).toBe('session_syncing');
    });

    it('returns ready when everything is healthy', () => {
      useRecoveryStore.setState({
        activeBackendId: 'b1',
        selectedSessionId: 's1',
        backends: { b1: { backendId: 'b1', status: 'ready', desiredOpen: true, channelReady: true, catalogReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() } },
        catalogs: { b1: { backendId: 'b1', status: 'ready', ownershipVersion: 1, retryCount: 0, lastError: null, lastSyncAt: Date.now(), statusEnteredAt: Date.now() } },
        activeSession: { sessionId: 's1', status: 'live', backendId: 'b1', ownershipVersion: 1, retryCount: 0, lastError: null, hasGapMarker: false, lastMessageAt: Date.now(), statusEnteredAt: Date.now() },
      } as any);
      expect(useRecoveryStore.getState().getBackendViewState('b1')).toBe('ready');
    });

    it('returns error when active session has error on same backend', () => {
      useRecoveryStore.setState({
        activeBackendId: 'b1',
        selectedSessionId: 's1',
        backends: { b1: { backendId: 'b1', status: 'ready', desiredOpen: true, channelReady: true, catalogReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() } },
        catalogs: { b1: { backendId: 'b1', status: 'ready', ownershipVersion: 1, retryCount: 0, lastError: null, lastSyncAt: Date.now(), statusEnteredAt: Date.now() } },
        activeSession: { sessionId: 's1', status: 'error', backendId: 'b1', ownershipVersion: 1, retryCount: 3, lastError: 'stream failed', hasGapMarker: false, lastMessageAt: null, statusEnteredAt: Date.now() },
      } as any);
      expect(useRecoveryStore.getState().getBackendViewState('b1')).toBe('error');
    });

    it('returns null-safe for null backendId', () => {
      expect(useRecoveryStore.getState().getBackendViewState(null)).toBe('offline');
    });
  });

  describe('setSelection', () => {
    it('resets active session when selectedSessionId is cleared', () => {
      useRecoveryStore.getState().setSelection('b1', 's1');
      expect(useRecoveryStore.getState().activeSession.sessionId).toBe('s1');

      useRecoveryStore.getState().setSelection('b1', null);
      expect(useRecoveryStore.getState().activeSession.sessionId).toBeNull();
      expect(useRecoveryStore.getState().activeSession.status).toBe('idle');
    });

    it('sets stale status when switching sessions during recovery', () => {
      useRecoveryStore.setState({ coordinator: 'recovering' } as any);
      useRecoveryStore.getState().setSelection('b1', 's2');
      expect(useRecoveryStore.getState().activeSession.status).toBe('stale');
    });

    it('no-ops when selection is unchanged', () => {
      useRecoveryStore.getState().setSelection('b1', 's1');
      const before = useRecoveryStore.getState().activeSession;
      useRecoveryStore.getState().setSelection('b1', 's1');
      expect(useRecoveryStore.getState().activeSession).toBe(before);
    });
  });

  describe('noteBackground', () => {
    it('sets coordinator to background with timestamp', () => {
      useRecoveryStore.getState().noteBackground();
      const state = useRecoveryStore.getState();
      expect(state.coordinator).toBe('background');
      expect(state.backgroundAt).toBeGreaterThan(0);
    });
  });

  describe('exported helpers', () => {
    it('isBackendReady returns true for ready backend', async () => {
      const { isBackendReady } = await import('../recoveryStore.ts');
      useRecoveryStore.setState({
        backends: { b1: { backendId: 'b1', status: 'ready', desiredOpen: true, channelReady: true, catalogReady: true, retryCount: 0, lastError: null, lastCloseReason: null, statusEnteredAt: Date.now() } },
      } as any);
      expect(isBackendReady('b1')).toBe(true);
      expect(isBackendReady('unknown')).toBe(false);
      expect(isBackendReady(null)).toBe(false);
    });

    it('isTransportReady returns true when connected', async () => {
      const { isTransportReady } = await import('../recoveryStore.ts');
      expect(isTransportReady()).toBe(true);

      useRecoveryStore.setState({
        transport: { ...useRecoveryStore.getState().transport, status: 'idle' },
      } as any);
      expect(isTransportReady()).toBe(false);
    });
  });

  describe('retry logic', () => {
    it('noteCatalogSyncFailed increments retryCount and stays in syncing on first failure', () => {
      useRecoveryStore.setState({
        catalogs: {
          b1: {
            backendId: 'b1', status: 'syncing_full', ownershipVersion: 1,
            retryCount: 0, lastError: null, lastSyncAt: null, statusEnteredAt: Date.now(),
          },
        },
      } as any);

      useRecoveryStore.getState().noteCatalogSyncFailed('b1', 'network error');

      const catalog = useRecoveryStore.getState().catalogs.b1;
      expect(catalog.retryCount).toBe(1);
      expect(catalog.status).toBe('syncing_full');
      expect(catalog.lastError).toBe('network error');
    });

    it('noteCatalogSyncFailed transitions to error when retries exhausted', () => {
      useRecoveryStore.setState({
        coordinator: 'recovering',
        catalogs: {
          b1: {
            backendId: 'b1', status: 'syncing_full', ownershipVersion: 1,
            retryCount: RECOVERY_MAX_RETRIES.CATALOG_FULL - 1,
            lastError: null, lastSyncAt: null, statusEnteredAt: Date.now(),
          },
        },
      } as any);

      useRecoveryStore.getState().noteCatalogSyncFailed('b1', 'final failure');

      expect(useRecoveryStore.getState().catalogs.b1.status).toBe('error');
      expect(useRecoveryStore.getState().coordinator).toBe('error');
    });
  });
});
