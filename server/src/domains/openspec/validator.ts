import type { ParsedRequirement, ParsedSpec, DeltaDoc } from './markdown/types.js';

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: ValidationSeverity;
  /** Path-style locator: 'requirement[Login]' / 'requirement[Login].scenario[Valid creds]' */
  location: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

/** Validate a corpus spec (full file under openspec/specs/). */
export function validateSpec(spec: ParsedSpec): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!spec.capability || /^\s*$/.test(spec.capability)) {
    issues.push({
      severity: 'error',
      location: 'capability',
      message: 'capability name missing or empty',
    });
  }
  if (spec.requirements.length === 0) {
    issues.push({
      severity: 'warning',
      location: 'requirements',
      message: 'spec has no requirements',
    });
  }
  for (const req of spec.requirements) {
    issues.push(...validateRequirement(req));
  }
  return { ok: issues.every((i) => i.severity !== 'error'), issues };
}

/** Validate a delta document. ADDED/MODIFIED requirements must satisfy the same rules. */
export function validateDelta(delta: DeltaDoc): ValidationResult {
  const issues: ValidationIssue[] = [];
  for (const r of delta.added) issues.push(...validateRequirement(r, 'added'));
  for (const r of delta.modified) issues.push(...validateRequirement(r, 'modified'));
  for (const name of delta.removed) {
    if (!name.trim()) {
      issues.push({
        severity: 'error',
        location: 'removed',
        message: 'empty requirement name in REMOVED list',
      });
    }
  }
  if (delta.added.length === 0 && delta.modified.length === 0 && delta.removed.length === 0) {
    issues.push({
      severity: 'warning',
      location: 'delta',
      message: 'delta is empty (no ADDED/MODIFIED/REMOVED)',
    });
  }
  return { ok: issues.every((i) => i.severity !== 'error'), issues };
}

function validateRequirement(req: ParsedRequirement, prefix = ''): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const loc = `${prefix ? prefix + '.' : ''}requirement[${req.name || '<unnamed>'}]`;
  if (!req.name || /^\s*$/.test(req.name)) {
    out.push({ severity: 'error', location: loc, message: 'requirement name missing' });
  }
  if (req.body.length === 0) {
    out.push({ severity: 'error', location: loc, message: 'requirement body missing' });
  }
  if (req.rfcKeywords.length === 0) {
    out.push({
      severity: 'warning',
      location: loc,
      message: 'requirement body has no RFC 2119 keyword (MUST/SHOULD/MAY/SHALL)',
    });
  }
  if (req.scenarios.length === 0) {
    out.push({
      severity: 'error',
      location: loc,
      message: 'requirement must have at least one Scenario',
    });
  }
  for (const sc of req.scenarios) {
    const scLoc = `${loc}.scenario[${sc.name || '<unnamed>'}]`;
    if (!sc.name) {
      out.push({ severity: 'error', location: scLoc, message: 'scenario name missing' });
    }
    if (sc.bodyLines.length === 0) {
      out.push({ severity: 'error', location: scLoc, message: 'scenario has no body lines' });
    }
  }
  return out;
}
