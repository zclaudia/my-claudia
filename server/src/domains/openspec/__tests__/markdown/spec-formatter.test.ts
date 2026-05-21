import { describe, it, expect } from 'vitest';
import { parseSpec } from '../../markdown/spec-parser.js';
import { formatSpec } from '../../markdown/spec-formatter.js';

describe('formatSpec', () => {
  it('produces a stable round-trip for a minimal spec', () => {
    const original = `# auth Specification

## Purpose
Handles user auth.

## Requirements

### Requirement: Login

System SHALL authenticate.

#### Scenario: Valid creds
- **WHEN** valid
- **THEN** SHALL return token
`;
    const parsed = parseSpec(original);
    const re = formatSpec(parsed);
    const reparsed = parseSpec(re);
    expect(reparsed.capability).toBe('auth');
    expect(reparsed.requirements[0].name).toBe('Login');
    expect(reparsed.requirements[0].scenarios[0].name).toBe('Valid creds');
  });

  it('omits Purpose section when undefined', () => {
    const md = formatSpec({ capability: 'x', requirements: [] });
    expect(md).not.toContain('## Purpose');
    expect(md).toContain('# x Specification');
  });

  it('formats multiple scenarios per requirement', () => {
    const md = formatSpec({
      capability: 'c', requirements: [
        { name: 'R', body: 'MUST work.', rfcKeywords: ['MUST'], scenarios: [
          { name: 'S1', bodyLines: ['- **WHEN** a', '- **THEN** b'] },
          { name: 'S2', bodyLines: ['- **WHEN** c', '- **THEN** d'] },
        ] },
      ],
    });
    expect(md).toContain('#### Scenario: S1');
    expect(md).toContain('#### Scenario: S2');
  });

  it('output ends with exactly one newline', () => {
    const md = formatSpec({ capability: 'x', requirements: [] });
    expect(md.endsWith('\n')).toBe(true);
    expect(md.endsWith('\n\n')).toBe(false);
  });
});
