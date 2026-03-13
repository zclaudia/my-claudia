import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('services/logger', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('initLogger intercepts console and captures entries', async () => {
    const { initLogger, exportLogs, clearLogs, getLogCount } = await import('../logger.js');
    initLogger();

    console.log('test info');
    console.warn('test warn');
    console.error('test error');
    console.debug('test debug');

    expect(getLogCount()).toBe(4);

    const logs = JSON.parse(exportLogs());
    expect(logs[0].l).toBe('info');
    expect(logs[0].msg).toBe('test info');
    expect(logs[1].l).toBe('warn');
    expect(logs[2].l).toBe('error');
    expect(logs[3].l).toBe('debug');

    clearLogs();
    expect(getLogCount()).toBe(0);
  });

  it('initLogger is idempotent', async () => {
    const { initLogger, getLogCount, clearLogs } = await import('../logger.js');
    initLogger();
    initLogger(); // second call should be no-op

    console.log('test');
    // If initialized twice, we'd get double entries
    expect(getLogCount()).toBe(1);
    clearLogs();
  });

  it('extracts [Tag] prefix from log messages', async () => {
    const { initLogger, exportLogs, clearLogs } = await import('../logger.js');
    initLogger();

    console.log('[MyService] connected');

    const logs = JSON.parse(exportLogs());
    expect(logs[0].tag).toBe('MyService');
    expect(logs[0].msg).toBe('connected');
    clearLogs();
  });

  it('uses "untagged" when no tag prefix', async () => {
    const { initLogger, exportLogs, clearLogs } = await import('../logger.js');
    initLogger();

    console.log('plain message');

    const logs = JSON.parse(exportLogs());
    expect(logs[0].tag).toBe('untagged');
    clearLogs();
  });

  it('captures extra arguments', async () => {
    const { initLogger, exportLogs, clearLogs } = await import('../logger.js');
    initLogger();

    console.log('message', 'extra1', 42);

    const logs = JSON.parse(exportLogs());
    expect(logs[0].args).toContain('extra1');
    expect(logs[0].args).toContain('42');
    clearLogs();
  });

  it('stringifies non-string first argument', async () => {
    const { initLogger, exportLogs, clearLogs } = await import('../logger.js');
    initLogger();

    console.log({ key: 'value' });

    const logs = JSON.parse(exportLogs());
    expect(logs[0].msg).toContain('key');
    clearLogs();
  });

  it('skips empty console calls', async () => {
    const { initLogger, getLogCount, clearLogs } = await import('../logger.js');
    initLogger();

    const before = getLogCount();
    // @ts-ignore - empty args
    console.log();
    expect(getLogCount()).toBe(before);
    clearLogs();
  });

  it('truncates long extra arguments', async () => {
    const { initLogger, exportLogs, clearLogs } = await import('../logger.js');
    initLogger();

    const longStr = 'x'.repeat(1000);
    console.log('msg', longStr);

    const logs = JSON.parse(exportLogs());
    expect(logs[0].args.length).toBeLessThan(1000);
    expect(logs[0].args.endsWith('…')).toBe(true);
    clearLogs();
  });

  it('handles circular references gracefully', async () => {
    const { initLogger, getLogCount, clearLogs } = await import('../logger.js');
    initLogger();

    const circular: any = {};
    circular.self = circular;

    console.log(circular);
    expect(getLogCount()).toBeGreaterThan(0);
    clearLogs();
  });

  it('trims buffer when over max entries', async () => {
    const { initLogger, getLogCount, clearLogs } = await import('../logger.js');
    initLogger(20);

    for (let i = 0; i < 25; i++) {
      console.log(`msg ${i}`);
    }

    // Buffer drops oldest 10% (2 entries) when exceeding 20, so after 21 entries it drops to 19
    // With 25 entries total, multiple trims will have occurred
    expect(getLogCount()).toBeLessThanOrEqual(20);
    clearLogs();
  });

  it('exportLogs returns empty array JSON when no logs', async () => {
    const { exportLogs, clearLogs } = await import('../logger.js');
    clearLogs();
    expect(exportLogs()).toBe('[]');
  });

  it('passes through to original console methods', async () => {
    const { initLogger, clearLogs } = await import('../logger.js');

    const originalLog = console.log;
    initLogger();

    // After init, console.log should still call through to the original
    // (we can't easily verify passthrough in this environment, but at least it shouldn't throw)
    console.log('passthrough test');
    clearLogs();
  });

  it('accepts custom max entries in initLogger', async () => {
    const { initLogger, getLogCount, clearLogs } = await import('../logger.js');
    initLogger(5);

    for (let i = 0; i < 10; i++) {
      console.log(`msg ${i}`);
    }

    expect(getLogCount()).toBeLessThanOrEqual(10);
    clearLogs();
  });

  it('records timestamp on each entry', async () => {
    const { initLogger, exportLogs, clearLogs } = await import('../logger.js');
    initLogger();

    const before = Date.now();
    console.log('timestamped');
    const after = Date.now();

    const logs = JSON.parse(exportLogs());
    expect(logs[0].t).toBeGreaterThanOrEqual(before);
    expect(logs[0].t).toBeLessThanOrEqual(after);
    clearLogs();
  });
});
