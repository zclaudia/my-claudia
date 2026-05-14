import type { ProviderAdapter, RunOptions, ClaudeMessage, PermissionCallback } from './types.js';
import { runACP, abortACPSession } from './acp-sdk.js';
import { ACP_MANIFEST, ACP_POLICY } from './manifests.js';
import { ACP_NORMALIZER } from './acp-normalizer.js';

export class ACPProviderAdapter implements ProviderAdapter {
  readonly type = 'acp';
  readonly manifest = ACP_MANIFEST;
  readonly policy = ACP_POLICY;
  readonly normalizer = ACP_NORMALIZER;

  async *run(
    input: string,
    options: RunOptions,
    onPermission: PermissionCallback,
  ): AsyncGenerator<ClaudeMessage, void, void> {
    yield* runACP(input, {
      cwd: options.cwd,
      sessionId: options.sessionId,
      cliPath: options.cliPath,
      env: options.env,
    }, onPermission);
  }

  async abort(sessionId: string): Promise<void> {
    await abortACPSession(sessionId);
  }
}
