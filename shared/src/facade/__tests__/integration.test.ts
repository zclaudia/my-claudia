/**
 * Integration Tests — BackendFacadeRuntimeCore end-to-end flows
 *
 * Tests complete scenarios that exercise RuntimeCore + RegistryStore +
 * StreamManager + snapshot assembly working together through realistic
 * event sequences.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BackendFacadeRuntimeCore } from '../runtime-core.js';
import type { BackendFacadeEvent, BackendFacadeSnapshot } from '../types.js';
import { createMockAdapter, makePresence } from './mock-adapter.js';
import type { CommandLog } from './mock-adapter.js';

describe('Integration: full backend lifecycle', () => {
  let core: BackendFacadeRuntimeCore;
  let emit: ReturnType<typeof createMockAdapter>['emit'];
  let commandLog: CommandLog[];
  let events: BackendFacadeEvent[];

  beforeEach(() => {
    const mock = createMockAdapter({
      instanceId: 'local-inst',
      registryItems: [
        makePresence({ backendId: 'remote-1', instanceId: 'remote-inst', epoch: 1 }),
      ],
    });
    emit = mock.emit;
    commandLog = mock.commandLog;
    events = [];

    core = new BackendFacadeRuntimeCore({
      adapter: mock.adapter,
      mode: 'embedded',
      localBackendMatcher: (p, id) => p.instanceId === id.instanceId,
    });
    core.onEvent(e => events.push(e));
    core.start();
    commandLog.length = 0;
    events = [];
  });

  it('open backend → channel → catalog → ready → stream → content → close', () => {
    // 1. Open backend
    core.openBackend('remote-1');
    expect(commandLog.some(c => c.method === 'channel.openBackendChannel')).toBe(true);
    commandLog.length = 0;

    // 2. Channel opened
    emit({
      type: 'backend_channel_opened',
      backendId: 'remote-1',
      channelId: 'ch-r1',
      epoch: 1,
      capabilities: ['run', 'mcp'],
    });

    // Should auto-subscribe catalog
    expect(commandLog.some(c => c.method === 'catalog.subscribe')).toBe(true);

    // Backend should be in 'opening' state (channel open but catalog not yet)
    let snap = core.getSnapshot();
    let b = snap.backends.find(b => b.backendId === 'remote-1')!;
    expect(b.openState).toBe('open');
    expect(b.runtimeState).toBe('opening');
    expect(b.capabilities).toEqual(['run', 'mcp']);
    commandLog.length = 0;

    // 3. Catalog snapshot received → backend becomes ready
    emit({
      type: 'catalog_snapshot_received',
      backendId: 'remote-1',
      epoch: 1,
      revision: 1,
      items: [
        { sessionId: 's1', createdAt: 1000, updatedAt: 2000 },
        { sessionId: 's2', title: 'Test', createdAt: 1000, updatedAt: 3000 },
      ],
    });

    snap = core.getSnapshot();
    b = snap.backends.find(b => b.backendId === 'remote-1')!;
    expect(b.runtimeState).toBe('ready');

    // Should have catalog_snapshot event
    expect(events.some(e => e.type === 'catalog_snapshot')).toBe(true);
    events = [];
    commandLog.length = 0;

    // 4. Open session stream
    core.openSessionStream('remote-1', 's1');
    expect(commandLog.some(c => c.method === 'stream.open')).toBe(true);

    snap = core.getSnapshot();
    const stream = Object.values(snap.sessionStreams).find(s => s.sessionId === 's1');
    expect(stream).toBeDefined();
    expect(stream!.state).toBe('opening');
    commandLog.length = 0;

    // 5. Content patch received → stream becomes open
    emit({
      type: 'content_patch_received',
      backendId: 'remote-1',
      channelId: 'ch-r1',
      sessionId: 's1',
      messages: [
        { messageId: 'm1', sessionId: 's1', offset: 1, role: 'user', createdAt: 1000, content: 'hello' },
        { messageId: 'm2', sessionId: 's1', offset: 2, role: 'assistant', createdAt: 1001, content: 'hi' },
      ],
      latestOffset: 2,
    });

    snap = core.getSnapshot();
    const openStream = Object.values(snap.sessionStreams).find(s => s.sessionId === 's1');
    expect(openStream!.state).toBe('open');
    expect(openStream!.latestOffset).toBe(2);
    expect(events.some(e => e.type === 'content_patch')).toBe(true);
    events = [];

    // 6. Run event
    emit({
      type: 'run_event_received',
      backendId: 'remote-1',
      channelId: 'ch-r1',
      sessionId: 's1',
      event: { type: 'run_started', runId: 'r1', sessionId: 's1' } as any,
    });
    expect(events.some(e => e.type === 'run_event')).toBe(true);
    events = [];

    // 7. Close session stream
    core.closeSessionStream('remote-1', 's1');
    expect(commandLog.some(c => c.method === 'stream.close')).toBe(true);

    snap = core.getSnapshot();
    const closedStream = Object.values(snap.sessionStreams).find(s => s.sessionId === 's1');
    expect(closedStream!.state).toBe('closed');
    commandLog.length = 0;

    // 8. Close backend
    core.closeBackend('remote-1');
    expect(commandLog.some(c => c.method === 'channel.closeBackendChannel')).toBe(true);

    snap = core.getSnapshot();
    b = snap.backends.find(b => b.backendId === 'remote-1')!;
    expect(b.openState).toBe('closed');
    expect(b.runtimeState).toBe('visible');
  });
});

describe('Integration: backend disconnect and auto-resume', () => {
  let core: BackendFacadeRuntimeCore;
  let emit: ReturnType<typeof createMockAdapter>['emit'];
  let commandLog: CommandLog[];
  let events: BackendFacadeEvent[];

  beforeEach(() => {
    const mock = createMockAdapter({
      registryItems: [
        makePresence({ backendId: 'b1', epoch: 1 }),
      ],
    });
    emit = mock.emit;
    commandLog = mock.commandLog;
    events = [];

    core = new BackendFacadeRuntimeCore({
      adapter: mock.adapter,
      mode: 'direct',
    });
    core.onEvent(e => events.push(e));
    core.start();

    // Bring backend to ready state
    core.openBackend('b1');
    emit({ type: 'backend_channel_opened', backendId: 'b1', channelId: 'ch-1', epoch: 1, capabilities: [] });
    emit({ type: 'catalog_snapshot_received', backendId: 'b1', epoch: 1, revision: 1, items: [] });

    // Open a session stream
    core.openSessionStream('b1', 's1');
    emit({ type: 'content_patch_received', backendId: 'b1', channelId: 'ch-1', sessionId: 's1', messages: [], latestOffset: 0 });

    commandLog.length = 0;
    events = [];
  });

  it('auto-resumes streams after backend reconnect', () => {
    // Backend disconnects
    emit({
      type: 'backend_channel_closed',
      backendId: 'b1',
      channelId: 'ch-1',
      reason: 'peer_disconnected',
    });

    // Stream should be in 'opening' (willAutoRecover=true because presence still exists)
    let snap = core.getSnapshot();
    let stream = Object.values(snap.sessionStreams).find(s => s.sessionId === 's1');
    expect(stream!.state).toBe('opening');

    // Backend should be visible (presence still in registry)
    let b = snap.backends.find(b => b.backendId === 'b1')!;
    expect(b.runtimeState).toBe('visible');
    expect(b.openState).toBe('closed');
    commandLog.length = 0;

    // Backend reconnects with new channel
    emit({ type: 'backend_channel_opened', backendId: 'b1', channelId: 'ch-2', epoch: 1, capabilities: [] });
    emit({ type: 'catalog_snapshot_received', backendId: 'b1', epoch: 1, revision: 2, items: [] });

    // Backend should be ready again
    snap = core.getSnapshot();
    b = snap.backends.find(b => b.backendId === 'b1')!;
    expect(b.runtimeState).toBe('ready');

    // Stream should have been auto-resumed (stream.open command sent)
    expect(commandLog.some(c => c.method === 'stream.open')).toBe(true);
  });

  it('does not resume closed streams after reconnect', () => {
    // Close the stream first
    core.closeSessionStream('b1', 's1');
    commandLog.length = 0;

    // Backend disconnects
    emit({ type: 'backend_channel_closed', backendId: 'b1', channelId: 'ch-1', reason: 'peer_disconnected' });

    // Backend reconnects
    emit({ type: 'backend_channel_opened', backendId: 'b1', channelId: 'ch-2', epoch: 1, capabilities: [] });
    emit({ type: 'catalog_snapshot_received', backendId: 'b1', epoch: 1, revision: 2, items: [] });

    // Stream should NOT be auto-resumed
    expect(commandLog.filter(c => c.method === 'stream.open')).toHaveLength(0);
  });
});

describe('Integration: multi-backend multi-session', () => {
  let core: BackendFacadeRuntimeCore;
  let emit: ReturnType<typeof createMockAdapter>['emit'];
  let commandLog: CommandLog[];

  beforeEach(() => {
    const mock = createMockAdapter({
      registryItems: [
        makePresence({ backendId: 'b1', epoch: 1 }),
        makePresence({ backendId: 'b2', epoch: 1 }),
      ],
    });
    emit = mock.emit;
    commandLog = mock.commandLog;

    core = new BackendFacadeRuntimeCore({
      adapter: mock.adapter,
      mode: 'direct',
    });
    core.start();
    commandLog.length = 0;
  });

  it('supports concurrent streams across multiple backends', () => {
    // Open both backends
    core.openBackend('b1');
    core.openBackend('b2');
    emit({ type: 'backend_channel_opened', backendId: 'b1', channelId: 'ch-1', epoch: 1, capabilities: [] });
    emit({ type: 'backend_channel_opened', backendId: 'b2', channelId: 'ch-2', epoch: 1, capabilities: [] });
    emit({ type: 'catalog_snapshot_received', backendId: 'b1', epoch: 1, revision: 1, items: [] });
    emit({ type: 'catalog_snapshot_received', backendId: 'b2', epoch: 1, revision: 1, items: [] });

    // Open streams on different backends
    core.openSessionStream('b1', 'session-a');
    core.openSessionStream('b1', 'session-b');
    core.openSessionStream('b2', 'session-c');

    const snap = core.getSnapshot();
    expect(Object.keys(snap.sessionStreams)).toHaveLength(3);
    expect(snap.backends.filter(b => b.runtimeState === 'ready')).toHaveLength(2);
  });

  it('backend 1 disconnect does not affect backend 2 streams', () => {
    // Setup both backends to ready
    core.openBackend('b1');
    core.openBackend('b2');
    emit({ type: 'backend_channel_opened', backendId: 'b1', channelId: 'ch-1', epoch: 1, capabilities: [] });
    emit({ type: 'backend_channel_opened', backendId: 'b2', channelId: 'ch-2', epoch: 1, capabilities: [] });
    emit({ type: 'catalog_snapshot_received', backendId: 'b1', epoch: 1, revision: 1, items: [] });
    emit({ type: 'catalog_snapshot_received', backendId: 'b2', epoch: 1, revision: 1, items: [] });

    core.openSessionStream('b1', 's1');
    core.openSessionStream('b2', 's2');

    // Promote both to open
    emit({ type: 'content_patch_received', backendId: 'b1', channelId: 'ch-1', sessionId: 's1', messages: [], latestOffset: 0 });
    emit({ type: 'content_patch_received', backendId: 'b2', channelId: 'ch-2', sessionId: 's2', messages: [], latestOffset: 0 });

    // b1 disconnects
    emit({ type: 'backend_channel_closed', backendId: 'b1', channelId: 'ch-1', reason: 'disconnected' });

    const snap = core.getSnapshot();

    // b1 stream should be in opening (auto-resume pending)
    const s1 = Object.values(snap.sessionStreams).find(s => s.sessionId === 's1');
    expect(s1!.state).toBe('opening');

    // b2 stream should still be open
    const s2 = Object.values(snap.sessionStreams).find(s => s.sessionId === 's2');
    expect(s2!.state).toBe('open');

    // b2 backend should still be ready
    const b2 = snap.backends.find(b => b.backendId === 'b2')!;
    expect(b2.runtimeState).toBe('ready');
  });
});

describe('Integration: local backend identification', () => {
  it('identifies local backend in embedded mode', () => {
    const mock = createMockAdapter({
      instanceId: 'my-inst',
      registryItems: [
        makePresence({ backendId: 'local-b', instanceId: 'my-inst' }),
        makePresence({ backendId: 'remote-b', instanceId: 'other-inst' }),
      ],
    });

    const core = new BackendFacadeRuntimeCore({
      adapter: mock.adapter,
      mode: 'embedded',
      localBackendMatcher: (p, id) => p.instanceId === id.instanceId,
    });
    core.start();

    const snap = core.getSnapshot();
    expect(snap.localBackendId).toBe('local-b');
    expect(snap.backends.find(b => b.backendId === 'local-b')!.isThisInstance).toBe(true);
    expect(snap.backends.find(b => b.backendId === 'remote-b')!.isThisInstance).toBe(false);
  });

  it('has no local backend in direct mode', () => {
    const mock = createMockAdapter({
      registryItems: [
        makePresence({ backendId: 'b1' }),
      ],
    });

    const core = new BackendFacadeRuntimeCore({
      adapter: mock.adapter,
      mode: 'direct',
      // No localBackendMatcher
    });
    core.start();

    const snap = core.getSnapshot();
    expect(snap.localBackendId).toBeNull();
  });
});

describe('Integration: epoch change invalidation', () => {
  let core: BackendFacadeRuntimeCore;
  let emit: ReturnType<typeof createMockAdapter>['emit'];

  beforeEach(() => {
    const mock = createMockAdapter({
      registryItems: [makePresence({ backendId: 'b1', epoch: 1 })],
    });
    emit = mock.emit;

    core = new BackendFacadeRuntimeCore({
      adapter: mock.adapter,
      mode: 'direct',
    });
    core.start();

    // Bring to ready
    core.openBackend('b1');
    emit({ type: 'backend_channel_opened', backendId: 'b1', channelId: 'ch-1', epoch: 1, capabilities: [] });
    emit({ type: 'catalog_snapshot_received', backendId: 'b1', epoch: 1, revision: 1, items: [] });
    core.openSessionStream('b1', 's1');
    emit({ type: 'content_patch_received', backendId: 'b1', channelId: 'ch-1', sessionId: 's1', messages: [], latestOffset: 0 });
  });

  it('invalidates channel and catalog on epoch change', () => {
    let snap = core.getSnapshot();
    expect(snap.backends.find(b => b.backendId === 'b1')!.runtimeState).toBe('ready');

    // Registry event with new epoch
    emit({
      type: 'registry_event_received',
      revision: 2,
      op: 'upsert',
      item: makePresence({ backendId: 'b1', epoch: 2 }),
    });

    snap = core.getSnapshot();
    const b = snap.backends.find(b => b.backendId === 'b1')!;
    // Channel and catalog should be invalidated
    expect(b.channelId).toBeNull();
    // Backend was desired (openBackend called in beforeEach), so auto-reopen
    // triggers immediately after epoch invalidation → state is 'opening'
    expect(b.runtimeState).toBe('opening');
  });

  it('auto-reopens desired backend after epoch change via registry event', () => {
    // b1 is ready and in desiredOpenBackends (openBackend was called in beforeEach)
    expect(core.getSnapshot().backends.find(b => b.backendId === 'b1')!.runtimeState).toBe('ready');

    // Backend restarts → new epoch arrives via incremental registry event
    emit({
      type: 'registry_event_received',
      revision: 2,
      op: 'upsert',
      item: makePresence({ backendId: 'b1', epoch: 2 }),
    });

    // Should be in error momentarily, but auto-reopen triggers openBackend
    // which sends channel.openBackendChannel command
    const snap = core.getSnapshot();
    const b = snap.backends.find(b => b.backendId === 'b1')!;
    // The backend should be in 'opening' state (auto-reopen triggered)
    expect(b.runtimeState).toBe('opening');
  });

  it('auto-reopens desired backend after epoch change via registry snapshot', () => {
    expect(core.getSnapshot().backends.find(b => b.backendId === 'b1')!.runtimeState).toBe('ready');

    // Full registry snapshot with new epoch (e.g. gateway reconnect after backend restart)
    emit({
      type: 'registry_snapshot_received',
      revision: 3,
      items: [makePresence({ backendId: 'b1', epoch: 2 })],
    });

    const snap = core.getSnapshot();
    const b = snap.backends.find(b => b.backendId === 'b1')!;
    // reopenDesiredBackends should trigger since openState is 'error' and b1 is desired
    expect(b.runtimeState).toBe('opening');
  });
});

describe('Integration: backend offline → online recovery', () => {
  let core: BackendFacadeRuntimeCore;
  let emit: ReturnType<typeof createMockAdapter>['emit'];
  let commandLog: CommandLog[];

  beforeEach(() => {
    const mock = createMockAdapter({
      registryItems: [makePresence({ backendId: 'b1', epoch: 1 })],
    });
    emit = mock.emit;
    commandLog = mock.commandLog;

    core = new BackendFacadeRuntimeCore({
      adapter: mock.adapter,
      mode: 'direct',
    });
    core.start();

    // Bring to ready
    core.openBackend('b1');
    emit({ type: 'backend_channel_opened', backendId: 'b1', channelId: 'ch-1', epoch: 1, capabilities: [] });
    emit({ type: 'catalog_snapshot_received', backendId: 'b1', epoch: 1, revision: 1, items: [] });
    commandLog.length = 0;
  });

  it('recovers when backend goes offline then comes back online', () => {
    // Backend removed from registry
    emit({
      type: 'registry_event_received',
      revision: 2,
      op: 'remove',
      backendId: 'b1',
    });

    let snap = core.getSnapshot();
    // Offline backends (presence=null) are excluded from the snapshot
    expect(snap.backends.find(b => b.backendId === 'b1')).toBeUndefined();
    commandLog.length = 0;

    // Backend comes back with new epoch
    emit({
      type: 'registry_event_received',
      revision: 3,
      op: 'upsert',
      item: makePresence({ backendId: 'b1', epoch: 2 }),
    });

    snap = core.getSnapshot();
    const b = snap.backends.find(b => b.backendId === 'b1')!;
    // Should auto-reopen since b1 is in desiredOpenBackends
    expect(b.runtimeState).toBe('opening');
    expect(commandLog.some(c => c.method === 'channel.openBackendChannel')).toBe(true);
  });
});

describe('Integration: GC cleanup', () => {
  it('cleans up ephemeral streams after TTL', () => {
    const mock = createMockAdapter({
      registryItems: [makePresence({ backendId: 'b1', epoch: 1 })],
    });

    const core = new BackendFacadeRuntimeCore({
      adapter: mock.adapter,
      mode: 'direct',
    });
    core.start();

    // Bring to ready
    core.openBackend('b1');
    mock.emit({ type: 'backend_channel_opened', backendId: 'b1', channelId: 'ch-1', epoch: 1, capabilities: [] });
    mock.emit({ type: 'catalog_snapshot_received', backendId: 'b1', epoch: 1, revision: 1, items: [] });

    // Receive a run event for an unknown session → creates ephemeral stream
    mock.emit({
      type: 'run_event_received',
      backendId: 'b1',
      channelId: 'ch-1',
      sessionId: 'ephemeral-s',
      event: { type: 'run_delta' } as any,
    });

    let snap = core.getSnapshot();
    expect(Object.values(snap.sessionStreams).some(s => s.sessionId === 'ephemeral-s')).toBe(true);

    // Close the stream by backend disconnect
    mock.emit({ type: 'backend_channel_closed', backendId: 'b1', channelId: 'ch-1', reason: 'gone' });

    // GC with future time (past ephemeral TTL)
    core.collectGarbage(Date.now() + 5 * 60_000);

    snap = core.getSnapshot();
    expect(Object.values(snap.sessionStreams).some(s => s.sessionId === 'ephemeral-s')).toBe(false);
  });
});
