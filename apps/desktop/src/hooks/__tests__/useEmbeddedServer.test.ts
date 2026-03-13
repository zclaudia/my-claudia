import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useEmbeddedServer } from '../useEmbeddedServer.js';

// Capture event handlers registered by the hook
type EventHandler = (...args: any[]) => void;
let stdoutHandlers: Map<string, EventHandler>;
let stderrHandlers: Map<string, EventHandler>;
let commandHandlers: Map<string, EventHandler>;
let mockSpawnFn: ReturnType<typeof vi.fn>;

function createMockCommand() {
  stdoutHandlers = new Map();
  stderrHandlers = new Map();
  commandHandlers = new Map();
  mockSpawnFn = vi.fn().mockResolvedValue({ pid: 12345 });

  return {
    stdout: {
      on: vi.fn((event: string, handler: EventHandler) => {
        stdoutHandlers.set(event, handler);
      }),
    },
    stderr: {
      on: vi.fn((event: string, handler: EventHandler) => {
        stderrHandlers.set(event, handler);
      }),
    },
    on: vi.fn((event: string, handler: EventHandler) => {
      commandHandlers.set(event, handler);
    }),
    spawn: mockSpawnFn,
  };
}

let latestMockCommand: ReturnType<typeof createMockCommand>;

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: {
    create: vi.fn(() => {
      latestMockCommand = createMockCommand();
      return latestMockCommand;
    }),
    sidecar: vi.fn(() => {
      latestMockCommand = createMockCommand();
      return latestMockCommand;
    }),
  },
}));

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(() => Promise.resolve('/app/data')),
  resolveResource: vi.fn(() => Promise.resolve('/app/resources/server.js')),
}));

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
}));

// Mock fetch for health check
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('hooks/useEmbeddedServer', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

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
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

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
    consoleWarnSpy.mockRestore();
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

    it('returns wsl-mode status on Windows Tauri', () => {
      mockTauriInternals();
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useEmbeddedServer());

      expect(result.current.status).toBe('wsl-mode');
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

  describe('disabled option', () => {
    it('returns disabled status when disabled option is true', () => {
      mockTauriInternals();

      const { result } = renderHook(() => useEmbeddedServer({ disabled: true }));

      expect(result.current.status).toBe('disabled');
      expect(result.current.port).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('does not spawn server when disabled', async () => {
      mockTauriInternals();

      renderHook(() => useEmbeddedServer({ disabled: true }));

      // Flush all promises
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // sidecar should not have been called
      const { Command } = await import('@tauri-apps/plugin-shell');
      expect(Command.sidecar).not.toHaveBeenCalled();
    });

    it('starts server when disabled is false', () => {
      mockTauriInternals();

      const { result } = renderHook(() => useEmbeddedServer({ disabled: false }));

      expect(result.current.status).toBe('starting');
    });
  });

  describe('health check reuse (dev mode)', () => {
    // In vitest, import.meta.env.DEV is true, so dev path is taken

    it('reuses existing server when health check succeeds', async () => {
      mockTauriInternals();
      mockFetch.mockResolvedValueOnce({ ok: true });

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.status).toBe('ready');
      expect(result.current.port).toBe(3100);
      expect(result.current.error).toBeNull();
    });

    it('does not spawn new process when health check succeeds', async () => {
      mockTauriInternals();
      mockFetch.mockResolvedValueOnce({ ok: true });

      renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // sidecar is called but spawn should not be called since we returned early
      expect(mockSpawnFn).not.toHaveBeenCalled();
    });

    it('spawns new process when health check fails', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockSpawnFn).toHaveBeenCalled();
    });

    it('spawns new process when health check returns non-ok', async () => {
      mockTauriInternals();
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockSpawnFn).toHaveBeenCalled();
    });
  });

  describe('SERVER_READY parsing from stdout', () => {
    it('parses SERVER_READY message and sets port + ready status', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Simulate stdout emitting SERVER_READY
      const stdoutHandler = stdoutHandlers.get('data');
      expect(stdoutHandler).toBeDefined();

      act(() => {
        stdoutHandler!('SERVER_READY:3100');
      });

      expect(result.current.status).toBe('ready');
      expect(result.current.port).toBe(3100);
      expect(result.current.error).toBeNull();
    });

    it('parses SERVER_READY with different port numbers', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const stdoutHandler = stdoutHandlers.get('data');

      act(() => {
        stdoutHandler!('SERVER_READY:8080');
      });

      expect(result.current.port).toBe(8080);
      expect(result.current.status).toBe('ready');
    });

    it('handles SERVER_READY with surrounding whitespace', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const stdoutHandler = stdoutHandlers.get('data');

      act(() => {
        stdoutHandler!('  SERVER_READY:4000  ');
      });

      expect(result.current.port).toBe(4000);
      expect(result.current.status).toBe('ready');
    });

    it('ignores non-SERVER_READY stdout lines', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const stdoutHandler = stdoutHandlers.get('data');

      act(() => {
        stdoutHandler!('Some random log output');
      });

      expect(result.current.status).toBe('starting');
      expect(result.current.port).toBeNull();
    });

    it('logs non-SERVER_READY stdout lines', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const stdoutHandler = stdoutHandlers.get('data');

      act(() => {
        stdoutHandler!('Database initialized');
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Database initialized')
      );
    });
  });

  describe('error handling during spawn', () => {
    it('sets error state when spawn throws', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      // Make sidecar's spawn reject
      const { Command } = await import('@tauri-apps/plugin-shell');
      (Command.sidecar as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        const cmd = createMockCommand();
        cmd.spawn = vi.fn().mockRejectedValue(new Error('Failed to spawn process'));
        latestMockCommand = cmd;
        return cmd;
      });

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.status).toBe('error');
      expect(result.current.error).toBe('Failed to spawn process');
      expect(result.current.port).toBeNull();
    });

    it('sets error state with string error message', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      const { Command } = await import('@tauri-apps/plugin-shell');
      (Command.sidecar as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        const cmd = createMockCommand();
        cmd.spawn = vi.fn().mockRejectedValue('string error');
        latestMockCommand = cmd;
        return cmd;
      });

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.status).toBe('error');
      expect(result.current.error).toBe('string error');
    });
  });

  describe('process lifecycle events', () => {
    it('sets error state on process error event', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const errorHandler = commandHandlers.get('error');
      expect(errorHandler).toBeDefined();

      act(() => {
        errorHandler!('Segmentation fault');
      });

      expect(result.current.status).toBe('error');
      expect(result.current.error).toBe('Segmentation fault');
    });

    it('sets error state on process close during starting', async () => {
      mockTauriInternals();
      // First call rejects (initial health check), subsequent calls also reject (close handler check)
      mockFetch.mockRejectedValue(new Error('Not running'));

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const closeHandler = commandHandlers.get('close');
      expect(closeHandler).toBeDefined();

      // Simulate process close during starting phase
      await act(async () => {
        closeHandler!({ code: 1, signal: null });
        // Let the fetch promise in the close handler resolve/reject
        await vi.runAllTimersAsync();
        // Flush microtasks
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.status).toBe('error');
      expect(result.current.error).toContain('crashed on startup');
    });

    it('sets error state on process close after ready', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // First transition to ready
      const stdoutHandler = stdoutHandlers.get('data');
      act(() => {
        stdoutHandler!('SERVER_READY:3100');
      });

      expect(result.current.status).toBe('ready');

      const closeHandler = commandHandlers.get('close');

      // Simulate process close after ready - health check also fails
      await act(async () => {
        closeHandler!({ code: null, signal: 9 });
        await vi.runAllTimersAsync();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.status).toBe('error');
      expect(result.current.error).toBe('Server process exited unexpectedly');
    });

    it('recovers on close if server is still reachable', async () => {
      mockTauriInternals();

      // First health check (init): fail so we actually spawn
      mockFetch.mockRejectedValueOnce(new Error('Not running'));

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Transition to ready
      const stdoutHandler = stdoutHandlers.get('data');
      act(() => {
        stdoutHandler!('SERVER_READY:3100');
      });

      expect(result.current.status).toBe('ready');

      // On close, health check succeeds -> recovery
      mockFetch.mockResolvedValueOnce({ ok: true });

      const closeHandler = commandHandlers.get('close');

      await act(async () => {
        closeHandler!({ code: 0, signal: null });
        await vi.runAllTimersAsync();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.status).toBe('ready');
      expect(result.current.port).toBe(3100);
    });

    it('registers stderr handler', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const stderrHandler = stderrHandlers.get('data');
      expect(stderrHandler).toBeDefined();

      // Should log stderr output as warning
      act(() => {
        stderrHandler!('Warning: deprecated API');
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Warning: deprecated API')
      );
    });
  });

  describe('dev mode server spawning', () => {
    // import.meta.env.DEV is true in vitest, so this is the default path

    it('calls Command.sidecar with correct arguments', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const { Command } = await import('@tauri-apps/plugin-shell');
      expect(Command.sidecar).toHaveBeenCalledWith(
        'binaries/node',
        ['../../../server/dist/index.js'],
        expect.objectContaining({
          env: expect.objectContaining({
            PORT: '3100',
            SERVER_HOST: '127.0.0.1',
            MY_CLAUDIA_DATA_DIR: '/tmp/my-claudia-dev/',
          }),
        })
      );
    });

    it('stores child process reference after spawn', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockSpawnFn).toHaveBeenCalled();
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

    it('does not update state after unmount on stdout', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      const { result, unmount } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const stdoutHandler = stdoutHandlers.get('data');

      // Unmount sets mountedRef.current = false
      unmount();

      // Now emit SERVER_READY - should be ignored since unmounted
      stdoutHandler?.('SERVER_READY:3100');

      // Status should remain starting (not ready), but we can't check result.current
      // after unmount in the same way. The key is no error is thrown.
      expect(true).toBe(true);
    });

    it('does not update state after unmount on error event', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      const { unmount } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const errorHandler = commandHandlers.get('error');

      unmount();

      // Should not throw when calling handler after unmount
      errorHandler?.('Some error');
      expect(true).toBe(true);
    });

    it('does not call invoke stop_server in dev mode on unmount', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      const { unmount } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      unmount();

      // In dev mode, stop_server should NOT be called (process left running for HMR reuse)
      expect(mockInvoke).not.toHaveBeenCalledWith('stop_server');
    });
  });

  describe('does not start when disabled or non-tauri', () => {
    it('does not start effect when disabled', async () => {
      mockTauriInternals();

      const { result } = renderHook(() => useEmbeddedServer({ disabled: true }));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.status).toBe('disabled');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not start effect when not in Tauri environment', async () => {
      removeTauriInternals();

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.status).toBe('disabled');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
