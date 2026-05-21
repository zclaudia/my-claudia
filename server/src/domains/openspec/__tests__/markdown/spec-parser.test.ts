import { describe, it, expect } from 'vitest';
import { parseSpec } from '../../markdown/spec-parser.js';

describe('parseSpec', () => {
  it('parses a minimal spec with capability + Purpose + one Requirement + one Scenario', () => {
    const md = `# auth Specification

## Purpose
Handles user authentication.

## Requirements
### Requirement: Login flow

The system SHALL authenticate users via email + password.

#### Scenario: Successful login
- **WHEN** user submits valid credentials
- **THEN** the system SHALL return a session token
`;
    const spec = parseSpec(md);
    expect(spec.capability).toBe('auth');
    expect(spec.purpose).toBe('Handles user authentication.');
    expect(spec.requirements).toHaveLength(1);
    expect(spec.requirements[0].name).toBe('Login flow');
    expect(spec.requirements[0].rfcKeywords).toContain('SHALL');
    expect(spec.requirements[0].scenarios).toHaveLength(1);
    expect(spec.requirements[0].scenarios[0].name).toBe('Successful login');
    expect(spec.requirements[0].scenarios[0].bodyLines.length).toBeGreaterThanOrEqual(2);
  });

  it('parses multiple Requirements each with multiple Scenarios', () => {
    const md = `# billing Specification

## Requirements
### Requirement: Charge user

System MUST charge user.

#### Scenario: Card succeeds
- **WHEN** card is valid
- **THEN** system MUST charge

#### Scenario: Card fails
- **WHEN** card declines
- **THEN** system MUST retry

### Requirement: Refund

System SHOULD allow refunds within 30 days.

#### Scenario: Recent refund
- **WHEN** refund requested within 30 days
- **THEN** system SHOULD process
`;
    const spec = parseSpec(md);
    expect(spec.requirements).toHaveLength(2);
    expect(spec.requirements[0].scenarios).toHaveLength(2);
    expect(spec.requirements[1].rfcKeywords).toContain('SHOULD');
  });

  it('returns empty requirements when ## Requirements section missing', () => {
    const md = `# notifications Specification\n\n## Purpose\nFor sending pings.\n`;
    const spec = parseSpec(md);
    expect(spec.capability).toBe('notifications');
    expect(spec.requirements).toEqual([]);
  });

  it('detects "MUST NOT" as a distinct keyword (not just MUST)', () => {
    const md = `# x Specification

## Requirements
### Requirement: a
The system MUST NOT do bad things.

#### Scenario: any
- **WHEN** invoked
- **THEN** nothing bad
`;
    const spec = parseSpec(md);
    expect(spec.requirements[0].rfcKeywords).toContain('MUST NOT');
    expect(spec.requirements[0].rfcKeywords).not.toContain('MUST');
  });

  it('tolerates capability heading without explicit "Specification" suffix', () => {
    const md = `# myproject\n\n## Requirements\n### Requirement: r\nMUST do x.\n#### Scenario: s\n- **WHEN** x\n- **THEN** y\n`;
    const spec = parseSpec(md);
    expect(spec.capability).toBe('myproject');
  });
});
