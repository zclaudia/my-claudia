/**
 * Decide the cwd a resumed provider run should use.
 *
 * The policy is declarative on the provider's manifest (`sessionCwdPolicy`):
 *   - `'pinned'`   → stick to the original session root (Kimi, anyone else
 *                    that stores sessions under work-dir-scoped storage)
 *   - `'requested'` (default) → honour the caller's requested cwd
 *
 * No provider-type literals here — the truth lives in `manifests.ts`.
 */
export function resolveProviderCwd(options: {
  sessionCwdPolicy?: 'pinned' | 'requested';
  sdkSessionId?: string;
  requestedCwd: string;
  sessionRootPath?: string | null;
  persistedWorkingDirectory?: string | null;
}): string {
  const {
    sessionCwdPolicy,
    sdkSessionId,
    requestedCwd,
    sessionRootPath,
    persistedWorkingDirectory,
  } = options;

  if (sessionCwdPolicy === 'pinned' && sdkSessionId) {
    return sessionRootPath || persistedWorkingDirectory || requestedCwd;
  }

  return requestedCwd;
}
