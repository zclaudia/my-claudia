import type { ProviderAdapter, RunOptions, ClaudeMessage, PermissionCallback } from './types.js';
import { runKimi, abortKimiSession } from './kimi-sdk.js';

export class KimiAdapter implements ProviderAdapter {
  readonly type = 'kimi';

  async *run(
    input: string,
    options: RunOptions,
    onPermission: PermissionCallback,
  ): AsyncGenerator<ClaudeMessage, void, void> {
    yield* runKimi(input, {
      cwd: options.cwd,
      sessionId: options.sessionId,
      cliPath: options.cliPath,
      env: options.env,
      model: options.model,
      mode: options.mode,
      systemPrompt: options.systemPrompt,
      thinking: options.model?.includes('thinking'),
      serverPort: options.serverPort,
      claudiaSessionId: options.claudiaSessionId,
    }, onPermission);
  }

  async abort(sessionId: string): Promise<void> {
    await abortKimiSession(sessionId);
  }

  getRunState(options: RunOptions): Record<string, unknown> {
    return {
      providerCwd: options.cwd,
      providerType: 'kimi',
    };
  }
}
