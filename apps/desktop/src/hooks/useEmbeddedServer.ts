/// <reference types="vite/client" />
import { useState, useEffect, useRef, useCallback } from 'react';
import { Command, type Child } from '@tauri-apps/plugin-shell';
import { appDataDir, resolveResource } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';

export type EmbeddedServerStatus = 'idle' | 'starting' | 'ready' | 'error' | 'disabled' | 'wsl-mode';

interface EmbeddedServerState {
  port: number | null;
  status: EmbeddedServerStatus;
  error: string | null;
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

/**
 * Detect if we're running inside a Tauri desktop app (not Android/mobile/Windows).
 * On mobile, the shell spawn capability isn't available.
 * On Windows, the app runs as UI-only — server runs in WSL or remotely.
 */
function isDesktopTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    '__TAURI_INTERNALS__' in window &&
    !navigator.userAgent.includes('Android') &&
    !navigator.userAgent.includes('Windows')
  );
}

/**
 * Detect if we're running on Windows with Tauri.
 * Returns true only on Windows desktop (not mobile/browser).
 */
export function isWindowsTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    '__TAURI_INTERNALS__' in window &&
    navigator.userAgent.includes('Windows')
  );
}

/**
 * Resolve the path to the server entry point.
 * In dev mode, this is relative to the Tauri app's working directory.
 * In production, the server is bundled as a Tauri resource.
 */
async function resolveServerPath(): Promise<string> {
  if (import.meta.env.DEV) {
    // Tauri dev cwd is apps/desktop/src-tauri/, so we need 3 levels up
    return '../../../server/dist/index.js';
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
    if (!isDesktopTauri()) return 'disabled';
    return 'starting';
  };

  const [state, setState] = useState<EmbeddedServerState>(() => ({
    port: null,
    status: getInitialStatus(),
    error: null,
  }));

  const childRef = useRef<Child | null>(null);
  const mountedRef = useRef(true);

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

      // If server is already running on port 3100 (e.g. after HMR remount), reuse it
      try {
        const resp = await fetch('http://127.0.0.1:3100/health');
        if (resp.ok) {
          console.log('[EmbeddedServer] Server already running on port 3100, reusing');
          setState({ port: 3100, status: 'ready', error: null });
          return;
        }
      } catch {
        // Not running, proceed to spawn
      }

      // Use /tmp to avoid space issues in env vars with sidecar
      const dataDir = '/tmp/my-claudia-dev/';
      const serverPath = await resolveServerPath();

      console.log(`[EmbeddedServer] DEV mode: serverPath=${serverPath}, dataDir=${dataDir}`);

      // Use sidecar to avoid env var space issues with shell execute
      const command = Command.sidecar('binaries/node', [serverPath], {
        env: {
          PORT: '3100',
          SERVER_HOST: '127.0.0.1',
          MY_CLAUDIA_DATA_DIR: dataDir,
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
        fetch('http://127.0.0.1:3100/health').then(resp => {
          if (resp.ok && mountedRef.current) {
            console.log('[EmbeddedServer] Process exited but server still reachable, recovering');
            setState({ port: 3100, status: 'ready', error: null });
          } else if (mountedRef.current) {
            setState(prev => {
              if (prev.status === 'ready') return { ...prev, status: 'error', error: 'Server process exited unexpectedly' };
              if (prev.status === 'starting') return { ...prev, status: 'error', error: `Server process crashed on startup (code=${data.code})` };
              return prev;
            });
          }
        }).catch(() => {
          if (mountedRef.current) {
            setState(prev => {
              if (prev.status === 'ready') return { ...prev, status: 'error', error: 'Server process exited unexpectedly' };
              if (prev.status === 'starting') return { ...prev, status: 'error', error: `Server process crashed on startup (code=${data.code})` };
              return prev;
            });
          }
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

  useEffect(() => {
    mountedRef.current = true;

    if (disabled || !isDesktopTauri()) return;

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
  }, [startServerDev, startServerProd]);

  return state;
}
