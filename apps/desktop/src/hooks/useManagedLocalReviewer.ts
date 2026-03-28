import { useCallback, useEffect, useRef } from 'react';
import { Command, type Child } from '@tauri-apps/plugin-shell';
import { resolveResource } from '@tauri-apps/api/path';
import { useLocalReviewerStore } from '../stores/localReviewerStore';
import { isDesktopTauri } from '../utils/platform';

interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

export interface ManagedLocalReviewerState {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

const OLLAMA_SIDECAR_NAME = 'binaries/ollama';
const OLLAMA_TAGS_PATH = '/api/tags';
const STARTUP_TIMEOUT_MS = 12_000;
const STARTUP_RETRY_INTERVAL_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
}

function endpointToOllamaHost(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return url.host;
  } catch {
    return '127.0.0.1:11434';
  }
}

function modelExists(payload: OllamaTagsResponse | null, model: string): boolean {
  if (!payload?.models?.length) return false;
  return payload.models.some(entry => entry.name === model || entry.model === model);
}

async function fetchTags(endpoint: string): Promise<OllamaTagsResponse | null> {
  const response = await fetch(`${normalizeEndpoint(endpoint)}${OLLAMA_TAGS_PATH}`);
  if (!response.ok) {
    throw new Error(`Ollama probe failed (${response.status})`);
  }
  return response.json() as Promise<OllamaTagsResponse>;
}

export function useManagedLocalReviewer(options?: { disabled?: boolean }): ManagedLocalReviewerState {
  const disabled = options?.disabled ?? false;
  const enabled = useLocalReviewerStore(state => state.enabled);
  const managedRuntime = useLocalReviewerStore(state => state.managedRuntime);
  const autoStart = useLocalReviewerStore(state => state.autoStart);
  const endpoint = useLocalReviewerStore(state => state.endpoint);
  const model = useLocalReviewerStore(state => state.model);
  const childRef = useRef<Child | null>(null);
  const mountedRef = useRef(true);
  const startingRef = useRef(false);

  const start = useCallback(async () => {
    if (disabled || !enabled || !isDesktopTauri()) {
      return;
    }

    if (startingRef.current) return;
    startingRef.current = true;

    try {
      useLocalReviewerStore.getState().setStatus({
        state: 'starting',
        binaryAvailable: false,
        serverReachable: false,
        modelAvailable: false,
        managedRuntimeActive: false,
        lastError: undefined,
      });

      try {
        const existing = await fetchTags(endpoint);
        useLocalReviewerStore.getState().setStatus({
          state: modelExists(existing, model) ? 'ready' : 'missing_model',
          binaryAvailable: !!(await resolveResource(OLLAMA_SIDECAR_NAME).catch(() => null)),
          serverReachable: true,
          modelAvailable: modelExists(existing, model),
          managedRuntimeActive: false,
          lastError: modelExists(existing, model) ? undefined : `Model ${model} is not installed`,
        });
        return;
      } catch {
        if (!managedRuntime || !autoStart) {
          useLocalReviewerStore.getState().setStatus({
            state: 'error',
            binaryAvailable: !!(await resolveResource(OLLAMA_SIDECAR_NAME).catch(() => null)),
            serverReachable: false,
            modelAvailable: false,
            managedRuntimeActive: false,
            lastError: 'Ollama runtime is not reachable',
          });
          return;
        }
      }

      const resourcePath = await resolveResource(OLLAMA_SIDECAR_NAME).catch(() => null);
      if (!resourcePath) {
        useLocalReviewerStore.getState().setStatus({
          state: 'missing_binary',
          binaryAvailable: false,
          serverReachable: false,
          modelAvailable: false,
          managedRuntimeActive: false,
          lastError: 'Bundled Ollama sidecar not found',
        });
        return;
      }

      const command = Command.sidecar(OLLAMA_SIDECAR_NAME, ['serve'], {
        env: {
          OLLAMA_HOST: endpointToOllamaHost(endpoint),
        },
      });

      command.stdout.on('data', (line: string) => {
        console.log(`[LocalReviewer] ${line}`);
      });

      command.stderr.on('data', (line: string) => {
        console.warn(`[LocalReviewer] ${line}`);
      });

      command.on('error', (error: string) => {
        console.error('[LocalReviewer] Process error:', error);
        if (!mountedRef.current) return;
        useLocalReviewerStore.getState().setStatus({
          state: 'error',
          serverReachable: false,
          modelAvailable: false,
          managedRuntimeActive: false,
          lastError: error,
        });
      });

      command.on('close', (data: { code: number | null; signal: number | null }) => {
        console.log(`[LocalReviewer] Process exited (code=${data.code}, signal=${data.signal})`);
        childRef.current = null;
        useLocalReviewerStore.getState().setManagedPid(null);
        if (!mountedRef.current) return;
        useLocalReviewerStore.getState().setStatus({
          state: useLocalReviewerStore.getState().enabled ? 'error' : 'disabled',
          serverReachable: false,
          modelAvailable: false,
          managedRuntimeActive: false,
          lastError: `Managed Ollama exited (code=${data.code}, signal=${data.signal})`,
        });
      });

      const child = await command.spawn();
      childRef.current = child;
      useLocalReviewerStore.getState().setManagedPid(child.pid);

      const deadline = Date.now() + STARTUP_TIMEOUT_MS;
      while (Date.now() < deadline) {
        try {
          const tags = await fetchTags(endpoint);
          const hasModel = modelExists(tags, model);
          useLocalReviewerStore.getState().setStatus({
            state: hasModel ? 'ready' : 'missing_model',
            binaryAvailable: true,
            serverReachable: true,
            modelAvailable: hasModel,
            managedRuntimeActive: true,
            lastError: hasModel ? undefined : `Model ${model} is not installed`,
          });
          return;
        } catch {
          await sleep(STARTUP_RETRY_INTERVAL_MS);
        }
      }

      useLocalReviewerStore.getState().setStatus({
        state: 'error',
        binaryAvailable: true,
        serverReachable: false,
        modelAvailable: false,
        managedRuntimeActive: true,
        lastError: 'Timed out waiting for managed Ollama runtime',
      });
    } catch (error) {
      useLocalReviewerStore.getState().setStatus({
        state: 'error',
        binaryAvailable: false,
        serverReachable: false,
        modelAvailable: false,
        managedRuntimeActive: false,
        lastError: error instanceof Error ? error.message : String(error),
      });
    } finally {
      startingRef.current = false;
    }
  }, [autoStart, disabled, enabled, endpoint, managedRuntime, model]);

  const stop = useCallback(async () => {
    const child = childRef.current;
    childRef.current = null;
    useLocalReviewerStore.getState().setManagedPid(null);

    if (child) {
      await child.kill().catch(() => {});
    }

    const store = useLocalReviewerStore.getState();
    useLocalReviewerStore.getState().setStatus({
      state: store.enabled ? 'error' : 'disabled',
      serverReachable: false,
      modelAvailable: false,
      managedRuntimeActive: false,
      lastError: undefined,
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    if (disabled || !isDesktopTauri() || !enabled) {
      useLocalReviewerStore.getState().setStatus({
        state: 'disabled',
        serverReachable: false,
        modelAvailable: false,
        managedRuntimeActive: false,
        lastError: undefined,
      });
      return () => {
        mountedRef.current = false;
      };
    }

    void start();

    return () => {
      mountedRef.current = false;
      if (!import.meta.env.DEV) {
        void stop();
      } else {
        useLocalReviewerStore.getState().setManagedPid(null);
      }
    };
  }, [disabled, enabled, start, stop]);

  return { start, stop };
}
