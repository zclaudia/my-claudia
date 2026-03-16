import type { ProviderAdapter, RunOptions, ClaudeMessage, PermissionCallback } from './types.js';
import { runClaude, type ClaudeQueryHandle } from './claude-sdk.js';
import type { PermissionMode } from '@my-claudia/shared';

export class ClaudeAdapter implements ProviderAdapter {
  readonly type = 'claude';

  // Track abort controllers per session so abort() can signal cancellation
  private abortControllers = new Map<string, AbortController>();
  // Track query handles per session so stopTask() can reach the SDK
  private queryHandles = new Map<string, ClaudeQueryHandle>();

  async *run(
    input: string,
    options: RunOptions,
    onPermission: PermissionCallback,
  ): AsyncGenerator<ClaudeMessage, void, void> {
    const abortController = new AbortController();
    const queryHandle: ClaudeQueryHandle = {};
    const sessionKey = options.sessionId || crypto.randomUUID();
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
      }, onPermission);
    } finally {
      this.abortControllers.delete(sessionKey);
      this.queryHandles.delete(sessionKey);
    }
  }

  async abort(sessionId: string): Promise<void> {
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      console.log(`[Claude] Aborting session ${sessionId}`);
      controller.abort();
      this.abortControllers.delete(sessionId);
      this.queryHandles.delete(sessionId);
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
