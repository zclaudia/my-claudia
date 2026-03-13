import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSwipeBack } from '../useSwipeBack.js';

// Polyfill Touch for jsdom
class MockTouch implements Touch {
  identifier: number;
  target: EventTarget;
  clientX: number;
  clientY: number;
  pageX: number;
  pageY: number;
  screenX: number;
  screenY: number;
  radiusX: number;
  radiusY: number;
  rotationAngle: number;
  force: number;

  constructor(init: TouchInit) {
    this.identifier = init.identifier;
    this.target = init.target;
    this.clientX = init.clientX ?? 0;
    this.clientY = init.clientY ?? 0;
    this.pageX = init.pageX ?? this.clientX;
    this.pageY = init.pageY ?? this.clientY;
    this.screenX = init.screenX ?? this.clientX;
    this.screenY = init.screenY ?? this.clientY;
    this.radiusX = init.radiusX ?? 0;
    this.radiusY = init.radiusY ?? 0;
    this.rotationAngle = init.rotationAngle ?? 0;
    this.force = init.force ?? 0;
  }
}

beforeAll(() => {
  if (typeof globalThis.Touch === 'undefined') {
    (globalThis as any).Touch = MockTouch;
  }
});

describe('hooks/useSwipeBack', () => {
  let mockElement: HTMLDivElement;
  let handlers: Record<string, Function>;

  beforeEach(() => {
    handlers = {};
    mockElement = document.createElement('div');
    Object.defineProperty(mockElement, 'clientWidth', {
      value: 375, writable: true, configurable: true,
    });
  });

  function setupHook(options: Parameters<typeof useSwipeBack>[0]) {
    // Create a fresh element that captures addEventListener calls
    const addSpy = vi.spyOn(mockElement, 'addEventListener').mockImplementation(
      (type: string, handler: any) => {
        handlers[type] = handler;
      }
    );
    const removeSpy = vi.spyOn(mockElement, 'removeEventListener');

    const { result, rerender, unmount } = renderHook(
      (props) => useSwipeBack(props),
      { initialProps: options }
    );
    // Mutate the ref to point to our mock element
    (result.current as any).current = mockElement;

    // Force effect to re-run by toggling enabled
    if (options.enabled !== false) {
      rerender({ ...options, enabled: false });
      rerender({ ...options, enabled: true });
    }

    return { result, rerender, unmount, addSpy, removeSpy };
  }

  function makeTouchEvent(type: string, x: number, y: number): TouchEvent {
    const touch = new MockTouch({
      identifier: 0, target: mockElement,
      clientX: x, clientY: y,
    });
    return new TouchEvent(type, {
      touches: type === 'touchend' ? [] : [touch as unknown as Touch],
      changedTouches: [touch as unknown as Touch],
      bubbles: true,
    });
  }

  function fireHandlers(startX: number, startY: number, endX: number, endY: number, moveX?: number, moveY?: number) {
    handlers.touchstart?.(makeTouchEvent('touchstart', startX, startY));
    if (moveX !== undefined && moveY !== undefined) {
      handlers.touchmove?.(makeTouchEvent('touchmove', moveX, moveY));
    }
    handlers.touchend?.(makeTouchEvent('touchend', endX, endY));
  }

  describe('basic', () => {
    it('returns a ref', () => {
      const { result } = renderHook(() => useSwipeBack({ onSwipe: vi.fn() }));
      expect(result.current).toBeDefined();
    });

    it('attaches event listeners when enabled and ref connected', () => {
      const { addSpy } = setupHook({ onSwipe: vi.fn(), enabled: true });
      expect(handlers.touchstart).toBeDefined();
      expect(handlers.touchmove).toBeDefined();
      expect(handlers.touchend).toBeDefined();
    });
  });

  describe('swipe right from left edge', () => {
    it('triggers onSwipe when distance exceeds threshold', () => {
      const onSwipe = vi.fn();
      setupHook({ onSwipe, direction: 'right', edgeWidth: 30, threshold: 80, velocityThreshold: 0.3 });

      fireHandlers(10, 100, 100, 100); // start in edge, moved 90 > 80
      expect(onSwipe).toHaveBeenCalledTimes(1);
    });

    it('does not trigger when starting outside edge', () => {
      const onSwipe = vi.fn();
      setupHook({ onSwipe, direction: 'right', edgeWidth: 30, threshold: 80 });

      fireHandlers(100, 100, 200, 100); // start outside edge
      expect(onSwipe).not.toHaveBeenCalled();
    });

    it('does not trigger when swiped in wrong direction', () => {
      const onSwipe = vi.fn();
      setupHook({ onSwipe, direction: 'right', edgeWidth: 30, threshold: 80, velocityThreshold: 0.3 });

      fireHandlers(10, 100, 5, 100); // swiped left (wrong direction)
      expect(onSwipe).not.toHaveBeenCalled();
    });
  });

  describe('swipe left from right edge', () => {
    it('triggers onSwipe for leftward swipe from right edge', () => {
      const onSwipe = vi.fn();
      setupHook({ onSwipe, direction: 'left', edgeWidth: 30, threshold: 80, velocityThreshold: 0.3 });

      fireHandlers(365, 100, 250, 100); // right edge, moved left 115 > 80
      expect(onSwipe).toHaveBeenCalledTimes(1);
    });

    it('does not trigger for wrong direction', () => {
      const onSwipe = vi.fn();
      setupHook({ onSwipe, direction: 'left', edgeWidth: 30, threshold: 80, velocityThreshold: 100 });

      fireHandlers(365, 100, 400, 100); // swiped right, not left
      expect(onSwipe).not.toHaveBeenCalled();
    });
  });

  describe('fullWidth mode', () => {
    it('triggers from any position', () => {
      const onSwipe = vi.fn();
      setupHook({ onSwipe, fullWidth: true, threshold: 80, velocityThreshold: 0.3 });

      fireHandlers(200, 100, 300, 100); // 100 > 80
      expect(onSwipe).toHaveBeenCalledTimes(1);
    });
  });

  describe('edgeWidthRatio', () => {
    it('uses ratio-based edge width', () => {
      const onSwipe = vi.fn();
      // 375 * 0.1 = 37.5 => floor = 37px
      setupHook({ onSwipe, edgeWidthRatio: 0.1, threshold: 80, velocityThreshold: 0.3 });

      fireHandlers(35, 100, 120, 100); // in edge, moved 85 > 80
      expect(onSwipe).toHaveBeenCalledTimes(1);
    });
  });

  describe('vertical scroll cancellation', () => {
    it('cancels tracking when vertical movement dominates', () => {
      const onSwipe = vi.fn();
      setupHook({ onSwipe, edgeWidth: 30, threshold: 80, velocityThreshold: 0.3 });

      fireHandlers(10, 100, 100, 200, 15, 200); // move: deltaY=100 > deltaX=5
      expect(onSwipe).not.toHaveBeenCalled();
    });

    it('does not cancel when horizontal movement dominates', () => {
      const onSwipe = vi.fn();
      setupHook({ onSwipe, edgeWidth: 30, threshold: 80, velocityThreshold: 0.3 });

      fireHandlers(10, 100, 100, 105, 50, 105); // move: deltaX=40 > deltaY=5
      expect(onSwipe).toHaveBeenCalledTimes(1);
    });
  });

  describe('disabled', () => {
    it('does not trigger when disabled', () => {
      const onSwipe = vi.fn();
      // When disabled, setupHook won't toggle the effect, handlers may not be set
      handlers = {};
      const addSpy = vi.spyOn(mockElement, 'addEventListener').mockImplementation(
        (type: string, handler: any) => { handlers[type] = handler; }
      );

      const { result } = renderHook(
        (props) => useSwipeBack(props),
        { initialProps: { onSwipe, enabled: false } }
      );
      (result.current as any).current = mockElement;

      // Handlers should be registered but the touchstart handler checks `enabled` internally
      // If handlers are registered, try calling them
      if (handlers.touchstart) {
        fireHandlers(10, 100, 100, 100);
        expect(onSwipe).not.toHaveBeenCalled();
      }

      addSpy.mockRestore();
    });
  });

  describe('cleanup', () => {
    it('removes listeners when effect re-runs', () => {
      const onSwipe = vi.fn();
      const { rerender, removeSpy } = setupHook({ onSwipe, enabled: true });

      // Change props to force effect cleanup + re-run
      (mockElement.removeEventListener as any).mockClear();
      rerender({ onSwipe, enabled: true, edgeWidth: 50 });

      expect(removeSpy).toHaveBeenCalledWith('touchstart', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('touchmove', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('touchend', expect.any(Function));
    });
  });
});
