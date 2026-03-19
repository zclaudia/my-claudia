import { afterEach, describe, expect, it, vi } from 'vitest';
import { compareVersionCore, hasDesktopUpdateCandidate, isDevBuild } from '../useAutoUpdate';

describe('useAutoUpdate helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('identifies dev builds with extended suffixes', () => {
    expect(isDevBuild('0.1.280-dev')).toBe(true);
    expect(isDevBuild('0.1.280-dev.macos.20260314093015')).toBe(true);
    expect(isDevBuild('0.1.280')).toBe(false);
  });

  it('compares numeric version cores independently from dev suffixes', () => {
    expect(compareVersionCore('0.1.281', '0.1.280-dev.macos.20260314093015')).toBe(1);
    expect(compareVersionCore('0.1.280', '0.1.280-dev.macos.20260314093015')).toBe(0);
    expect(compareVersionCore('0.1.279', '0.1.280-dev.macos.20260314093015')).toBe(-1);
  });

  it('suppresses desktop update prompts for same-core release over a dev build', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: '0.1.280' }),
    })) as typeof fetch);

    await expect(hasDesktopUpdateCandidate('0.1.280-dev.macos.20260314093015')).resolves.toBe(false);
  });

  it('suppresses desktop update prompts for dev builds even when remote is newer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: '0.1.281' }),
    })) as typeof fetch);

    // Dev builds never auto-update, regardless of remote version
    await expect(hasDesktopUpdateCandidate('0.1.280-dev.macos.20260314093015')).resolves.toBe(false);
  });

  it('keeps desktop update prompts for newer numeric releases over a release build', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: '0.1.281' }),
    })) as typeof fetch);

    await expect(hasDesktopUpdateCandidate('0.1.280')).resolves.toBe(true);
  });
});
