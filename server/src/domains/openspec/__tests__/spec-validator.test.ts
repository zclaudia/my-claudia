import { describe, it, expect } from 'vitest';
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
});
