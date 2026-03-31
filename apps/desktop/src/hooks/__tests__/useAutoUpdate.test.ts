import { describe, expect, it } from 'vitest';
import { compareVersionCore, hasDesktopUpdateCandidate, isDevAppIdentity, isDevBuild } from '../useAutoUpdate';

describe('useAutoUpdate helpers', () => {
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

  it('suppresses desktop update for dev builds', () => {
    expect(hasDesktopUpdateCandidate('0.1.280-dev.macos.20260314093015')).toBe(false);
    expect(hasDesktopUpdateCandidate('0.1.280-dev')).toBe(false);
  });

  it('suppresses desktop update when build config disables updates', () => {
    expect(hasDesktopUpdateCandidate('0.1.280', false)).toBe(false);
    expect(hasDesktopUpdateCandidate('0.1.280-dev', false)).toBe(false);
  });

  it('identifies dev app identities even without a dev version suffix', () => {
    expect(isDevAppIdentity('com.myClaudia.desktop.dev', 'MyClaudia')).toBe(true);
    expect(isDevAppIdentity('com.myClaudia.desktop', 'MyClaudia Dev')).toBe(true);
    expect(isDevAppIdentity('com.myClaudia.desktop', 'MyClaudia')).toBe(false);
  });

  it('allows desktop update for release builds', () => {
    expect(hasDesktopUpdateCandidate('0.1.280')).toBe(true);
    expect(hasDesktopUpdateCandidate('0.1.281')).toBe(true);
  });
});
