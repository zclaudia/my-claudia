import { describe, it, expect, beforeEach } from 'vitest';
import { FacadeStreamManager } from '../stream-manager.js';

describe('FacadeStreamManager', () => {
  let mgr: FacadeStreamManager;

  beforeEach(() => {
    mgr = new FacadeStreamManager();
    mgr.applyBootstrap();
  });

  describe('requestOpen', () => {
    it('creates desired+runtime state when backend ready', () => {
      const result = mgr.requestOpen('b1', 's1', {
        backendReady: true,
      });

      // Stream open is now local-only, no command sent
      expect(result.commands).toHaveLength(0);
      expect(result.events).toHaveLength(1);

      const stream = mgr.getStream('b1', 's1');
      expect(stream).toBeDefined();
      expect(stream!.state).toBe('opening');
    });

    it('creates desired state but no command when backend not ready', () => {
      const result = mgr.requestOpen('b1', 's1', {
        backendReady: false,
      });

      expect(result.commands).toHaveLength(0);
      expect(result.events).toHaveLength(1);

      const stream = mgr.getStream('b1', 's1');
      expect(stream!.state).toBe('opening');
    });

    it('is idempotent when already open', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true });
      // Simulate stream becoming open via content patch
      mgr.handleContentPatch('b1', 's1', [], 0);

      const stream = mgr.getStream('b1', 's1');
      expect(stream!.state).toBe('open');

      const result = mgr.requestOpen('b1', 's1', { backendReady: true });
      expect(result.commands).toHaveLength(0); // no duplicate command
    });
  });

  describe('requestClose', () => {
    it('closes an open stream (local-only)', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true });

      const result = mgr.requestClose('b1', 's1');

      // No command sent — stream close is local-only
      expect(result.commands).toHaveLength(0);
      expect(result.events).toHaveLength(1);

      const stream = mgr.getStream('b1', 's1');
      expect(stream!.state).toBe('closed');
    });

    it('is a no-op for already closed stream', () => {
      const result = mgr.requestClose('b1', 's1');
      expect(result.commands).toHaveLength(0);
      expect(result.events).toHaveLength(0);
    });
  });

  describe('handleBackendBecameReady', () => {
    it('auto-resumes streams with shouldBeOpen=true', () => {
      // Open streams when backend is not ready
      mgr.requestOpen('b1', 's1', { backendReady: false });
      mgr.requestOpen('b1', 's2', { backendReady: false });

      // Backend becomes ready
      const result = mgr.handleBackendBecameReady('b1');

      // No commands — stream open is local-only
      expect(result.commands).toHaveLength(0);
      expect(result.events).toHaveLength(2);
    });

    it('does not resume already open streams', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true });
      mgr.handleContentPatch('b1', 's1', [], 0); // promote to open

      const result = mgr.handleBackendBecameReady('b1');
      expect(result.commands).toHaveLength(0);
      expect(result.events).toHaveLength(0);
    });

    it('does not resume closed (shouldBeOpen=false) streams', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true });
      mgr.requestClose('b1', 's1');

      const result = mgr.handleBackendBecameReady('b1');
      expect(result.commands).toHaveLength(0);
      expect(result.events).toHaveLength(0);
    });
  });

  describe('handleBackendUnsubscribed', () => {
    it('moves shouldBeOpen streams to opening when willAutoRecover', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true });

      const result = mgr.handleBackendUnsubscribed('b1', 'disconnected', { willAutoRecover: true });

      expect(result.events).toHaveLength(1);
      const stream = mgr.getStream('b1', 's1');
      expect(stream!.state).toBe('opening');
    });

    it('moves shouldBeOpen streams to error when willAutoRecover=false', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true });

      const result = mgr.handleBackendUnsubscribed('b1', 'gone', { willAutoRecover: false });

      const stream = mgr.getStream('b1', 's1');
      expect(stream!.state).toBe('error');
    });

    it('closes streams with shouldBeOpen=false', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true });
      mgr.requestClose('b1', 's1');
      // Re-open runtime state to simulate an edge case
      mgr.handleContentPatch('b1', 's1', [], 0);

      // Now desired.shouldBeOpen = false but runtime.state = open
      const result = mgr.handleBackendUnsubscribed('b1', 'lost', { willAutoRecover: true });
      const stream = mgr.getStream('b1', 's1');
      expect(stream!.state).toBe('closed');
    });
  });

  describe('handleSessionStreamClosed', () => {
    it('moves desired-open stream to error', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true });

      const result = mgr.handleSessionStreamClosed('b1', 's1', 'epoch_changed');

      const stream = mgr.getStream('b1', 's1');
      expect(stream!.state).toBe('error');
      expect(stream!.lastError).toBe('epoch_changed');
    });
  });

  describe('handleContentPatch', () => {
    it('promotes opening stream to open', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true });

      const result = mgr.handleContentPatch('b1', 's1', [], 5);

      const stream = mgr.getStream('b1', 's1');
      expect(stream!.state).toBe('open');
      expect(stream!.latestOffset).toBe(5);
    });

    it('creates ephemeral runtime for unknown stream', () => {
      const result = mgr.handleContentPatch('b1', 's-unknown', [], 3);

      const stream = mgr.getStream('b1', 's-unknown');
      expect(stream).toBeDefined();
      expect(stream!.state).toBe('open');
    });

    it('updates latestOffset monotonically', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true });
      mgr.handleContentPatch('b1', 's1', [], 10);
      mgr.handleContentPatch('b1', 's1', [], 5); // stale

      const stream = mgr.getStream('b1', 's1');
      expect(stream!.latestOffset).toBe(10);
    });
  });

  describe('handleRunEvent', () => {
    it('promotes opening stream to open', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true });

      const result = mgr.handleRunEvent('b1', 's1', { type: 'run_started' } as any);

      const stream = mgr.getStream('b1', 's1');
      expect(stream!.state).toBe('open');
      expect(result.events.some(e => e.type === 'run_event')).toBe(true);
    });

    it('creates ephemeral runtime for unknown stream', () => {
      mgr.handleRunEvent('b1', 's-eph', { type: 'run_delta' } as any);

      const stream = mgr.getStream('b1', 's-eph');
      expect(stream).toBeDefined();
      expect(stream!.state).toBe('open');
    });
  });

  describe('collectGarbage', () => {
    it('removes stale ephemeral streams', () => {
      mgr.handleContentPatch('b1', 's-eph', [], 1);
      const stream = mgr.getStream('b1', 's-eph');
      expect(stream).toBeDefined();

      // Simulate time passing (ephemeral TTL = 2 minutes)
      const future = Date.now() + 3 * 60_000;
      // Need to close the stream first for GC to clean it
      mgr.handleBackendUnsubscribed('b1', 'gone', { willAutoRecover: false });

      mgr.collectGarbage(future);
      expect(mgr.getStream('b1', 's-eph')).toBeUndefined();
    });

    it('does not GC desired shouldBeOpen streams', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true });

      const future = Date.now() + 60 * 60_000; // 1 hour
      mgr.collectGarbage(future);

      expect(mgr.getStream('b1', 's1')).toBeDefined();
    });
  });

  describe('getAllStreams', () => {
    it('returns all runtime stream snapshots', () => {
      mgr.requestOpen('b1', 's1', { backendReady: true });
      mgr.requestOpen('b1', 's2', { backendReady: true });

      expect(mgr.getAllStreams()).toHaveLength(2);
    });
  });
});
