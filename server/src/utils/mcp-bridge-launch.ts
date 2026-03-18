import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export interface McpBridgeLaunchConfig {
  command: string;
  args: string[];
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
  //   dev (dist/utils/) → ../plugins/mcp-bridge.{js,ts}
  //   bundle (server/)  → plugins/mcp-bridge.js  (import.meta.url is server.mjs)
  const candidates: Array<{ path: string; runtime: 'js' | 'ts' }> = [
    { path: path.resolve(currentDir, '..', 'plugins', 'mcp-bridge.js'), runtime: 'js' },
    { path: path.resolve(currentDir, 'plugins', 'mcp-bridge.js'), runtime: 'js' },
    { path: path.resolve(currentDir, '..', 'plugins', 'mcp-bridge.ts'), runtime: 'ts' },
    { path: path.resolve(currentDir, 'plugins', 'mcp-bridge.ts'), runtime: 'ts' },
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate.path)) {
      return createLaunchConfig(candidate.path, candidate.runtime);
    }
  }

  // Fallback to first candidate (will fail at runtime with a clear path)
  return createLaunchConfig(candidates[0].path, 'js');
}
