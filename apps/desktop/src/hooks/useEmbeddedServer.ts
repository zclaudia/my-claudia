/// <reference types="vite/client" />
import { useState, useEffect, useRef, useCallback } from 'react';
import { Command, type Child } from '@tauri-apps/plugin-shell';
import { appDataDir, resolveResource } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';

export type EmbeddedServerStatus = 'idle' | 'starting' | 'ready' | 'error' | 'disabled';

interface EmbeddedServerState {
  port: number | null;
  status: EmbeddedServerStatus;
  error: string | null;
}

/**
 * Detect if we're running inside a Tauri desktop app (not Android/mobile).
 * On mobile, the shell spawn capability isn't available.
 */
function isDesktopTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    '__TAURI_INTERNALS__' in window &&
    !navigator.userAgent.includes('Android')
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
export function useEmbeddedServer(): EmbeddedServerState {
  const [state, setState] = useState<EmbeddedServerState>(() => ({
    port: null,
    status: isDesktopTauri() ? 'starting' : 'disabled',
    error: null,
  }));

  const childRef = useRef<Child | null>(null);
  const mountedRef = useRef(true);

  const startServerDev = useCallback(async () => {
    try {
      const baseDataDir = await appDataDir();
      const dataDir = baseDataDir.replace(/\/?$/, '-dev/');
      const serverPath = await resolveServerPath();

      console.log(`[EmbeddedServer] DEV mode: serverPath=${serverPath}, dataDir=${dataDir}`);

      const command = Command.create('run-node', [serverPath], {
        env: {
          PORT: '0',
          SERVER_HOST: '127.0.0.1',
          MY_CLAUDIA_DATA_DIR: dataDir,
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
        if (mountedRef.current) {
          setState(prev => {
            if (prev.status === 'ready') {
              return { ...prev, status: 'error', error: 'Server process exited unexpectedly' };
            }
            if (prev.status === 'starting') {
              return { ...prev, status: 'error', error: `Server process crashed on startup (code=${data.code})` };
            }
            return prev;
          });
        }
      });

      const child = await command.spawn();
      childRef.current = child;
      console.log(`[EmbeddedServer] Spawned server process (pid=${child.pid})`);
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
  }, []);

  const startServerProd = useCallback(async () => {
    try {
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
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    if (!isDesktopTauri()) return;

    if (import.meta.env.DEV) {
      startServerDev();
    } else {
      startServerProd();
    }

    return () => {
      mountedRef.current = false;
      if (import.meta.env.DEV) {
        // Dev mode: kill via JS child ref
        if (childRef.current) {
          console.log('[EmbeddedServer] Killing server process...');
          childRef.current.kill().catch(() => {});
          childRef.current = null;
        }
      } else {
        // Production: kill via Rust command
        invoke('stop_server').catch(() => {});
      }
    };
  }, [startServerDev, startServerProd]);

  return state;
}
