/**
 * Pure-TS validator for OpenSpec spec-driven schema.
 * Each rule is checked independently and returns a structured error.
 * See docs/superpowers/specs/2026-05-26-spec-corpus-init-design.md §11.
 */

export interface ValidationError {
  rule: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export function validateSpec(markdown: string): ValidationResult {
  const errors: ValidationError[] = [];
  const lines = markdown.split(/\r?\n/);

  // Rule 1: ## Purpose section required with at least one non-empty paragraph
  const purposeIdx = lines.findIndex((l) => /^##\s+Purpose\s*$/.test(l));
  if (purposeIdx === -1) {
    errors.push({
      rule: 'purpose-required',
      message: 'Missing required `## Purpose` section.',
    });
  } else {
    const nextSectionIdx = lines
      .slice(purposeIdx + 1)
      .findIndex((l) => /^##\s+/.test(l));
    const end = nextSectionIdx === -1 ? lines.length : purposeIdx + 1 + nextSectionIdx;
    const body = lines.slice(purposeIdx + 1, end).join('\n').trim();
    if (body.length === 0) {
      errors.push({
        rule: 'purpose-required',
        message: '`## Purpose` section is empty.',
      });
    }
  }

  return { valid: errors.length === 0, errors };
}
