/** RFC 2119 keywords as recognized by OpenSpec specs. */
export type RfcKeyword = 'MUST' | 'MUST NOT' | 'SHALL' | 'SHALL NOT' | 'SHOULD' | 'SHOULD NOT' | 'MAY';

export interface ParsedScenario {
  name: string;
  /** Raw body lines (typically bulleted "- **WHEN/THEN/AND** ..." lines). */
  bodyLines: string[];
}

export interface ParsedRequirement {
  name: string;
  /** Body text between the Requirement heading and the first Scenario heading. */
  body: string;
  /** Detected RFC keywords in the body (unique, in first-appearance order). */
  rfcKeywords: RfcKeyword[];
  scenarios: ParsedScenario[];
}

export interface ParsedSpec {
  /** Top-level capability name from `# <name> Specification` heading. */
  capability: string;
  /** Optional `## Purpose` section body. */
  purpose?: string;
  requirements: ParsedRequirement[];
}

/** A parsed delta document: a change-scoped spec that mutates a corpus spec. */
export interface DeltaDoc {
  /** Optional change-scoped purpose paragraph. */
  purpose?: string;
  added: ParsedRequirement[];
  modified: ParsedRequirement[];
  /** Names of requirements to remove from the corpus spec. */
  removed: string[];
}

/** Discriminated representation of an individual delta operation (useful for diff/UI). */
export type DeltaOp =
  | { kind: 'add'; requirement: ParsedRequirement }
  | { kind: 'modify'; requirement: ParsedRequirement }
  | { kind: 'remove'; name: string };

export function flattenDelta(delta: DeltaDoc): DeltaOp[] {
  return [
    ...delta.added.map((r) => ({ kind: 'add' as const, requirement: r })),
    ...delta.modified.map((r) => ({ kind: 'modify' as const, requirement: r })),
    ...delta.removed.map((name) => ({ kind: 'remove' as const, name })),
  ];
}
