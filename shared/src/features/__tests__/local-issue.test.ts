import { describe, it, expect } from 'vitest';
import { ACTIONABLE_LABEL, extractDefaultTitleFromPlan } from '../local-issue.js';

describe('ACTIONABLE_LABEL', () => {
  it('is the reserved string "actionable"', () => {
    expect(ACTIONABLE_LABEL).toBe('actionable');
  });
});

describe('extractDefaultTitleFromPlan', () => {
  it('returns the first H1 heading text when present', () => {
    const plan = '# Refactor auth\n\nSome body.\n';
    expect(extractDefaultTitleFromPlan(plan)).toBe('Refactor auth');
  });

  it('returns the first H2 heading text when no H1', () => {
    const plan = '## Migration steps\n\nDetails…';
    expect(extractDefaultTitleFromPlan(plan)).toBe('Migration steps');
  });

  it('falls back to the first non-empty line, trimmed to 80 chars', () => {
    const long = 'a'.repeat(120);
    const plan = `   \n\n${long}\nmore`;
    expect(extractDefaultTitleFromPlan(plan)).toBe('a'.repeat(80));
  });

  it('returns a timestamp-form fallback when input is blank', () => {
    const out = extractDefaultTitleFromPlan('   \n\n  \n');
    expect(out).toMatch(/^Plan from \d{4}-\d{2}-\d{2}T/);
  });

  it('strips trailing whitespace and `#` markers from headings', () => {
    expect(extractDefaultTitleFromPlan('#   Trim me   \nbody')).toBe('Trim me');
  });

  it('returns the heading text for H3 through H6 headings', () => {
    expect(extractDefaultTitleFromPlan('### Sub-section\nbody')).toBe('Sub-section');
    expect(extractDefaultTitleFromPlan('###### Deep\nbody')).toBe('Deep');
  });
});
