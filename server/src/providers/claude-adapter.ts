import type { ProviderAdapter, RunOptions, ClaudeMessage, PermissionCallback } from './types.js';
import { runClaude, type ClaudeQueryHandle } from './claude-sdk.js';
import type { PermissionMode } from '@my-claudia/shared';
import { listDescendantProcesses, killProcessTree, summarizeProcesses, type ChildProcessInfo } from '../utils/process-tree.js';

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

        // On task_started, resolve task → process PIDs via command matching
        if (message.type === 'task_notification' && message.taskStatus === 'started' && message.taskId) {
          const cliPid = this.cliPids.get(sessionKey);
          if (cliPid && message.taskToolUseId) {
            const toolInfo = this.toolUseCommands.get(message.taskToolUseId);
            if (toolInfo) {
              // Async — don't block the message stream
              this.resolveTaskProcesses(cliPid, message.taskId, toolInfo.command, toolInfo.toolName);
            }
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
   * Resolve which OS processes belong to a background task by matching the
   * command string against descendants of the CLI subprocess.
   */
  private async resolveTaskProcesses(cliPid: number, taskId: string, command: string, toolName: string): Promise<void> {
    try {
      const descendants = await listDescendantProcesses(cliPid);
      // Match by checking if the process args contain the command string
      // Use first significant portion of command for matching (avoid matching on trivial substrings)
      const needle = command.length > 200 ? command.slice(0, 200) : command;
      const matched = descendants.filter(proc => proc.args.includes(needle));

      if (matched.length > 0) {
        const rootPid = matched[0].pid;
        // Also get descendants of the matched root process (its own children)
        const rootDescendants = await listDescendantProcesses(rootPid);
        const allPids = [rootPid, ...rootDescendants.map(p => p.pid)];

        this.taskProcesses.set(taskId, {
          taskId,
          command,
          toolName,
          pids: allPids,
          rootPid,
        });
        console.log(`[Claude] Task ${taskId} resolved: command="${command.slice(0, 80)}" rootPid=${rootPid} totalPids=${allPids.length}`);
      } else {
        // No exact match — store what we know, will fall back to CLI tree kill
        this.taskProcesses.set(taskId, { taskId, command, toolName, pids: [] });
        console.log(`[Claude] Task ${taskId}: no process match for command="${command.slice(0, 80)}" (${descendants.length} descendants scanned)`);
      }
    } catch (err) {
      console.warn(`[Claude] Failed to resolve processes for task ${taskId}:`, err);
    }
  }

  async stopTask(sessionId: string, taskId: string): Promise<void> {
    console.log(`[Claude] Stopping task ${taskId} in session ${sessionId}`);

    // Strategy 1: Try SDK stopTask (non-blocking, unreliable)
    const handle = this.queryHandles.get(sessionId);
    if (handle?.stopTask) {
      handle.stopTask(taskId).catch(err => {
        console.warn(`[Claude] SDK stopTask failed for ${taskId}:`, err);
      });
    }

    // Strategy 2: Precise kill — target only the task's matched processes
    const taskInfo = this.taskProcesses.get(taskId);
    if (taskInfo?.rootPid) {
      // Re-resolve descendants of the root PID (it may have spawned more children since initial match)
      const { killed } = await killProcessTree(taskInfo.rootPid);
      console.log(`[Claude] Killed task ${taskId} process tree: rootPid=${taskInfo.rootPid} command="${taskInfo.command?.slice(0, 80)}" killed=${killed.length} PIDs`);
      this.taskProcesses.delete(taskId);
      return;
    }

    // Strategy 3: Fallback — kill entire CLI process tree
    const cliPid = this.cliPids.get(sessionId);
    if (cliPid) {
      const { killed } = await killProcessTree(cliPid);
      console.log(`[Claude] Fallback: killed CLI process tree for task ${taskId}: PID=${cliPid} killed=${killed.length} PIDs`);
      this.cliPids.delete(sessionId);
    } else {
      console.warn(`[Claude] No CLI PID tracked for session ${sessionId} — SDK stopTask only`);
    }
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
