/// <reference types="vite/client" />
import { useState, useEffect, useRef, useCallback } from 'react';
import { Command, type Child } from '@tauri-apps/plugin-shell';
import { appDataDir } from '@tauri-apps/api/path';

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
 * Resolve the path to server/dist/index.js.
 * In dev mode, this is relative to the Tauri app's working directory.
 * In production, the server would be bundled as a Tauri resource (TODO).
 */
function resolveServerPath(): string {
  // In dev mode (Vite dev server), the Tauri app runs from apps/desktop/
  // so the server dist is two levels up
  if (import.meta.env.DEV) {
    return '../../server/dist/index.js';
  }
  // TODO: production — use resolveResource() to locate bundled server
  return '../../server/dist/index.js';
}

/**
 * Hook that spawns an embedded Node.js server process on a random available port.
 * Only active on desktop Tauri builds — on mobile/browser, returns { status: 'disabled' }.
 *
 * The server outputs a machine-readable `SERVER_READY:<port>` line to stdout,
 * which this hook parses to discover the actual bound port.
 */
export function useEmbeddedServer(): EmbeddedServerState {
  const [state, setState] = useState<EmbeddedServerState>(() => ({
    port: null,
    status: isDesktopTauri() ? 'starting' : 'disabled',
    error: null,
  }));

  const childRef = useRef<Child | null>(null);
  const mountedRef = useRef(true);

  const startServer = useCallback(async () => {
    try {
      // In dev mode, append '-dev' to isolate data from the production app
      const baseDataDir = await appDataDir();
      const dataDir = import.meta.env.DEV
        ? baseDataDir.replace(/\/?$/, '-dev/')
        : baseDataDir;
      const serverPath = resolveServerPath();

      const command = Command.create('run-node', [serverPath], {
        env: {
          PORT: '0',
          SERVER_HOST: '127.0.0.1',
          MY_CLAUDIA_DATA_DIR: dataDir,
        },
      });

      command.stdout.on('data', (line: string) => {
        // Parse the machine-readable port announcement
        const match = line.match(/^SERVER_READY:(\d+)$/);
        if (match && mountedRef.current) {
          const port = parseInt(match[1], 10);
          console.log(`[EmbeddedServer] Ready on port ${port}`);
          setState({ port, status: 'ready', error: null });
        }

        // Forward other stdout lines to console for debugging
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
          setState(prev => ({
            ...prev,
            status: prev.status === 'ready' ? 'error' : prev.status,
            error: prev.status === 'ready' ? 'Server process exited unexpectedly' : prev.error,
          }));
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

  useEffect(() => {
    mountedRef.current = true;

    if (!isDesktopTauri()) return;

    startServer();

    return () => {
      mountedRef.current = false;
      if (childRef.current) {
        console.log('[EmbeddedServer] Killing server process...');
        childRef.current.kill().catch(() => {});
        childRef.current = null;
      }
    };
  }, [startServer]);

  return state;
}
