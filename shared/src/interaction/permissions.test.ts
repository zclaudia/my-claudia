import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UNIFIED_POLICY,
  normalizeToUnifiedPolicy,
} from './permissions.js';

describe('normalizeToUnifiedPolicy', () => {
  it('returns a cloned default policy for invalid input', () => {
    const normalized = normalizeToUnifiedPolicy(null);

    expect(normalized).toEqual(DEFAULT_UNIFIED_POLICY);
    expect(normalized).not.toBe(DEFAULT_UNIFIED_POLICY);
    expect(normalized.profile).not.toBe(DEFAULT_UNIFIED_POLICY.profile);
    expect(normalized.globalGuards).not.toBe(DEFAULT_UNIFIED_POLICY.globalGuards);
    expect(normalized.escalateAlways).not.toBe(DEFAULT_UNIFIED_POLICY.escalateAlways);
    expect(normalized.aiReview).not.toBe(DEFAULT_UNIFIED_POLICY.aiReview);
  });

  it('does not mutate the shared defaults when caller mutates normalized fallback', () => {
    const normalized = normalizeToUnifiedPolicy(undefined);

    normalized.profile.fileRead = 'block';
    normalized.globalGuards.blockSensitiveFiles = false;
    normalized.escalateAlways.push('Bash');
    normalized.aiReview.enabled = false;

    expect(DEFAULT_UNIFIED_POLICY.profile.fileRead).toBe('auto-approve');
    expect(DEFAULT_UNIFIED_POLICY.globalGuards.blockSensitiveFiles).toBe(true);
    expect(DEFAULT_UNIFIED_POLICY.escalateAlways).toEqual(['AskUserQuestion', 'ExitPlanMode']);
    expect(DEFAULT_UNIFIED_POLICY.aiReview.enabled).toBe(true);
  });
});
