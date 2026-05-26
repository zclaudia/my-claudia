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

const RFC_KEYWORDS = ['MUST NOT', 'MUST', 'SHALL NOT', 'SHALL', 'SHOULD NOT', 'SHOULD', 'MAY'];

function containsRfcKeyword(text: string): boolean {
  let scratch = text;
  for (const kw of RFC_KEYWORDS) {
    const pattern = new RegExp(`\\b${kw.replace(' ', '\\s+')}\\b`);
    if (pattern.test(scratch)) return true;
    scratch = scratch.replace(new RegExp(`\\b${kw.replace(' ', '\\s+')}\\b`, 'g'), ' '.repeat(kw.length));
  }
  return false;
}

export function validateSpec(markdown: string): ValidationResult {
  const errors: ValidationError[] = [];
  const lines = markdown.split(/\r?\n/);

  // Rule 1: ## Purpose section required with at least one non-empty paragraph
  const purposeIdx = lines.findIndex((l) => /^##\s+Purpose\s*$/.test(l));
  if (purposeIdx === -1) {
    errors.push({ rule: 'purpose-required', message: 'Missing required `## Purpose` section.' });
  } else {
    const nextSectionIdx = lines.slice(purposeIdx + 1).findIndex((l) => /^##\s+/.test(l));
    const end = nextSectionIdx === -1 ? lines.length : purposeIdx + 1 + nextSectionIdx;
    const body = lines.slice(purposeIdx + 1, end).join('\n').trim();
    if (body.length === 0) {
      errors.push({ rule: 'purpose-required', message: '`## Purpose` section is empty.' });
    }
  }

  // Rule 2: ## Requirements section required
  const requirementsIdx = lines.findIndex((l) => /^##\s+Requirements\s*$/.test(l));
  if (requirementsIdx === -1) {
    errors.push({ rule: 'requirements-required', message: 'Missing required `## Requirements` section.' });
    return { valid: false, errors };
  }

  // Walk through requirements
  const reqHeadingIndexes: number[] = [];
  for (let i = requirementsIdx + 1; i < lines.length; i += 1) {
    if (/^###\s+Requirement:\s+(.+)$/.test(lines[i])) reqHeadingIndexes.push(i);
  }

  // Rule 5: heading hierarchy — no H4 (#### Scenario) outside a Requirement
  for (let i = requirementsIdx + 1; i < lines.length; i += 1) {
    if (/^####\s+/.test(lines[i])) {
      const hasReqAbove = reqHeadingIndexes.some((idx) => idx < i);
      if (!hasReqAbove) {
        errors.push({
          rule: 'heading-hierarchy',
          message: `H4 \`${lines[i].trim()}\` appears before any \`### Requirement\` heading.`,
        });
        break;
      }
    }
  }

  for (let r = 0; r < reqHeadingIndexes.length; r += 1) {
    const reqStart = reqHeadingIndexes[r];
    const reqEnd = r + 1 < reqHeadingIndexes.length ? reqHeadingIndexes[r + 1] : lines.length;
    const nameMatch = lines[reqStart].match(/^###\s+Requirement:\s+(.+)$/);
    const name = nameMatch ? nameMatch[1].trim() : '<unknown>';

    // Find Scenario headings inside this requirement
    const scenarioIndexes: number[] = [];
    for (let i = reqStart + 1; i < reqEnd; i += 1) {
      if (/^####\s+Scenario:\s+/.test(lines[i])) scenarioIndexes.push(i);
    }

    // Rule 4: each Requirement has at least one Scenario
    if (scenarioIndexes.length === 0) {
      errors.push({
        rule: 'scenario-required-per-requirement',
        message: `Requirement \`${name}\` has no \`#### Scenario:\` block.`,
      });
    }

    // Rule 3: Requirement body (between heading and first Scenario) non-empty
    const bodyEnd = scenarioIndexes[0] ?? reqEnd;
    const reqBody = lines.slice(reqStart + 1, bodyEnd).join('\n').trim();
    if (reqBody.length === 0) {
      errors.push({
        rule: 'requirement-body-required',
        message: `Requirement \`${name}\` has empty body before first Scenario.`,
      });
    } else if (!containsRfcKeyword(reqBody)) {
      // Rule 6: RFC keyword required
      errors.push({
        rule: 'rfc-keyword-required',
        message: `Requirement \`${name}\` body lacks an RFC keyword (MUST / SHOULD / MAY / etc.). Found: "${reqBody.slice(0, 80)}".`,
      });
    }

    // Rule 7: Scenario body has WHEN and THEN
    for (let s = 0; s < scenarioIndexes.length; s += 1) {
      const sStart = scenarioIndexes[s];
      const sEnd = s + 1 < scenarioIndexes.length ? scenarioIndexes[s + 1] : reqEnd;
      const sNameMatch = lines[sStart].match(/^####\s+Scenario:\s+(.+)$/);
      const sName = sNameMatch ? sNameMatch[1].trim() : '<unknown>';
      const sBody = lines.slice(sStart + 1, sEnd).join('\n');
      const hasWhen = /^-\s+\*\*WHEN\*\*/m.test(sBody);
      const hasThen = /^-\s+\*\*THEN\*\*/m.test(sBody);
      if (!hasWhen || !hasThen) {
        errors.push({
          rule: 'scenario-when-then-required',
          message: `Scenario \`${sName}\` (in Requirement \`${name}\`) missing ${!hasWhen ? '**WHEN**' : ''}${!hasWhen && !hasThen ? ' and ' : ''}${!hasThen ? '**THEN**' : ''} bullet.`,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
