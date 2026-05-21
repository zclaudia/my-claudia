import type { ParsedSpec, ParsedRequirement } from './types.js';

/**
 * Format a ParsedSpec back to canonical markdown. Output is byte-stable for
 * a given input (no trailing whitespace, single blank line between sections).
 */
export function formatSpec(spec: ParsedSpec): string {
  const out: string[] = [`# ${spec.capability} Specification`, ''];
  if (spec.purpose) {
    out.push('## Purpose', spec.purpose.trim(), '');
  }
  if (spec.requirements.length > 0) {
    out.push('## Requirements', '');
    for (const req of spec.requirements) {
      out.push(...formatRequirement(req), '');
    }
  }
  // Trim trailing blank lines and ensure exactly one terminating newline.
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}

export function formatRequirement(req: ParsedRequirement): string[] {
  const out: string[] = [`### Requirement: ${req.name}`, ''];
  if (req.body.trim()) {
    out.push(req.body.trim(), '');
  }
  for (const sc of req.scenarios) {
    out.push(`#### Scenario: ${sc.name}`);
    for (const line of sc.bodyLines) out.push(line);
    out.push('');
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}
