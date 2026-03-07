import type { ProviderAdapter, RunOptions, ClaudeMessage, PermissionCallback } from './types.js';
import { runClaude } from './claude-sdk.js';
import type { PermissionMode } from '@my-claudia/shared';

export class ClaudeAdapter implements ProviderAdapter {
  readonly type = 'claude';

  async *run(
    input: string,
    options: RunOptions,
    onPermission: PermissionCallback,
  ): AsyncGenerator<ClaudeMessage, void, void> {
    yield* runClaude(input, {
      cwd: options.cwd,
      sessionId: options.sessionId,
      cliPath: options.cliPath,
      env: options.env,
      permissionMode: (options.mode || 'default') as PermissionMode,
      model: options.model,
      systemPrompt: options.systemPrompt,
      serverPort: options.serverPort,
    }, onPermission);
  }
}
