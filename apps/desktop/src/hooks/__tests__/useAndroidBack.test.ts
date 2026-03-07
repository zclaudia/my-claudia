import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// We need to import the module after setting up mocks
// The module has module-level state, so we need to reset it between tests

describe('hooks/useAndroidBack', () => {
  let dispatchAndroidBack: () => void;
  let originalAddEventListener: typeof window.addEventListener;
  let originalRemoveEventListener: typeof window.removeEventListener;
  let eventListeners: Map<string, EventListener[]>;

  beforeEach(() => {
    vi.resetModules();

    eventListeners = new Map();
    originalAddEventListener = window.addEventListener;
    originalRemoveEventListener = window.removeEventListener;

    // Mock window.addEventListener to capture listeners
    window.addEventListener = vi.fn((type: string, listener: EventListener) => {
      if (!eventListeners.has(type)) {
        eventListeners.set(type, []);
      }
      eventListeners.get(type)!.push(listener);
    });

    window.removeEventListener = vi.fn((type: string, listener: EventListener) => {
      const listeners = eventListeners.get(type);
      if (listeners) {
        const idx = listeners.indexOf(listener);
        if (idx !== -1) {
          listeners.splice(idx, 1);
        }
      }
    });

    // Helper to dispatch android-back event
    dispatchAndroidBack = () => {
      const listeners = eventListeners.get('android-back');
      if (listeners) {
        listeners.forEach((listener) => listener(new Event('android-back')));
      }
    };
  });

  afterEach(() => {
    window.addEventListener = originalAddEventListener;
    window.removeEventListener = originalRemoveEventListener;
    vi.restoreAllMocks();
  });

  it('registers global event listener on module load', async () => {
    await import('../useAndroidBack.js');

    expect(window.addEventListener).toHaveBeenCalledWith('android-back', expect.any(Function));
  });

  it('registers handler when enabled', async () => {
    const { useAndroidBack } = await import('../useAndroidBack.js');
    const handler = vi.fn();

    renderHook(() => useAndroidBack(handler, true, 10));

    dispatchAndroidBack();

    expect(handler).toHaveBeenCalled();
  });

  it('does not register handler when disabled', async () => {
    const { useAndroidBack } = await import('../useAndroidBack.js');
    const handler = vi.fn();

    renderHook(() => useAndroidBack(handler, false, 10));

    dispatchAndroidBack();

    expect(handler).not.toHaveBeenCalled();
  });

  it('removes handler on unmount', async () => {
    const { useAndroidBack } = await import('../useAndroidBack.js');
    const handler = vi.fn();

    const { unmount } = renderHook(() => useAndroidBack(handler, true, 10));

    unmount();

    dispatchAndroidBack();

    expect(handler).not.toHaveBeenCalled();
  });

  it('higher priority handler runs first', async () => {
    const { useAndroidBack } = await import('../useAndroidBack.js');
    const lowHandler = vi.fn();
    const highHandler = vi.fn();

    renderHook(() => useAndroidBack(lowHandler, true, 10));
    renderHook(() => useAndroidBack(highHandler, true, 20));

    dispatchAndroidBack();

    expect(highHandler).toHaveBeenCalled();
    expect(lowHandler).not.toHaveBeenCalled();
  });

  it('only highest priority handler runs', async () => {
    const { useAndroidBack } = await import('../useAndroidBack.js');
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const handler3 = vi.fn();

    renderHook(() => useAndroidBack(handler1, true, 5));
    renderHook(() => useAndroidBack(handler2, true, 15));
    renderHook(() => useAndroidBack(handler3, true, 10));

    dispatchAndroidBack();

    expect(handler2).toHaveBeenCalled(); // priority 15
    expect(handler1).not.toHaveBeenCalled();
    expect(handler3).not.toHaveBeenCalled();
  });

  it('handler ref stays current', async () => {
    const { useAndroidBack } = await import('../useAndroidBack.js');
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    const { rerender } = renderHook(
      ({ handler }) => useAndroidBack(handler, true, 10),
      { initialProps: { handler: handler1 } }
    );

    rerender({ handler: handler2 });

    dispatchAndroidBack();

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  it('does not throw when no handlers registered', async () => {
    await import('../useAndroidBack.js');

    expect(() => dispatchAndroidBack()).not.toThrow();
  });

  it('re-registers when priority changes', async () => {
    const { useAndroidBack } = await import('../useAndroidBack.js');
    const handler = vi.fn();

    const { rerender } = renderHook(
      ({ priority }) => useAndroidBack(handler, true, priority),
      { initialProps: { priority: 10 } }
    );

    dispatchAndroidBack();
    expect(handler).toHaveBeenCalledTimes(1);

    rerender({ priority: 20 });

    dispatchAndroidBack();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('disabled then enabled re-registers', async () => {
    const { useAndroidBack } = await import('../useAndroidBack.js');
    const handler = vi.fn();

    const { rerender } = renderHook(
      ({ enabled }) => useAndroidBack(handler, enabled, 10),
      { initialProps: { enabled: true } }
    );

    dispatchAndroidBack();
    expect(handler).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });

    dispatchAndroidBack();
    expect(handler).toHaveBeenCalledTimes(1); // Not called again

    rerender({ enabled: true });

    dispatchAndroidBack();
    expect(handler).toHaveBeenCalledTimes(2); // Called again
  });
});
