import { describe, expect, it } from 'vitest';
import { resolveProviderCwd } from '../provider-cwd.js';

describe('resolveProviderCwd', () => {
  it('pins resumed kimi sessions to the session root path', () => {
    expect(resolveProviderCwd({
      providerType: 'kimi',
      sdkSessionId: 'kimi-session-1',
      requestedCwd: '/project/subdir',
      sessionRootPath: '/project',
      persistedWorkingDirectory: '/project/subdir',
    })).toBe('/project');
  });

  it('falls back to the persisted working directory when root path is missing', () => {
    expect(resolveProviderCwd({
      providerType: 'kimi',
      sdkSessionId: 'kimi-session-1',
      requestedCwd: '/project/subdir',
      sessionRootPath: null,
      persistedWorkingDirectory: '/project/subdir',
    })).toBe('/project/subdir');
  });

  it('keeps the requested cwd for non-kimi providers', () => {
    expect(resolveProviderCwd({
      providerType: 'claude',
      sdkSessionId: 'sess-1',
      requestedCwd: '/project/subdir',
      sessionRootPath: '/project',
      persistedWorkingDirectory: '/project/subdir',
    })).toBe('/project/subdir');
  });
});
