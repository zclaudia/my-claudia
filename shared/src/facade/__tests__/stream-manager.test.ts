import { describe, it, expect, beforeEach } from 'vitest';
import { FacadeStreamManager } from '../stream-manager.js';

describe('FacadeStreamManager', () => {
  let mgr: FacadeStreamManager;

  beforeEach(() => {
    mgr = new FacadeStreamManager();
    mgr.applyBootstrap();
  });

  describe('requestOpen', () => {
    it('creates desired+runtime state and returns open command when backend ready', () => {
      const result = mgr.requestOpen('b1', 's1', {
        backendReady: true,
        channelId: 'ch-1',
      });

      expect(result.commands).toHaveLength(1);
      expect(result.commands[0]).toEqual({
        type: 'open_session_stream',
        backendId: 'b1',
        channelId: 'ch-1',
        sessionId: 's1',
      });

      const stream = mgr.getStream('b1', 's1');
      expect(stream).toBeDefined();
      expect(stream!.state).toBe('opening');
    });

    it('creates desired state but no command when backend not ready', () => {
      const result = mgr.requestOpen('b1', 's1', {
        backendReady: false,
        channelId: null,
      });

      expect(result.commands).toHaveLength(0);
      expect(result.events).toHaveLength(1);

      const stream = mgr.getStream('b1', 's1');
      expect(stream!.state).toBe('opening');
    });

    it('is idempotent when already open', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true, channelId: 'ch-1' });
      // Simulate stream becoming open via content patch
      mgr.handleContentPatch('b1', 'ch-1', 's1', [], 0);

      const stream = mgr.getStream('b1', 's1');
      expect(stream!.state).toBe('open');

      const result = mgr.requestOpen('b1', 's1', { backendReady: true, channelId: 'ch-1' });
      expect(result.commands).toHaveLength(0); // no duplicate command
    });
  });

  describe('requestClose', () => {
    it('closes an open stream and returns close command', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true, channelId: 'ch-1' });

      const result = mgr.requestClose('b1', 's1', { channelId: 'ch-1' });

      expect(result.commands).toHaveLength(1);
      expect(result.commands[0].type).toBe('close_session_stream');

      const stream = mgr.getStream('b1', 's1');
      expect(stream!.state).toBe('closed');
      expect(stream!.channelId).toBeNull();
    });

    it('is a no-op for already closed stream', () => {
      const result = mgr.requestClose('b1', 's1', { channelId: null });
      expect(result.commands).toHaveLength(0);
      expect(result.events).toHaveLength(0);
    });
  });

  describe('handleBackendBecameReady', () => {
    it('auto-resumes streams with shouldBeOpen=true', () => {
      // Open a stream when backend is not ready
      mgr.requestOpen('b1', 's1', { backendReady: false, channelId: null });
      mgr.requestOpen('b1', 's2', { backendReady: false, channelId: null });

      // Backend becomes ready
      const result = mgr.handleBackendBecameReady('b1', 'ch-1');

      expect(result.commands).toHaveLength(2);
      expect(result.commands[0].type).toBe('open_session_stream');
      expect(result.commands[1].type).toBe('open_session_stream');
    });

    it('does not resume already open streams', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true, channelId: 'ch-1' });
      mgr.handleContentPatch('b1', 'ch-1', 's1', [], 0); // promote to open

      const result = mgr.handleBackendBecameReady('b1', 'ch-1');
      expect(result.commands).toHaveLength(0);
    });

    it('does not resume closed (shouldBeOpen=false) streams', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true, channelId: 'ch-1' });
      mgr.requestClose('b1', 's1', { channelId: 'ch-1' });

      const result = mgr.handleBackendBecameReady('b1', 'ch-1');
      expect(result.commands).toHaveLength(0);
    });
  });

  describe('handleBackendLostChannel', () => {
    it('moves shouldBeOpen streams to opening when willAutoRecover', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true, channelId: 'ch-1' });

      const result = mgr.handleBackendLostChannel('b1', 'disconnected', { willAutoRecover: true });

      expect(result.events).toHaveLength(1);
      const stream = mgr.getStream('b1', 's1');
      expect(stream!.state).toBe('opening');
    });

    it('moves shouldBeOpen streams to error when willAutoRecover=false', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true, channelId: 'ch-1' });

      const result = mgr.handleBackendLostChannel('b1', 'gone', { willAutoRecover: false });

      const stream = mgr.getStream('b1', 's1');
      expect(stream!.state).toBe('error');
      expect(stream!.channelId).toBeNull();
    });

    it('closes streams with shouldBeOpen=false', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true, channelId: 'ch-1' });
      mgr.requestClose('b1', 's1', { channelId: 'ch-1' });
      // Re-open runtime state to simulate an edge case
      mgr.handleContentPatch('b1', 'ch-1', 's1', [], 0);

      // Now desired.shouldBeOpen = false but runtime.state = open
      const result = mgr.handleBackendLostChannel('b1', 'lost', { willAutoRecover: true });
      const stream = mgr.getStream('b1', 's1');
      expect(stream!.state).toBe('closed');
      expect(stream!.channelId).toBeNull();
    });
  });

  describe('handleSessionStreamClosed', () => {
    it('moves desired-open stream to error', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true, channelId: 'ch-1' });

      const result = mgr.handleSessionStreamClosed('b1', 'ch-1', 's1', 'epoch_changed');

      const stream = mgr.getStream('b1', 's1');
      expect(stream!.state).toBe('error');
      expect(stream!.channelId).toBeNull();
      expect(stream!.lastError).toBe('epoch_changed');
    });
  });

  describe('handleContentPatch', () => {
    it('promotes opening stream to open', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true, channelId: 'ch-1' });

      const result = mgr.handleContentPatch('b1', 'ch-1', 's1', [], 5);

      const stream = mgr.getStream('b1', 's1');
      expect(stream!.state).toBe('open');
      expect(stream!.latestOffset).toBe(5);
    });

    it('creates ephemeral runtime for unknown stream', () => {
      const result = mgr.handleContentPatch('b1', 'ch-1', 's-unknown', [], 3);

      const stream = mgr.getStream('b1', 's-unknown');
      expect(stream).toBeDefined();
      expect(stream!.state).toBe('open');
    });

    it('updates latestOffset monotonically', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true, channelId: 'ch-1' });
      mgr.handleContentPatch('b1', 'ch-1', 's1', [], 10);
      mgr.handleContentPatch('b1', 'ch-1', 's1', [], 5); // stale

      const stream = mgr.getStream('b1', 's1');
      expect(stream!.latestOffset).toBe(10);
    });
  });

  describe('handleRunEvent', () => {
    it('promotes opening stream to open', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true, channelId: 'ch-1' });

      const result = mgr.handleRunEvent('b1', 'ch-1', 's1', { type: 'run_started' } as any);

      const stream = mgr.getStream('b1', 's1');
      expect(stream!.state).toBe('open');
      expect(result.events.some(e => e.type === 'run_event')).toBe(true);
    });

    it('creates ephemeral runtime for unknown stream', () => {
      mgr.handleRunEvent('b1', 'ch-1', 's-eph', { type: 'run_delta' } as any);

      const stream = mgr.getStream('b1', 's-eph');
      expect(stream).toBeDefined();
      expect(stream!.state).toBe('open');
    });
  });

  describe('collectGarbage', () => {
    it('removes stale ephemeral streams', () => {
      mgr.handleContentPatch('b1', 'ch-1', 's-eph', [], 1);
      const stream = mgr.getStream('b1', 's-eph');
      expect(stream).toBeDefined();

      // Simulate time passing (ephemeral TTL = 2 minutes)
      const future = Date.now() + 3 * 60_000;
      // Need to close the stream first for GC to clean it
      mgr.handleBackendLostChannel('b1', 'gone', { willAutoRecover: false });

      mgr.collectGarbage(future);
      expect(mgr.getStream('b1', 's-eph')).toBeUndefined();
    });

    it('does not GC desired shouldBeOpen streams', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true, channelId: 'ch-1' });

      const future = Date.now() + 60 * 60_000; // 1 hour
      mgr.collectGarbage(future);

      expect(mgr.getStream('b1', 's1')).toBeDefined();
    });
  });

  describe('getAllStreams', () => {
    it('returns all runtime stream snapshots', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true, channelId: 'ch-1' });
      mgr.requestOpen('b1', 's2', { backendReady: true, channelId: 'ch-1' });

      expect(mgr.getAllStreams()).toHaveLength(2);
    });
  });
});
