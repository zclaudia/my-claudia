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

  it('calls onBackground when visibility changes to hidden', () => {
    const onBackground = vi.fn();
    appLifecycleManager.start(facade as any, { onBackground });

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(onBackground).toHaveBeenCalledOnce();
  });

  it('calls onResume when returning to foreground', () => {
    const onResume = vi.fn();
    appLifecycleManager.start(facade as any, { onResume });

    // Go to background first
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    // Return to foreground
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(onResume).toHaveBeenCalledOnce();
  });

  it('calls forceReconnect when returning from background longer than threshold', () => {
    appLifecycleManager.start(facade as any);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    vi.advanceTimersByTime(10_000); // 10s background, past 5s threshold

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(facade.forceReconnect).toHaveBeenCalledOnce();
  });

  it('does not call forceReconnect for short background', () => {
    appLifecycleManager.start(facade as any);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    vi.advanceTimersByTime(2_000); // 2s, below 5s threshold

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(facade.forceReconnect).not.toHaveBeenCalled();
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

  it('calls onNetworkOffline when network goes offline', () => {
    const onNetworkOffline = vi.fn();
    appLifecycleManager.start(facade as any, { onNetworkOffline });

    window.dispatchEvent(new Event('offline'));

    expect(onNetworkOffline).toHaveBeenCalledOnce();
  });

  it('calls forceReconnect and onResume on network online when visible', () => {
    const onResume = vi.fn();
    appLifecycleManager.start(facade as any, { onResume });

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    window.dispatchEvent(new Event('online'));

    expect(facade.forceReconnect).toHaveBeenCalledOnce();
    expect(onResume).toHaveBeenCalledOnce();
  });

  it('does not trigger reconnect on network online when hidden', () => {
    const onResume = vi.fn();
    appLifecycleManager.start(facade as any, { onResume });

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    window.dispatchEvent(new Event('online'));

    expect(facade.forceReconnect).not.toHaveBeenCalled();
    expect(onResume).not.toHaveBeenCalled();
  });

  it('cleans up listeners on stop', () => {
    const onBackground = vi.fn();
    appLifecycleManager.start(facade as any, { onBackground });
    appLifecycleManager.stop();

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(onBackground).not.toHaveBeenCalled();
  });

  it('re-start replaces previous lifecycle', () => {
    const onBg1 = vi.fn();
    const onBg2 = vi.fn();
    appLifecycleManager.start(facade as any, { onBackground: onBg1 });
    appLifecycleManager.start(facade as any, { onBackground: onBg2 });

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(onBg1).not.toHaveBeenCalled();
    expect(onBg2).toHaveBeenCalledOnce();
  });
});
