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
import {
  noteBackendOpenRequested,
  noteBackendOpenTimeout,
  noteDataSyncTimeout,
  noteSessionMarkedStale,
  noteSessionRecoveryTimeout,
  noteSessionResolvingOwner,
  noteTransportRecoveryTimeout,
  noteTransportStaleConnection,
} from './recoveryTransitions';

type TimerHandle = ReturnType<typeof setTimeout>;

export type ReconciliationContext = {
  getFacadeSnapshot: () => BackendFacadeSnapshot | null;
  openBackend: (backendId: string) => void;
  syncData: (backendId: string, mode: 'full' | 'delta') => void;
};

export class RecoveryTimerManager {
  private timers = new Map<string, TimerHandle>();
  private reconcileTimer: TimerHandle | null = null;
  private reconcileCtx: ReconciliationContext | null = null;
  private disposed = false;
  private reconcileListener: (() => void) | null = null;

  setReconciliationContext(ctx: ReconciliationContext): void {
    this.reconcileCtx = ctx;
  }

  setReconcileListener(listener: (() => void) | null): void {
    this.reconcileListener = listener;
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
    this.reconcileDataSyncs(store);
    this.reconcileActiveSession(store, snapshot);
    // After reconciliation corrections, trigger the recovery state machine
    // to re-evaluate in case any state was corrected.
    this.reconcileListener?.();
  }

  dispose(): void {
    this.disposed = true;
    this.stopReconciliation();
    for (const handle of this.timers.values()) {
      clearTimeout(handle);
    }
    this.timers.clear();
    this.reconcileCtx = null;
    this.reconcileListener = null;
  }

  /**
   * Transport reconciliation:
   * - connected but no messages for 2x health probe interval -> reconnecting
   * - connecting/reconnecting stuck past timeout -> error
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

      const STALE_THRESHOLD = 2 * 25_000; // 2x health probe interval
      if (transport.lastMessageAt && (t - transport.lastMessageAt) > STALE_THRESHOLD) {
        console.warn('[RecoveryReconcile] Transport connected but no messages for',
          Math.round((t - transport.lastMessageAt) / 1000), 's — treating as stale');
        noteTransportStaleConnection();
      }
      return;
    }

    if (transport.status === 'connecting' || transport.status === 'reconnecting') {
      const elapsed = t - transport.statusEnteredAt;
      if (elapsed > RECOVERY_TIMEOUTS.TRANSPORT_CONNECT) {
        console.warn('[RecoveryReconcile] Transport stuck in', transport.status, 'for',
          Math.round(elapsed / 1000), 's — marking as error');
        noteTransportRecoveryTimeout();
      }
    }
  }

  /**
   * Backend reconciliation:
   * - subscribing: check facade snapshot for subscription already ready -> synthesize ready
   * - subscribing: check timeout -> emit backend timeout
   * - ready: check facade snapshot shows subscription lost -> correct
   * - visible: transport connected -> re-trigger open
   */
  private reconcileBackends(
    store: ReturnType<typeof useRecoveryStore.getState>,
    snapshot: BackendFacadeSnapshot,
  ): void {
    const t = Date.now();
    for (const [backendId, backend] of Object.entries(store.backends)) {
      const snapshotBackend = snapshot.backends.find(b => b.backendId === backendId);

      if (backend.status === 'subscribing') {
        if (snapshotBackend?.runtimeState === 'ready' && !backend.subscribed) {
          console.log('[RecoveryReconcile] Backend', backendId,
            'subscribed in snapshot but subscribed=false — correcting');
          store.applySnapshot(snapshot);
        }
        const elapsed = t - backend.statusEnteredAt;
        if (elapsed > RECOVERY_TIMEOUTS.BACKEND_SUBSCRIBE) {
          console.warn('[RecoveryReconcile] Backend', backendId, 'stuck in subscribing for',
            Math.round(elapsed / 1000), 's');
          noteBackendOpenTimeout(backendId);
        }
      }

      if (backend.status === 'ready') {
        if (snapshotBackend && snapshotBackend.runtimeState !== 'ready') {
          console.warn('[RecoveryReconcile] Backend', backendId,
            'marked ready but snapshot shows', snapshotBackend.runtimeState, '— correcting');
          store.applySnapshot(snapshot);
        }
      }

      if (backend.status === 'visible' && store.transport.status === 'connected') {
        const elapsed = t - backend.statusEnteredAt;
        if (elapsed > RECOVERY_TIMEOUTS.BACKEND_SUBSCRIBE) {
          console.warn('[RecoveryReconcile] Backend', backendId,
            'stuck in visible — re-triggering open');
          noteBackendOpenRequested(backendId);
          this.reconcileCtx?.openBackend(backendId);
        }
      }
    }
  }

  /**
   * Data sync reconciliation:
   * - syncing_full/syncing_delta: check timeout -> emit data sync timeout
   * - ready: check staleness -> request delta sync
   * - stale: backend subscribed but not syncing -> request full sync
   */
  private reconcileDataSyncs(
    store: ReturnType<typeof useRecoveryStore.getState>,
  ): void {
    const t = Date.now();
    for (const [backendId, dataSync] of Object.entries(store.dataSyncs)) {
      if (dataSync.status === 'syncing_full' || dataSync.status === 'syncing_delta') {
        const elapsed = t - dataSync.statusEnteredAt;
        if (elapsed > RECOVERY_TIMEOUTS.DATA_SYNC) {
          console.warn('[RecoveryReconcile] Data sync', backendId, 'stuck in',
            dataSync.status, 'for', Math.round(elapsed / 1000), 's');
          noteDataSyncTimeout(backendId);
        }
      }

      if (dataSync.status === 'ready' && dataSync.lastSyncAt) {
        const isActive = backendId === store.activeBackendId;
        const staleness = isActive
          ? RECOVERY_TIMEOUTS.DATA_STALENESS_ACTIVE
          : RECOVERY_TIMEOUTS.DATA_STALENESS_INACTIVE;
        if ((t - dataSync.lastSyncAt) > staleness) {
          console.log('[RecoveryReconcile] Data sync', backendId, 'stale — requesting delta sync');
          this.reconcileCtx?.syncData(backendId, 'delta');
        }
      }

      if (dataSync.status === 'stale') {
        const backend = store.backends[backendId];
        if (backend?.subscribed) {
          console.log('[RecoveryReconcile] Data sync', backendId,
            'stale with backend subscribed — requesting full sync');
          this.reconcileCtx?.syncData(backendId, 'full');
        }
      }
    }
  }

  /**
   * Active session reconciliation:
   * - live: check facade session stream still open
   * - opening_stream/catching_up/hydrating_tail: check timeout
   * - stale: owner backend ready + data ready but not recovering -> kick
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
        noteSessionMarkedStale();
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
        noteSessionRecoveryTimeout();
      }
    }

    if (activeSession.status === 'stale' && activeSession.backendId) {
      const ownerBackend = store.backends[activeSession.backendId];
      const ownerDataSync = store.dataSyncs[activeSession.backendId];
      if (ownerBackend?.status === 'ready' && ownerDataSync?.status === 'ready') {
        const elapsed = t - activeSession.statusEnteredAt;
        if (elapsed > RECOVERY_TIMEOUTS.SESSION_STREAM_OPEN) {
          console.warn('[RecoveryReconcile] Active session stale but owner ready — re-triggering recovery');
          noteSessionResolvingOwner(activeSession.sessionId, activeSession.backendId);
        }
      }
    }
  }
}
