import { useRef, useCallback, useEffect } from 'react';

interface UseSwipeBackOptions {
  /** Callback when swipe completes */
  onSwipe: () => void;
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
}

interface SwipeState {
  startX: number;
  startY: number;
  startTime: number;
  tracking: boolean;
}

export function useSwipeBack(options: UseSwipeBackOptions) {
  const {
    onSwipe,
    enabled = true,
    direction = 'right',
    edgeWidth = 30,
    edgeWidthRatio,
    threshold = 80,
    velocityThreshold = 0.3,
    fullWidth = false,
  } = options;

  const stateRef = useRef<SwipeState>({
    startX: 0, startY: 0, startTime: 0, tracking: false,
  });

  const containerRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!enabled) return;
    const touch = e.touches[0];
    const x = touch.clientX;
    const containerWidth = containerRef.current?.clientWidth ?? window.innerWidth;
    const clampedRatio = Math.min(Math.max(edgeWidthRatio ?? 0, 0), 1);
    const computedEdgeWidth = edgeWidthRatio != null
      ? Math.max(1, Math.floor(containerWidth * clampedRatio))
      : edgeWidth;

    let inEdge = false;
    if (fullWidth) {
      inEdge = true;
    } else if (direction === 'right') {
      inEdge = x <= computedEdgeWidth;
    } else {
      inEdge = x >= containerWidth - computedEdgeWidth;
    }

    if (!inEdge) return;

    stateRef.current = {
      startX: x,
      startY: touch.clientY,
      startTime: Date.now(),
      tracking: true,
    };
  }, [enabled, direction, edgeWidth, edgeWidthRatio, fullWidth]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!stateRef.current.tracking) return;
    const touch = e.touches[0];
    const deltaY = Math.abs(touch.clientY - stateRef.current.startY);
    const deltaX = Math.abs(touch.clientX - stateRef.current.startX);

    // Cancel if vertical movement is dominant (user is scrolling)
    if (deltaY > deltaX && deltaY > 10) {
      stateRef.current.tracking = false;
    }
  }, []);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (!stateRef.current.tracking) return;
    stateRef.current.tracking = false;

    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - stateRef.current.startX;
    const elapsed = Date.now() - stateRef.current.startTime;
    const velocity = Math.abs(deltaX) / elapsed;

    const isCorrectDirection = direction === 'right' ? deltaX > 0 : deltaX < 0;
    const meetsThreshold = Math.abs(deltaX) >= threshold;
    const meetsVelocity = velocity >= velocityThreshold;

    if (isCorrectDirection && (meetsThreshold || meetsVelocity)) {
      onSwipe();
    }
  }, [direction, threshold, velocityThreshold, onSwipe]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) return;

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: true });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [enabled, handleTouchStart, handleTouchMove, handleTouchEnd]);

  return containerRef;
}
