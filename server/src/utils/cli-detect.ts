import { spawn, execSync } from 'child_process';
import { existsSync, statSync } from 'fs';

export interface DetectedCli {
  type: 'claude' | 'opencode' | 'codex' | 'kimi';
  name: string;
  cliPath: string;
  version?: string;
}

const CLI_COMMANDS = {
  claude: ['claude', 'claude-code'],
  opencode: ['opencode', 'opencode-cli'],
  codex: ['codex'],
  kimi: ['kimi'],
} as const;

function findInPath(command: string): string | null {
  const isWindows = process.platform === 'win32';
  const checkCmd = isWindows ? 'where' : 'which';

  try {
    const result = execSync(
      `${checkCmd} ${command} 2>/dev/null`,
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();

    if (result && result.length > 0) {
      return result.split('\n')[0].trim();
    }
  } catch {}

  return null;
}

// Common installation paths for CLI tools not in PATH
const COMMON_CLI_PATHS = [
  `${process.env.HOME}/.local/bin`,      // pipx, pip user install
  `${process.env.HOME}/.cargo/bin`,      // cargo install
  `${process.env.HOME}/.npm-global/bin`, // npm global
  '/usr/local/bin',                       // Homebrew on macOS (Intel)
];

function findInCommonPaths(command: string): string | null {
  const isWindows = process.platform === 'win32';
  const ext = isWindows ? '.exe' : '';

  for (const dir of COMMON_CLI_PATHS) {
    const fullPath = `${dir}/${command}${ext}`;
    try {
      if (existsSync(fullPath) && statSync(fullPath).isFile()) {
        return fullPath;
      }
    } catch {}
  }

  return null;
}

async function getCliVersion(cliPath: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(cliPath, ['--version'], {
        timeout: 5000,
        shell: true
      });
      
      let output = '';
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      proc.on('close', () => {
        resolve(output.trim() || undefined);
      });
      
      proc.on('error', () => {
        resolve(undefined);
      });
    } catch {
      resolve(undefined);
    }
  });
}

export async function detectCliProviders(): Promise<DetectedCli[]> {
  const detected: DetectedCli[] = [];

  for (const [type, commands] of Object.entries(CLI_COMMANDS)) {
    for (const cmd of commands) {
      // Try PATH first, then common installation directories
      let cliPath = findInPath(cmd);
      if (!cliPath) {
        cliPath = findInCommonPaths(cmd);
      }

      if (cliPath) {
        const version = await getCliVersion(cliPath);
        const nameMap: Record<string, string> = { claude: 'Claude Code', opencode: 'OpenCode', codex: 'Codex', kimi: 'Kimi Code' };
        detected.push({
          type: type as DetectedCli['type'],
          name: nameMap[type] || type,
          cliPath,
          version
        });
        break;
      }
    }
  }

  return detected;
}

export function detectCliProvidersSync(): DetectedCli[] {
  const detected: DetectedCli[] = [];

  for (const [type, commands] of Object.entries(CLI_COMMANDS)) {
    for (const cmd of commands) {
      // Try PATH first, then common installation directories
      let cliPath = findInPath(cmd);
      if (!cliPath) {
        cliPath = findInCommonPaths(cmd);
      }

      if (cliPath) {
        const nameMap: Record<string, string> = { claude: 'Claude Code', opencode: 'OpenCode', codex: 'Codex', kimi: 'Kimi Code' };
        detected.push({
          type: type as DetectedCli['type'],
          name: nameMap[type] || type,
          cliPath,
          version: undefined
        });
        break;
      }
    }
  }

  return detected;
}
