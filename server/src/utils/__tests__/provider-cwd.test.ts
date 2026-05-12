import { describe, expect, it } from 'vitest';
import { resolveProviderCwd } from '../provider-cwd.js';

describe('resolveProviderCwd', () => {
  it('pins resumed sessions to the session root when the manifest says so', () => {
    expect(resolveProviderCwd({
      sessionCwdPolicy: 'pinned',
      sdkSessionId: 'kimi-session-1',
      requestedCwd: '/project/subdir',
      sessionRootPath: '/project',
      persistedWorkingDirectory: '/project/subdir',
    })).toBe('/project');
  });

  it('falls back to the persisted working directory when root path is missing', () => {
    expect(resolveProviderCwd({
      sessionCwdPolicy: 'pinned',
      sdkSessionId: 'kimi-session-1',
      requestedCwd: '/project/subdir',
      sessionRootPath: null,
      persistedWorkingDirectory: '/project/subdir',
    })).toBe('/project/subdir');
  });

  it('keeps the requested cwd for providers that request the default policy', () => {
    expect(resolveProviderCwd({
      sessionCwdPolicy: 'requested',
      sdkSessionId: 'sess-1',
      requestedCwd: '/project/subdir',
      sessionRootPath: '/project',
      persistedWorkingDirectory: '/project/subdir',
    })).toBe('/project/subdir');
  });

  it('keeps the requested cwd when the manifest declares no policy at all', () => {
    expect(resolveProviderCwd({
      sdkSessionId: 'sess-1',
      requestedCwd: '/project/subdir',
      sessionRootPath: '/project',
      persistedWorkingDirectory: '/project/subdir',
    })).toBe('/project/subdir');
  });

  it('does not pin when there is no resumed sdk session yet', () => {
    expect(resolveProviderCwd({
      sessionCwdPolicy: 'pinned',
      sdkSessionId: undefined,
      requestedCwd: '/project/subdir',
      sessionRootPath: '/project',
      persistedWorkingDirectory: '/project/subdir',
    })).toBe('/project/subdir');
  });
});
