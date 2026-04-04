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
        registry: { items: [p1] },
        subscriptions: { backendIds: [] },
      });

      const b1 = store.getBackend('b1');
      expect(b1).toBeDefined();
      expect(b1!.runtimeState).toBe('visible');
      expect(b1!.openState).toBe('unsubscribed');
    });

    it('applies existing subscriptions from bootstrap', () => {
      const p1 = makePresence({ backendId: 'b1', epoch: 3 });
      store.applyBootstrap({
        capturedAt: Date.now(),
        connection: { state: 'connected' },
        identity: { instanceId: 'i1', deviceId: 'd1' },
        registry: { items: [p1] },
        subscriptions: { backendIds: ['b1'] },
      });

      const b1 = store.getBackend('b1');
      expect(b1!.subscribed).toBe(true);
      expect(b1!.openState).toBe('subscribed');
      // Not ready yet because catalog not initialized
      expect(b1!.runtimeState).toBe('subscribing');
    });
  });

  describe('applyRegistrySnapshot', () => {
    it('adds new backends', () => {
      const p1 = makePresence({ backendId: 'b1' });
      const diffs = store.applyRegistrySnapshot([p1]);

      expect(diffs).toHaveLength(1);
      expect(diffs[0].backendId).toBe('b1');
      expect(diffs[0].nextRuntimeState).toBe('visible');
    });

    it('removes backends not in snapshot', () => {
      store.applyRegistrySnapshot([makePresence({ backendId: 'b1' })]);
      const diffs = store.applyRegistrySnapshot([makePresence({ backendId: 'b2' })]);

      // b1 removed (offline), b2 added (visible)
      const b1Diff = diffs.find(d => d.backendId === 'b1');
      const b2Diff = diffs.find(d => d.backendId === 'b2');
      expect(b1Diff).toBeDefined();
      expect(b1Diff!.nextRuntimeState).toBe('offline');
      expect(b2Diff).toBeDefined();
      expect(b2Diff!.nextRuntimeState).toBe('visible');
    });

    it('handles epoch change by invalidating subscription and catalog', () => {
      store.applyRegistrySnapshot([makePresence({ backendId: 'b1', epoch: 1 })]);
      store.markSubscribed('b1', 1, ['cap1']);
      store.markDataInitialized('b1');

      const b1 = store.getBackend('b1');
      expect(b1!.runtimeState).toBe('ready');

      // Epoch changes
      const diffs = store.applyRegistrySnapshot([makePresence({ backendId: 'b1', epoch: 2 })]);
      const b1After = store.getBackend('b1');
      expect(b1After!.subscribed).toBe(false);
      expect(b1After!.dataInitialized).toBe(false);
      // openState transitions to 'error' because was subscribed when epoch changed
      expect(b1After!.openState).toBe('error');
      expect(b1After!.runtimeState).toBe('error');
    });
  });

  describe('applyRegistrySnapshot (upsert/remove equivalents)', () => {
    it('upserts a backend via snapshot', () => {
      const p1 = makePresence({ backendId: 'b1' });
      const diffs = store.applyRegistrySnapshot([p1]);

      expect(diffs).toHaveLength(1);
      expect(diffs[0].nextRuntimeState).toBe('visible');
    });

    it('removes a backend by omitting from snapshot', () => {
      store.applyRegistrySnapshot([makePresence({ backendId: 'b1' })]);
      const diffs = store.applyRegistrySnapshot([]);

      expect(diffs).toHaveLength(1);
      expect(diffs[0].nextRuntimeState).toBe('offline');
    });
  });

  describe('subscription operations', () => {
    beforeEach(() => {
      store.applyRegistrySnapshot([makePresence({ backendId: 'b1', epoch: 1 })]);
    });

    it('markSubscribing transitions to opening', () => {
      const diffs = store.markSubscribing('b1');
      expect(diffs).toHaveLength(1);
      expect(diffs[0].nextRuntimeState).toBe('subscribing');
      expect(store.getBackend('b1')!.openState).toBe('subscribing');
    });

    it('markSubscribed transitions openState to subscribed', () => {
      store.markSubscribing('b1');
      const diffs = store.markSubscribed('b1', 1, ['cap1']);

      const b = store.getBackend('b1')!;
      expect(b.openState).toBe('subscribed');
      expect(b.subscribed).toBe(true);
      expect(b.capabilities).toEqual(['cap1']);
      // Still opening because catalog not initialized
      expect(b.runtimeState).toBe('subscribing');
    });

    it('markDataInitialized transitions to ready when subscribed', () => {
      store.markSubscribed('b1', 1, []);
      const diffs = store.markDataInitialized('b1');

      const b = store.getBackend('b1')!;
      expect(b.runtimeState).toBe('ready');
      expect(b.dataInitialized).toBe(true);
    });

    it('markUnsubscribed resets subscription and catalog', () => {
      store.markSubscribed('b1', 1, []);
      store.markDataInitialized('b1');
      expect(store.getBackend('b1')!.runtimeState).toBe('ready');

      const diffs = store.markUnsubscribed('b1', 'disconnected');

      const b = store.getBackend('b1')!;
      expect(b.subscribed).toBe(false);
      expect(b.dataInitialized).toBe(false);
      expect(b.openState).toBe('unsubscribed');
      expect(b.runtimeState).toBe('visible');
    });
  });

  describe('catalog operations', () => {
    it('markDataReset clears catalog initialization', () => {
      store.applyRegistrySnapshot([makePresence({ backendId: 'b1', epoch: 1 })]);
      store.markSubscribed('b1', 1, []);
      store.markDataInitialized('b1');
      expect(store.getBackend('b1')!.runtimeState).toBe('ready');

      store.markDataReset('b1');
      expect(store.getBackend('b1')!.dataInitialized).toBe(false);
      expect(store.getBackend('b1')!.runtimeState).toBe('subscribing');
    });
  });

  describe('getAllBackends', () => {
    it('returns all records', () => {
      store.applyRegistrySnapshot([
        makePresence({ backendId: 'b1' }),
        makePresence({ backendId: 'b2' }),
      ]);
      expect(store.getAllBackends()).toHaveLength(2);
    });
  });
});
