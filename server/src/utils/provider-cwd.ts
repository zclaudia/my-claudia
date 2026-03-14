export function resolveProviderCwd(options: {
  providerType: string;
  sdkSessionId?: string;
  requestedCwd: string;
  sessionRootPath?: string | null;
  persistedWorkingDirectory?: string | null;
}): string {
  const {
    providerType,
    sdkSessionId,
    requestedCwd,
    sessionRootPath,
    persistedWorkingDirectory,
  } = options;

  // Kimi persists sessions under a work_dir-scoped storage tree. Reusing the
  // same session ID under a different work_dir silently creates a new empty
  // session, so resumed runs must stay pinned to the original session root.
  if (providerType === 'kimi' && sdkSessionId) {
    return sessionRootPath || persistedWorkingDirectory || requestedCwd;
  }

  return requestedCwd;
}
