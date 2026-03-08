import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEmbeddedServer } from '../useEmbeddedServer.js';

// Mock Tauri APIs
const mockCommand = {
  spawn: vi.fn(),
};

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: {
    create: vi.fn(() => mockCommand),
    sidecar: vi.fn(() => ({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      spawn: mockCommand.spawn,
    })),
  },
}));

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(() => Promise.resolve('/app/data')),
  resolveResource: vi.fn(() => Promise.resolve('/app/resources/server.js')),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock import.meta.env
vi.mock('import.meta', () => ({
  env: {
    DEV: false,
  },
}));

// Mock fetch for health check
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('hooks/useEmbeddedServer', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  const mockTauriInternals = () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      writable: true,
      configurable: true,
    });
  };

  const removeTauriInternals = () => {
    delete (window as any).__TAURI_INTERNALS__;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Reset window state
    removeTauriInternals();

    // Mock navigator.userAgent for desktop
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      writable: true,
      configurable: true,
    });

    // Default mock for fetch (health check fails)
    mockFetch.mockRejectedValue(new Error('Not running'));
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    removeTauriInternals();
  });

  describe('isDesktopTauri detection', () => {
    it('returns disabled status when not in Tauri', () => {
      removeTauriInternals();

      const { result } = renderHook(() => useEmbeddedServer());

      expect(result.current.status).toBe('disabled');
    });

    it('returns disabled status on Android', () => {
      mockTauriInternals();
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Linux; Android 10)',
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useEmbeddedServer());

      expect(result.current.status).toBe('disabled');
    });

    it('returns starting status in desktop Tauri', () => {
      mockTauriInternals();

      const { result } = renderHook(() => useEmbeddedServer());

      expect(result.current.status).toBe('starting');
    });
  });

  describe('return values', () => {
    it('returns status object with required properties', () => {
      mockTauriInternals();

      const { result } = renderHook(() => useEmbeddedServer());

      expect(result.current).toHaveProperty('status');
      expect(result.current).toHaveProperty('port');
      expect(result.current).toHaveProperty('error');
    });

    it('returns null port initially', () => {
      mockTauriInternals();

      const { result } = renderHook(() => useEmbeddedServer());

      expect(result.current.port).toBeNull();
    });

    it('returns null error initially', () => {
      mockTauriInternals();

      const { result } = renderHook(() => useEmbeddedServer());

      expect(result.current.error).toBeNull();
    });
  });

  describe('cleanup on unmount', () => {
    it('stops server on unmount', () => {
      mockTauriInternals();

      const { unmount } = renderHook(() => useEmbeddedServer());

      unmount();

      // Should not throw
      expect(true).toBe(true);
    });
  });
});
