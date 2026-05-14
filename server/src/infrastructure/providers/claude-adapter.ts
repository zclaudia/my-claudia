import type { ProviderAdapter, RunOptions, ClaudeMessage, PermissionCallback } from './types.js';
import { runClaude, type ClaudeQueryHandle } from './claude-sdk.js';
import type { PermissionMode } from '@my-claudia/shared/core/provider';
import { CLAUDE_MANIFEST, CLAUDE_POLICY } from './manifests.js';
import { CLAUDE_NORMALIZER } from './claude-normalizer.js';
import {
  isProcessAlive,
  listDescendantProcesses,
  killProcessTree,
  summarizeProcesses,
  waitForProcessesToExit,
  type ChildProcessInfo,
} from '../../utils/process-tree.js';

const CLAUDE_PROCESS_MATCHERS = ['claude', 'mcp-bridge', 'mcp-server'];

function isClaudeRelatedProcess(proc: ChildProcessInfo): boolean {
  const haystack = `${proc.command} ${proc.args}`.toLowerCase();
  return CLAUDE_PROCESS_MATCHERS.some(matcher => haystack.includes(matcher));
}

function filterClaudeRelatedProcesses(processes: ChildProcessInfo[]): ChildProcessInfo[] {
  return processes.filter(isClaudeRelatedProcess);
}

function diffProcesses(after: ChildProcessInfo[], beforePids: Set<number>): ChildProcessInfo[] {
  return after.filter(proc => !beforePids.has(proc.pid));
}

/** Info about a background task's actual processes */
export interface TaskProcessInfo {
  taskId: string;
  command?: string;       // The command that was run (e.g. "npm test")
  toolName?: string;      // The tool that spawned it (e.g. "Bash")
  pids: number[];         // Matched process PIDs
  rootPid?: number;       // The root process PID (direct child of CLI)
}

export class ClaudeAdapter implements ProviderAdapter {
  readonly type = 'claude';
  readonly manifest = CLAUDE_MANIFEST;
  readonly policy = CLAUDE_POLICY;
  readonly normalizer = CLAUDE_NORMALIZER;
  private runAbortControllers = new WeakMap<RunOptions, AbortController>();

  // Track abort controllers per session so abort() can signal cancellation
  private abortControllers = new Map<string, AbortController>();
  // Track query handles per session so stopTask() can reach the SDK
  private queryHandles = new Map<string, ClaudeQueryHandle>();
  // Track CLI subprocess PIDs per session for direct process-tree killing
  private cliPids = new Map<string, number>();
  // Track toolUseId → command/toolName for Bash tool calls (used to match processes)
  private toolUseCommands = new Map<string, { command: string; toolName: string }>();
  // Track taskId → process info (populated when task_started arrives)
  private taskProcesses = new Map<string, TaskProcessInfo>();

  private getOrCreateAbortController(options: RunOptions): AbortController {
    let controller = this.runAbortControllers.get(options);
    if (!controller) {
      controller = new AbortController();
      this.runAbortControllers.set(options, controller);
    }
    return controller;
  }

  private rekeySession(oldKey: string, newKey: string, abortController: AbortController, queryHandle: ClaudeQueryHandle): void {
    if (oldKey === newKey) return;
    this.abortControllers.delete(oldKey);
    this.queryHandles.delete(oldKey);
    this.abortControllers.set(newKey, abortController);
    this.queryHandles.set(newKey, queryHandle);
    // Migrate PID tracking
    const pid = this.cliPids.get(oldKey);
    if (pid !== undefined) {
      this.cliPids.delete(oldKey);
      this.cliPids.set(newKey, pid);
    }
  }

  async *run(
    input: string,
    options: RunOptions,
    onPermission: PermissionCallback,
  ): AsyncGenerator<ClaudeMessage, void, void> {
    const runLabel = options.sessionId || `pending:${crypto.randomUUID().slice(0, 8)}`;
    const initialProcesses = filterClaudeRelatedProcesses(await listDescendantProcesses(process.pid));
    const initialPids = new Set(initialProcesses.map(proc => proc.pid));
    console.log(`[Claude Debug] run_start ${runLabel} descendants=${initialProcesses.length} ${summarizeProcesses(initialProcesses)}`);

    const abortController = this.getOrCreateAbortController(options);
    const queryHandle: ClaudeQueryHandle = {};
    let sessionKey = options.sessionId || crypto.randomUUID();
    this.abortControllers.set(sessionKey, abortController);
    this.queryHandles.set(sessionKey, queryHandle);

    try {
      const generator = runClaude(input, {
        cwd: options.cwd,
        sessionId: options.sessionId,
        cliPath: options.cliPath,
        env: options.env,
        permissionMode: (options.mode || 'default') as PermissionMode,
        model: options.model,
        systemPrompt: options.systemPrompt,
        serverPort: options.serverPort,
        claudiaSessionId: options.claudiaSessionId,
        db: options.db,
        abortController,
        queryHandle,
        onSessionId: (resolvedSessionId) => {
          this.rekeySession(sessionKey, resolvedSessionId, abortController, queryHandle);
          sessionKey = resolvedSessionId;
        },
      }, onPermission);

      for await (const message of generator) {
        // Capture CLI PID from queryHandle (set by spawnClaudeCodeProcess)
        if (queryHandle.pid && !this.cliPids.has(sessionKey)) {
          this.cliPids.set(sessionKey, queryHandle.pid);
          console.log(`[Claude] Tracking CLI PID ${queryHandle.pid} for session ${sessionKey}`);
        }

        // Track Bash tool_use commands for process matching
        if (message.type === 'tool_use' && message.toolUseId && message.toolName) {
          const input = message.toolInput as Record<string, unknown> | undefined;
          const command = input?.command as string | undefined;
          if (command) {
            this.toolUseCommands.set(message.toolUseId, {
              command,
              toolName: message.toolName,
            });
          }
        }

        // On task_started, resolve task → process PIDs
        if (message.type === 'task_notification' && message.taskStatus === 'started' && message.taskId) {
          const cliPid = this.cliPids.get(sessionKey);
          if (cliPid) {
            const command = message.taskToolUseId
              ? this.toolUseCommands.get(message.taskToolUseId)?.command
              : undefined;
            const toolName = message.taskToolUseId
              ? this.toolUseCommands.get(message.taskToolUseId)?.toolName
              : undefined;
            // Async — don't block the message stream
            this.resolveTaskProcesses(cliPid, message.taskId, command, toolName);
          }
        }

        // On task completed/failed/stopped, clean up
        if (message.type === 'task_notification' && message.taskId) {
          const status = message.taskStatus;
          if (status === 'completed' || status === 'failed' || status === 'stopped') {
            this.taskProcesses.delete(message.taskId);
          }
        }

        yield message;
      }
    } finally {
      const finalizedProcesses = filterClaudeRelatedProcesses(await listDescendantProcesses(process.pid));
      const newProcesses = diffProcesses(finalizedProcesses, initialPids);
      console.log(
        `[Claude Debug] run_finalized ${sessionKey} descendants=${finalizedProcesses.length} new=${newProcesses.length} ${summarizeProcesses(newProcesses)}`,
      );

      const delayedSessionKey = sessionKey;
      const delayedSnapshot = setTimeout(() => {
        listDescendantProcesses(process.pid)
          .then(processes => {
            const related = filterClaudeRelatedProcesses(processes);
            const lingering = diffProcesses(related, initialPids);
            console.log(
              `[Claude Debug] post_finalize ${delayedSessionKey} descendants=${related.length} lingering=${lingering.length} ${summarizeProcesses(lingering)}`,
            );
          })
          .catch(() => {});
      }, 3000);
      delayedSnapshot.unref();

      this.abortControllers.delete(sessionKey);
      // Keep queryHandle alive so stopTask() can still reach background tasks
      // after the run completes. Handle is cleaned up on abort() or next run().
    }
  }

  getRunState(options: RunOptions): Record<string, unknown> {
    return {
      abortController: this.getOrCreateAbortController(options),
      providerCwd: options.cwd,
    };
  }

  async abort(sessionId: string): Promise<void> {
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      console.log(`[Claude] Aborting session ${sessionId}`);
      const beforeAbort = filterClaudeRelatedProcesses(await listDescendantProcesses(process.pid));
      console.log(`[Claude Debug] abort_requested ${sessionId} descendants=${beforeAbort.length} ${summarizeProcesses(beforeAbort)}`);
      controller.abort();

      // Kill CLI process tree directly for reliability
      const cliPid = this.cliPids.get(sessionId);
      if (cliPid) {
        const { killed } = await killProcessTree(cliPid);
        console.log(`[Claude] Killed process tree for session ${sessionId}: PID=${cliPid} killed=${killed.length} PIDs`);
      }

      this.abortControllers.delete(sessionId);
      this.queryHandles.delete(sessionId);
      this.cliPids.delete(sessionId);

      const delayedSnapshot = setTimeout(() => {
        listDescendantProcesses(process.pid)
          .then(processes => {
            const related = filterClaudeRelatedProcesses(processes);
            console.log(`[Claude Debug] post_abort ${sessionId} descendants=${related.length} ${summarizeProcesses(related)}`);
          })
          .catch(() => {});
      }, 3000);
      delayedSnapshot.unref();
    }
  }

  /**
   * Resolve which OS processes belong to a background task.
   * Takes a snapshot of CLI descendants, optionally matches by command string,
   * and retries after a delay to catch late-spawning processes.
   */
  private async resolveTaskProcesses(cliPid: number, taskId: string, command?: string, toolName?: string): Promise<void> {
    // Take an initial snapshot of known PIDs (before the task's processes spawn)
    const beforePids = new Set(
      [...this.taskProcesses.values()].flatMap(t => t.pids)
    );

    // Helper to scan and match
    const scanAndMatch = async (): Promise<ChildProcessInfo[]> => {
      const descendants = await listDescendantProcesses(cliPid);
      if (command) {
        // If we know the command, match by args content
        const needle = command.length > 200 ? command.slice(0, 200) : command;
        const matched = descendants.filter(proc => proc.args.includes(needle));
        if (matched.length > 0) return matched;
      }
      // Fallback: return all new descendants not already tracked by other tasks
      return descendants.filter(proc => !beforePids.has(proc.pid));
    };

    try {
      // First scan — might be too early for the process to appear
      let matched = await scanAndMatch();

      // If no match, wait a bit and try again (process may not have spawned yet)
      if (matched.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        matched = await scanAndMatch();
      }

      if (matched.length > 0) {
        // Pick the most likely root process (lowest PID usually = first spawned)
        const rootPid = matched.reduce((min, p) => p.pid < min.pid ? p : min).pid;
        const allPids = matched.map(p => p.pid);

        this.taskProcesses.set(taskId, {
          taskId,
          command,
          toolName,
          pids: allPids,
          rootPid,
        });
        console.log(`[Claude] Task ${taskId} resolved: rootPid=${rootPid} pids=[${allPids.join(',')}] command="${command?.slice(0, 80) || '(unknown)'}"`);
      } else {
        // Store what we know — kill will fall back to CLI or server tree scan
        this.taskProcesses.set(taskId, { taskId, command, toolName, pids: [] });
        console.log(`[Claude] Task ${taskId}: no processes matched (cliPid=${cliPid} descendants=${(await listDescendantProcesses(cliPid)).length})`);
      }
    } catch (err) {
      console.warn(`[Claude] Failed to resolve processes for task ${taskId}:`, err);
    }
  }

  async stopTask(sessionId: string, taskId: string): Promise<boolean> {
    console.log(`[Claude] Stopping task ${taskId} in session ${sessionId}`);

    // Strategy 1: Try SDK stopTask (non-blocking, unreliable)
    const handle = this.queryHandles.get(sessionId);
    if (handle?.stopTask) {
      handle.stopTask(taskId).catch(err => {
        console.warn(`[Claude] SDK stopTask failed for ${taskId}:`, err);
      });
    }

    // Strategy 2: Kill stored PIDs directly (works even after CLI exit + reparent)
    const taskInfo = this.taskProcesses.get(taskId);
    if (taskInfo && taskInfo.pids.length > 0) {
      let killedCount = 0;
      const targetPids = taskInfo.rootPid ? [taskInfo.rootPid] : [...new Set(taskInfo.pids)];
      for (const pid of targetPids) {
        const { killed } = await killProcessTree(pid);
        killedCount += killed.length;
      }

      const survivors = await waitForProcessesToExit(taskInfo.pids, 250);
      console.log(`[Claude] Killed task ${taskId} by stored PIDs: pids=[${taskInfo.pids.join(',')}] command="${taskInfo.command?.slice(0, 80) || '?'}" killed=${killedCount} survivors=${survivors.length}`);
      if (survivors.length === 0) {
        this.taskProcesses.delete(taskId);
        return killedCount > 0;
      }
    }

    // Strategy 3: Kill entire CLI process tree (if CLI is still alive)
    const cliPid = this.cliPids.get(sessionId);
    if (cliPid) {
      const { killed } = await killProcessTree(cliPid);
      const cliAlive = isProcessAlive(cliPid);
      console.log(`[Claude] Killed CLI tree for task ${taskId}: PID=${cliPid} killed=${killed.length} alive=${cliAlive}`);
      if (killed.length > 0 && !cliAlive) {
        this.cliPids.delete(sessionId);
        return true;
      }
    }

    // Strategy 4: Last resort — scan ALL system processes for task's command
    console.log(`[Claude] No live PIDs found, scanning system processes...`);
    const command = taskInfo?.command;
    if (command) {
      const { stdout } = await import('child_process').then(m =>
        new Promise<{ stdout: string }>((resolve, reject) => {
          m.execFile('ps', ['-e', '-o', 'pid=,args='], (err, stdout) => {
            if (err) reject(err); else resolve({ stdout });
          });
        })
      );
      const needle = command.length > 200 ? command.slice(0, 200) : command;
      let killedCount = 0;
      for (const line of stdout.trim().split('\n')) {
        if (line.includes(needle)) {
          const pidMatch = line.trim().match(/^(\d+)/);
          if (pidMatch) {
            const pid = Number(pidMatch[1]);
            try { process.kill(pid, 'SIGTERM'); killedCount++; } catch { /* dead */ }
          }
        }
      }
      const matchedPids = stdout
        .trim()
        .split('\n')
        .filter(line => line.includes(needle))
        .map(line => Number(line.trim().match(/^(\d+)/)?.[1]))
        .filter((pid): pid is number => Number.isFinite(pid));
      const survivors = await waitForProcessesToExit(matchedPids, 3000);
      if (killedCount > 0 && survivors.length === 0) {
        console.log(`[Claude] Killed ${killedCount} processes matching command "${needle.slice(0, 80)}"`);
        return true;
      }
    }

    // Strategy 5: Kill all claude-related processes under server
    const allDescendants = await listDescendantProcesses(process.pid);
    const claudeProcesses = filterClaudeRelatedProcesses(allDescendants);
    if (claudeProcesses.length > 0) {
      console.log(`[Claude] Found ${claudeProcesses.length} claude-related processes: ${summarizeProcesses(claudeProcesses)}`);
      let killedCount = 0;
      for (const proc of claudeProcesses) {
        try { process.kill(proc.pid, 'SIGTERM'); killedCount++; } catch { /* dead */ }
      }
      const survivors = await waitForProcessesToExit(claudeProcesses.map(proc => proc.pid), 3000);
      console.log(`[Claude] Killed ${killedCount} claude-related processes for task ${taskId}; survivors=${survivors.length}`);
      return killedCount > 0 && survivors.length === 0;
    }

    console.warn(`[Claude] No processes found to kill for task ${taskId} in session ${sessionId}`);
    return false;
  }

  /** Get the CLI subprocess PID for a session (used for frontend display) */
  getCliPid(sessionId: string): number | undefined {
    return this.cliPids.get(sessionId);
  }

  /** Get resolved process info for a specific task */
  getTaskProcessInfo(taskId: string): TaskProcessInfo | undefined {
    return this.taskProcesses.get(taskId);
  }
}
