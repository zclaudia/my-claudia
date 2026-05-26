import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSpec } from '../spec-validator.js';

describe('validateSpec', () => {
  describe('rule 1: ## Purpose section', () => {
    it('passes when Purpose section has content', () => {
      const md = `## Purpose\n\nThis capability does X.\n\n## Requirements\n\n### Requirement: Foo\n\nThe system MUST do foo.\n\n#### Scenario: bar\n\n- **WHEN** x\n- **THEN** y\n`;
      const result = validateSpec(md);
      expect(result.errors.filter(e => e.rule === 'purpose-required')).toEqual([]);
    });

    it('fails when ## Purpose section is missing', () => {
      const md = `## Requirements\n\n### Requirement: Foo\n\nThe system MUST do foo.\n\n#### Scenario: bar\n\n- **WHEN** x\n- **THEN** y\n`;
      const result = validateSpec(md);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        rule: 'purpose-required',
        message: expect.stringMatching(/Purpose/),
      });
    });

    it('fails when ## Purpose section is empty', () => {
      const md = `## Purpose\n\n## Requirements\n\n### Requirement: Foo\n\nThe system MUST do foo.\n\n#### Scenario: bar\n\n- **WHEN** x\n- **THEN** y\n`;
      const result = validateSpec(md);
      expect(result.errors).toContainEqual({
        rule: 'purpose-required',
        message: expect.stringMatching(/Purpose.*empty/i),
      });
    });
  });

  describe('rule 2: ## Requirements section', () => {
    it('fails when ## Requirements is missing', () => {
      const md = `## Purpose\n\nFoo.\n`;
      const result = validateSpec(md);
      expect(result.errors).toContainEqual({
        rule: 'requirements-required',
        message: expect.stringMatching(/Requirements/),
      });
    });
  });

  describe('rule 3 & 4: Requirement and Scenario structure', () => {
    it('fails when a Requirement has no Scenario', () => {
      const md = `## Purpose\n\nFoo.\n\n## Requirements\n\n### Requirement: Foo\n\nThe system MUST do foo.\n`;
      const result = validateSpec(md);
      expect(result.errors).toContainEqual({
        rule: 'scenario-required-per-requirement',
        message: expect.stringMatching(/Foo.*Scenario/),
      });
    });

    it('fails when a Requirement body is empty', () => {
      const md = `## Purpose\n\nFoo.\n\n## Requirements\n\n### Requirement: Foo\n\n#### Scenario: bar\n\n- **WHEN** x\n- **THEN** y\n`;
      const result = validateSpec(md);
      expect(result.errors).toContainEqual({
        rule: 'requirement-body-required',
        message: expect.stringMatching(/Foo/),
      });
    });
  });

  describe('rule 5: heading hierarchy', () => {
    it('fails when H4 appears outside a Requirement', () => {
      const md = `## Purpose\n\nFoo.\n\n## Requirements\n\n#### Scenario: orphan\n\n- **WHEN** x\n- **THEN** y\n`;
      const result = validateSpec(md);
      expect(result.errors).toContainEqual({
        rule: 'heading-hierarchy',
        message: expect.stringMatching(/Scenario.*Requirement/),
      });
    });
  });

  describe('rule 6: RFC keyword required in Requirement body', () => {
    it('fails when no MUST/SHOULD/MAY keyword present', () => {
      const md = `## Purpose\n\nFoo.\n\n## Requirements\n\n### Requirement: Foo\n\nThe system does foo somehow.\n\n#### Scenario: bar\n\n- **WHEN** x\n- **THEN** y\n`;
      const result = validateSpec(md);
      expect(result.errors).toContainEqual({
        rule: 'rfc-keyword-required',
        message: expect.stringMatching(/Foo/),
      });
    });

    it('matches as whole words only — "must" lowercase does not count', () => {
      const md = `## Purpose\n\nFoo.\n\n## Requirements\n\n### Requirement: Foo\n\nThe system must do foo.\n\n#### Scenario: bar\n\n- **WHEN** x\n- **THEN** y\n`;
      const result = validateSpec(md);
      expect(result.errors).toContainEqual({
        rule: 'rfc-keyword-required',
        message: expect.stringMatching(/Foo/),
      });
    });

    it('accepts MUST NOT as a single match', () => {
      const md = `## Purpose\n\nFoo.\n\n## Requirements\n\n### Requirement: Foo\n\nThe system MUST NOT do foo.\n\n#### Scenario: bar\n\n- **WHEN** x\n- **THEN** y\n`;
      const result = validateSpec(md);
      expect(result.errors.filter(e => e.rule === 'rfc-keyword-required')).toEqual([]);
    });
  });

  describe('rule 7: Scenario body WHEN/THEN', () => {
    it('fails when Scenario has no WHEN bullet', () => {
      const md = `## Purpose\n\nFoo.\n\n## Requirements\n\n### Requirement: Foo\n\nThe system MUST do foo.\n\n#### Scenario: bar\n\n- **THEN** y\n`;
      const result = validateSpec(md);
      expect(result.errors).toContainEqual({
        rule: 'scenario-when-then-required',
        message: expect.stringMatching(/bar/),
      });
    });

    it('fails when Scenario has no THEN bullet', () => {
      const md = `## Purpose\n\nFoo.\n\n## Requirements\n\n### Requirement: Foo\n\nThe system MUST do foo.\n\n#### Scenario: bar\n\n- **WHEN** x\n`;
      const result = validateSpec(md);
      expect(result.errors).toContainEqual({
        rule: 'scenario-when-then-required',
        message: expect.stringMatching(/bar/),
      });
    });
  });

  describe('happy path', () => {
    it('passes a minimal valid spec', () => {
      const md = `## Purpose\n\nFoo.\n\n## Requirements\n\n### Requirement: Foo\n\nThe system MUST do foo.\n\n#### Scenario: bar\n\n- **WHEN** x\n- **THEN** y\n`;
      const result = validateSpec(md);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('fixtures', () => {
    const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spec-validator');

    const cases: Array<{ name: string; valid: boolean; expectedRule?: string }> = [
      { name: 'valid-minimal',        valid: true },
      { name: 'missing-purpose',      valid: false, expectedRule: 'purpose-required' },
      { name: 'missing-scenario',     valid: false, expectedRule: 'scenario-required-per-requirement' },
      { name: 'missing-must-keyword', valid: false, expectedRule: 'rfc-keyword-required' },
      { name: 'invalid-format',       valid: false, expectedRule: 'heading-hierarchy' },
      { name: 'invalid-when-then',    valid: false, expectedRule: 'scenario-when-then-required' },
    ];

    for (const c of cases) {
      it(`fixture: ${c.name}`, () => {
        const md = readFileSync(join(fixtureDir, c.name, 'spec.md'), 'utf-8');
        const result = validateSpec(md);
        expect(result.valid).toBe(c.valid);
        if (c.expectedRule) {
          expect(result.errors.some((e) => e.rule === c.expectedRule)).toBe(true);
        }
      });
    }
  });
});
