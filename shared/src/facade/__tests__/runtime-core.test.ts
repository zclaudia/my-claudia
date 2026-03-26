import { describe, it, expect, beforeEach } from 'vitest';
import { BackendFacadeRuntimeCore } from '../runtime-core.js';
import type { BackendFacadeEvent, BackendFacadeSnapshot } from '../types.js';
import { createMockAdapter, makePresence } from './mock-adapter.js';

describe('BackendFacadeRuntimeCore', () => {
  let core: BackendFacadeRuntimeCore;
  let emit: ReturnType<typeof createMockAdapter>['emit'];
  let commandLog: ReturnType<typeof createMockAdapter>['commandLog'];
  let events: BackendFacadeEvent[];
  let snapshots: BackendFacadeSnapshot[];

  function setup(options?: Parameters<typeof createMockAdapter>[0]) {
    const mock = createMockAdapter(options);
    emit = mock.emit;
    commandLog = mock.commandLog;
    events = [];
    snapshots = [];

    core = new BackendFacadeRuntimeCore({
      adapter: mock.adapter,
      mode: 'embedded',
      localBackendMatcher: (presence, identity) =>
        presence.instanceId === identity.instanceId,
    });

    core.onEvent(e => events.push(e));
    core.subscribe(s => snapshots.push(s));
  }

  describe('bootstrap', () => {
    it('emits initial snapshot on start', () => {
      setup({ registryItems: [makePresence({ backendId: 'b1' })] });
      core.start();

      // Should have emitted snapshot_updated event
      const snapshotEvent = events.find(e => e.type === 'snapshot_updated');
      expect(snapshotEvent).toBeDefined();

      const snapshot = core.getSnapshot();
      expect(snapshot.mode).toBe('embedded');
      expect(snapshot.connectionState).toBe('connected');
      expect(snapshot.backends).toHaveLength(1);
      expect(snapshot.backends[0].backendId).toBe('b1');
      expect(snapshot.backends[0].runtimeState).toBe('visible');
    });

    it('identifies local backend via localBackendMatcher', () => {
      setup({
        instanceId: 'inst-1',
        registryItems: [
          makePresence({ backendId: 'b-local', instanceId: 'inst-1' }),
          makePresence({ backendId: 'b-remote', instanceId: 'inst-2' }),
        ],
      });
      core.start();

      const snapshot = core.getSnapshot();
      expect(snapshot.localBackendId).toBe('b-local');
      expect(snapshot.backends.find(b => b.backendId === 'b-local')!.isThisInstance).toBe(true);
      expect(snapshot.backends.find(b => b.backendId === 'b-remote')!.isThisInstance).toBe(false);
    });

    it('replays buffered events after bootstrap', () => {
      const mock = createMockAdapter({ registryItems: [] });
      emit = mock.emit;
      commandLog = mock.commandLog;
      events = [];

      core = new BackendFacadeRuntimeCore({
        adapter: mock.adapter,
        mode: 'direct',
      });
      core.onEvent(e => events.push(e));

      // Start will subscribe to events, then bootstrap. Any events that arrive
      // between subscribe and initialized=true should be buffered and replayed.
      core.start();

      // After start, emit a registry event
      emit({
        type: 'registry_snapshot_received',
        revision: 2,
        items: [makePresence({ backendId: 'b-new' })],
      });

      const snapshot = core.getSnapshot();
      expect(snapshot.backends.some(b => b.backendId === 'b-new')).toBe(true);
    });
  });

  describe('registry events', () => {
    beforeEach(() => {
      setup({ registryItems: [makePresence({ backendId: 'b1' })] });
      core.start();
      events = []; // clear bootstrap events
    });

    it('handles registry_snapshot_received', () => {
      emit({
        type: 'registry_snapshot_received',
        revision: 2,
        items: [
          makePresence({ backendId: 'b1' }),
          makePresence({ backendId: 'b2' }),
        ],
      });

      const snapshot = core.getSnapshot();
      expect(snapshot.backends).toHaveLength(2);
    });

    it('handles registry_event_received upsert', () => {
      emit({
        type: 'registry_event_received',
        revision: 2,
        op: 'upsert',
        item: makePresence({ backendId: 'b2' }),
      });

      const snapshot = core.getSnapshot();
      expect(snapshot.backends.some(b => b.backendId === 'b2')).toBe(true);
    });

    it('handles registry_event_received remove', () => {
      emit({
        type: 'registry_event_received',
        revision: 2,
        op: 'remove',
        backendId: 'b1',
      });

      const snapshot = core.getSnapshot();
      // Removed backend has presence=null, filtered from snapshot
      expect(snapshot.backends.some(b => b.backendId === 'b1')).toBe(false);
    });
  });

  describe('backend open/close', () => {
    beforeEach(() => {
      setup({ registryItems: [makePresence({ backendId: 'b1', epoch: 1 })] });
      core.start();
      commandLog.length = 0;
      events = [];
    });

    it('openBackend sends channel open command', () => {
      core.openBackend('b1');

      expect(commandLog).toHaveLength(1);
      expect(commandLog[0].method).toBe('channel.openBackendChannel');
      expect(commandLog[0].args).toEqual(['b1', 1]);
    });

    it('full channel lifecycle: open → catalog → ready', () => {
      core.openBackend('b1');

      // Gateway responds with channel opened
      emit({
        type: 'backend_channel_opened',
        backendId: 'b1',
        channelId: 'ch-1',
        epoch: 1,
        capabilities: ['run'],
      });

      // Should auto-subscribe to catalog
      const catalogSub = commandLog.find(c => c.method === 'catalog.subscribe');
      expect(catalogSub).toBeDefined();

      // Gateway sends catalog snapshot
      emit({
        type: 'catalog_snapshot_received',
        backendId: 'b1',
        epoch: 1,
        revision: 1,
        items: [{ sessionId: 's1', createdAt: Date.now(), updatedAt: Date.now() }],
      });

      const snapshot = core.getSnapshot();
      const b1 = snapshot.backends.find(b => b.backendId === 'b1')!;
      expect(b1.runtimeState).toBe('ready');
      expect(b1.openState).toBe('open');

      // Catalog snapshot event should have been emitted
      expect(events.some(e => e.type === 'catalog_snapshot')).toBe(true);
    });

    it('closeBackend sends close command and resets state', () => {
      core.openBackend('b1');
      emit({
        type: 'backend_channel_opened',
        backendId: 'b1',
        channelId: 'ch-1',
        epoch: 1,
        capabilities: [],
      });

      commandLog.length = 0;
      core.closeBackend('b1');

      expect(commandLog.some(c => c.method === 'channel.closeBackendChannel')).toBe(true);
      const b1 = core.getSnapshot().backends.find(b => b.backendId === 'b1')!;
      expect(b1.openState).toBe('closed');
    });
  });

  describe('session streams', () => {
    beforeEach(() => {
      setup({ registryItems: [makePresence({ backendId: 'b1', epoch: 1 })] });
      core.start();

      // Open backend to ready state
      core.openBackend('b1');
      emit({
        type: 'backend_channel_opened',
        backendId: 'b1',
        channelId: 'ch-1',
        epoch: 1,
        capabilities: [],
      });
      emit({
        type: 'catalog_snapshot_received',
        backendId: 'b1',
        epoch: 1,
        revision: 1,
        items: [],
      });

      commandLog.length = 0;
      events = [];
    });

    it('openSessionStream sends stream open command', () => {
      core.openSessionStream('b1', 's1');

      expect(commandLog.some(c => c.method === 'stream.open')).toBe(true);
    });

    it('content_patch promotes stream and emits event', () => {
      core.openSessionStream('b1', 's1');

      emit({
        type: 'content_patch_received',
        backendId: 'b1',
        channelId: 'ch-1',
        sessionId: 's1',
        messages: [],
        latestOffset: 5,
      });

      expect(events.some(e => e.type === 'content_patch')).toBe(true);
      const snapshot = core.getSnapshot();
      const stream = Object.values(snapshot.sessionStreams).find(s => s.sessionId === 's1');
      expect(stream).toBeDefined();
      expect(stream!.state).toBe('open');
    });

    it('run_event emits through facade', () => {
      core.openSessionStream('b1', 's1');

      emit({
        type: 'run_event_received',
        backendId: 'b1',
        channelId: 'ch-1',
        sessionId: 's1',
        event: { type: 'run_started' } as any,
      });

      expect(events.some(e => e.type === 'run_event')).toBe(true);
    });

    it('auto-resumes streams when backend becomes ready again', () => {
      core.openSessionStream('b1', 's1');

      // Backend loses channel
      emit({
        type: 'backend_channel_closed',
        backendId: 'b1',
        channelId: 'ch-1',
        reason: 'disconnected',
      });

      commandLog.length = 0;

      // Backend comes back
      emit({
        type: 'backend_channel_opened',
        backendId: 'b1',
        channelId: 'ch-2',
        epoch: 1,
        capabilities: [],
      });
      emit({
        type: 'catalog_snapshot_received',
        backendId: 'b1',
        epoch: 1,
        revision: 2,
        items: [],
      });

      // Stream should auto-resume
      expect(commandLog.some(c => c.method === 'stream.open')).toBe(true);
    });
  });

  describe('sendToBackend', () => {
    it('sends message to backend via adapter', () => {
      setup({ registryItems: [makePresence({ backendId: 'b1', epoch: 1 })] });
      core.start();
      core.openBackend('b1');
      emit({
        type: 'backend_channel_opened',
        backendId: 'b1',
        channelId: 'ch-1',
        epoch: 1,
        capabilities: [],
      });

      commandLog.length = 0;
      core.sendToBackend('b1', { type: 'test' } as any);

      expect(commandLog).toHaveLength(1);
      expect(commandLog[0].method).toBe('channel.sendToBackend');
      expect(commandLog[0].args[0]).toBe('ch-1');
    });
  });

  describe('HTTP', () => {
    it('delegates to adapter queries', () => {
      setup();
      core.start();

      expect(core.getHttpBaseUrl('b1')).toBe('http://mock/b1');
      expect(core.getHttpHeaders()).toEqual({ 'x-mock': 'true' });
    });
  });

  describe('stop', () => {
    it('unsubscribes from adapter and sets disconnected', () => {
      setup();
      core.start();
      core.stop();

      // Emitting events after stop should not cause errors
      emit({
        type: 'registry_snapshot_received',
        revision: 99,
        items: [],
      });

      // No crash — adapter listener was removed
    });
  });

  describe('collectGarbage', () => {
    it('can be called externally', () => {
      setup();
      core.start();

      // Should not throw
      core.collectGarbage(Date.now() + 60 * 60_000);
    });
  });
});
