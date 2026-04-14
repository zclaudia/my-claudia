/// <reference types="vite/client" />
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Command, type Child } from '@tauri-apps/plugin-shell';
import { appDataDir, resolveResource } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';

export type EmbeddedServerStatus = 'idle' | 'starting' | 'ready' | 'error' | 'disabled' | 'wsl-mode';

interface EmbeddedServerCoreState {
  port: number | null;
  status: EmbeddedServerStatus;
  error: string | null;
}

export interface EmbeddedServerState extends EmbeddedServerCoreState {
  restart: () => Promise<void>;
}

interface OpenCodeEndpointProbeResult {
  base_url: string;
  host: string;
  port: number;
  ok: boolean;
  detail: string;
}

type ProbeWindow = typeof window & {
  __MY_CLAUDIA_OPENCODE_PROBE_RAN__?: boolean;
  __MY_CLAUDIA_PROBE_ENDPOINT__?: (baseUrl: string) => Promise<OpenCodeEndpointProbeResult | null>;
};

const DEV_HEALTHCHECK_URL = 'http://127.0.0.1:3100/health';
const DEV_HEALTHCHECK_RETRY_DELAYS_MS = [150, 300, 500, 750, 1000, 1500];
const DEV_SERVER_PATH = '../../../server/dist/index.js';
const DEV_REPO_ROOT = '../../..';
const DEV_NATIVE_MODULE_CHECKER = '../../../scripts/check-native-modules.mjs';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

import { isDesktopTauriNonWindows, isWindows as isWindowsTauri } from '../utils/platform';

/**
 * Resolve the path to the server entry point.
 * In dev mode, this is relative to the Tauri app's working directory.
 * In production, the server is bundled as a Tauri resource.
 */
async function resolveServerPath(): Promise<string> {
  if (import.meta.env.DEV) {
    // Tauri dev cwd is apps/desktop/src-tauri/, so we need 3 levels up
    return DEV_SERVER_PATH;
  }
  return await resolveResource('server/server.mjs');
}

/**
 * Hook that spawns an embedded Node.js server process on a random available port.
 * Only active on desktop Tauri builds — on mobile/browser, returns { status: 'disabled' }.
 *
 * In dev mode, uses the Tauri JS shell plugin (Command.create) with system node.
 * In production, uses a Rust-side Tauri command that directly spawns the bundled
 * node sidecar and reads stdout for SERVER_READY:<port>.
 */
export function useEmbeddedServer(options?: { disabled?: boolean }): EmbeddedServerState {
  const disabled = options?.disabled ?? false;

  // Determine initial status based on platform
  const getInitialStatus = (): EmbeddedServerStatus => {
    if (disabled) return 'disabled';
    if (isWindowsTauri()) return 'wsl-mode';
    if (!isDesktopTauriNonWindows()) return 'disabled';
    return 'starting';
  };

  const [state, setState] = useState<EmbeddedServerCoreState>(() => ({
    port: null,
    status: getInitialStatus(),
    error: null,
  }));

  const childRef = useRef<Child | null>(null);
  const mountedRef = useRef(true);
  const [restartNonce, setRestartNonce] = useState(0);

  const registerManualEndpointProbe = useCallback(() => {
    const probeWindow = window as ProbeWindow;
    if (probeWindow.__MY_CLAUDIA_PROBE_ENDPOINT__) return;

    probeWindow.__MY_CLAUDIA_PROBE_ENDPOINT__ = async (baseUrl: string) => {
      try {
        const result = await invoke<OpenCodeEndpointProbeResult>('probe_network_endpoint', { baseUrl });
        const log = result.ok ? console.log : console.warn;
        log(
          `[EmbeddedServer] Manual endpoint probe ${result.ok ? 'ok' : 'failed'}: ${result.base_url} (${result.host}:${result.port}) -> ${result.detail}`,
        );
        return result;
      } catch (err) {
        console.warn('[EmbeddedServer] Manual endpoint probe failed to run:', err);
        return null;
      }
    };
  }, []);

  const runOpencodeEndpointProbe = useCallback(async () => {
    const probeWindow = window as ProbeWindow;
    if (probeWindow.__MY_CLAUDIA_OPENCODE_PROBE_RAN__) return;
    probeWindow.__MY_CLAUDIA_OPENCODE_PROBE_RAN__ = true;

    try {
      const results = await invoke<OpenCodeEndpointProbeResult[]>('probe_opencode_endpoints');
      if (!Array.isArray(results) || results.length === 0) {
        console.warn('[EmbeddedServer] OpenCode endpoint probe: no configured provider baseURL found');
        return;
      }

      for (const result of results) {
        const log = result.ok ? console.log : console.warn;
        log(
          `[EmbeddedServer] OpenCode endpoint probe ${result.ok ? 'ok' : 'failed'}: ${result.base_url} (${result.host}:${result.port}) -> ${result.detail}`,
        );
      }
    } catch (err) {
      console.warn('[EmbeddedServer] OpenCode endpoint probe failed to run:', err);
    }
  }, []);

  const startServerDev = useCallback(async () => {
    try {
      registerManualEndpointProbe();
      void runOpencodeEndpointProbe();
      const shellNetworkEnv = await invoke<Record<string, string>>('get_shell_network_env').catch(() => ({}));

      // In tauri dev, beforeDevCommand starts the workspace server on port 3100 in parallel.
      // Vite may become ready first, so give the existing dev server a short window to finish booting
      // before falling back to spawning a sidecar on a random port.
      for (let attempt = 0; attempt <= DEV_HEALTHCHECK_RETRY_DELAYS_MS.length; attempt++) {
        try {
          const resp = await fetch(DEV_HEALTHCHECK_URL);
          if (resp.ok) {
            console.log('[EmbeddedServer] Server already running on port 3100, reusing');
            setState({ port: 3100, status: 'ready', error: null });
            return;
          }
        } catch {
          // Not ready yet, retry below.
        }

        if (attempt < DEV_HEALTHCHECK_RETRY_DELAYS_MS.length) {
          await sleep(DEV_HEALTHCHECK_RETRY_DELAYS_MS[attempt]);
        }
      }

      // Use /tmp to avoid space issues in env vars with sidecar
      const dataDir = '/tmp/my-claudia-dev/';
      const serverPath = await resolveServerPath();

      console.log(`[EmbeddedServer] DEV mode: serverPath=${serverPath}, dataDir=${dataDir}`);

      // The sidecar Node version may differ from the user's current workspace
      // install. Re-run the existing ABI self-check before loading native modules
      // from server/dist in dev mode.
      const nativeModuleCheck = await Command.sidecar('binaries/node', [DEV_NATIVE_MODULE_CHECKER], {
        cwd: DEV_REPO_ROOT,
        env: shellNetworkEnv,
      }).execute();
      if (nativeModuleCheck.stdout.trim()) {
        console.log(`[EmbeddedServer] Native module check:\n${nativeModuleCheck.stdout.trim()}`);
      }
      if (nativeModuleCheck.stderr.trim()) {
        console.warn(`[EmbeddedServer] Native module check stderr:\n${nativeModuleCheck.stderr.trim()}`);
      }
      if (nativeModuleCheck.code !== 0) {
        throw new Error('Native module compatibility check failed. Try running `pnpm rebuild` in the workspace.');
      }

      // Use sidecar to avoid env var space issues with shell execute
      const command = Command.sidecar('binaries/node', [serverPath], {
        cwd: DEV_REPO_ROOT,
        env: {
          PORT: '0',
          SERVER_HOST: '127.0.0.1',
          MY_CLAUDIA_DATA_DIR: dataDir,
          MY_CLAUDIA_CHANNEL: 'dev',
          ...shellNetworkEnv,
        },
      });

      command.stdout.on('data', (line: string) => {
        const trimmed = line.trim();
        const match = trimmed.match(/^SERVER_READY:(\d+)$/);
        if (match && mountedRef.current) {
          const port = parseInt(match[1], 10);
          console.log(`[EmbeddedServer] Ready on port ${port}`);
          setState({ port, status: 'ready', error: null });
        }
        if (!match) {
          console.log(`[EmbeddedServer] ${line}`);
        }
      });

      command.stderr.on('data', (line: string) => {
        console.warn(`[EmbeddedServer] ${line}`);
      });

      command.on('error', (error: string) => {
        console.error('[EmbeddedServer] Process error:', error);
        if (mountedRef.current) {
          setState(prev => ({ ...prev, status: 'error', error }));
        }
      });

      command.on('close', (data: { code: number | null; signal: number | null }) => {
        console.log(`[EmbeddedServer] Process exited (code=${data.code}, signal=${data.signal})`);
        if (!mountedRef.current) return;
        // Before marking as error, check if server is still reachable
        // (handles React StrictMode double-mount: old process dies but new one is running)
        setState(prev => {
          const recoveryPort = prev.port;
          if (!recoveryPort) {
            if (prev.status === 'ready') return { ...prev, status: 'error', error: 'Server process exited unexpectedly' };
            if (prev.status === 'starting') return { ...prev, status: 'error', error: `Server process crashed on startup (code=${data.code})` };
            return prev;
          }
          fetch(`http://127.0.0.1:${recoveryPort}/health`).then(resp => {
            if (resp.ok && mountedRef.current) {
              console.log(`[EmbeddedServer] Process exited but server still reachable on port ${recoveryPort}, recovering`);
              setState({ port: recoveryPort, status: 'ready', error: null });
            } else if (mountedRef.current) {
              setState(p => {
                if (p.status === 'ready') return { ...p, status: 'error', error: 'Server process exited unexpectedly' };
                if (p.status === 'starting') return { ...p, status: 'error', error: `Server process crashed on startup (code=${data.code})` };
                return p;
              });
            }
          }).catch(() => {
            if (mountedRef.current) {
              setState(p => {
                if (p.status === 'ready') return { ...p, status: 'error', error: 'Server process exited unexpectedly' };
                if (p.status === 'starting') return { ...p, status: 'error', error: `Server process crashed on startup (code=${data.code})` };
                return p;
              });
            }
          });
          return prev;
        });
      });

      const child = await command.spawn();
      childRef.current = child;
      console.log(`[EmbeddedServer] Spawned server process (pid=${child.pid})`);

      // Register PID with Rust so the exit hook can clean it up
      invoke('register_dev_server_pid', { pid: child.pid }).catch((err) => {
        console.warn('[EmbeddedServer] Failed to register dev server pid:', err);
      });
    } catch (err) {
      console.error('[EmbeddedServer] Failed to start:', err);
      if (mountedRef.current) {
        setState({
          port: null,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }, [registerManualEndpointProbe, runOpencodeEndpointProbe]);

  const startServerProd = useCallback(async () => {
    try {
      registerManualEndpointProbe();
      void runOpencodeEndpointProbe();

      const dataDir = await appDataDir();
      const serverPath = await resolveResource('server/server.mjs');

      console.log(`[EmbeddedServer] PROD mode: serverPath=${serverPath}, dataDir=${dataDir}`);

      // Use the Rust-side command to spawn node and capture SERVER_READY
      const result = await invoke<{ port: number }>('start_server', {
        serverPath,
        dataDir,
      });

      if (mountedRef.current) {
        console.log(`[EmbeddedServer] Ready on port ${result.port}`);
        setState({ port: result.port, status: 'ready', error: null });
      }
    } catch (err) {
      console.error('[EmbeddedServer] Failed to start:', err);
      if (mountedRef.current) {
        setState({
          port: null,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }, [registerManualEndpointProbe, runOpencodeEndpointProbe]);

  const restart = useCallback(async () => {
    if (disabled || !isDesktopTauriNonWindows()) return;

    setState((prev) => ({
      ...prev,
      status: 'starting',
      error: null,
      port: null,
    }));

    if (import.meta.env.DEV) {
      const child = childRef.current;
      childRef.current = null;
      if (child) {
        await child.kill().catch(() => {});
      }
    } else {
      await invoke('stop_server').catch(() => {});
    }

    setRestartNonce((value) => value + 1);
  }, [disabled]);

  useEffect(() => {
    mountedRef.current = true;

    if (disabled || !isDesktopTauriNonWindows()) return;

    if (import.meta.env.DEV) {
      startServerDev();
    } else {
      startServerProd();
    }

    return () => {
      mountedRef.current = false;
      if (import.meta.env.DEV) {
        // Dev mode: do NOT kill the server process on cleanup.
        // React StrictMode unmount+remount causes a race condition:
        // cleanup kills the process, but the next mount's health check
        // may catch the dying process and "reuse" it, then it dies → stuck in ready state.
        // Leaving the server running lets the next mount genuinely reuse it.
        // The process will be cleaned up when the Tauri window closes.
      } else {
        // Production: kill via Rust command
        invoke('stop_server').catch(() => {});
      }
    };
  }, [restartNonce, startServerDev, startServerProd]);

  return useMemo(() => ({
    ...state,
    restart,
  }), [state, restart]);
}
