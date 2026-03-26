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

  // 2. Has presence but no channel → visible
  if (record.channelId === null) {
    // Check if we're in an opening attempt
    if (record.openState === 'opening') return 'opening';
    // Check for error
    if (record.openState === 'error') return 'error';
    return 'visible';
  }

  // 3. Channel exists but catalog not initialized → opening
  if (!record.catalogInitialized) return 'opening';

  // 4. Epoch alignment check
  const epochAligned =
    record.presence.epoch === record.channelEpoch &&
    record.presence.epoch === record.catalogEpoch;

  if (!epochAligned) return 'opening';

  // 5. All aligned → ready
  return 'ready';
}

function deriveOpenState(record: BackendRuntimeRecord): BackendOpenState {
  return record.openState;
}

function createDefaultRecord(backendId: string, presence: BackendPresence | null): BackendRuntimeRecord {
  return {
    backendId,
    presence,
    currentEpoch: presence?.epoch ?? null,
    channelId: null,
    channelEpoch: null,
    catalogInitialized: false,
    catalogEpoch: null,
    runtimeState: presence ? 'visible' : 'offline',
    openState: 'closed',
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
  private registryRevision = 0;

  // --------------------------------------------------------------------------
  // Bootstrap
  // --------------------------------------------------------------------------

  applyBootstrap(state: FacadeAdapterBootstrapState): void {
    this.records.clear();

    // Apply registry items
    this.registryRevision = state.registry.revision;
    for (const item of state.registry.items) {
      const record = createDefaultRecord(item.backendId, item);
      this.records.set(item.backendId, record);
    }

    // Apply existing channels
    for (const ch of state.channels.items) {
      const record = this.records.get(ch.backendId);
      if (record) {
        record.channelId = ch.channelId;
        record.channelEpoch = ch.epoch;
        record.openState = 'open';
        updateDerived(record);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Registry Operations
  // --------------------------------------------------------------------------

  applyRegistrySnapshot(revision: number, items: BackendPresence[]): BackendStateDiff[] {
    const diffs: BackendStateDiff[] = [];
    const newIds = new Set(items.map(i => i.backendId));

    // Remove backends no longer in registry
    for (const [id, prev] of this.records) {
      if (!newIds.has(id)) {
        const next: BackendRuntimeRecord = {
          ...prev,
          presence: null,
          currentEpoch: null,
          openState: prev.openState === 'open' || prev.openState === 'opening' ? 'error' : prev.openState,
        };
        updateDerived(next);
        const diff = makeDiff(id, prev, next, 'registry_removed');
        if (diff) diffs.push(diff);
        // Keep record for potential stream cleanup; runtime can GC later
        this.records.set(id, next);
      }
    }

    // Upsert present backends
    for (const item of items) {
      const prev = this.records.get(item.backendId);
      const next = prev
        ? { ...prev, presence: item, currentEpoch: item.epoch }
        : createDefaultRecord(item.backendId, item);

      // Epoch change invalidates channel and catalog
      if (prev && prev.currentEpoch !== null && prev.currentEpoch !== item.epoch) {
        next.channelId = null;
        next.channelEpoch = null;
        next.catalogInitialized = false;
        next.catalogEpoch = null;
        next.openState = prev.openState === 'open' ? 'error' : 'closed';
        next.capabilities = [];
      }

      updateDerived(next);
      const diff = makeDiff(item.backendId, prev, next, 'registry_snapshot');
      if (diff) diffs.push(diff);
      this.records.set(item.backendId, next);
    }

    this.registryRevision = revision;
    return diffs;
  }

  applyRegistryEvent(
    revision: number,
    op: 'upsert' | 'remove',
    item?: BackendPresence,
    backendId?: string,
  ): BackendStateDiff[] {
    this.registryRevision = revision;

    if (op === 'remove' && backendId) {
      const prev = this.records.get(backendId);
      if (!prev) return [];

      const next: BackendRuntimeRecord = {
        ...prev,
        presence: null,
        currentEpoch: null,
        openState: prev.openState === 'open' || prev.openState === 'opening' ? 'error' : prev.openState,
      };
      updateDerived(next);
      this.records.set(backendId, next);
      const diff = makeDiff(backendId, prev, next, 'registry_removed');
      return diff ? [diff] : [];
    }

    if (op === 'upsert' && item) {
      const prev = this.records.get(item.backendId);
      const next = prev
        ? { ...prev, presence: item, currentEpoch: item.epoch }
        : createDefaultRecord(item.backendId, item);

      // Epoch change
      if (prev && prev.currentEpoch !== null && prev.currentEpoch !== item.epoch) {
        next.channelId = null;
        next.channelEpoch = null;
        next.catalogInitialized = false;
        next.catalogEpoch = null;
        next.openState = prev.openState === 'open' ? 'error' : 'closed';
        next.capabilities = [];
      }

      updateDerived(next);
      this.records.set(item.backendId, next);
      const diff = makeDiff(item.backendId, prev, next, 'registry_upsert');
      return diff ? [diff] : [];
    }

    return [];
  }

  // --------------------------------------------------------------------------
  // Channel Operations
  // --------------------------------------------------------------------------

  markChannelOpening(backendId: string, epoch: number): BackendStateDiff[] {
    const prev = this.records.get(backendId);
    if (!prev) return [];

    const next: BackendRuntimeRecord = {
      ...prev,
      openState: 'opening' as BackendOpenState,
    };
    updateDerived(next);
    this.records.set(backendId, next);
    const diff = makeDiff(backendId, prev, next, 'channel_opening');
    return diff ? [diff] : [];
  }

  markChannelOpened(
    backendId: string,
    channelId: string,
    epoch: number,
    capabilities: string[],
  ): BackendStateDiff[] {
    const prev = this.records.get(backendId);
    if (!prev) return [];

    const next: BackendRuntimeRecord = {
      ...prev,
      channelId,
      channelEpoch: epoch,
      openState: 'open' as BackendOpenState,
      capabilities,
      lastError: undefined,
      lastClosureReason: undefined,
    };
    updateDerived(next);
    this.records.set(backendId, next);
    const diff = makeDiff(backendId, prev, next, 'channel_opened');
    return diff ? [diff] : [];
  }

  markChannelClosed(
    backendId: string,
    channelId: string,
    reason: string,
  ): BackendStateDiff[] {
    const prev = this.records.get(backendId);
    if (!prev) return [];
    // Ignore if channelId doesn't match
    if (prev.channelId !== channelId) return [];

    const next: BackendRuntimeRecord = {
      ...prev,
      channelId: null,
      channelEpoch: null,
      catalogInitialized: false,
      catalogEpoch: null,
      openState: 'closed' as BackendOpenState,
      lastClosureReason: reason,
      capabilities: [],
    };
    updateDerived(next);
    this.records.set(backendId, next);
    const diff = makeDiff(backendId, prev, next, reason);
    return diff ? [diff] : [];
  }

  markChannelRejected(backendId: string, reason: string): BackendStateDiff[] {
    const prev = this.records.get(backendId);
    if (!prev) return [];

    const next: BackendRuntimeRecord = {
      ...prev,
      channelId: null,
      channelEpoch: null,
      openState: 'error' as BackendOpenState,
      lastError: reason,
    };
    updateDerived(next);
    this.records.set(backendId, next);
    const diff = makeDiff(backendId, prev, next, reason);
    return diff ? [diff] : [];
  }

  // --------------------------------------------------------------------------
  // Catalog Operations
  // --------------------------------------------------------------------------

  markCatalogInitialized(backendId: string, epoch: number): BackendStateDiff[] {
    const prev = this.records.get(backendId);
    if (!prev) return [];

    const next: BackendRuntimeRecord = {
      ...prev,
      catalogInitialized: true,
      catalogEpoch: epoch,
    };
    updateDerived(next);
    this.records.set(backendId, next);
    const diff = makeDiff(backendId, prev, next, 'catalog_initialized');
    return diff ? [diff] : [];
  }

  markCatalogReset(backendId: string, epoch: number): BackendStateDiff[] {
    const prev = this.records.get(backendId);
    if (!prev) return [];

    const next: BackendRuntimeRecord = {
      ...prev,
      catalogInitialized: false,
      catalogEpoch: epoch,
    };
    updateDerived(next);
    this.records.set(backendId, next);
    const diff = makeDiff(backendId, prev, next, 'catalog_reset');
    return diff ? [diff] : [];
  }

  // --------------------------------------------------------------------------
  // Queries
  // --------------------------------------------------------------------------

  getBackend(backendId: string): BackendRuntimeRecord | undefined {
    return this.records.get(backendId);
  }

  getAllBackends(): BackendRuntimeRecord[] {
    return Array.from(this.records.values());
  }

  getRegistryRevision(): number {
    return this.registryRevision;
  }
}
