import { useState, useCallback, useRef, useEffect } from 'react';
import { Command } from '@tauri-apps/plugin-shell';
import { isWindowsTauri } from './useEmbeddedServer';

export interface WslDistro {
  name: string;
  state: 'Running' | 'Stopped';
  version: number; // WSL version (1 or 2)
}

export interface WslDiscoveryState {
  isChecking: boolean;
  wslAvailable: boolean | null;
  serverRunning: boolean | null;
  serverAddress: string | null;
  distros: WslDistro[];
  error: string | null;
}

const DEFAULT_PORT = 3100;
const HEALTH_CHECK_TIMEOUT = 3000;

/**
 * Hook for discovering WSL and servers running inside WSL.
 * Only active on Windows Tauri builds.
 */
export function useWslDiscovery() {
  const [state, setState] = useState<WslDiscoveryState>({
    isChecking: false,
    wslAvailable: null,
    serverRunning: null,
    serverAddress: null,
    distros: [],
    error: null,
  });

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Check if WSL is installed and get available distros
   */
  const checkWslAvailable = useCallback(async (): Promise<boolean> => {
    if (!isWindowsTauri()) {
      return false;
    }

    setState(prev => ({ ...prev, isChecking: true, error: null }));

    try {
      const command = Command.create('wsl-check', ['--list', '--verbose']);
      const output = await command.execute();

      if (!mountedRef.current) return false;

      if (output.code !== 0) {
        // WSL not installed or not available
        setState(prev => ({
          ...prev,
          isChecking: false,
          wslAvailable: false,
          distros: [],
          error: output.code === 1 ? 'WSL is not installed' : 'Failed to check WSL status',
        }));
        return false;
      }

      // Parse WSL output
      const distros = parseWslListOutput(output.stdout);

      setState(prev => ({
        ...prev,
        isChecking: false,
        wslAvailable: true,
        distros,
      }));
      return true;
    } catch (err) {
      if (!mountedRef.current) return false;

      setState(prev => ({
        ...prev,
        isChecking: false,
        wslAvailable: false,
        error: err instanceof Error ? err.message : 'Failed to check WSL',
      }));
      return false;
    }
  }, []);

  /**
   * Check if server is running at the specified address
   */
  const checkServerHealth = useCallback(async (address: string = `localhost:${DEFAULT_PORT}`): Promise<boolean> => {
    const url = `http://${address}/health`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);

      const resp = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (resp.ok) {
        setState(prev => ({
          ...prev,
          serverRunning: true,
          serverAddress: address,
        }));
        return true;
      }
    } catch {
      // Server not running or not reachable
    }

    setState(prev => ({
      ...prev,
      serverRunning: false,
      serverAddress: null,
    }));
    return false;
  }, []);

  /**
   * Run full discovery: check WSL and server status
   */
  const runDiscovery = useCallback(async () => {
    if (!isWindowsTauri()) return;

    setState(prev => ({ ...prev, isChecking: true, error: null }));

    // Check server health first (fast)
    const serverOk = await checkServerHealth();

    // Then check WSL availability
    await checkWslAvailable();

    if (!mountedRef.current) return;

    setState(prev => ({
      ...prev,
      isChecking: false,
      serverRunning: serverOk,
    }));
  }, [checkServerHealth, checkWslAvailable]);

  /**
   * Reset discovery state
   */
  const reset = useCallback(() => {
    setState({
      isChecking: false,
      wslAvailable: null,
      serverRunning: null,
      serverAddress: null,
      distros: [],
      error: null,
    });
  }, []);

  return {
    ...state,
    checkWslAvailable,
    checkServerHealth,
    runDiscovery,
    reset,
  };
}

/**
 * Parse output from `wsl --list --verbose`
 * Example output:
 *   NAME      STATE           VERSION
 *   Ubuntu    Running         2
 *   Debian    Stopped         1
 */
export function parseWslListOutput(output: string): WslDistro[] {
  const lines = output.split('\n').filter(line => line.trim());
  const distros: WslDistro[] = [];

  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cleanLine = line.replace(/\u0000/g, '').trim();
    const match = cleanLine.match(/^(?:\*\s+)?(.+?)\s{2,}(Running|Stopped)\s+(\d+)$/);
    if (!match) continue;

    distros.push({
      name: match[1].trim(),
      state: match[2] as 'Running' | 'Stopped',
      version: parseInt(match[3], 10) || 2,
    });
  }

  return distros;
}

/**
 * Check if server is running at localhost:3100 (one-time check)
 * Useful for quick polling without the full hook
 */
export async function checkWslServerHealth(address: string = `localhost:${DEFAULT_PORT}`): Promise<boolean> {
  const url = `http://${address}/health`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);

    const resp = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return resp.ok;
  } catch {
    return false;
  }
}
