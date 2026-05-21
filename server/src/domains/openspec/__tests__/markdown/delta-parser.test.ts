import { describe, it, expect } from 'vitest';
import { parseDelta } from '../../markdown/delta-parser.js';

describe('parseDelta', () => {
  it('parses ADDED + MODIFIED + REMOVED sections', () => {
    const md = `## Purpose
Adds 2FA support to the auth capability.

## ADDED Requirements
### Requirement: 2FA enrollment
The system SHALL allow users to enroll in 2FA.

#### Scenario: User enrolls
- **WHEN** user opts in
- **THEN** system SHALL provision TOTP secret

## MODIFIED Requirements
### Requirement: Login flow
The system SHALL prompt for 2FA when enrolled.

#### Scenario: Logging in with 2FA
- **WHEN** user logs in
- **THEN** system SHALL ask for TOTP

## REMOVED Requirements
- \`Login flow without 2FA\`
- \`Legacy SMS fallback\`
`;
    const delta = parseDelta(md);
    expect(delta.purpose).toContain('2FA');
    expect(delta.added).toHaveLength(1);
    expect(delta.added[0].name).toBe('2FA enrollment');
    expect(delta.modified).toHaveLength(1);
    expect(delta.modified[0].name).toBe('Login flow');
    expect(delta.removed).toEqual(['Login flow without 2FA', 'Legacy SMS fallback']);
  });

  it('returns empty arrays when sections absent', () => {
    const delta = parseDelta(`## Purpose\nNothing yet.\n`);
    expect(delta.added).toEqual([]);
    expect(delta.modified).toEqual([]);
    expect(delta.removed).toEqual([]);
  });

  it('tolerates REMOVED list entries without backticks', () => {
    const md = `## REMOVED Requirements\n- foo\n- bar\n`;
    const delta = parseDelta(md);
    expect(delta.removed).toEqual(['foo', 'bar']);
  });

  it('handles only-ADDED delta', () => {
    const md = `## ADDED Requirements
### Requirement: r1
MUST happen.

#### Scenario: s1
- **WHEN** x
- **THEN** y
`;
    const delta = parseDelta(md);
    expect(delta.added).toHaveLength(1);
    expect(delta.added[0].rfcKeywords).toContain('MUST');
  });
});
