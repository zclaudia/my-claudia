/**
 * FacadeRegistryStore
 *
 * Manages backend registry state and derives BackendRuntimeState / BackendOpenState.
 * Pure ES2022, no platform dependencies.
 *
 * See docs/design/backend-facade.md § "runtime backend 状态推导"
 */

import type { BackendPresence } from '../protocol/gateway.js';
import type { FacadeAdapterBootstrapState } from './adapter.js';
import type {
  BackendRuntimeRecord,
  BackendRuntimeState,
  BackendOpenState,
  BackendStateDiff,
} from './types.js';

// ============================================================================
// Pure State Derivation
// ============================================================================

function deriveRuntimeState(record: BackendRuntimeRecord): BackendRuntimeState {
  // 1. No presence → offline
  if (!record.presence) return 'offline';

  // 2. Has presence but not subscribed → visible
  if (!record.subscribed) {
    // Check if we're in a subscribing attempt
    if (record.openState === 'subscribing') return 'subscribing';
    // Check for error
    if (record.openState === 'error') return 'error';
    return 'visible';
  }

  // 3. Subscribed but backend data not initialized → subscribing
  if (!record.dataInitialized) return 'subscribing';

  // 4. Subscribed + backend data initialized → ready
  return 'ready';
}

function createDefaultRecord(backendId: string, presence: BackendPresence | null): BackendRuntimeRecord {
  return {
    backendId,
    presence,
    currentEpoch: presence?.epoch ?? null,
    subscribed: false,
    dataInitialized: false,
    runtimeState: presence ? 'visible' : 'offline',
    openState: 'unsubscribed',
    capabilities: [],
  };
}

function makeDiff(
  backendId: string,
  prev: BackendRuntimeRecord | undefined,
  next: BackendRuntimeRecord,
  reason?: string,
): BackendStateDiff | null {
  if (
    prev?.runtimeState === next.runtimeState &&
    prev?.openState === next.openState
  ) {
    return null;
  }
  return {
    backendId,
    previousRuntimeState: prev?.runtimeState,
    nextRuntimeState: next.runtimeState,
    previousOpenState: prev?.openState,
    nextOpenState: next.openState,
    reason,
  };
}

function updateDerived(record: BackendRuntimeRecord): void {
  record.runtimeState = deriveRuntimeState(record);
}

// ============================================================================
// FacadeRegistryStore
// ============================================================================

export class FacadeRegistryStore {
  private records = new Map<string, BackendRuntimeRecord>();

  // --------------------------------------------------------------------------
  // Bootstrap
  // --------------------------------------------------------------------------

  applyBootstrap(state: FacadeAdapterBootstrapState): void {
    this.records.clear();

    // Apply registry items
    for (const item of state.registry.items) {
      const record = createDefaultRecord(item.backendId, item);
      this.records.set(item.backendId, record);
    }

    // Apply existing subscriptions
    for (const backendId of state.subscriptions.backendIds) {
      const record = this.records.get(backendId);
      if (record) {
        record.subscribed = true;
        record.openState = 'subscribed';
        updateDerived(record);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Registry Operations
  // --------------------------------------------------------------------------

  applyRegistrySnapshot(items: BackendPresence[]): BackendStateDiff[] {
    const diffs: BackendStateDiff[] = [];
    const newIds = new Set(items.map(i => i.backendId));

    // Remove backends no longer in registry
    for (const [id, prev] of this.records) {
      if (!newIds.has(id)) {
        // Already offline/error — don't re-emit diff on every snapshot
        if (prev.runtimeState === 'offline' || (prev.runtimeState === 'error' && !prev.presence)) {
          continue;
        }
        const next: BackendRuntimeRecord = {
          ...prev,
          presence: null,
          currentEpoch: null,
          subscribed: false,
          dataInitialized: false,
          openState: prev.openState === 'subscribed' || prev.openState === 'subscribing' ? 'error' : prev.openState,
          capabilities: [],
        };
        updateDerived(next);
        const diff = makeDiff(id, prev, next, 'registry_removed');
        if (diff) diffs.push(diff);
        this.records.set(id, next);
      }
    }

    // Upsert present backends
    for (const item of items) {
      const prev = this.records.get(item.backendId);

      if (prev) {
        // Same epoch — just update presence reference, no state change
        if (prev.currentEpoch === item.epoch || prev.currentEpoch === null) {
          prev.presence = item;
          if (prev.currentEpoch === null) prev.currentEpoch = item.epoch;
          continue;
        }

        // Epoch changed — invalidate subscription and data
        const prevState = { runtimeState: prev.runtimeState, openState: prev.openState };
        prev.presence = item;
        prev.currentEpoch = item.epoch;
        prev.subscribed = false;
        prev.dataInitialized = false;
        prev.openState = prev.openState === 'subscribed' ? 'error' : 'unsubscribed';
        prev.capabilities = [];
        updateDerived(prev);
        if (prev.runtimeState !== prevState.runtimeState || prev.openState !== prevState.openState) {
          diffs.push({
            backendId: item.backendId,
            previousRuntimeState: prevState.runtimeState,
            nextRuntimeState: prev.runtimeState,
            previousOpenState: prevState.openState,
            nextOpenState: prev.openState,
            reason: 'epoch_changed',
          });
        }
        continue;
      }

      // New backend — create default record
      const next = createDefaultRecord(item.backendId, item);
      updateDerived(next);
      const diff = makeDiff(item.backendId, prev, next, 'registry_snapshot');
      if (diff) diffs.push(diff);
      this.records.set(item.backendId, next);
    }

    return diffs;
  }

  // --------------------------------------------------------------------------
  // Subscription Operations
  // --------------------------------------------------------------------------

  markSubscribing(backendId: string): BackendStateDiff[] {
    const prev = this.records.get(backendId);
    if (!prev) return [];

    const next: BackendRuntimeRecord = {
      ...prev,
      openState: 'subscribing' as BackendOpenState,
    };
    updateDerived(next);
    this.records.set(backendId, next);
    const diff = makeDiff(backendId, prev, next, 'subscribing');
    return diff ? [diff] : [];
  }

  markSubscribed(
    backendId: string,
    epoch: number,
    capabilities: string[],
  ): BackendStateDiff[] {
    const prev = this.records.get(backendId);
    if (!prev) return [];

    const next: BackendRuntimeRecord = {
      ...prev,
      subscribed: true,
      currentEpoch: epoch,
      openState: 'subscribed' as BackendOpenState,
      capabilities,
      lastError: undefined,
      lastClosureReason: undefined,
    };
    updateDerived(next);
    this.records.set(backendId, next);
    const diff = makeDiff(backendId, prev, next, 'subscribed');
    return diff ? [diff] : [];
  }

  markUnsubscribed(
    backendId: string,
    reason: string,
  ): BackendStateDiff[] {
    const prev = this.records.get(backendId);
    if (!prev) return [];

    const next: BackendRuntimeRecord = {
      ...prev,
      subscribed: false,
      dataInitialized: false,
      openState: 'unsubscribed' as BackendOpenState,
      lastClosureReason: reason,
      capabilities: [],
    };
    updateDerived(next);
    this.records.set(backendId, next);
    const diff = makeDiff(backendId, prev, next, reason);
    return diff ? [diff] : [];
  }

  // --------------------------------------------------------------------------
  // Backend Data Operations
  // --------------------------------------------------------------------------

  markDataInitialized(backendId: string): BackendStateDiff[] {
    const prev = this.records.get(backendId);
    if (!prev) return [];

    const next: BackendRuntimeRecord = {
      ...prev,
      dataInitialized: true,
    };
    updateDerived(next);
    this.records.set(backendId, next);
    const diff = makeDiff(backendId, prev, next, 'data_initialized');
    return diff ? [diff] : [];
  }

  markDataReset(backendId: string): BackendStateDiff[] {
    const prev = this.records.get(backendId);
    if (!prev) return [];

    const next: BackendRuntimeRecord = {
      ...prev,
      dataInitialized: false,
    };
    updateDerived(next);
    this.records.set(backendId, next);
    const diff = makeDiff(backendId, prev, next, 'data_reset');
    return diff ? [diff] : [];
  }

  // --------------------------------------------------------------------------
  // Queries
  // --------------------------------------------------------------------------

  /** Fix #16: Remove zombie records (null presence, not subscribed) to prevent memory leak. */
  collectGarbage(): void {
    for (const [id, record] of this.records) {
      if (!record.presence && !record.subscribed) {
        this.records.delete(id);
      }
    }
  }

  getBackend(backendId: string): BackendRuntimeRecord | undefined {
    return this.records.get(backendId);
  }

  getAllBackends(): BackendRuntimeRecord[] {
    return Array.from(this.records.values());
  }

}
