import { describe, it, expect, beforeEach } from 'vitest';
import { FacadeRegistryStore } from '../registry-store.js';
import { makePresence } from './mock-adapter.js';

describe('FacadeRegistryStore', () => {
  let store: FacadeRegistryStore;

  beforeEach(() => {
    store = new FacadeRegistryStore();
  });

  describe('applyBootstrap', () => {
    it('initializes with registry items', () => {
      const p1 = makePresence({ backendId: 'b1' });
      store.applyBootstrap({
        capturedAt: Date.now(),
        connection: { state: 'connected' },
        identity: { instanceId: 'i1', deviceId: 'd1' },
        registry: { revision: 5, items: [p1] },
        channels: { items: [] },
      });

      const b1 = store.getBackend('b1');
      expect(b1).toBeDefined();
      expect(b1!.runtimeState).toBe('visible');
      expect(b1!.openState).toBe('closed');
      expect(store.getRegistryRevision()).toBe(5);
    });

    it('applies existing channels from bootstrap', () => {
      const p1 = makePresence({ backendId: 'b1', epoch: 3 });
      store.applyBootstrap({
        capturedAt: Date.now(),
        connection: { state: 'connected' },
        identity: { instanceId: 'i1', deviceId: 'd1' },
        registry: { revision: 1, items: [p1] },
        channels: { items: [{ backendId: 'b1', channelId: 'ch-1', epoch: 3 }] },
      });

      const b1 = store.getBackend('b1');
      expect(b1!.channelId).toBe('ch-1');
      expect(b1!.openState).toBe('open');
      // Not ready yet because catalog not initialized
      expect(b1!.runtimeState).toBe('opening');
    });
  });

  describe('applyRegistrySnapshot', () => {
    it('adds new backends', () => {
      const p1 = makePresence({ backendId: 'b1' });
      const diffs = store.applyRegistrySnapshot(1, [p1]);

      expect(diffs).toHaveLength(1);
      expect(diffs[0].backendId).toBe('b1');
      expect(diffs[0].nextRuntimeState).toBe('visible');
    });

    it('removes backends not in snapshot', () => {
      store.applyRegistrySnapshot(1, [makePresence({ backendId: 'b1' })]);
      const diffs = store.applyRegistrySnapshot(2, [makePresence({ backendId: 'b2' })]);

      // b1 removed (offline), b2 added (visible)
      const b1Diff = diffs.find(d => d.backendId === 'b1');
      const b2Diff = diffs.find(d => d.backendId === 'b2');
      expect(b1Diff).toBeDefined();
      expect(b1Diff!.nextRuntimeState).toBe('offline');
      expect(b2Diff).toBeDefined();
      expect(b2Diff!.nextRuntimeState).toBe('visible');
    });

    it('handles epoch change by invalidating channel and catalog', () => {
      store.applyRegistrySnapshot(1, [makePresence({ backendId: 'b1', epoch: 1 })]);
      store.markChannelOpened('b1', 'ch-1', 1, ['cap1']);
      store.markCatalogInitialized('b1', 1);

      const b1 = store.getBackend('b1');
      expect(b1!.runtimeState).toBe('ready');

      // Epoch changes
      const diffs = store.applyRegistrySnapshot(2, [makePresence({ backendId: 'b1', epoch: 2 })]);
      const b1After = store.getBackend('b1');
      expect(b1After!.channelId).toBeNull();
      expect(b1After!.catalogInitialized).toBe(false);
      // openState transitions to 'error' because channel was open when epoch changed
      expect(b1After!.openState).toBe('error');
      expect(b1After!.runtimeState).toBe('error');
    });
  });

  describe('applyRegistryEvent', () => {
    it('upserts a backend', () => {
      const p1 = makePresence({ backendId: 'b1' });
      const diffs = store.applyRegistryEvent(1, 'upsert', p1);

      expect(diffs).toHaveLength(1);
      expect(diffs[0].nextRuntimeState).toBe('visible');
    });

    it('removes a backend', () => {
      store.applyRegistrySnapshot(1, [makePresence({ backendId: 'b1' })]);
      const diffs = store.applyRegistryEvent(2, 'remove', undefined, 'b1');

      expect(diffs).toHaveLength(1);
      expect(diffs[0].nextRuntimeState).toBe('offline');
    });
  });

  describe('channel operations', () => {
    beforeEach(() => {
      store.applyRegistrySnapshot(1, [makePresence({ backendId: 'b1', epoch: 1 })]);
    });

    it('markChannelOpening transitions to opening', () => {
      const diffs = store.markChannelOpening('b1', 1);
      expect(diffs).toHaveLength(1);
      expect(diffs[0].nextRuntimeState).toBe('opening');
      expect(store.getBackend('b1')!.openState).toBe('opening');
    });

    it('markChannelOpened transitions openState to open', () => {
      store.markChannelOpening('b1', 1);
      const diffs = store.markChannelOpened('b1', 'ch-1', 1, ['cap1']);

      const b = store.getBackend('b1')!;
      expect(b.openState).toBe('open');
      expect(b.channelId).toBe('ch-1');
      expect(b.capabilities).toEqual(['cap1']);
      // Still opening because catalog not initialized
      expect(b.runtimeState).toBe('opening');
    });

    it('markCatalogInitialized transitions to ready when epoch aligned', () => {
      store.markChannelOpened('b1', 'ch-1', 1, []);
      const diffs = store.markCatalogInitialized('b1', 1);

      const b = store.getBackend('b1')!;
      expect(b.runtimeState).toBe('ready');
      expect(b.catalogInitialized).toBe(true);
    });

    it('does not reach ready if epoch misaligned', () => {
      store.markChannelOpened('b1', 'ch-1', 1, []);
      store.markCatalogInitialized('b1', 2); // different epoch

      const b = store.getBackend('b1')!;
      expect(b.runtimeState).toBe('opening'); // not ready
    });

    it('markChannelClosed resets channel and catalog', () => {
      store.markChannelOpened('b1', 'ch-1', 1, []);
      store.markCatalogInitialized('b1', 1);
      expect(store.getBackend('b1')!.runtimeState).toBe('ready');

      const diffs = store.markChannelClosed('b1', 'ch-1', 'disconnected');

      const b = store.getBackend('b1')!;
      expect(b.channelId).toBeNull();
      expect(b.catalogInitialized).toBe(false);
      expect(b.openState).toBe('closed');
      expect(b.runtimeState).toBe('visible');
    });

    it('markChannelClosed ignores mismatched channelId', () => {
      store.markChannelOpened('b1', 'ch-1', 1, []);
      const diffs = store.markChannelClosed('b1', 'ch-wrong', 'stale');
      expect(diffs).toHaveLength(0);
    });

    it('markChannelRejected transitions to error', () => {
      store.markChannelOpening('b1', 1);
      const diffs = store.markChannelRejected('b1', 'auth_failed');

      const b = store.getBackend('b1')!;
      expect(b.openState).toBe('error');
      expect(b.runtimeState).toBe('error');
      expect(b.lastError).toBe('auth_failed');
    });
  });

  describe('catalog operations', () => {
    it('markCatalogReset clears catalog initialization', () => {
      store.applyRegistrySnapshot(1, [makePresence({ backendId: 'b1', epoch: 1 })]);
      store.markChannelOpened('b1', 'ch-1', 1, []);
      store.markCatalogInitialized('b1', 1);
      expect(store.getBackend('b1')!.runtimeState).toBe('ready');

      store.markCatalogReset('b1', 1);
      expect(store.getBackend('b1')!.catalogInitialized).toBe(false);
      expect(store.getBackend('b1')!.runtimeState).toBe('opening');
    });
  });

  describe('getAllBackends', () => {
    it('returns all records', () => {
      store.applyRegistrySnapshot(1, [
        makePresence({ backendId: 'b1' }),
        makePresence({ backendId: 'b2' }),
      ]);
      expect(store.getAllBackends()).toHaveLength(2);
    });
  });
});
