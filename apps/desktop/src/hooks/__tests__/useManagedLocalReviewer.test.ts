import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useManagedLocalReviewer } from '../useManagedLocalReviewer';
import { useLocalReviewerStore } from '../../stores/localReviewerStore';

type EventHandler = (...args: any[]) => void;
let stdoutHandlers: Map<string, EventHandler>;
let stderrHandlers: Map<string, EventHandler>;
let commandHandlers: Map<string, EventHandler>;

function createMockCommand() {
  stdoutHandlers = new Map();
  stderrHandlers = new Map();
  commandHandlers = new Map();

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
    spawn: vi.fn().mockResolvedValue({
      pid: 4242,
      kill: vi.fn().mockResolvedValue(undefined),
    }),
  };
}

let latestMockCommand: ReturnType<typeof createMockCommand>;

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: {
    sidecar: vi.fn(() => {
      latestMockCommand = createMockCommand();
      return latestMockCommand;
    }),
  },
}));

vi.mock('@tauri-apps/api/path', () => ({
  resolveResource: vi.fn(() => Promise.resolve('/app/resources/ollama')),
}));

vi.mock('../../utils/platform', () => ({
  isDesktopTauri: vi.fn(() => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('useManagedLocalReviewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      writable: true,
      configurable: true,
    });

    useLocalReviewerStore.setState({
      enabled: true,
      provider: 'ollama',
      endpoint: 'http://127.0.0.1:11434',
      model: 'qwen3:4b-instruct',
      managedRuntime: true,
      autoStart: true,
      managedPid: null,
      status: {
        state: 'disabled',
        endpoint: 'http://127.0.0.1:11434',
        model: 'qwen3:4b-instruct',
        binaryAvailable: false,
        serverReachable: false,
        modelAvailable: false,
        managedRuntimeActive: false,
      },
    });
  });

  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
  });

  it('marks runtime ready when ollama is already reachable', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: 'qwen3:4b-instruct' }] }),
    });

    renderHook(() => useManagedLocalReviewer());

    await waitFor(() => {
      expect(useLocalReviewerStore.getState().status.state).toBe('ready');
    });
  });

  it('spawns sidecar when endpoint is down and then becomes ready', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: 'qwen3:4b-instruct' }] }),
      });

    renderHook(() => useManagedLocalReviewer());

    await waitFor(() => {
      expect(useLocalReviewerStore.getState().managedPid).toBe(4242);
      expect(useLocalReviewerStore.getState().status.state).toBe('ready');
      expect(useLocalReviewerStore.getState().status.managedRuntimeActive).toBe(true);
    });
  });

  it('marks runtime missing_model when service is up without the configured model', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: 'gemma-3:4b' }] }),
    });

    renderHook(() => useManagedLocalReviewer());

    await waitFor(() => {
      expect(useLocalReviewerStore.getState().status.state).toBe('missing_model');
    });
  });
});
