import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ChildProcessInfo {
  pid: number;
  ppid: number;
  command: string;
  args: string;
  elapsedSeconds: number;
}

function parsePsOutput(stdout: string): ChildProcessInfo[] {
  const allProcesses: ChildProcessInfo[] = [];
  for (const line of stdout.trim().split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)/);
    if (!match) continue;
    allProcesses.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      elapsedSeconds: Number(match[3]),
      command: match[4],
      args: match[5],
    });
  }
  return allProcesses;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitForProcessesToExit(
  pids: number[],
  timeoutMs: number,
  pollIntervalMs = 100,
): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  let survivors = [...new Set(pids)].filter(isProcessAlive);

  while (survivors.length > 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    survivors = survivors.filter(isProcessAlive);
  }

  return survivors;
}

export async function listDescendantProcesses(parentPid: number): Promise<ChildProcessInfo[]> {
  try {
    const { stdout } = await execFileAsync('ps', [
      '-e', '-o', 'pid=,ppid=,etimes=,comm=,args=',
    ]);

    const allProcesses = parsePsOutput(stdout);

    const descendants: ChildProcessInfo[] = [];
    const frontier = [parentPid];
    const visited = new Set<number>([parentPid]);

    while (frontier.length > 0) {
      const current = frontier.shift()!;
      for (const proc of allProcesses) {
        if (proc.ppid !== current || visited.has(proc.pid)) continue;
        visited.add(proc.pid);
        frontier.push(proc.pid);
        descendants.push(proc);
      }
    }

    return descendants;
  } catch {
    return [];
  }
}

export async function listAllProcesses(): Promise<ChildProcessInfo[]> {
  try {
    const { stdout } = await execFileAsync('ps', [
      '-e', '-o', 'pid=,ppid=,etimes=,comm=,args=',
    ]);
    return parsePsOutput(stdout);
  } catch {
    return [];
  }
}

export async function findProcessesByArgsIncludes(needles: string[]): Promise<ChildProcessInfo[]> {
  const normalized = [...new Set(needles.map(needle => needle.trim()).filter(Boolean))];
  if (normalized.length === 0) return [];

  const allProcesses = await listAllProcesses();
  return allProcesses.filter(proc =>
    normalized.some(needle => proc.args.includes(needle))
  );
}

/**
 * Kill a process and all its descendants.
 * Sends SIGTERM first, then SIGKILL after a delay for any survivors.
 */
export async function killProcessTree(pid: number, sigkillDelayMs = 3000): Promise<{ killed: number[]; failed: number[] }> {
  const descendants = await listDescendantProcesses(pid);
  // Kill children first (leaves → root), then the parent
  const pidsToKill = [...descendants.map(p => p.pid).reverse(), pid];
  const signaled: number[] = [];

  for (const targetPid of pidsToKill) {
    try {
      process.kill(targetPid, 'SIGTERM');
      signaled.push(targetPid);
    } catch {
      // Process may have already exited.
    }
  }

  if (signaled.length === 0) {
    return { killed: [], failed: [] };
  }

  let survivors = await waitForProcessesToExit(signaled, sigkillDelayMs);

  for (const targetPid of survivors) {
    try {
      process.kill(targetPid, 'SIGKILL');
    } catch {
      // Already dead.
    }
  }

  survivors = await waitForProcessesToExit(survivors, 1000);
  const killed = signaled.filter(targetPid => !survivors.includes(targetPid));

  return { killed, failed: survivors };
}

export function summarizeProcesses(processes: ChildProcessInfo[]): string {
  if (processes.length === 0) return 'none';
  return processes
    .map(proc => `PID=${proc.pid} PPID=${proc.ppid} CMD=${proc.command} ET=${proc.elapsedSeconds}s ARGS=${proc.args}`)
    .join(' | ');
}
