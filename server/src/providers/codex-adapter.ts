import type { ProviderAdapter, RunOptions, ClaudeMessage, PermissionCallback } from './types.js';
import { runCodex, abortCodexSession } from './codex-sdk.js';

export class CodexAdapter implements ProviderAdapter {
  readonly type = 'codex';

  async *run(
    input: string,
    options: RunOptions,
    onPermission: PermissionCallback,
  ): AsyncGenerator<ClaudeMessage, void, void> {
    yield* runCodex(input, {
      cwd: options.cwd,
      sessionId: options.sessionId,
      cliPath: options.cliPath,
      env: options.env,
      model: options.model,
      mode: options.mode,
      systemPrompt: options.systemPrompt,
    }, onPermission);
  }

  async abort(sessionId: string): Promise<void> {
    await abortCodexSession(sessionId);
  }
}
