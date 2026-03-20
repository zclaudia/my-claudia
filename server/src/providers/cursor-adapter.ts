import type { ProviderAdapter, RunOptions, ClaudeMessage, PermissionCallback } from './types.js';
import { runCursor, abortCursorSession } from './cursor-sdk.js';
import { CURSOR_MANIFEST } from './manifests.js';

export class CursorAdapter implements ProviderAdapter {
  readonly type = 'cursor';
  readonly manifest = CURSOR_MANIFEST;

  async *run(
    input: string,
    options: RunOptions,
    onPermission: PermissionCallback,
  ): AsyncGenerator<ClaudeMessage, void, void> {
    yield* runCursor(input, {
      cwd: options.cwd,
      sessionId: options.sessionId,
      cliPath: options.cliPath,
      env: options.env,
      model: options.model,
      mode: options.mode,
      systemPrompt: options.systemPrompt,
      serverPort: options.serverPort,
      claudiaSessionId: options.claudiaSessionId,
    }, onPermission);
  }

  async abort(sessionId: string): Promise<void> {
    await abortCursorSession(sessionId);
  }
}
