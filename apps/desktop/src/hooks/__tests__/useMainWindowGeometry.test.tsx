import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Monitor } from '@tauri-apps/api/window';
import { availableMonitors, getCurrentWindow } from '@tauri-apps/api/window';
import { isDesktopTauri } from '../../utils/platform';
import { resolveRestoredMainWindowBounds, useMainWindowGeometry } from '../useMainWindowGeometry';

const STORAGE_KEY = 'my-claudia:main-window-geometry:v1';

const tauriWindowMock = vi.hoisted(() => {
  const handlers: {
    moved: (() => void) | null;
    resized: (() => void) | null;
  } = {
    moved: null,
    resized: null,
  };

  class MockPhysicalPosition {
    constructor(public x: number, public y: number) {}
  }

  class MockPhysicalSize {
    constructor(public width: number, public height: number) {}
  }

  const windowMock = {
    outerPosition: vi.fn(),
    outerSize: vi.fn(),
    setPosition: vi.fn(),
    setSize: vi.fn(),
    isMaximized: vi.fn(),
    isMinimized: vi.fn(),
    maximize: vi.fn(),
    onMoved: vi.fn((handler: () => void) => {
      handlers.moved = handler;
      return Promise.resolve(vi.fn());
    }),
    onResized: vi.fn((handler: () => void) => {
      handlers.resized = handler;
      return Promise.resolve(vi.fn());
    }),
    onCloseRequested: vi.fn(() => Promise.resolve(vi.fn())),
  };

  return {
    handlers,
    MockPhysicalPosition,
    MockPhysicalSize,
    windowMock,
  };
});

const windowMock = tauriWindowMock.windowMock;

vi.mock('../../utils/platform', () => ({
  isDesktopTauri: vi.fn(() => true),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => windowMock),
  availableMonitors: vi.fn(),
  PhysicalPosition: tauriWindowMock.MockPhysicalPosition,
  PhysicalSize: tauriWindowMock.MockPhysicalSize,
}));

function monitor(workArea: { x: number; y: number; width: number; height: number }): Monitor {
  return {
    name: 'display',
    position: { x: workArea.x, y: workArea.y },
    size: { width: workArea.width, height: workArea.height },
    workArea: {
      position: { x: workArea.x, y: workArea.y },
      size: { width: workArea.width, height: workArea.height },
    },
    scaleFactor: 1,
  } as Monitor;
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useMainWindowGeometry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    window.localStorage.clear();
    tauriWindowMock.handlers.moved = null;
    tauriWindowMock.handlers.resized = null;

    vi.mocked(isDesktopTauri).mockReturnValue(true);
    vi.mocked(getCurrentWindow).mockReturnValue(windowMock as any);
    vi.mocked(availableMonitors).mockResolvedValue([
      monitor({ x: 0, y: 0, width: 1920, height: 1040 }),
    ]);

    windowMock.outerPosition.mockResolvedValue({ x: 80, y: 90 });
    windowMock.outerSize.mockResolvedValue({ width: 1200, height: 800 });
    windowMock.isMaximized.mockResolvedValue(false);
    windowMock.isMinimized.mockResolvedValue(false);
    windowMock.setPosition.mockResolvedValue(undefined);
    windowMock.setSize.mockResolvedValue(undefined);
    windowMock.maximize.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clamps restored bounds to the visible work area', () => {
    const bounds = resolveRestoredMainWindowBounds(
      { x: -100, y: -50, width: 2200, height: 1200, maximized: false },
      [monitor({ x: 0, y: 0, width: 1920, height: 1040 })],
    );

    expect(bounds).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1040,
      maximized: false,
    });
  });

  it('ignores saved bounds that are fully offscreen', () => {
    const bounds = resolveRestoredMainWindowBounds(
      { x: 3000, y: 2000, width: 900, height: 700, maximized: false },
      [monitor({ x: 0, y: 0, width: 1920, height: 1040 })],
    );

    expect(bounds).toBeNull();
  });

  it('restores saved main window bounds on desktop Tauri', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      x: 100,
      y: 120,
      width: 1000,
      height: 720,
      maximized: false,
    }));

    renderHook(() => useMainWindowGeometry());
    await flushEffects();

    expect(windowMock.setSize).toHaveBeenCalledWith(expect.objectContaining({
      width: 1000,
      height: 720,
    }));
    expect(windowMock.setPosition).toHaveBeenCalledWith(expect.objectContaining({
      x: 100,
      y: 120,
    }));
    expect(windowMock.maximize).not.toHaveBeenCalled();
  });

  it('saves updated bounds after window move or resize events', async () => {
    renderHook(() => useMainWindowGeometry());
    await flushEffects();

    windowMock.outerPosition.mockResolvedValue({ x: 220, y: 240 });
    windowMock.outerSize.mockResolvedValue({ width: 1280, height: 760 });

    act(() => {
      tauriWindowMock.handlers.moved?.();
      vi.advanceTimersByTime(300);
    });
    await flushEffects();

    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}')).toEqual({
      x: 220,
      y: 240,
      width: 1280,
      height: 760,
      maximized: false,
    });
    expect(tauriWindowMock.handlers.resized).toBeTruthy();
  });

  it('continues installing save listeners when restore fails', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      x: 100,
      y: 120,
      width: 1000,
      height: 720,
      maximized: false,
    }));
    windowMock.setSize.mockRejectedValueOnce(new Error('permission denied'));

    renderHook(() => useMainWindowGeometry());
    await flushEffects();

    expect(windowMock.onMoved).toHaveBeenCalled();
    expect(windowMock.onResized).toHaveBeenCalled();

    windowMock.outerPosition.mockResolvedValue({ x: 260, y: 280 });
    windowMock.outerSize.mockResolvedValue({ width: 1300, height: 780 });

    act(() => {
      tauriWindowMock.handlers.resized?.();
      vi.advanceTimersByTime(300);
    });
    await flushEffects();

    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}')).toEqual({
      x: 260,
      y: 280,
      width: 1300,
      height: 780,
      maximized: false,
    });
  });
});
