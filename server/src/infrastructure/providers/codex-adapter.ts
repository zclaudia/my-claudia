import type { ProviderAdapter, RunOptions, ClaudeMessage, PermissionCallback } from './types.js';
import { runCodex, abortCodexSession } from './codex-sdk.js';
import { CODEX_MANIFEST, CODEX_POLICY } from './manifests.js';

export class CodexAdapter implements ProviderAdapter {
  readonly type = 'codex';
  readonly manifest = CODEX_MANIFEST;
  readonly policy = CODEX_POLICY;

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
      serverPort: options.serverPort,
      claudiaSessionId: options.claudiaSessionId,
      db: options.db,
    }, onPermission);
  }

  async abort(sessionId: string): Promise<void> {
    await abortCodexSession(sessionId);
  }
}
