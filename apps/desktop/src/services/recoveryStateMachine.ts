/**
 * RecoveryController
 *
 * Drives the recovery state machine imperatively, outside React's render cycle.
 * All store reads use getState() (no reactive subscriptions), so store writes
 * inside tick() never trigger React re-renders or cascading useEffect re-runs.
 *
 * External modules should only call dispatch() with domain events.
 * The controller coalesces them into ticks and tracks inflight work explicitly.
 */

import { useFacadeStore } from '../stores/facadeStore';
import { useRecoveryStore, getRecoverySessionStream } from '../stores/recoveryStore';
import { useOwnershipStore } from '../stores/ownershipStore';
import type { RecoveryTimerManager } from './recoveryTimers';
import type { BackendFacadeMode } from '@my-claudia/shared';
import { planRecoveryStep } from './recoveryPlanner';
import {
  executeRecoveryPlan,
  type InflightOperation,
  type RecoveryInflightState,
} from './recoveryEffects';
import { logRecoveryEvent, logRecoveryPlan } from './recoveryLogger';

export type RecoveryControllerEvent =
  | { type: 'selection_changed'; activeBackendId: string | null; selectedSessionId: string | null }
  | { type: 'background' }
  | { type: 'resume'; mode?: BackendFacadeMode }
  | { type: 'network_offline' }
  | { type: 'facade_snapshot' }
  | { type: 'transport_changed' }
  | { type: 'backend_state_changed' }
  | { type: 'reconcile' };

export class RecoveryController {
  private inflight: RecoveryInflightState = {
    dataSyncOp: null,
    backendOpenOp: null,
    sessionRecoveryOp: null,
  };
  private tickScheduled = false;
  private disposed = false;
  private timerManager: RecoveryTimerManager;

  constructor(timerManager: RecoveryTimerManager) {
    this.timerManager = timerManager;
  }

  dispatch(event: RecoveryControllerEvent): void {
    if (this.disposed) return;
    logRecoveryEvent('dispatch', { event });

    switch (event.type) {
      case 'selection_changed':
        useRecoveryStore.getState().setSelection(event.activeBackendId, event.selectedSessionId);
        this.scheduleTick();
        return;
      case 'background':
        useRecoveryStore.getState().noteBackground();
        return;
      case 'resume':
        useRecoveryStore.getState().startRecovery(event.mode ?? 'direct');
        this.scheduleTick();
        return;
      case 'network_offline':
        useRecoveryStore.getState().setTransportState('reconnecting', 'network_offline');
        this.scheduleTick();
        return;
      case 'facade_snapshot':
      case 'transport_changed':
      case 'backend_state_changed':
      case 'reconcile':
        this.scheduleTick();
        return;
      default:
        return;
    }
  }

  private clearInflight(): void {
    this.inflight.dataSyncOp = null;
    this.inflight.backendOpenOp = null;
    this.inflight.sessionRecoveryOp = null;
  }

  private clearInflightForBackend(backendId: string): void {
    if (this.inflight.dataSyncOp?.backendId === backendId) this.inflight.dataSyncOp = null;
    if (this.inflight.backendOpenOp?.backendId === backendId) this.inflight.backendOpenOp = null;
  }

  private matchesOp(current: InflightOperation | null, next: InflightOperation): boolean {
    return !!current
      && current.kind === next.kind
      && current.generation === next.generation
      && current.backendId === next.backendId
      && current.sessionId === next.sessionId;
  }

  /**
   * Schedule a tick via queueMicrotask. Multiple calls within the same
   * synchronous block are coalesced into a single tick execution.
   */
  scheduleTick(): void {
    if (this.tickScheduled || this.disposed) return;
    this.tickScheduled = true;
    queueMicrotask(() => {
      this.tickScheduled = false;
      if (!this.disposed) this.tick();
    });
  }

  /**
   * Run one pass of the recovery state machine. Reads all state imperatively
   * via getState(). Writes to stores as needed. No React subscriptions involved.
   */
  tick(): void {
    if (this.disposed) return;

    const facade = useFacadeStore.getState().facade;
    if (!facade) return;

    // Read all store state once to ensure atomic snapshot within this tick
    const store = useRecoveryStore.getState();
    const { coordinator, transport, activeBackendId: recoveryActiveBackendId, selectedSessionId, backends: recoveryBackendsSnap, dataSyncs: recoveryDataSyncsSnap } = store;
    const facadeState = useFacadeStore.getState();
    const { backends: facadeBackends, sessionStreams } = facadeState;
    const mgr = this.timerManager;

    const transportStatus = transport.status;
    const transportGeneration = transport.generation;

    const backendId = recoveryActiveBackendId;
    const backendSnapshot = backendId
      ? facadeBackends.find((item) => item.backendId === backendId) ?? null
      : null;
    const backendState = backendId ? recoveryBackendsSnap[backendId] ?? null : null;
    const dataSyncState = backendId ? recoveryDataSyncsSnap[backendId] ?? null : null;
    const generation = transportGeneration;

    const ownershipStore = useOwnershipStore.getState();
    const resolvedOwnerBackendId =
      selectedSessionId
        ? (
          store.getVerifiedSessionBackendId(selectedSessionId)
          ?? ownershipStore.getSessionBackendId(selectedSessionId)
          ?? backendId
        )
        : null;
    const ownershipVersion =
      (selectedSessionId ? ownershipStore.getSessionOwnershipVersion(selectedSessionId) : null)
      ?? (backendId ? recoveryDataSyncsSnap[backendId]?.ownershipVersion : null)
      ?? null;
    const ownerBackendState = resolvedOwnerBackendId ? recoveryBackendsSnap[resolvedOwnerBackendId] ?? null : null;
    const ownerDataSyncState = resolvedOwnerBackendId ? recoveryDataSyncsSnap[resolvedOwnerBackendId] ?? null : null;
    const ownerBackendSnapshot = resolvedOwnerBackendId
      ? facadeBackends.find((item) => item.backendId === resolvedOwnerBackendId) ?? null
      : null;
    const stream = resolvedOwnerBackendId && selectedSessionId
      ? getRecoverySessionStream(sessionStreams, resolvedOwnerBackendId, selectedSessionId)
      : null;

    const plan = planRecoveryStep({
      coordinator,
      transportStatus,
      activeBackendId: recoveryActiveBackendId,
      selectedSessionId,
      backendId,
      backendSnapshot,
      backendState,
      dataSyncState,
      ownerBackendId: resolvedOwnerBackendId,
      ownerBackendSnapshot,
      ownerBackendState,
      ownerDataSyncState,
      ownershipVersion,
      streamState: stream?.state ?? null,
    });

    logRecoveryPlan('plan', {
      coordinator,
      generation,
      activeBackendId: backendId,
      selectedSessionId,
      ownerBackendId: resolvedOwnerBackendId,
      transportStatus,
      planState: plan.state,
      effectType: plan.effect.type,
    });

    executeRecoveryPlan(plan, {
      facade,
      generation,
      ownershipVersion,
      timerManager: mgr,
      inflight: this.inflight,
      matchesOp: this.matchesOp.bind(this),
      clearInflight: this.clearInflight.bind(this),
      clearInflightForBackend: this.clearInflightForBackend.bind(this),
      scheduleTick: this.scheduleTick.bind(this),
    });
  }

  dispose(): void {
    this.disposed = true;
    this.clearInflight();
  }
}
