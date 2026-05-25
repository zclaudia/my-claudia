import type { ProviderAdapter, RunOptions, ClaudeMessage, PermissionCallback } from './types.js';
import { runClaude, type ClaudeQueryHandle } from './claude-sdk.js';
import type { PermissionMode } from '@my-claudia/shared/core/provider';
import { OPENCLAUDE_MANIFEST, OPENCLAUDE_POLICY } from './manifests.js';
import { CLAUDE_NORMALIZER } from './claude-normalizer.js';

export class OpenClaudeAdapter implements ProviderAdapter {
  readonly type = 'openclaude';
  readonly manifest = OPENCLAUDE_MANIFEST;
  readonly policy = OPENCLAUDE_POLICY;
  readonly normalizer = CLAUDE_NORMALIZER;
  private runAbortControllers = new WeakMap<RunOptions, AbortController>();
  private abortControllers = new Map<string, AbortController>();
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
    const abortController = this.getOrCreateAbortController(options);
    const queryHandle: ClaudeQueryHandle = {};
    let sessionKey = options.sessionId || crypto.randomUUID();
    const env = {
      ...(options.env || {}),
      CLAUDE_CODE_USE_OPENAI: options.env?.CLAUDE_CODE_USE_OPENAI || '1',
      ...(options.model ? { OPENAI_MODEL: options.model } : {}),
    };

    this.abortControllers.set(sessionKey, abortController);
    this.queryHandles.set(sessionKey, queryHandle);

    yield* runClaude(input, {
      cwd: options.cwd,
      sessionId: options.sessionId,
      cliPath: options.cliPath || 'openclaude',
      env,
      permissionMode: (options.mode || 'default') as PermissionMode,
      model: undefined,
      systemPrompt: options.systemPrompt,
      serverPort: options.serverPort,
      claudiaSessionId: options.claudiaSessionId,
      db: options.db,
      mcpProviderType: 'openclaude',
      abortController,
      queryHandle,
      onSessionId: (resolvedSessionId) => {
        this.rekeySession(sessionKey, resolvedSessionId, abortController, queryHandle);
        sessionKey = resolvedSessionId;
      },
    }, onPermission);
  }

  async abort(sessionId: string): Promise<void> {
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(sessionId);
      this.queryHandles.delete(sessionId);
    }
  }

  async stopTask(sessionId: string, taskId: string): Promise<boolean> {
    const handle = this.queryHandles.get(sessionId);
    if (!handle?.stopTask) return false;
    await handle.stopTask(taskId);
    return true;
  }

  getRunState(options: RunOptions): Record<string, unknown> {
    return {
      abortController: this.getOrCreateAbortController(options),
      providerCwd: options.cwd,
      providerType: 'openclaude',
    };
  }
}
