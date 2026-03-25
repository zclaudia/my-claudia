import { useRef, useCallback, useEffect } from 'react';

interface UseSwipeBackOptions {
  /** Callback when swipe completes */
  onSwipe: () => void;
  /** Drag progress callback: progress is normalized 0..1 */
  onProgress?: (progress: number) => void;
  /** Whether the hook is active */
  enabled?: boolean;
  /** 'right' = swipe from left edge toward right (default), 'left' = swipe leftward */
  direction?: 'right' | 'left';
  /** Width of the edge zone that accepts touch start (px). Default: 30 */
  edgeWidth?: number;
  /** Width of the edge zone as a ratio of container width (0-1). Overrides edgeWidth when set. */
  edgeWidthRatio?: number;
  /** Minimum horizontal distance to trigger (px). Default: 80 */
  threshold?: number;
  /** Minimum velocity to trigger (px/ms). Default: 0.3 */
  velocityThreshold?: number;
  /** If true, swipe triggers from anywhere, not just the edge. Default: false */
  fullWidth?: boolean;
  /** Start zone as ratios of container width, inclusive. Overrides edge detection when both are set. */
  startZone?: {
    startRatio: number;
    endRatio: number;
  };
  /** If true, listen on document instead of the ref element. Useful for edge gestures that must work regardless of scroll containers. */
  global?: boolean;
}

interface SwipeState {
  startX: number;
  startY: number;
  startTime: number;
  tracking: boolean;
  source: 'touch' | 'pointer' | null;
}

export function useSwipeBack(options: UseSwipeBackOptions) {
  const {
    onSwipe,
    onProgress,
    enabled = true,
    direction = 'right',
    edgeWidth = 30,
    edgeWidthRatio,
    threshold = 80,
    velocityThreshold = 0.3,
    fullWidth = false,
    startZone,
    global = false,
  } = options;

  const stateRef = useRef<SwipeState>({
    startX: 0, startY: 0, startTime: 0, tracking: false, source: null,
  });

  const containerRef = useRef<HTMLDivElement>(null);

  const beginTracking = useCallback((source: 'touch' | 'pointer', x: number, y: number) => {
    if (!enabled) return;
    if (stateRef.current.tracking && stateRef.current.source !== source) return;

    const rect = containerRef.current?.getBoundingClientRect();
    const containerWidth = rect?.width ?? containerRef.current?.clientWidth ?? window.innerWidth;
    const clampedRatio = Math.min(Math.max(edgeWidthRatio ?? 0, 0), 1);
    const computedEdgeWidth = edgeWidthRatio != null
      ? Math.max(1, Math.floor(containerWidth * clampedRatio))
      : edgeWidth;
    const leftEdge = rect?.left ?? 0;
    const rightEdge = rect?.right ?? window.innerWidth;

    let inEdge = false;
    if (fullWidth) {
      inEdge = true;
    } else if (startZone) {
      const normalizedStart = Math.min(Math.max(startZone.startRatio, 0), 1);
      const normalizedEnd = Math.min(Math.max(startZone.endRatio, 0), 1);
      const zoneStart = leftEdge + containerWidth * Math.min(normalizedStart, normalizedEnd);
      const zoneEnd = leftEdge + containerWidth * Math.max(normalizedStart, normalizedEnd);
      inEdge = x >= zoneStart && x <= zoneEnd;
    } else if (direction === 'right') {
      inEdge = x <= leftEdge + computedEdgeWidth;
    } else {
      inEdge = x >= rightEdge - computedEdgeWidth;
    }

    if (!inEdge) return;

    stateRef.current = {
      startX: x,
      startY: y,
      startTime: Date.now(),
      tracking: true,
      source,
    };
    onProgress?.(0);
  }, [enabled, direction, edgeWidth, edgeWidthRatio, fullWidth, onProgress, startZone]);

  const updateTracking = useCallback((source: 'touch' | 'pointer', x: number, y: number) => {
    if (!stateRef.current.tracking || stateRef.current.source !== source) return;
    const deltaY = Math.abs(y - stateRef.current.startY);
    const deltaX = Math.abs(x - stateRef.current.startX);

    // Cancel if vertical movement is dominant (user is scrolling)
    if (deltaY > deltaX && deltaY > 10) {
      stateRef.current.tracking = false;
      stateRef.current.source = null;
      onProgress?.(0);
      return;
    }
    const directionalDelta = direction === 'right'
      ? x - stateRef.current.startX
      : stateRef.current.startX - x;
    onProgress?.(Math.max(0, Math.min(1, directionalDelta / threshold)));
  }, [direction, onProgress, threshold]);

  const endTracking = useCallback((source: 'touch' | 'pointer', x: number) => {
    if (!stateRef.current.tracking || stateRef.current.source !== source) return;
    stateRef.current.tracking = false;
    stateRef.current.source = null;

    const deltaX = x - stateRef.current.startX;
    const elapsed = Date.now() - stateRef.current.startTime;
    const velocity = Math.abs(deltaX) / elapsed;

    const isCorrectDirection = direction === 'right' ? deltaX > 0 : deltaX < 0;
    const meetsThreshold = Math.abs(deltaX) >= threshold;
    const meetsVelocity = velocity >= velocityThreshold;

    if (isCorrectDirection && (meetsThreshold || meetsVelocity)) {
      onSwipe();
    }
    onProgress?.(0);
  }, [direction, threshold, velocityThreshold, onSwipe, onProgress]);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    beginTracking('touch', touch.clientX, touch.clientY);
  }, [beginTracking]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    updateTracking('touch', touch.clientX, touch.clientY);
  }, [updateTracking]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    const touch = e.changedTouches[0];
    if (!touch) return;
    endTracking('touch', touch.clientX);
  }, [endTracking]);

  const handlePointerDown = useCallback((e: PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    beginTracking('pointer', e.clientX, e.clientY);
  }, [beginTracking]);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    updateTracking('pointer', e.clientX, e.clientY);
  }, [updateTracking]);

  const handlePointerUp = useCallback((e: PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    endTracking('pointer', e.clientX);
  }, [endTracking]);

  const handlePointerCancel = useCallback((e: PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    if (stateRef.current.source === 'pointer') {
      stateRef.current.tracking = false;
      stateRef.current.source = null;
      onProgress?.(0);
    }
  }, [onProgress]);

  useEffect(() => {
    const el = global ? document.documentElement : containerRef.current;
    if (!el || !enabled) return;

    el.addEventListener('touchstart', handleTouchStart as EventListener, { passive: true });
    el.addEventListener('touchmove', handleTouchMove as EventListener, { passive: true });
    el.addEventListener('touchend', handleTouchEnd as EventListener, { passive: true });
    el.addEventListener('pointerdown', handlePointerDown as EventListener, { passive: true });
    el.addEventListener('pointermove', handlePointerMove as EventListener, { passive: true });
    el.addEventListener('pointerup', handlePointerUp as EventListener, { passive: true });
    el.addEventListener('pointercancel', handlePointerCancel as EventListener, { passive: true });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart as EventListener);
      el.removeEventListener('touchmove', handleTouchMove as EventListener);
      el.removeEventListener('touchend', handleTouchEnd as EventListener);
      el.removeEventListener('pointerdown', handlePointerDown as EventListener);
      el.removeEventListener('pointermove', handlePointerMove as EventListener);
      el.removeEventListener('pointerup', handlePointerUp as EventListener);
      el.removeEventListener('pointercancel', handlePointerCancel as EventListener);
    };
  }, [
    enabled,
    global,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
  ]);

  return containerRef;
}
