import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { toolRegistry } from '../domains/plugins/tool-registry.js';

export interface McpBridgeLaunchConfig {
  command: string;
  args: string[];
}

export interface McpBridgeServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Build the standard 'claudia-plugins' MCP bridge server entry.
 * Returns null if no bridge tools are registered.
 *
 * @param serverPort - Local server port for the bridge URL
 * @param sessionId - Session ID (direct env var) or undefined
 * @param sessionIdFile - Session ID file path (for providers that load MCP once at startup)
 */
export function buildMcpBridgeEntry(
  serverPort: number,
  sessionId?: string,
  sessionIdFile?: string,
): McpBridgeServerEntry | null {
  const bridgeTools = toolRegistry.getBridgeTools();
  if (bridgeTools.length === 0) return null;

  const launch = resolveMcpBridgeLaunchConfig();
  const env: Record<string, string> = {
    CLAUDIA_BRIDGE_URL: `http://127.0.0.1:${serverPort}`,
  };
  if (sessionIdFile) {
    env.CLAUDIA_SESSION_ID_FILE = sessionIdFile;
  } else if (sessionId) {
    env.CLAUDIA_SESSION_ID = sessionId;
  }

  return {
    command: launch.command,
    args: launch.args,
    env,
  };
}

function createLaunchConfig(
  filePath: string,
  runtime: 'js' | 'ts',
): McpBridgeLaunchConfig {
  if (runtime === 'js') {
    return {
      command: process.execPath,
      args: [filePath],
    };
  }

  return {
    command: process.execPath,
    args: ['--import', 'tsx/esm', filePath],
  };
}

export function resolveMcpBridgeLaunchConfig(
  currentModuleUrl: string = import.meta.url,
): McpBridgeLaunchConfig {
  const currentDir = path.dirname(fileURLToPath(currentModuleUrl));

  // Search candidates:
  //   dev source (src/utils/) → ../../dist/domains/plugins/mcp-bridge.js (preferred)
  //   dev dist   (dist/utils/) → ../domains/plugins/mcp-bridge.js
  //   bundle     (server/)     → domains/plugins/mcp-bridge.js  (import.meta.url is server.mjs)
  //   legacy bundle fallback   → plugins/mcp-bridge.js
  //   final fallback           → source ts bridge via tsx/esm
  const candidates: Array<{ path: string; runtime: 'js' | 'ts' }> = [
    { path: path.resolve(currentDir, '..', '..', 'dist', 'domains', 'plugins', 'mcp-bridge.js'), runtime: 'js' },
    { path: path.resolve(currentDir, '..', 'domains', 'plugins', 'mcp-bridge.js'), runtime: 'js' },
    { path: path.resolve(currentDir, 'domains', 'plugins', 'mcp-bridge.js'), runtime: 'js' },
    { path: path.resolve(currentDir, 'plugins', 'mcp-bridge.js'), runtime: 'js' },
    { path: path.resolve(currentDir, '..', 'domains', 'plugins', 'mcp-bridge.ts'), runtime: 'ts' },
    { path: path.resolve(currentDir, 'domains', 'plugins', 'mcp-bridge.ts'), runtime: 'ts' },
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate.path)) {
      return createLaunchConfig(candidate.path, candidate.runtime);
    }
  }

  // Fallback to first candidate (will fail at runtime with a clear path)
  return createLaunchConfig(candidates[0].path, 'js');
}
