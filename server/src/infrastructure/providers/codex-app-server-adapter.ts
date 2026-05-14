import type { ProviderAdapter, RunOptions, ClaudeMessage, PermissionCallback } from './types.js';
import { runCodexAppServer, abortCodexAppServer, setAppServerClientMode } from './codex-app-server.js';
import { CODEX_MANIFEST, CODEX_POLICY } from './manifests.js';

export class CodexAppServerAdapter implements ProviderAdapter {
  readonly type = 'codex';
  readonly manifest = CODEX_MANIFEST;
  readonly policy = CODEX_POLICY;

  async *run(
    input: string,
    options: RunOptions,
    onPermission: PermissionCallback,
  ): AsyncGenerator<ClaudeMessage, void, void> {
    yield* runCodexAppServer(input, {
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
    await abortCodexAppServer(sessionId);
  }

  setSessionMode(sessionId: string, mode: string): void {
    setAppServerClientMode(sessionId, mode);
  }
}
