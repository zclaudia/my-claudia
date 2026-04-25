/// <reference types="vite/client" />
import { useState, useEffect, useRef, useCallback } from 'react';
import { resolveResource } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { isWindows as isWindowsTauri } from '../utils/platform';

export type WslServerStatus = 'idle' | 'checking' | 'deploying' | 'starting' | 'ready' | 'error';

export interface WslServerState {
  port: number | null;
  status: WslServerStatus;
  error: string | null;
  /** Streaming output lines from deploy/start for UI display */
  outputLines: string[];
}

const DEFAULT_PORT = 3100;
const HEALTH_CHECK_TIMEOUT = 3000;
const WSL_DEPLOY_DIR = '~/.my-claudia/server';

/**
 * Convert a Windows path (e.g. C:\Users\foo\bar) to a WSL path (/mnt/c/Users/foo/bar).
 */
function windowsToWslPath(winPath: string): string {
  return winPath
    .replace(/\\/g, '/')
    .replace(/^([A-Za-z]):\//, (_, drive: string) => `/mnt/${drive.toLowerCase()}/`);
}

/**
 * Check if the server is running at the given address.
 */
async function checkHealth(port: number = DEFAULT_PORT): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);
    const resp = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    clearTimeout(timeoutId);
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Run a WSL command via the Rust-side `wsl_exec` Tauri command.
 *
 * The JS shell-plugin's `Command.execute()` hangs on `wsl bash -c "..."`
 * because the child inherits a GUI-parent stdin handle that never reports
 * EOF, leaving wsl.exe's stdio relay stuck. The Rust path uses
 * `Stdio::null()` for stdin and returns as fast as a direct PowerShell
 * invocation.
 */
async function wslExec(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return await invoke<{ code: number; stdout: string; stderr: string }>('wsl_exec', { args });
}

/**
 * Hook that manages the WSL server lifecycle on Windows:
 * - Checks if server is already running
 * - Deploys the bundled Linux server to WSL if needed
 * - Starts the server and monitors its output
 *
 * Only active on Windows Tauri builds. On other platforms returns { status: 'idle' }.
 */
export function useWslServer(): WslServerState & {
  /** Manually trigger deploy + start. */
  start: () => void;
} {
  const [state, setState] = useState<WslServerState>({
    port: null,
    status: 'idle',
    error: null,
    outputLines: [],
  });

  const mountedRef = useRef(true);

  const appendOutput = useCallback((line: string) => {
    if (!mountedRef.current) return;
    setState(prev => ({
      ...prev,
      outputLines: [...prev.outputLines.slice(-200), line], // Keep last 200 lines
    }));
  }, []);

  /**
   * Check deployed server version in WSL.
   * Returns the version string, or null if not deployed.
   */
  const getDeployedVersion = useCallback(async (): Promise<string | null> => {
    try {
      const result = await wslExec(['bash', '-c', `cat ${WSL_DEPLOY_DIR}/.version 2>/dev/null`]);
      if (result.code === 0 && result.stdout.trim()) {
        return result.stdout.trim();
      }
    } catch {
      // Not deployed
    }
    return null;
  }, []);

  /**
   * Deploy the bundled server to WSL.
   * Copies from the Windows resource path to ~/.my-claudia/server/ in WSL.
   */
  const deploy = useCallback(async (): Promise<boolean> => {
    setState(prev => ({ ...prev, status: 'deploying', error: null, outputLines: [] }));
    appendOutput('[Deploy] Resolving bundled server path...');

    try {
      // In dev mode, the wsl-server resource doesn't exist — use the local build
      let wslSourcePath: string;
      if (import.meta.env.DEV) {
        // In dev, point to the server bundle built locally
        // Tauri dev cwd is apps/desktop/src-tauri/
        const winPath = new URL('../../../server/bundle/', window.location.href).pathname;
        // For dev, we assume we're running in WSL or the source is accessible
        wslSourcePath = windowsToWslPath(winPath);
        appendOutput(`[Deploy] DEV mode: using local bundle`);
      } else {
        const winResourcePath = await resolveResource('wsl-server');
        wslSourcePath = windowsToWslPath(winResourcePath);
        appendOutput(`[Deploy] Source: ${wslSourcePath}`);
      }

      // Deploy to WSL
      appendOutput(`[Deploy] Copying to ${WSL_DEPLOY_DIR}...`);
      const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
      const deployCmd = [
        `rm -rf ${WSL_DEPLOY_DIR}`,
        `mkdir -p ${WSL_DEPLOY_DIR}`,
        `cp -r '${wslSourcePath}/'* ${WSL_DEPLOY_DIR}/`,
        `chmod +x ${WSL_DEPLOY_DIR}/node`,
        `echo '${appVersion}' > ${WSL_DEPLOY_DIR}/.version`,
        `echo "Deploy complete: $(ls ${WSL_DEPLOY_DIR}/ | wc -l) items"`,
      ].join(' && ');

      const result = await wslExec(['bash', '-c', deployCmd]);

      if (result.code !== 0) {
        const errMsg = result.stderr.trim() || 'Deploy failed';
        appendOutput(`[Deploy] ERROR: ${errMsg}`);
        if (mountedRef.current) {
          setState(prev => ({ ...prev, status: 'error', error: errMsg }));
        }
        return false;
      }

      appendOutput(result.stdout.trim());
      appendOutput('[Deploy] Done');
      return true;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      appendOutput(`[Deploy] ERROR: ${errMsg}`);
      if (mountedRef.current) {
        setState(prev => ({ ...prev, status: 'error', error: errMsg }));
      }
      return false;
    }
  }, [appendOutput]);

  /**
   * Start the server in WSL via the Rust-side `wsl_start_server` Tauri
   * command. Rust spawns `wsl bash -c "..."` with `Stdio::null()` for
   * stdin (avoiding the JS shell-plugin hang), waits for SERVER_READY,
   * and returns the port. Detailed server stdout/stderr is logged to
   * the Rust app's stderr instead of the in-app TerminalOutput.
   */
  const startServer = useCallback(async () => {
    setState(prev => ({ ...prev, status: 'starting' }));
    appendOutput('[Server] Starting...');

    try {
      const { port } = await invoke<{ port: number }>('wsl_start_server');
      appendOutput(`[Server] Ready on port ${port}`);
      if (mountedRef.current) {
        setState(prev => ({ ...prev, port, status: 'ready', error: null }));
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[WslServer] Failed to start:', err);
      appendOutput(`[Server] Failed: ${errMsg}`);
      if (mountedRef.current) {
        setState(prev => ({ ...prev, status: 'error', error: errMsg }));
      }
    }
  }, [appendOutput]);

  /**
   * Full flow: check health → deploy if needed → start.
   */
  const start = useCallback(async () => {
    if (!isWindowsTauri()) return;

    setState(prev => ({ ...prev, status: 'checking', error: null, outputLines: [] }));
    appendOutput('[Check] Checking if server is already running...');

    // 1. Quick health check — maybe server is already running
    if (await checkHealth()) {
      appendOutput('[Check] Server already running');
      if (mountedRef.current) {
        setState(prev => ({ ...prev, port: DEFAULT_PORT, status: 'ready', error: null }));
      }
      return;
    }

    // 2. Check if we need to deploy
    appendOutput('[Check] Checking deployed version...');
    const deployedVersion = await getDeployedVersion();
    const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

    if (deployedVersion !== appVersion) {
      appendOutput(
        deployedVersion
          ? `[Check] Version mismatch: deployed=${deployedVersion}, app=${appVersion}`
          : '[Check] Server not deployed yet'
      );

      // Deploy
      const ok = await deploy();
      if (!ok) return;
    } else {
      appendOutput(`[Check] Server v${deployedVersion} already deployed`);
    }

    // 3. Start
    await startServer();
  }, [appendOutput, deploy, getDeployedVersion, startServer]);

  // Track mount state. The server process is owned by Rust and intentionally
  // outlives this hook — WindowsSetup unmounts when the app transitions to
  // the main UI, and we want the WSL server to keep running.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return { ...state, start };
}
