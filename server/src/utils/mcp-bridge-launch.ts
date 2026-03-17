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
  const jsPath = path.resolve(currentDir, '..', 'plugins', 'mcp-bridge.js');
  const tsPath = path.resolve(currentDir, '..', 'plugins', 'mcp-bridge.ts');

  if (existsSync(jsPath)) {
    return createLaunchConfig(jsPath, 'js');
  }

  if (existsSync(tsPath)) {
    return createLaunchConfig(tsPath, 'ts');
  }

  return createLaunchConfig(jsPath, 'js');
}
