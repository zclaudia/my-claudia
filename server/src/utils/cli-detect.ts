import { spawn, execSync } from 'child_process';

export interface DetectedCli {
  type: 'claude' | 'opencode' | 'codex';
  name: string;
  cliPath: string;
  version?: string;
}

const CLI_COMMANDS = {
  claude: ['claude', 'claude-code'],
  opencode: ['opencode', 'opencode-cli'],
  codex: ['codex'],
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
      const cliPath = findInPath(cmd);
      
      if (cliPath) {
        const version = await getCliVersion(cliPath);
        const nameMap: Record<string, string> = { claude: 'Claude Code', opencode: 'OpenCode', codex: 'Codex' };
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
      const cliPath = findInPath(cmd);
      
      if (cliPath) {
        const nameMap: Record<string, string> = { claude: 'Claude Code', opencode: 'OpenCode', codex: 'Codex' };
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
