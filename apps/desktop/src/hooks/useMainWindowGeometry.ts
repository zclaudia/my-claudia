import { useEffect } from 'react';
import type { Monitor } from '@tauri-apps/api/window';
import { isDesktopTauri } from '../utils/platform';

const STORAGE_KEY = 'my-claudia:main-window-geometry:v1';
const SAVE_DEBOUNCE_MS = 300;
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;

interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sanitizeGeometry(value: unknown): WindowGeometry | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<WindowGeometry>;

  if (
    !isFiniteNumber(candidate.x)
    || !isFiniteNumber(candidate.y)
    || !isFiniteNumber(candidate.width)
    || !isFiniteNumber(candidate.height)
  ) {
    return null;
  }

  const width = Math.max(Math.round(candidate.width), MIN_WIDTH);
  const height = Math.max(Math.round(candidate.height), MIN_HEIGHT);

  return {
    x: Math.round(candidate.x),
    y: Math.round(candidate.y),
    width,
    height,
    maximized: candidate.maximized === true,
  };
}

function readStoredGeometry(): WindowGeometry | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return sanitizeGeometry(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeStoredGeometry(geometry: WindowGeometry) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(geometry));
  } catch {
    // Ignore storage failures; window persistence should never block startup.
  }
}

function intersectionArea(a: Rect, b: Rect): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function monitorWorkArea(monitor: Monitor): Rect {
  return {
    x: monitor.workArea.position.x,
    y: monitor.workArea.position.y,
    width: monitor.workArea.size.width,
    height: monitor.workArea.size.height,
  };
}

export function resolveRestoredMainWindowBounds(
  geometry: WindowGeometry,
  monitors: Monitor[],
): WindowGeometry | null {
  if (monitors.length === 0) return null;

  const savedRect: Rect = {
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
  };

  let bestMonitor: Monitor | null = null;
  let bestArea = 0;

  for (const monitor of monitors) {
    const area = intersectionArea(savedRect, monitorWorkArea(monitor));
    if (area > bestArea) {
      bestArea = area;
      bestMonitor = monitor;
    }
  }

  if (!bestMonitor || bestArea === 0) return null;

  const workArea = monitorWorkArea(bestMonitor);
  const width = Math.min(geometry.width, workArea.width);
  const height = Math.min(geometry.height, workArea.height);

  return {
    ...geometry,
    width,
    height,
    x: clamp(geometry.x, workArea.x, workArea.x + workArea.width - width),
    y: clamp(geometry.y, workArea.y, workArea.y + workArea.height - height),
  };
}

/**
 * Persists and restores only the main application window. Standalone popout
 * windows are routed before AppContent mounts, so they do not use this hook.
 */
export function useMainWindowGeometry() {
  useEffect(() => {
    if (!isDesktopTauri()) return;

    let disposed = false;
    let saveTimer: ReturnType<typeof window.setTimeout> | null = null;
    const unlisteners: Array<() => void> = [];

    const clearSaveTimer = () => {
      if (saveTimer !== null) {
        window.clearTimeout(saveTimer);
        saveTimer = null;
      }
    };

    (async () => {
      try {
        const {
          getCurrentWindow,
          availableMonitors,
          PhysicalPosition,
          PhysicalSize,
        } = await import('@tauri-apps/api/window');

        if (disposed) return;

        const win = getCurrentWindow();
        if (
          typeof win.outerPosition !== 'function'
          || typeof win.outerSize !== 'function'
          || typeof win.setPosition !== 'function'
          || typeof win.setSize !== 'function'
          || typeof win.isMaximized !== 'function'
          || typeof win.isMinimized !== 'function'
          || typeof win.onMoved !== 'function'
          || typeof win.onResized !== 'function'
        ) {
          return;
        }

        const saveCurrentGeometry = async () => {
          try {
            if (disposed || await win.isMinimized()) return;

            const maximized = await win.isMaximized();
            const previous = readStoredGeometry();

            if (maximized && previous) {
              writeStoredGeometry({ ...previous, maximized: true });
              return;
            }

            const [position, size] = await Promise.all([
              win.outerPosition(),
              win.outerSize(),
            ]);
            const geometry = sanitizeGeometry({
              x: position.x,
              y: position.y,
              width: size.width,
              height: size.height,
              maximized,
            });

            if (geometry) writeStoredGeometry(geometry);
          } catch {
            // Ignore transient window API failures during shutdown.
          }
        };

        const scheduleSave = () => {
          clearSaveTimer();
          saveTimer = window.setTimeout(() => {
            void saveCurrentGeometry();
          }, SAVE_DEBOUNCE_MS);
        };

        try {
          const storedGeometry = readStoredGeometry();
          if (storedGeometry) {
            const bounds = resolveRestoredMainWindowBounds(storedGeometry, await availableMonitors());
            if (bounds && !disposed) {
              await win.setSize(new PhysicalSize(bounds.width, bounds.height));
              await win.setPosition(new PhysicalPosition(bounds.x, bounds.y));
              if (bounds.maximized && typeof win.maximize === 'function') {
                await win.maximize();
              }
            }
          }
        } catch {
          // Missing permissions or stale display data should not disable future saves.
        }

        unlisteners.push(await win.onMoved(scheduleSave));
        unlisteners.push(await win.onResized(scheduleSave));
        if (typeof win.onCloseRequested === 'function') {
          unlisteners.push(await win.onCloseRequested(() => {
            void saveCurrentGeometry();
          }));
        }

        void saveCurrentGeometry();
      } catch {
        // Running in a non-window test/browser context; leave defaults alone.
      }
    })();

    return () => {
      disposed = true;
      clearSaveTimer();
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, []);
}
