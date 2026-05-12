import type { ProviderAdapter, RunOptions, ClaudeMessage, PermissionCallback } from './types.js';
import { runCursor, abortCursorSession } from './cursor-sdk.js';
import { CURSOR_MANIFEST } from './manifests.js';

export class CursorAdapter implements ProviderAdapter {
  readonly type = 'cursor';
  readonly manifest = CURSOR_MANIFEST;

  /**
   * cursor-agent spawns a fresh child process per turn (mode passed via the
   * `--mode=` CLI flag), so mid-run mode mutation can't be enforced inside the
   * provider process itself — the AI's own `switchMode` already gates writes
   * internally. We still record the session mode here so the next turn's spawn
   * can honor an AI-initiated transition until the user changes it.
   */
  private readonly sessionModes = new Map<string, string>();

  async *run(
    input: string,
    options: RunOptions,
    onPermission: PermissionCallback,
  ): AsyncGenerator<ClaudeMessage, void, void> {
    const sessionId = options.claudiaSessionId ?? options.sessionId;
    const effectiveMode = (sessionId && this.sessionModes.get(sessionId)) ?? options.mode;
    yield* runCursor(input, {
      cwd: options.cwd,
      sessionId: options.sessionId,
      cliPath: options.cliPath,
      env: options.env,
      model: options.model,
      mode: effectiveMode,
      systemPrompt: options.systemPrompt,
      serverPort: options.serverPort,
      claudiaSessionId: options.claudiaSessionId,
    }, onPermission);
  }

  async abort(sessionId: string): Promise<void> {
    this.sessionModes.delete(sessionId);
    await abortCursorSession(sessionId);
  }

  setSessionMode(sessionId: string, mode: string): void {
    if (!sessionId) return;
    this.sessionModes.set(sessionId, mode);
  }
}
