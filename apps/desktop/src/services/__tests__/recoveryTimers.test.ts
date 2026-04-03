import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecoveryTimerManager } from '../recoveryTimers';
import { useRecoveryStore } from '../../stores/recoveryStore';

describe('RecoveryTimerManager', () => {
  let mgr: RecoveryTimerManager;

  beforeEach(() => {
    vi.useFakeTimers();
    mgr = new RecoveryTimerManager();
    useRecoveryStore.setState({
      coordinator: 'recovering',
      transport: {
        status: 'connected', mode: 'direct', generation: 1,
        error: null, peerSessionId: null, retryCount: 0,
        lastMessageAt: Date.now(), statusEnteredAt: Date.now(),
      },
      activeBackendId: 'b1',
      selectedSessionId: null,
      backends: {},
      catalogs: {},
      activeSession: {
        sessionId: null, status: 'idle', backendId: null,
        ownershipVersion: null, retryCount: 0, lastError: null,
        hasGapMarker: false, lastMessageAt: null, statusEnteredAt: Date.now(),
      },
      nextOwnershipVersion: 1,
      backgroundAt: null,
    } as any);
  });

  afterEach(() => {
    mgr.dispose();
    vi.useRealTimers();
  });

  it('fires timeout callback after specified duration', () => {
    const callback = vi.fn();
    mgr.startTimeout('test', 5000, callback);

    vi.advanceTimersByTime(4999);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledOnce();
  });

  it('cancels timeout before it fires', () => {
    const callback = vi.fn();
    mgr.startTimeout('test', 5000, callback);
    mgr.cancelTimeout('test');

    vi.advanceTimersByTime(10000);
    expect(callback).not.toHaveBeenCalled();
  });

  it('replaces existing timeout with same key', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    mgr.startTimeout('test', 5000, callback1);
    mgr.startTimeout('test', 5000, callback2);

    vi.advanceTimersByTime(5000);
    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).toHaveBeenCalledOnce();
  });

  it('cancelAllWithPrefix removes matching timers', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const cb3 = vi.fn();

    mgr.startTimeout('recovery:backend:b1', 5000, cb1);
    mgr.startTimeout('recovery:backend:b2', 5000, cb2);
    mgr.startTimeout('other:timer', 5000, cb3);

    mgr.cancelAllWithPrefix('recovery:backend:');

    vi.advanceTimersByTime(5000);
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).not.toHaveBeenCalled();
    expect(cb3).toHaveBeenCalledOnce();
  });

  it('hasTimeout correctly reports presence', () => {
    expect(mgr.hasTimeout('test')).toBe(false);
    mgr.startTimeout('test', 5000, vi.fn());
    expect(mgr.hasTimeout('test')).toBe(true);
    mgr.cancelTimeout('test');
    expect(mgr.hasTimeout('test')).toBe(false);
  });

  it('dispose cancels all timers and prevents new ones', () => {
    const cb = vi.fn();
    mgr.startTimeout('test', 5000, cb);
    mgr.dispose();

    vi.advanceTimersByTime(10000);
    expect(cb).not.toHaveBeenCalled();

    const cb2 = vi.fn();
    mgr.startTimeout('new', 1000, cb2);
    vi.advanceTimersByTime(2000);
    expect(cb2).not.toHaveBeenCalled();
  });

  describe('reconciliation', () => {
    it('runs reconciliation tick at 30s intervals', () => {
      const openBackend = vi.fn();
      const syncCatalog = vi.fn();
      mgr.setReconciliationContext({
        getFacadeSnapshot: () => ({
          snapshotVersion: 1, capturedAt: Date.now(), mode: 'direct' as const,
          connectionState: 'connected' as const, localBackendId: null,
          currentInstanceId: null, currentDeviceId: null,
          backends: [], sessionStreams: {},
        }),
        openBackend,
        syncCatalog,
      });

      mgr.startReconciliation();

      vi.advanceTimersByTime(29999);
      // No tick yet

      vi.advanceTimersByTime(1);
      // First tick at 30s — but no backends to reconcile, so no calls
      expect(openBackend).not.toHaveBeenCalled();
    });

    it('stops reconciliation', () => {
      mgr.startReconciliation();
      mgr.stopReconciliation();

      vi.advanceTimersByTime(60000);
      // No errors since it was stopped
    });

    it('reconciles stale transport by marking as reconnecting (direct mode)', () => {
      const staleTime = Date.now() - 60_000; // 60s ago, well past 2×25s threshold
      useRecoveryStore.setState({
        transport: {
          ...useRecoveryStore.getState().transport,
          status: 'connected',
          mode: 'direct',
          lastMessageAt: staleTime,
        },
      } as any);

      mgr.setReconciliationContext({
        getFacadeSnapshot: () => ({
          snapshotVersion: 1, capturedAt: Date.now(), mode: 'direct' as const,
          connectionState: 'connected' as const, localBackendId: null,
          currentInstanceId: null, currentDeviceId: null,
          backends: [], sessionStreams: {},
        }),
        openBackend: vi.fn(),
        syncCatalog: vi.fn(),
      });

      mgr.runReconciliationTick();

      expect(useRecoveryStore.getState().transport.status).toBe('reconnecting');
    });

    it('skips stale transport detection in embedded mode', () => {
      const staleTime = Date.now() - 60_000;
      useRecoveryStore.setState({
        transport: {
          ...useRecoveryStore.getState().transport,
          status: 'connected',
          mode: 'embedded',
          lastMessageAt: staleTime,
        },
      } as any);

      mgr.setReconciliationContext({
        getFacadeSnapshot: () => ({
          snapshotVersion: 1, capturedAt: Date.now(), mode: 'embedded' as const,
          connectionState: 'connected' as const, localBackendId: null,
          currentInstanceId: null, currentDeviceId: null,
          backends: [], sessionStreams: {},
        }),
        openBackend: vi.fn(),
        syncCatalog: vi.fn(),
      });

      mgr.runReconciliationTick();

      expect(useRecoveryStore.getState().transport.status).toBe('connected');
    });

    it('does not reconcile transport when messages are recent', () => {
      useRecoveryStore.setState({
        transport: {
          ...useRecoveryStore.getState().transport,
          status: 'connected',
          lastMessageAt: Date.now() - 5000, // 5s ago, well within threshold
        },
      } as any);

      mgr.setReconciliationContext({
        getFacadeSnapshot: () => ({
          snapshotVersion: 1, capturedAt: Date.now(), mode: 'direct' as const,
          connectionState: 'connected' as const, localBackendId: null,
          currentInstanceId: null, currentDeviceId: null,
          backends: [], sessionStreams: {},
        }),
        openBackend: vi.fn(),
        syncCatalog: vi.fn(),
      });

      mgr.runReconciliationTick();

      expect(useRecoveryStore.getState().transport.status).toBe('connected');
    });

    it('reconciles stuck connecting transport by marking timeout', () => {
      const stuckTime = Date.now() - 35_000; // 35s ago, past TRANSPORT_CONNECT timeout
      useRecoveryStore.setState({
        transport: {
          ...useRecoveryStore.getState().transport,
          status: 'connecting',
          statusEnteredAt: stuckTime,
        },
      } as any);

      mgr.setReconciliationContext({
        getFacadeSnapshot: () => ({
          snapshotVersion: 1, capturedAt: Date.now(), mode: 'direct' as const,
          connectionState: 'connecting' as const, localBackendId: null,
          currentInstanceId: null, currentDeviceId: null,
          backends: [], sessionStreams: {},
        }),
        openBackend: vi.fn(),
        syncCatalog: vi.fn(),
      });

      mgr.runReconciliationTick();

      expect(useRecoveryStore.getState().transport.status).toBe('error');
    });

    it('reconciles backend stuck in opening by triggering timeout', () => {
      const stuckTime = Date.now() - 25_000; // 25s ago
      useRecoveryStore.setState({
        backends: {
          b1: {
            backendId: 'b1', status: 'opening', desiredOpen: true,
            channelReady: false, catalogReady: false, retryCount: 0,
            lastError: null, lastCloseReason: null, statusEnteredAt: stuckTime,
          },
        },
      } as any);

      mgr.setReconciliationContext({
        getFacadeSnapshot: () => ({
          snapshotVersion: 1, capturedAt: Date.now(), mode: 'direct' as const,
          connectionState: 'connected' as const, localBackendId: null,
          currentInstanceId: null, currentDeviceId: null,
          backends: [{ backendId: 'b1', runtimeState: 'opening', online: true } as any],
          sessionStreams: {},
        }),
        openBackend: vi.fn(),
        syncCatalog: vi.fn(),
      });

      mgr.runReconciliationTick();

      expect(useRecoveryStore.getState().backends.b1.status).toBe('error');
    });

    it('reconciles backend marked ready but snapshot shows non-ready', () => {
      useRecoveryStore.setState({
        backends: {
          b1: {
            backendId: 'b1', status: 'ready', desiredOpen: true,
            channelReady: true, catalogReady: true, retryCount: 0,
            lastError: null, lastCloseReason: null, statusEnteredAt: Date.now(),
          },
        },
      } as any);

      mgr.setReconciliationContext({
        getFacadeSnapshot: () => ({
          snapshotVersion: 1, capturedAt: Date.now(), mode: 'direct' as const,
          connectionState: 'connected' as const, localBackendId: null,
          currentInstanceId: null, currentDeviceId: null,
          backends: [{ backendId: 'b1', runtimeState: 'offline', online: false } as any],
          sessionStreams: {},
        }),
        openBackend: vi.fn(),
        syncCatalog: vi.fn(),
      });

      mgr.runReconciliationTick();

      // applySnapshot should correct the backend state
      const b1 = useRecoveryStore.getState().backends.b1;
      expect(b1.status).not.toBe('ready');
    });

    it('reconciles degraded backend by re-triggering open', () => {
      const stuckTime = Date.now() - 25_000;
      const openBackend = vi.fn();
      useRecoveryStore.setState({
        backends: {
          b1: {
            backendId: 'b1', status: 'degraded', desiredOpen: true,
            channelReady: false, catalogReady: false, retryCount: 0,
            lastError: null, lastCloseReason: 'transport_reconnecting',
            statusEnteredAt: stuckTime,
          },
        },
      } as any);

      mgr.setReconciliationContext({
        getFacadeSnapshot: () => ({
          snapshotVersion: 1, capturedAt: Date.now(), mode: 'direct' as const,
          connectionState: 'connected' as const, localBackendId: null,
          currentInstanceId: null, currentDeviceId: null,
          backends: [{ backendId: 'b1', runtimeState: 'visible', online: true } as any],
          sessionStreams: {},
        }),
        openBackend,
        syncCatalog: vi.fn(),
      });

      mgr.runReconciliationTick();

      expect(openBackend).toHaveBeenCalledWith('b1');
    });

    it('reconciles stuck delta catalog sync by falling back to stale', () => {
      const stuckTime = Date.now() - 15_000;
      useRecoveryStore.setState({
        catalogs: {
          b1: {
            backendId: 'b1', status: 'syncing_delta', ownershipVersion: 1,
            retryCount: 0, lastError: null, lastSyncAt: null,
            statusEnteredAt: stuckTime,
          },
        },
      } as any);

      mgr.setReconciliationContext({
        getFacadeSnapshot: () => ({
          snapshotVersion: 1, capturedAt: Date.now(), mode: 'direct' as const,
          connectionState: 'connected' as const, localBackendId: null,
          currentInstanceId: null, currentDeviceId: null,
          backends: [], sessionStreams: {},
        }),
        openBackend: vi.fn(),
        syncCatalog: vi.fn(),
      });

      mgr.runReconciliationTick();

      expect(useRecoveryStore.getState().catalogs.b1.status).toBe('stale');
    });

    it('reconciles stuck full catalog sync by incrementing retryCount', () => {
      const stuckTime = Date.now() - 15_000;
      useRecoveryStore.setState({
        catalogs: {
          b1: {
            backendId: 'b1', status: 'syncing_full', ownershipVersion: 1,
            retryCount: 0, lastError: null, lastSyncAt: null,
            statusEnteredAt: stuckTime,
          },
        },
      } as any);

      mgr.setReconciliationContext({
        getFacadeSnapshot: () => ({
          snapshotVersion: 1, capturedAt: Date.now(), mode: 'direct' as const,
          connectionState: 'connected' as const, localBackendId: null,
          currentInstanceId: null, currentDeviceId: null,
          backends: [], sessionStreams: {},
        }),
        openBackend: vi.fn(),
        syncCatalog: vi.fn(),
      });

      mgr.runReconciliationTick();

      const catalog = useRecoveryStore.getState().catalogs.b1;
      expect(catalog.retryCount).toBe(1);
      expect(catalog.lastError).toContain('timeout');
    });

    it('reconciles stale catalog with channel ready by requesting full sync', () => {
      const syncCatalog = vi.fn();
      useRecoveryStore.setState({
        backends: {
          b1: {
            backendId: 'b1', status: 'ready', desiredOpen: true,
            channelReady: true, catalogReady: true, retryCount: 0,
            lastError: null, lastCloseReason: null, statusEnteredAt: Date.now(),
          },
        },
        catalogs: {
          b1: {
            backendId: 'b1', status: 'stale', ownershipVersion: 1,
            retryCount: 0, lastError: null, lastSyncAt: null,
            statusEnteredAt: Date.now(),
          },
        },
      } as any);

      mgr.setReconciliationContext({
        getFacadeSnapshot: () => ({
          snapshotVersion: 1, capturedAt: Date.now(), mode: 'direct' as const,
          connectionState: 'connected' as const, localBackendId: null,
          currentInstanceId: null, currentDeviceId: null,
          backends: [{ backendId: 'b1', runtimeState: 'ready', online: true } as any],
          sessionStreams: {},
        }),
        openBackend: vi.fn(),
        syncCatalog,
      });

      mgr.runReconciliationTick();

      expect(syncCatalog).toHaveBeenCalledWith('b1', 'full');
    });

    it('reconciles live session when stream is closed in snapshot', () => {
      useRecoveryStore.setState({
        activeBackendId: 'b1',
        selectedSessionId: 's1',
        activeSession: {
          sessionId: 's1', status: 'live', backendId: 'b1',
          ownershipVersion: 1, retryCount: 0, lastError: null,
          hasGapMarker: false, lastMessageAt: Date.now(),
          statusEnteredAt: Date.now(),
        },
      } as any);

      mgr.setReconciliationContext({
        getFacadeSnapshot: () => ({
          snapshotVersion: 1, capturedAt: Date.now(), mode: 'direct' as const,
          connectionState: 'connected' as const, localBackendId: null,
          currentInstanceId: null, currentDeviceId: null,
          backends: [],
          sessionStreams: { 'b1:s1': { state: 'closed' } },
        }),
        openBackend: vi.fn(),
        syncCatalog: vi.fn(),
      });

      mgr.runReconciliationTick();

      expect(useRecoveryStore.getState().activeSession.status).toBe('stale');
    });

    it('reconciles stuck opening_stream session by triggering timeout', () => {
      const stuckTime = Date.now() - 25_000;
      useRecoveryStore.setState({
        activeBackendId: 'b1',
        selectedSessionId: 's1',
        activeSession: {
          sessionId: 's1', status: 'opening_stream', backendId: 'b1',
          ownershipVersion: 1, retryCount: 0, lastError: null,
          hasGapMarker: false, lastMessageAt: null,
          statusEnteredAt: stuckTime,
        },
      } as any);

      mgr.setReconciliationContext({
        getFacadeSnapshot: () => ({
          snapshotVersion: 1, capturedAt: Date.now(), mode: 'direct' as const,
          connectionState: 'connected' as const, localBackendId: null,
          currentInstanceId: null, currentDeviceId: null,
          backends: [], sessionStreams: {},
        }),
        openBackend: vi.fn(),
        syncCatalog: vi.fn(),
      });

      mgr.runReconciliationTick();

      // opening_stream timeout should trigger noteActiveSessionTimeout
      const session = useRecoveryStore.getState().activeSession;
      expect(session.status).toBe('error');
    });

    it('reconciles stale session when owner backend and catalog are ready', () => {
      const stuckTime = Date.now() - 25_000;
      useRecoveryStore.setState({
        activeBackendId: 'b1',
        selectedSessionId: 's1',
        backends: {
          b1: {
            backendId: 'b1', status: 'ready', desiredOpen: true,
            channelReady: true, catalogReady: true, retryCount: 0,
            lastError: null, lastCloseReason: null, statusEnteredAt: Date.now(),
          },
        },
        catalogs: {
          b1: {
            backendId: 'b1', status: 'ready', ownershipVersion: 1,
            retryCount: 0, lastError: null, lastSyncAt: Date.now(),
            statusEnteredAt: Date.now(),
          },
        },
        activeSession: {
          sessionId: 's1', status: 'stale', backendId: 'b1',
          ownershipVersion: null, retryCount: 0, lastError: null,
          hasGapMarker: false, lastMessageAt: null,
          statusEnteredAt: stuckTime,
        },
      } as any);

      mgr.setReconciliationContext({
        getFacadeSnapshot: () => ({
          snapshotVersion: 1, capturedAt: Date.now(), mode: 'direct' as const,
          connectionState: 'connected' as const, localBackendId: null,
          currentInstanceId: null, currentDeviceId: null,
          backends: [], sessionStreams: {},
        }),
        openBackend: vi.fn(),
        syncCatalog: vi.fn(),
      });

      mgr.runReconciliationTick();

      expect(useRecoveryStore.getState().activeSession.status).toBe('resolving_owner');
    });

    it('skips reconciliation when coordinator is background', () => {
      useRecoveryStore.setState({ coordinator: 'background' } as any);

      const syncCatalog = vi.fn();
      mgr.setReconciliationContext({
        getFacadeSnapshot: () => ({
          snapshotVersion: 1, capturedAt: Date.now(), mode: 'direct' as const,
          connectionState: 'connected' as const, localBackendId: null,
          currentInstanceId: null, currentDeviceId: null,
          backends: [], sessionStreams: {},
        }),
        openBackend: vi.fn(),
        syncCatalog,
      });

      mgr.runReconciliationTick();

      expect(syncCatalog).not.toHaveBeenCalled();
    });

    it('skips reconciliation when coordinator is error', () => {
      useRecoveryStore.setState({ coordinator: 'error' } as any);

      const syncCatalog = vi.fn();
      mgr.setReconciliationContext({
        getFacadeSnapshot: () => ({
          snapshotVersion: 1, capturedAt: Date.now(), mode: 'direct' as const,
          connectionState: 'connected' as const, localBackendId: null,
          currentInstanceId: null, currentDeviceId: null,
          backends: [], sessionStreams: {},
        }),
        openBackend: vi.fn(),
        syncCatalog,
      });

      mgr.runReconciliationTick();

      expect(syncCatalog).not.toHaveBeenCalled();
    });

    it('reconciles stale catalog by requesting delta sync', () => {
      const syncCatalog = vi.fn();
      mgr.setReconciliationContext({
        getFacadeSnapshot: () => ({
          snapshotVersion: 1, capturedAt: Date.now(), mode: 'direct' as const,
          connectionState: 'connected' as const, localBackendId: null,
          currentInstanceId: null, currentDeviceId: null,
          backends: [{ backendId: 'b1', runtimeState: 'ready', online: true } as any],
          sessionStreams: {},
        }),
        openBackend: vi.fn(),
        syncCatalog,
      });

      const staleTime = Date.now() - 6 * 60_000; // 6 minutes ago
      useRecoveryStore.setState({
        catalogs: {
          b1: {
            backendId: 'b1', status: 'ready', ownershipVersion: 1,
            retryCount: 0, lastError: null,
            lastSyncAt: staleTime, statusEnteredAt: staleTime,
          },
        },
      } as any);

      mgr.runReconciliationTick();

      expect(syncCatalog).toHaveBeenCalledWith('b1', 'delta');
    });
  });
});
