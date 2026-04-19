/**
 * Process monitor — detects leaked child processes across all providers.
 *
 * Periodically scans the process tree under the server PID and compares
 * against known active runs.  When no runs are active but child processes
 * remain, they are flagged (and optionally killed) as leaked.
 */

import { listDescendantProcesses, type ChildProcessInfo } from './process-tree.js';

export interface LeakReport {
  timestamp: number;
  activeRunCount: number;
  leakedProcesses: ChildProcessInfo[];
}

export interface ProcessCleanupResult {
  status: 'clean' | 'killed' | 'skipped_active_runs';
  leakedCount: number;
  killedCount: number;
  activeRunCount: number;
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
  /** Grace period when comparing descendant elapsed time to server uptime. */
  elapsedSlackSeconds?: number;
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
      elapsedSlackSeconds: options?.elapsedSlackSeconds ?? 300,
    };
  }

  private isIgnoredCommand(command: string): boolean {
    const normalized = command.trim().toLowerCase();
    if (!normalized) return true;
    // `ps` is spawned by the monitor itself and can briefly appear in the descendant tree.
    if (normalized === 'ps') return true;
    return this.opts.ignoreCommands.some(cmd => normalized.includes(cmd.toLowerCase()));
  }

  private isReasonableElapsedSeconds(elapsedSeconds: number): boolean {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return false;
    const maxReasonableElapsed = Math.ceil(process.uptime()) + this.opts.elapsedSlackSeconds;
    return elapsedSeconds <= maxReasonableElapsed;
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

  private async scanForLeaks(): Promise<{ activeRunCount: number; leakedProcesses: ChildProcessInfo[] }> {
    const activeRunCount = this.getActiveRunCount();
    if (activeRunCount > 0) {
      return { activeRunCount, leakedProcesses: [] };
    }

    const children = await listDescendantProcesses(this.serverPid);
    const leakedProcesses = children.filter(p =>
      p.elapsedSeconds >= this.opts.minElapsedSeconds &&
      this.isReasonableElapsedSeconds(p.elapsedSeconds) &&
      !this.isIgnoredCommand(p.command),
    );

    return { activeRunCount, leakedProcesses };
  }

  /** Run a check immediately (also called by the periodic interval).
   *  @param forceKill — override autoKill setting and kill leaked processes (for user-initiated cleanup) */
  async check(forceKill = false): Promise<LeakReport | null> {
    const { activeRunCount, leakedProcesses: leaked } = await this.scanForLeaks();

    // If there are active runs, we can't distinguish run children from leaked ones.
    // Only check when no runs are active — run lifecycle (abort/stopTask) handles the rest.
    if (activeRunCount > 0) return null;

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

  async cleanupNow(): Promise<ProcessCleanupResult> {
    const { activeRunCount, leakedProcesses } = await this.scanForLeaks();

    if (activeRunCount > 0) {
      return {
        status: 'skipped_active_runs',
        leakedCount: 0,
        killedCount: 0,
        activeRunCount,
      };
    }

    if (leakedProcesses.length === 0) {
      this.lastNotifiedPids.clear();
      this.lastNotifyTime = 0;
      this.consecutiveSuppressions = 0;
      return {
        status: 'clean',
        leakedCount: 0,
        killedCount: 0,
        activeRunCount: 0,
      };
    }

    const report: LeakReport = {
      timestamp: Date.now(),
      activeRunCount,
      leakedProcesses,
    };

    this.recentLeaks.push(report);
    if (this.recentLeaks.length > 20) this.recentLeaks.shift();
    this.lastNotifiedPids = new Set(leakedProcesses.map(proc => proc.pid));
    this.lastNotifyTime = report.timestamp;
    this.consecutiveSuppressions = 0;
    this.onLeakDetected(report);

    let killedCount = 0;
    for (const proc of leakedProcesses) {
      try {
        process.kill(proc.pid, 'SIGTERM');
        killedCount += 1;
        console.log(`[ProcessMonitor] Killed leaked process PID=${proc.pid} (${proc.command})`);
      } catch {
        // Process may have already exited.
      }
    }

    return {
      status: 'killed',
      leakedCount: leakedProcesses.length,
      killedCount,
      activeRunCount,
    };
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
