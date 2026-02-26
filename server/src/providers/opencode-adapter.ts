import type { ProviderAdapter, RunOptions, ClaudeMessage, PermissionCallback } from './types.js';
import { runOpenCode, abortOpenCodeSession } from './opencode-sdk.js';

export class OpenCodeAdapter implements ProviderAdapter {
  readonly type = 'opencode';

  async *run(
    input: string,
    options: RunOptions,
    onPermission: PermissionCallback,
  ): AsyncGenerator<ClaudeMessage, void, void> {
    yield* runOpenCode(input, {
      cwd: options.cwd,
      sessionId: options.sessionId,
      cliPath: options.cliPath,
      env: options.env,
      model: options.model,
      agent: options.mode,
      systemPrompt: options.systemPrompt,
    }, onPermission);
  }

  async abort(sessionId: string, cwd: string): Promise<void> {
    await abortOpenCodeSession(cwd, sessionId);
  }

  getRunState(options: RunOptions): Record<string, unknown> {
    return { providerCwd: options.cwd };
  }
}
