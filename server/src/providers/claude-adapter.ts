import type { ProviderAdapter, RunOptions, ClaudeMessage, PermissionCallback } from './types.js';
import { runClaude, type ClaudeQueryHandle } from './claude-sdk.js';
import type { PermissionMode } from '@my-claudia/shared';
import { listDescendantProcesses, summarizeProcesses, type ChildProcessInfo } from '../utils/process-tree.js';

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

export class ClaudeAdapter implements ProviderAdapter {
  readonly type = 'claude';
  private runAbortControllers = new WeakMap<RunOptions, AbortController>();

  // Track abort controllers per session so abort() can signal cancellation
  private abortControllers = new Map<string, AbortController>();
  // Track query handles per session so stopTask() can reach the SDK
  private queryHandles = new Map<string, ClaudeQueryHandle>();

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
      yield* runClaude(input, {
        cwd: options.cwd,
        sessionId: options.sessionId,
        cliPath: options.cliPath,
        env: options.env,
        permissionMode: (options.mode || 'default') as PermissionMode,
        model: options.model,
        systemPrompt: options.systemPrompt,
        serverPort: options.serverPort,
        db: options.db,
        abortController,
        queryHandle,
        onSessionId: (resolvedSessionId) => {
          this.rekeySession(sessionKey, resolvedSessionId, abortController, queryHandle);
          sessionKey = resolvedSessionId;
        },
      }, onPermission);
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
      this.abortControllers.delete(sessionId);
      this.queryHandles.delete(sessionId);

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

  async stopTask(sessionId: string, taskId: string): Promise<void> {
    const handle = this.queryHandles.get(sessionId);
    if (handle?.stopTask) {
      console.log(`[Claude] Stopping task ${taskId} in session ${sessionId}`);
      await handle.stopTask(taskId);
    } else {
      console.warn(`[Claude] Cannot stop task ${taskId} — no active query for session ${sessionId}`);
    }
  }
}
