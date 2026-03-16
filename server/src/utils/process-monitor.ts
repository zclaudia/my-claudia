/**
 * Process monitor — detects leaked child processes across all providers.
 *
 * Periodically scans the process tree under the server PID and compares
 * against known active runs.  When no runs are active but child processes
 * remain, they are flagged (and optionally killed) as leaked.
 */

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

export interface LeakReport {
  timestamp: number;
  activeRunCount: number;
  leakedProcesses: ChildProcessInfo[];
}

/**
 * List all descendant processes of a given PID (non-recursive ps query).
 * Works on macOS and Linux.
 */
async function getDescendantProcesses(parentPid: number): Promise<ChildProcessInfo[]> {
  try {
    // ps -e gives all processes; we filter descendants in JS
    // Format: pid, ppid, elapsed time (seconds), command, full args
    const { stdout } = await execFileAsync('ps', [
      '-e', '-o', 'pid=,ppid=,etimes=,comm=,args=',
    ]);

    const allProcesses: Array<{ pid: number; ppid: number; etimes: number; comm: string; args: string }> = [];
    for (const line of stdout.trim().split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Parse: PID PPID ETIMES COMM ARGS...
      const match = trimmed.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)/);
      if (match) {
        allProcesses.push({
          pid: Number(match[1]),
          ppid: Number(match[2]),
          etimes: Number(match[3]),
          comm: match[4],
          args: match[5],
        });
      }
    }

    // BFS to find all descendants of parentPid
    const descendants: ChildProcessInfo[] = [];
    const frontier = [parentPid];
    const visited = new Set<number>([parentPid]);

    while (frontier.length > 0) {
      const current = frontier.shift()!;
      for (const proc of allProcesses) {
        if (proc.ppid === current && !visited.has(proc.pid)) {
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
    }

    return descendants;
  } catch {
    return [];
  }
}

// ── Process Monitor ──────────────────────────────────────────

export type ActiveRunCountFn = () => number;
export type OnLeakDetectedFn = (report: LeakReport) => void;

interface ProcessMonitorOptions {
  /** How often to scan (ms). Default: 30000 (30s) */
  intervalMs?: number;
  /** Kill leaked processes automatically? Default: false */
  autoKill?: boolean;
  /** Minimum elapsed time (seconds) before a process is considered leaked. Default: 60 */
  minElapsedSeconds?: number;
  /** Process names to ignore (e.g. internal helpers that outlive runs). */
  ignoreCommands?: string[];
}

export class ProcessMonitor {
  private interval: NodeJS.Timeout | null = null;
  private readonly serverPid = process.pid;
  private readonly getActiveRunCount: ActiveRunCountFn;
  private readonly onLeakDetected: OnLeakDetectedFn;
  private readonly opts: Required<ProcessMonitorOptions>;
  /** Notification cooldown state — same PID set triggers progressively longer delays */
  private lastNotifiedPids = new Set<number>();
  private lastNotifyTime = 0;
  private consecutiveSuppressions = 0;
  /** Cooldown tiers: 1st repeat at 5min, then 15min, then 30min cap */
  private static readonly COOLDOWN_TIERS_MS = [5 * 60_000, 15 * 60_000, 30 * 60_000];

  /** Recent leak reports (ring buffer, keeps last 20) */
  readonly recentLeaks: LeakReport[] = [];

  constructor(
    getActiveRunCount: ActiveRunCountFn,
    onLeakDetected: OnLeakDetectedFn,
    options?: ProcessMonitorOptions,
  ) {
    this.getActiveRunCount = getActiveRunCount;
    this.onLeakDetected = onLeakDetected;
    this.opts = {
      intervalMs: options?.intervalMs ?? 30_000,
      autoKill: options?.autoKill ?? false,
      minElapsedSeconds: options?.minElapsedSeconds ?? 60,
      ignoreCommands: options?.ignoreCommands ?? [],
    };
  }

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => this.check(), this.opts.intervalMs);
    this.interval.unref(); // don't prevent server shutdown
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /** Run a check immediately (also called by the periodic interval).
   *  @param forceKill — override autoKill setting and kill leaked processes (for user-initiated cleanup) */
  async check(forceKill = false): Promise<LeakReport | null> {
    const activeRunCount = this.getActiveRunCount();
    const children = await getDescendantProcesses(this.serverPid);

    // If there are active runs, we can't distinguish run children from leaked ones.
    // Only check when no runs are active — run lifecycle (abort/stopTask) handles the rest.
    if (activeRunCount > 0) return null;

    // Filter out short-lived processes and ignored commands
    const leaked = children.filter(p =>
      p.elapsedSeconds >= this.opts.minElapsedSeconds &&
      !this.opts.ignoreCommands.some(cmd => p.command.includes(cmd)),
    );

    if (leaked.length === 0) {
      // All clear — reset cooldown so next leak gets notified immediately
      this.lastNotifiedPids.clear();
      this.lastNotifyTime = 0;
      this.consecutiveSuppressions = 0;
      return null;
    }

    const now = Date.now();
    const report: LeakReport = {
      timestamp: now,
      activeRunCount,
      leakedProcesses: leaked,
    };

    // Store in ring buffer
    this.recentLeaks.push(report);
    if (this.recentLeaks.length > 20) this.recentLeaks.shift();

    // Determine whether to notify: new PIDs → immediate, same PIDs → cooldown
    const currentPids = new Set(leaked.map(p => p.pid));
    const sameAsLast = currentPids.size === this.lastNotifiedPids.size &&
      [...currentPids].every(pid => this.lastNotifiedPids.has(pid));

    let shouldNotify = false;
    if (!sameAsLast || forceKill) {
      // PID set changed or user forced — notify immediately, reset cooldown
      shouldNotify = true;
      this.consecutiveSuppressions = 0;
    } else {
      // Same PIDs still lingering — apply cooldown with progressive backoff
      const tierIndex = Math.min(this.consecutiveSuppressions, ProcessMonitor.COOLDOWN_TIERS_MS.length - 1);
      const cooldownMs = ProcessMonitor.COOLDOWN_TIERS_MS[tierIndex];
      if (now - this.lastNotifyTime >= cooldownMs) {
        shouldNotify = true;
        this.consecutiveSuppressions++;
      }
    }

    if (shouldNotify) {
      this.lastNotifiedPids = currentPids;
      this.lastNotifyTime = now;
      this.onLeakDetected(report);
    }

    if (this.opts.autoKill || forceKill) {
      for (const proc of leaked) {
        try {
          process.kill(proc.pid, 'SIGTERM');
          console.log(`[ProcessMonitor] Killed leaked process PID=${proc.pid} (${proc.command})`);
        } catch {
          // Process may have already exited
        }
      }
    }

    return report;
  }

  /** Summary for heartbeat or diagnostics endpoint. */
  getStatus(): { leakedCount: number; lastReport: LeakReport | null } {
    const last = this.recentLeaks.length > 0 ? this.recentLeaks[this.recentLeaks.length - 1] : null;
    return {
      leakedCount: last?.leakedProcesses.length ?? 0,
      lastReport: last,
    };
  }
}
