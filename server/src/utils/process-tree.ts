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

export async function listDescendantProcesses(parentPid: number): Promise<ChildProcessInfo[]> {
  try {
    const { stdout } = await execFileAsync('ps', [
      '-e', '-o', 'pid=,ppid=,etimes=,comm=,args=',
    ]);

    const allProcesses: Array<{ pid: number; ppid: number; etimes: number; comm: string; args: string }> = [];
    for (const line of stdout.trim().split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)/);
      if (!match) continue;
      allProcesses.push({
        pid: Number(match[1]),
        ppid: Number(match[2]),
        etimes: Number(match[3]),
        comm: match[4],
        args: match[5],
      });
    }

    const descendants: ChildProcessInfo[] = [];
    const frontier = [parentPid];
    const visited = new Set<number>([parentPid]);

    while (frontier.length > 0) {
      const current = frontier.shift()!;
      for (const proc of allProcesses) {
        if (proc.ppid !== current || visited.has(proc.pid)) continue;
        visited.add(proc.pid);
        frontier.push(proc.pid);
        descendants.push({
          pid: proc.pid,
          ppid: proc.ppid,
          command: proc.comm,
          args: proc.args,
          elapsedSeconds: proc.etimes,
        });
      }
    }

    return descendants;
  } catch {
    return [];
  }
}

export function summarizeProcesses(processes: ChildProcessInfo[]): string {
  if (processes.length === 0) return 'none';
  return processes
    .map(proc => `PID=${proc.pid} PPID=${proc.ppid} CMD=${proc.command} ET=${proc.elapsedSeconds}s ARGS=${proc.args}`)
    .join(' | ');
}
