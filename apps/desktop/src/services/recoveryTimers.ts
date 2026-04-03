/**
 * RecoveryTimerManager
 *
 * Manages per-phase timeout timers and the periodic reconciliation tick
 * for the recovery state machine. Timers are keyed by name so they can
 * be started/cancelled independently.
 *
 * Usage: create one instance per coordinator lifecycle. Call dispose() on cleanup.
 */

import { useRecoveryStore, RECOVERY_TIMEOUTS } from '../stores/recoveryStore';
import type { BackendFacadeSnapshot } from '@my-claudia/shared';

type TimerHandle = ReturnType<typeof setTimeout>;

export type ReconciliationContext = {
  getFacadeSnapshot: () => BackendFacadeSnapshot | null;
  openBackend: (backendId: string) => void;
  syncCatalog: (backendId: string, mode: 'full' | 'delta') => void;
};

export class RecoveryTimerManager {
  private timers = new Map<string, TimerHandle>();
  private reconcileTimer: TimerHandle | null = null;
  private reconcileCtx: ReconciliationContext | null = null;
  private disposed = false;

  setReconciliationContext(ctx: ReconciliationContext): void {
    this.reconcileCtx = ctx;
  }

  startTimeout(key: string, durationMs: number, onTimeout: () => void): void {
    if (this.disposed) return;
    this.cancelTimeout(key);
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      if (!this.disposed) onTimeout();
    }, durationMs));
  }

  cancelTimeout(key: string): void {
    const handle = this.timers.get(key);
    if (handle) {
      clearTimeout(handle);
      this.timers.delete(key);
    }
  }

  cancelAllWithPrefix(prefix: string): void {
    for (const [key, handle] of this.timers) {
      if (key.startsWith(prefix)) {
        clearTimeout(handle);
        this.timers.delete(key);
      }
    }
  }

  hasTimeout(key: string): boolean {
    return this.timers.has(key);
  }

  startReconciliation(): void {
    this.stopReconciliation();
    if (this.disposed) return;
    this.reconcileTimer = setInterval(() => {
      if (!this.disposed) this.runReconciliationTick();
    }, RECOVERY_TIMEOUTS.RECONCILE_INTERVAL);
  }

  stopReconciliation(): void {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
  }

  runReconciliationTick(): void {
    if (this.disposed || !this.reconcileCtx) return;
    const store = useRecoveryStore.getState();
    const { coordinator } = store;

    if (coordinator === 'background' || coordinator === 'error') return;

    const snapshot = this.reconcileCtx.getFacadeSnapshot();
    if (!snapshot) return;

    this.reconcileTransport(store, snapshot);
    this.reconcileBackends(store, snapshot);
    this.reconcileCatalogs(store);
    this.reconcileActiveSession(store, snapshot);
  }

  dispose(): void {
    this.disposed = true;
    this.stopReconciliation();
    for (const handle of this.timers.values()) {
      clearTimeout(handle);
    }
    this.timers.clear();
    this.reconcileCtx = null;
  }

  /**
   * Transport reconciliation:
   * - connected but no messages for 2× health probe interval → reconnecting
   * - connecting/reconnecting stuck past timeout → error
   */
  private reconcileTransport(
    store: ReturnType<typeof useRecoveryStore.getState>,
    _snapshot: BackendFacadeSnapshot,
  ): void {
    const { transport } = store;
    const t = Date.now();

    if (transport.status === 'connected') {
      // In embedded mode the transport is a localhost WS — extremely reliable.
      // If the server dies, ws.onclose handles it. No stale-message heuristic needed.
      if (transport.mode === 'embedded') return;

      const STALE_THRESHOLD = 2 * 25_000; // 2× health probe interval
      if (transport.lastMessageAt && (t - transport.lastMessageAt) > STALE_THRESHOLD) {
        console.warn('[RecoveryReconcile] Transport connected but no messages for',
          Math.round((t - transport.lastMessageAt) / 1000), 's — treating as stale');
        store.setTransportState('reconnecting', 'reconciliation: stale connection');
      }
      return;
    }

    if (transport.status === 'connecting' || transport.status === 'reconnecting') {
      const elapsed = t - transport.statusEnteredAt;
      if (elapsed > RECOVERY_TIMEOUTS.TRANSPORT_CONNECT) {
        console.warn('[RecoveryReconcile] Transport stuck in', transport.status, 'for',
          Math.round(elapsed / 1000), 's — marking as error');
        store.noteTransportTimeout();
      }
    }
  }

  /**
   * Backend reconciliation:
   * - opening: check facade snapshot for channel already open → synthesize ready
   * - opening: check timeout → emit backend timeout
   * - ready: check facade snapshot shows channel closed → degrade
   * - degraded: transport connected + desired → re-trigger open
   */
  private reconcileBackends(
    store: ReturnType<typeof useRecoveryStore.getState>,
    snapshot: BackendFacadeSnapshot,
  ): void {
    const t = Date.now();
    for (const [backendId, backend] of Object.entries(store.backends)) {
      const snapshotBackend = snapshot.backends.find(b => b.backendId === backendId);

      if (backend.status === 'opening') {
        if (snapshotBackend?.runtimeState === 'ready' && !backend.channelReady) {
          console.log('[RecoveryReconcile] Backend', backendId,
            'channel open in snapshot but channelReady=false — correcting');
          store.applySnapshot(snapshot);
        }
        const elapsed = t - backend.statusEnteredAt;
        if (elapsed > RECOVERY_TIMEOUTS.BACKEND_OPEN) {
          console.warn('[RecoveryReconcile] Backend', backendId, 'stuck in opening for',
            Math.round(elapsed / 1000), 's');
          store.noteBackendTimeout(backendId);
        }
      }

      if (backend.status === 'ready') {
        if (snapshotBackend && snapshotBackend.runtimeState !== 'ready') {
          console.warn('[RecoveryReconcile] Backend', backendId,
            'marked ready but snapshot shows', snapshotBackend.runtimeState, '— correcting');
          store.applySnapshot(snapshot);
        }
      }

      if (backend.status === 'degraded' && backend.desiredOpen && store.transport.status === 'connected') {
        const elapsed = t - backend.statusEnteredAt;
        if (elapsed > RECOVERY_TIMEOUTS.BACKEND_OPEN) {
          console.warn('[RecoveryReconcile] Backend', backendId,
            'stuck in degraded with desiredOpen=true — re-triggering open');
          store.noteBackendDesiredOpen(backendId);
          this.reconcileCtx?.openBackend(backendId);
        }
      }
    }
  }

  /**
   * Catalog reconciliation:
   * - syncing_full/syncing_delta: check timeout → emit catalog timeout
   * - ready: check staleness → request delta sync
   * - stale: backend channel open but not syncing → request full sync
   */
  private reconcileCatalogs(
    store: ReturnType<typeof useRecoveryStore.getState>,
  ): void {
    const t = Date.now();
    for (const [backendId, catalog] of Object.entries(store.catalogs)) {
      if (catalog.status === 'syncing_full' || catalog.status === 'syncing_delta') {
        const elapsed = t - catalog.statusEnteredAt;
        if (elapsed > RECOVERY_TIMEOUTS.CATALOG_SYNC) {
          console.warn('[RecoveryReconcile] Catalog', backendId, 'stuck in',
            catalog.status, 'for', Math.round(elapsed / 1000), 's');
          store.noteCatalogSyncTimeout(backendId);
        }
      }

      if (catalog.status === 'ready' && catalog.lastSyncAt) {
        const isActive = backendId === store.activeBackendId;
        const staleness = isActive
          ? RECOVERY_TIMEOUTS.CATALOG_STALENESS_ACTIVE
          : RECOVERY_TIMEOUTS.CATALOG_STALENESS_INACTIVE;
        if ((t - catalog.lastSyncAt) > staleness) {
          console.log('[RecoveryReconcile] Catalog', backendId, 'stale — requesting delta sync');
          this.reconcileCtx?.syncCatalog(backendId, 'delta');
        }
      }

      if (catalog.status === 'stale') {
        const backend = store.backends[backendId];
        if (backend?.channelReady) {
          console.log('[RecoveryReconcile] Catalog', backendId,
            'stale with channel open — requesting full sync');
          this.reconcileCtx?.syncCatalog(backendId, 'full');
        }
      }
    }
  }

  /**
   * Active session reconciliation:
   * - live: check facade session stream still open
   * - opening_stream/catching_up/hydrating_tail: check timeout
   * - stale: owner backend ready + catalog ready but not recovering → kick
   */
  private reconcileActiveSession(
    store: ReturnType<typeof useRecoveryStore.getState>,
    snapshot: BackendFacadeSnapshot,
  ): void {
    const { activeSession } = store;
    if (!activeSession.sessionId) return;
    const t = Date.now();

    if (activeSession.status === 'live' && activeSession.backendId) {
      const streamKey = `${activeSession.backendId}:${activeSession.sessionId}`;
      const stream = snapshot.sessionStreams?.[streamKey];
      if (stream && stream.state !== 'open') {
        console.warn('[RecoveryReconcile] Active session stream closed in snapshot — marking stale');
        store.noteActiveSessionStale();
      }
    }

    const timedPhases = ['opening_stream', 'catching_up', 'hydrating_tail', 'waiting_backend_ready'] as const;
    if ((timedPhases as readonly string[]).includes(activeSession.status)) {
      const timeout = activeSession.status === 'catching_up' || activeSession.status === 'hydrating_tail'
        ? RECOVERY_TIMEOUTS.SESSION_CATCHUP
        : RECOVERY_TIMEOUTS.SESSION_STREAM_OPEN;
      const elapsed = t - activeSession.statusEnteredAt;
      if (elapsed > timeout) {
        console.warn('[RecoveryReconcile] Active session stuck in', activeSession.status,
          'for', Math.round(elapsed / 1000), 's');
        store.noteActiveSessionTimeout();
      }
    }

    if (activeSession.status === 'stale' && activeSession.backendId) {
      const ownerBackend = store.backends[activeSession.backendId];
      const ownerCatalog = store.catalogs[activeSession.backendId];
      if (ownerBackend?.status === 'ready' && ownerCatalog?.status === 'ready') {
        const elapsed = t - activeSession.statusEnteredAt;
        if (elapsed > RECOVERY_TIMEOUTS.SESSION_STREAM_OPEN) {
          console.warn('[RecoveryReconcile] Active session stale but owner ready — re-triggering recovery');
          store.noteActiveSessionResolving(activeSession.sessionId, activeSession.backendId);
        }
      }
    }
  }
}
