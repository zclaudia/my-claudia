/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appLifecycleManager } from '../appLifecycleManager';

describe('AppLifecycleManager', () => {
  let facade: {
    forceReconnect: ReturnType<typeof vi.fn>;
    probeHealth: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    facade = {
      forceReconnect: vi.fn(),
      probeHealth: vi.fn(),
    };
  });

  afterEach(() => {
    appLifecycleManager.stop();
    vi.useRealTimers();
  });

  it('starts and stops without errors', () => {
    appLifecycleManager.start(facade as any);
    appLifecycleManager.stop();
  });

  it('calls forceReconnect when returning from background', () => {
    appLifecycleManager.start(facade as any);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    vi.advanceTimersByTime(2_000);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(facade.forceReconnect).toHaveBeenCalledOnce();
  });

  it('calls probeHealth on foreground return', () => {
    appLifecycleManager.start(facade as any);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(facade.probeHealth).toHaveBeenCalled();
  });

  it('runs health probe at 25s intervals', () => {
    appLifecycleManager.start(facade as any);

    vi.advanceTimersByTime(25_000);
    expect(facade.probeHealth).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(25_000);
    expect(facade.probeHealth).toHaveBeenCalledTimes(2);
  });

  it('stops health probe on background', () => {
    appLifecycleManager.start(facade as any);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    facade.probeHealth.mockClear();
    vi.advanceTimersByTime(50_000);
    expect(facade.probeHealth).not.toHaveBeenCalled();
  });

  it('calls forceReconnect on network online when visible', () => {
    appLifecycleManager.start(facade as any);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    window.dispatchEvent(new Event('online'));

    expect(facade.forceReconnect).toHaveBeenCalledOnce();
  });

  it('does not trigger reconnect on network online when hidden', () => {
    appLifecycleManager.start(facade as any);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    window.dispatchEvent(new Event('online'));

    expect(facade.forceReconnect).not.toHaveBeenCalled();
  });

  it('cleans up listeners on stop', () => {
    appLifecycleManager.start(facade as any);
    appLifecycleManager.stop();

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    vi.advanceTimersByTime(10_000);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(facade.forceReconnect).not.toHaveBeenCalled();
  });

  it('re-start replaces previous lifecycle', () => {
    const facade2 = { forceReconnect: vi.fn(), probeHealth: vi.fn() };
    appLifecycleManager.start(facade as any);
    appLifecycleManager.start(facade2 as any);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    vi.advanceTimersByTime(10_000);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(facade.forceReconnect).not.toHaveBeenCalled();
    expect(facade2.forceReconnect).toHaveBeenCalledOnce();
  });
});
