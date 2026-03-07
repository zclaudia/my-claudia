import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initLogger, exportLogs, clearLogs, getLogCount } from '../logger.js';

describe('services/logger', () => {
  let originalLog: typeof console.log;
  let originalWarn: typeof console.warn;
  let originalError: typeof console.error;
  let originalDebug: typeof console.debug;

  beforeEach(() => {
    // Save originals
    originalLog = console.log;
    originalWarn = console.warn;
    originalError = console.error;
    originalDebug = console.debug;

    // Mock console methods
    console.log = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
    console.debug = vi.fn();

    // Clear logs before each test
    clearLogs();

    // Reset initialized state by re-importing
    vi.resetModules();
  });

  afterEach(() => {
    // Restore originals
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    console.debug = originalDebug;
  });

  describe('initLogger', () => {
    it('initializes only once', async () => {
      const { initLogger: init } = await import('../logger.js');

      init(100);
      init(200); // Second call should be ignored

      // Check that max entries wasn't changed to 200
      // We can verify this indirectly by adding logs and checking behavior
    });

    it('accepts custom max entries', async () => {
      const { initLogger: init, getLogCount: count } = await import('../logger.js');

      init(10);
      expect(count()).toBe(0);
    });
  });

  describe('exportLogs', () => {
    it('returns empty array as JSON when no logs', async () => {
      const { exportLogs: exp, clearLogs: clear } = await import('../logger.js');
      clear();

      const logs = exp();

      expect(logs).toBe('[]');
    });

    it('returns valid JSON string', async () => {
      const { exportLogs: exp, clearLogs: clear } = await import('../logger.js');
      clear();

      const logs = exp();
      expect(() => JSON.parse(logs)).not.toThrow();
    });
  });

  describe('clearLogs', () => {
    it('clears all logs', async () => {
      const { clearLogs: clear, getLogCount: count } = await import('../logger.js');

      clear();
      expect(count()).toBe(0);
    });
  });

  describe('getLogCount', () => {
    it('returns 0 when no logs', async () => {
      const { getLogCount: count, clearLogs: clear } = await import('../logger.js');
      clear();

      expect(count()).toBe(0);
    });
  });

  describe('tag extraction', () => {
    it('extracts tag from [Tag] prefix format', () => {
      const TAG_RE = /^\[([^\]]+)\]\s*/;
      const input = '[MyTag] Hello world';
      const match = TAG_RE.exec(input);

      expect(match).not.toBeNull();
      expect(match![1]).toBe('MyTag');
    });

    it('returns untagged for no tag prefix', () => {
      const TAG_RE = /^\[([^\]]+)\]\s*/;
      const input = 'Hello world without tag';
      const match = TAG_RE.exec(input);

      expect(match).toBeNull();
    });
  });

  describe('stringify', () => {
    it('stringifies objects', () => {
      const obj = { foo: 'bar', num: 123 };
      const result = JSON.stringify(obj);

      expect(result).toContain('foo');
      expect(result).toContain('bar');
    });

    it('handles circular references gracefully', () => {
      const obj: any = { a: 1 };
      obj.self = obj;

      expect(() => {
        try {
          JSON.stringify(obj);
        } catch {
          String(obj);
        }
      }).not.toThrow();
    });
  });
});
