# OpenSpec × Supervisor — Phase G2: SpecChange Runtime + Delta Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the spec-runtime heart: parse OpenSpec-format markdown specs and deltas, validate structure, merge deltas into the corpus, and ship a `SpecChangeService` + `ArchiveService` that drives the full lifecycle from "create spec_change" → "edit files" → "archive (merge into corpus)". Zero UI in this phase; pure server logic + tests.

**Architecture:** Pure functions for parse / format / merge / validate live in `server/src/domains/openspec/markdown/` and `delta-merger.ts`. Two services orchestrate: `SpecChangeService` owns the on-disk lifecycle of an active spec_change (create skeleton files, persist edits, transition status). `ArchiveService` runs the merge: validate → diff against corpus → apply ADDED/MODIFIED/REMOVED → move folder under `archive/`. All file operations are scoped to a project's `openspec/` root.

**Tech Stack:** TypeScript strict, vitest, Node fs/promises, the existing `SpecChangeRepository` from G1.

**Spec reference:** `docs/design/openspec-integration-v2.zh-CN.md` §5.5 / §6 / §11 G2 acceptance.

**Format reference (verified from `.3rd-party/OpenSpec/openspec/`):**
- Spec file: `# <cap> Specification` → `## Purpose` → `## Requirements` → `### Requirement: <name>` → `#### Scenario: <name>` → `- **WHEN/THEN/AND** ...`
- Delta file: `## Purpose` (change-scoped) → `## ADDED Requirements` / `## MODIFIED Requirements` / `## REMOVED Requirements` sections

**Phase predecessors:**
- G1 tag `openspec/phase-g1-complete` (commit `cddb0223`)
- Design v0.2 commit `342651f6`

---

## File Structure

```
server/src/domains/openspec/                                 (existing dir from G2 — currently empty)
├── index.ts                                                 NEW
├── markdown/
│   ├── types.ts                                             NEW (ParsedSpec, ParsedRequirement, ParsedScenario, DeltaDoc, DeltaOp)
│   ├── spec-parser.ts                                       NEW (parse spec.md → ParsedSpec)
│   ├── delta-parser.ts                                      NEW (parse delta spec.md → DeltaDoc)
│   └── spec-formatter.ts                                    NEW (ParsedSpec / DeltaDoc → markdown round-trip)
├── validator.ts                                             NEW (structural + RFC keyword rules)
├── delta-merger.ts                                          NEW (apply DeltaDoc to ParsedSpec)
├── spec-change-service.ts                                   NEW (CRUD + scaffold openspec/changes/<slug>/)
├── archive-service.ts                                       NEW (validate → merge → move folder)
└── __tests__/
    ├── markdown/
    │   ├── spec-parser.test.ts                              NEW
    │   ├── delta-parser.test.ts                             NEW
    │   └── spec-formatter.test.ts                           NEW
    ├── validator.test.ts                                    NEW
    ├── delta-merger.test.ts                                 NEW
    ├── spec-change-service.test.ts                          NEW
    └── archive-service.test.ts                              NEW
```

7 tasks total.

```
Task 1 — markdown/types.ts + spec-parser                     ← independent
Task 2 — markdown/delta-parser + spec-formatter              ← needs T1
Task 3 — validator                                           ← needs T1
Task 4 — delta-merger                                        ← needs T2
Task 5 — SpecChangeService (CRUD + file IO + scaffold)       ← needs T2, T3
Task 6 — ArchiveService (validate + merge + folder move)      ← needs T4, T5
Task 7 — Smoke + tag openspec/phase-g2-complete              ← final
```

---

## Task 1: `markdown/types.ts` + `spec-parser.ts`

**Files:**
- Create: `server/src/domains/openspec/markdown/types.ts`
- Create: `server/src/domains/openspec/markdown/spec-parser.ts`
- Create: `server/src/domains/openspec/__tests__/markdown/spec-parser.test.ts`

**Goal:** Define the parsed-AST types and a function `parseSpec(markdown): ParsedSpec`.

- [ ] **Step 1: Create types**

```typescript
// server/src/domains/openspec/markdown/types.ts

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
```

- [ ] **Step 2: Create the parser**

```typescript
// server/src/domains/openspec/markdown/spec-parser.ts
import type { ParsedSpec, ParsedRequirement, ParsedScenario, RfcKeyword } from './types.js';

const RFC_KEYWORDS: RfcKeyword[] = ['MUST NOT', 'MUST', 'SHALL NOT', 'SHALL', 'SHOULD NOT', 'SHOULD', 'MAY'];

function detectRfcKeywords(body: string): RfcKeyword[] {
  const seen = new Set<RfcKeyword>();
  const out: RfcKeyword[] = [];
  // Word-boundary search; "MUST NOT" must be matched before "MUST" — order in RFC_KEYWORDS handles this.
  for (const kw of RFC_KEYWORDS) {
    const pattern = new RegExp(`\\b${kw.replace(' ', '\\s+')}\\b`);
    if (pattern.test(body) && !seen.has(kw)) {
      seen.add(kw);
      out.push(kw);
    }
  }
  return out;
}

/** Extract everything between two line predicates (exclusive of the boundaries). */
function sliceLines(lines: string[], startIdx: number, endIdx: number): string[] {
  return lines.slice(startIdx + 1, endIdx);
}

export function parseSpec(markdown: string): ParsedSpec {
  const lines = markdown.split(/\r?\n/);

  // 1. Find the capability heading: first level-1 heading matching "# <cap> Specification"
  let capability = '';
  let capabilityLineIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^#\s+(.+?)\s+Specification\s*$/i);
    if (m) {
      capability = m[1].trim();
      capabilityLineIdx = i;
      break;
    }
  }
  if (capability === '') {
    // Try a softer fallback: first `# <something>` heading.
    for (let i = 0; i < lines.length; i += 1) {
      const m = lines[i].match(/^#\s+(.+?)\s*$/);
      if (m) { capability = m[1].trim().replace(/\s+Specification$/i, ''); capabilityLineIdx = i; break; }
    }
  }

  // 2. Find `## Purpose` section (optional)
  let purpose: string | undefined;
  const purposeIdx = lines.findIndex((l, i) => i > capabilityLineIdx && /^##\s+Purpose\s*$/i.test(l));
  if (purposeIdx >= 0) {
    const nextH2 = lines.findIndex((l, i) => i > purposeIdx && /^##\s+/.test(l));
    const endIdx = nextH2 >= 0 ? nextH2 : lines.length;
    purpose = sliceLines(lines, purposeIdx, endIdx).join('\n').trim() || undefined;
  }

  // 3. Find `## Requirements` section
  const reqsHeadingIdx = lines.findIndex((l) => /^##\s+Requirements\s*$/i.test(l));
  if (reqsHeadingIdx === -1) {
    return { capability, purpose, requirements: [] };
  }

  // 4. Within Requirements section, find each `### Requirement: <name>` block
  const requirementHeadingIdxs: number[] = [];
  for (let i = reqsHeadingIdx + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) break;  // next h2 ends the Requirements section
    if (/^###\s+Requirement:\s*/.test(lines[i])) requirementHeadingIdxs.push(i);
  }

  const requirements: ParsedRequirement[] = requirementHeadingIdxs.map((startIdx, k) => {
    const endIdx = requirementHeadingIdxs[k + 1] ?? (
      lines.findIndex((l, i) => i > startIdx && /^##\s+/.test(l))
    );
    const finalEnd = endIdx >= 0 ? endIdx : lines.length;

    const nameMatch = lines[startIdx].match(/^###\s+Requirement:\s*(.+?)\s*$/);
    const name = nameMatch ? nameMatch[1].trim() : '';

    // Find Scenario sub-headings within this requirement
    const scenarioIdxs: number[] = [];
    for (let i = startIdx + 1; i < finalEnd; i += 1) {
      if (/^####\s+Scenario:\s*/.test(lines[i])) scenarioIdxs.push(i);
    }

    const bodyEnd = scenarioIdxs[0] ?? finalEnd;
    const body = sliceLines(lines, startIdx, bodyEnd).join('\n').trim();
    const rfcKeywords = detectRfcKeywords(body);

    const scenarios: ParsedScenario[] = scenarioIdxs.map((sIdx, j) => {
      const sEnd = scenarioIdxs[j + 1] ?? finalEnd;
      const sNameMatch = lines[sIdx].match(/^####\s+Scenario:\s*(.+?)\s*$/);
      const scenarioName = sNameMatch ? sNameMatch[1].trim() : '';
      const bodyLines = sliceLines(lines, sIdx, sEnd)
        .filter((l) => l.trim().length > 0);
      return { name: scenarioName, bodyLines };
    });

    return { name, body, rfcKeywords, scenarios };
  });

  return { capability, purpose, requirements };
}
```

- [ ] **Step 3: Write tests**

```typescript
// server/src/domains/openspec/__tests__/markdown/spec-parser.test.ts
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
```

- [ ] **Step 4: Run + verify**

Run:
```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/openspec/__tests__/markdown/spec-parser.test.ts
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: 5 tests green, tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/openspec/markdown/types.ts \
        server/src/domains/openspec/markdown/spec-parser.ts \
        server/src/domains/openspec/__tests__/markdown/spec-parser.test.ts
git commit -m "feat(openspec): markdown types + spec parser"
```

---

## Task 2: `delta-parser.ts` + `spec-formatter.ts`

**Files:**
- Create: `server/src/domains/openspec/markdown/delta-parser.ts`
- Create: `server/src/domains/openspec/markdown/spec-formatter.ts`
- Create: `server/src/domains/openspec/__tests__/markdown/delta-parser.test.ts`
- Create: `server/src/domains/openspec/__tests__/markdown/spec-formatter.test.ts`

**Goal:** Parse `## ADDED Requirements` / `## MODIFIED Requirements` / `## REMOVED Requirements` sections from a delta spec.md. Also provide a formatter that produces canonical markdown from a `ParsedSpec` (for archive merge output).

- [ ] **Step 1: Create `delta-parser.ts`**

```typescript
// server/src/domains/openspec/markdown/delta-parser.ts
import type { DeltaDoc, ParsedRequirement } from './types.js';
import { parseSpec } from './spec-parser.js';

/**
 * Parse a delta document. Delta documents have ADDED / MODIFIED / REMOVED
 * section headings instead of `## Requirements`. They may also have a
 * change-scoped `## Purpose` paragraph.
 *
 * For ADDED and MODIFIED sections, we reuse the spec parser by synthesizing
 * a "## Requirements" wrapper and reading out the requirements.
 */
export function parseDelta(markdown: string): DeltaDoc {
  const lines = markdown.split(/\r?\n/);

  // Purpose (optional)
  let purpose: string | undefined;
  const purposeIdx = lines.findIndex((l) => /^##\s+Purpose\s*$/i.test(l));
  if (purposeIdx >= 0) {
    const nextH2 = lines.findIndex((l, i) => i > purposeIdx && /^##\s+/.test(l));
    const endIdx = nextH2 >= 0 ? nextH2 : lines.length;
    purpose = lines.slice(purposeIdx + 1, endIdx).join('\n').trim() || undefined;
  }

  const added = extractRequirements(lines, /^##\s+ADDED Requirements\s*$/i);
  const modified = extractRequirements(lines, /^##\s+MODIFIED Requirements\s*$/i);
  const removed = extractRemoved(lines);

  return { purpose, added, modified, removed };
}

function extractRequirements(lines: string[], headingPattern: RegExp): ParsedRequirement[] {
  const start = lines.findIndex((l) => headingPattern.test(l));
  if (start === -1) return [];
  const end = lines.findIndex((l, i) => i > start && /^##\s+/.test(l));
  const sectionEnd = end >= 0 ? end : lines.length;
  const sectionLines = lines.slice(start + 1, sectionEnd);

  // Reuse parseSpec by synthesizing a minimal spec doc containing only these requirements.
  const synthetic = ['# synthetic Specification', '', '## Requirements', ...sectionLines].join('\n');
  return parseSpec(synthetic).requirements;
}

function extractRemoved(lines: string[]): string[] {
  const start = lines.findIndex((l) => /^##\s+REMOVED Requirements\s*$/i.test(l));
  if (start === -1) return [];
  const end = lines.findIndex((l, i) => i > start && /^##\s+/.test(l));
  const sectionEnd = end >= 0 ? end : lines.length;
  const sectionLines = lines.slice(start + 1, sectionEnd);

  // Parse list entries: lines like "- `name`" or "- name"
  const names: string[] = [];
  for (const raw of sectionLines) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('-')) {
      const m = trimmed.match(/^-\s+`?(.+?)`?\s*$/);
      if (m) names.push(m[1].trim());
    }
  }
  return names;
}
```

- [ ] **Step 2: Create `spec-formatter.ts`**

```typescript
// server/src/domains/openspec/markdown/spec-formatter.ts
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
```

- [ ] **Step 3: Write delta-parser tests**

```typescript
// server/src/domains/openspec/__tests__/markdown/delta-parser.test.ts
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
```

- [ ] **Step 4: Write formatter tests**

```typescript
// server/src/domains/openspec/__tests__/markdown/spec-formatter.test.ts
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
```

- [ ] **Step 5: Run + verify**

```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/openspec/__tests__/markdown
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: 4 delta + 4 formatter = 8 new tests green; spec-parser tests still green; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add server/src/domains/openspec/markdown/delta-parser.ts \
        server/src/domains/openspec/markdown/spec-formatter.ts \
        server/src/domains/openspec/__tests__/markdown/delta-parser.test.ts \
        server/src/domains/openspec/__tests__/markdown/spec-formatter.test.ts
git commit -m "feat(openspec): delta parser + spec formatter"
```

---

## Task 3: `validator.ts`

**Files:**
- Create: `server/src/domains/openspec/validator.ts`
- Create: `server/src/domains/openspec/__tests__/validator.test.ts`

**Goal:** Run structural checks against a parsed spec or delta and return a list of issues.

- [ ] **Step 1: Create validator**

```typescript
// server/src/domains/openspec/validator.ts
import type { ParsedSpec, ParsedRequirement, DeltaDoc } from './markdown/types.js';

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
    issues.push({ severity: 'error', location: 'capability', message: 'capability name missing or empty' });
  }
  if (spec.requirements.length === 0) {
    issues.push({ severity: 'warning', location: 'requirements', message: 'spec has no requirements' });
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
    if (!name.trim()) issues.push({ severity: 'error', location: 'removed', message: 'empty requirement name in REMOVED list' });
  }
  if (delta.added.length === 0 && delta.modified.length === 0 && delta.removed.length === 0) {
    issues.push({ severity: 'warning', location: 'delta', message: 'delta is empty (no ADDED/MODIFIED/REMOVED)' });
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
    out.push({ severity: 'warning', location: loc, message: 'requirement body has no RFC 2119 keyword (MUST/SHOULD/MAY/SHALL)' });
  }
  if (req.scenarios.length === 0) {
    out.push({ severity: 'error', location: loc, message: 'requirement must have at least one Scenario' });
  }
  for (const sc of req.scenarios) {
    const scLoc = `${loc}.scenario[${sc.name || '<unnamed>'}]`;
    if (!sc.name) out.push({ severity: 'error', location: scLoc, message: 'scenario name missing' });
    if (sc.bodyLines.length === 0) {
      out.push({ severity: 'error', location: scLoc, message: 'scenario has no body lines' });
    }
  }
  return out;
}
```

- [ ] **Step 2: Write tests**

```typescript
// server/src/domains/openspec/__tests__/validator.test.ts
import { describe, it, expect } from 'vitest';
import { validateSpec, validateDelta } from '../validator.js';
import type { ParsedSpec, DeltaDoc } from '../markdown/types.js';

function mkReq(over: Partial<ParsedSpec['requirements'][number]> = {}) {
  return {
    name: 'R',
    body: 'System MUST do x.',
    rfcKeywords: ['MUST' as const],
    scenarios: [{ name: 'S', bodyLines: ['- **WHEN** x', '- **THEN** y'] }],
    ...over,
  };
}

describe('validateSpec', () => {
  it('ok=true for a well-formed spec', () => {
    const spec: ParsedSpec = { capability: 'auth', requirements: [mkReq()] };
    const v = validateSpec(spec);
    expect(v.ok).toBe(true);
  });

  it('flags missing capability', () => {
    const v = validateSpec({ capability: '', requirements: [mkReq()] });
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.message.includes('capability'))).toBe(true);
  });

  it('flags requirement without scenarios as error', () => {
    const v = validateSpec({ capability: 'x', requirements: [mkReq({ scenarios: [] })] });
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.message.includes('Scenario'))).toBe(true);
  });

  it('warns when body lacks RFC keyword', () => {
    const v = validateSpec({ capability: 'x', requirements: [mkReq({ body: 'no keyword here', rfcKeywords: [] })] });
    expect(v.ok).toBe(true);  // warning, not error
    expect(v.issues.some((i) => i.severity === 'warning' && i.message.includes('RFC'))).toBe(true);
  });

  it('flags scenario with no body lines', () => {
    const v = validateSpec({ capability: 'x', requirements: [mkReq({ scenarios: [{ name: 'S', bodyLines: [] }] })] });
    expect(v.ok).toBe(false);
  });
});

describe('validateDelta', () => {
  it('ok=true for non-empty delta with valid added requirement', () => {
    const delta: DeltaDoc = { added: [mkReq()], modified: [], removed: [] };
    expect(validateDelta(delta).ok).toBe(true);
  });

  it('warns when delta is fully empty', () => {
    const v = validateDelta({ added: [], modified: [], removed: [] });
    expect(v.ok).toBe(true);
    expect(v.issues.some((i) => i.message.includes('empty'))).toBe(true);
  });

  it('flags empty name in removed list', () => {
    const v = validateDelta({ added: [], modified: [], removed: ['', 'good'] });
    expect(v.ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run + verify**

```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/openspec/__tests__/validator.test.ts
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: 8 tests green, tsc clean.

- [ ] **Step 4: Commit**

```bash
git add server/src/domains/openspec/validator.ts \
        server/src/domains/openspec/__tests__/validator.test.ts
git commit -m "feat(openspec): spec + delta validator"
```

---

## Task 4: `delta-merger.ts`

**Files:**
- Create: `server/src/domains/openspec/delta-merger.ts`
- Create: `server/src/domains/openspec/__tests__/delta-merger.test.ts`

**Goal:** Apply a `DeltaDoc` to a `ParsedSpec` (the existing corpus capability) and return a new `ParsedSpec`. Pure function.

- [ ] **Step 1: Create merger**

```typescript
// server/src/domains/openspec/delta-merger.ts
import type { ParsedSpec, ParsedRequirement, DeltaDoc } from './markdown/types.js';

export interface MergeResult {
  spec: ParsedSpec;
  /** Names that were added (didn't exist in corpus). */
  added: string[];
  /** Names that were modified (replaced existing). */
  modified: string[];
  /** Names that were removed (matched existing). */
  removed: string[];
  /** ADDED entries whose name already existed in corpus (collision). */
  addedConflicts: string[];
  /** MODIFIED entries whose target didn't exist in corpus. */
  modifiedMissing: string[];
  /** REMOVED entries whose target didn't exist in corpus. */
  removedMissing: string[];
}

export function applyDelta(corpus: ParsedSpec, delta: DeltaDoc): MergeResult {
  // Index existing requirements by name (case-sensitive).
  const byName = new Map<string, ParsedRequirement>();
  for (const r of corpus.requirements) byName.set(r.name, r);

  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];
  const addedConflicts: string[] = [];
  const modifiedMissing: string[] = [];
  const removedMissing: string[] = [];

  // ADDED
  for (const r of delta.added) {
    if (byName.has(r.name)) {
      addedConflicts.push(r.name);
      // Conservative: skip (don't overwrite via add-as-modify).
      continue;
    }
    byName.set(r.name, r);
    added.push(r.name);
  }

  // MODIFIED
  for (const r of delta.modified) {
    if (!byName.has(r.name)) {
      modifiedMissing.push(r.name);
      // Conservative: insert it anyway (treat as ADDED).
      byName.set(r.name, r);
      continue;
    }
    byName.set(r.name, r);
    modified.push(r.name);
  }

  // REMOVED
  for (const name of delta.removed) {
    if (!byName.has(name)) {
      removedMissing.push(name);
      continue;
    }
    byName.delete(name);
    removed.push(name);
  }

  // Preserve corpus order for surviving + previously-existing requirements; append truly-new ones at the end.
  const orderedNames: string[] = [];
  for (const r of corpus.requirements) if (byName.has(r.name)) orderedNames.push(r.name);
  for (const name of added) if (!orderedNames.includes(name)) orderedNames.push(name);

  const mergedRequirements = orderedNames.map((n) => byName.get(n) as ParsedRequirement);

  return {
    spec: {
      capability: corpus.capability,
      purpose: corpus.purpose,  // keep corpus purpose; delta.purpose is change-scoped, not corpus
      requirements: mergedRequirements,
    },
    added,
    modified,
    removed,
    addedConflicts,
    modifiedMissing,
    removedMissing,
  };
}

/**
 * Apply a delta against an EMPTY corpus (first-time capability). All ADDED
 * succeed; MODIFIED becomes ADDED; REMOVED becomes removedMissing.
 */
export function applyDeltaToEmptyCorpus(capability: string, delta: DeltaDoc): MergeResult {
  return applyDelta({ capability, requirements: [] }, delta);
}
```

- [ ] **Step 2: Write tests**

```typescript
// server/src/domains/openspec/__tests__/delta-merger.test.ts
import { describe, it, expect } from 'vitest';
import { applyDelta, applyDeltaToEmptyCorpus } from '../delta-merger.js';
import type { ParsedSpec, ParsedRequirement } from '../markdown/types.js';

function mkReq(name: string, body = 'MUST do.'): ParsedRequirement {
  return { name, body, rfcKeywords: ['MUST'], scenarios: [{ name: 's', bodyLines: ['- **WHEN** x', '- **THEN** y'] }] };
}

describe('applyDelta', () => {
  it('ADDED inserts a new requirement', () => {
    const corpus: ParsedSpec = { capability: 'x', requirements: [mkReq('A')] };
    const result = applyDelta(corpus, { added: [mkReq('B')], modified: [], removed: [] });
    expect(result.spec.requirements.map((r) => r.name)).toEqual(['A', 'B']);
    expect(result.added).toEqual(['B']);
  });

  it('MODIFIED replaces existing requirement body, keeps position', () => {
    const corpus: ParsedSpec = { capability: 'x', requirements: [mkReq('A'), mkReq('B'), mkReq('C')] };
    const newB = mkReq('B', 'SHALL be updated.');
    const result = applyDelta(corpus, { added: [], modified: [newB], removed: [] });
    expect(result.spec.requirements.map((r) => r.name)).toEqual(['A', 'B', 'C']);
    expect(result.spec.requirements[1].body).toBe('SHALL be updated.');
    expect(result.modified).toEqual(['B']);
  });

  it('REMOVED drops a requirement', () => {
    const corpus: ParsedSpec = { capability: 'x', requirements: [mkReq('A'), mkReq('B')] };
    const result = applyDelta(corpus, { added: [], modified: [], removed: ['A'] });
    expect(result.spec.requirements.map((r) => r.name)).toEqual(['B']);
    expect(result.removed).toEqual(['A']);
  });

  it('ADDED collision is reported, original kept', () => {
    const corpus: ParsedSpec = { capability: 'x', requirements: [mkReq('A', 'original')] };
    const result = applyDelta(corpus, { added: [mkReq('A', 'new')], modified: [], removed: [] });
    expect(result.addedConflicts).toEqual(['A']);
    expect(result.spec.requirements[0].body).toBe('original');
  });

  it('MODIFIED missing target is reported, inserted anyway', () => {
    const corpus: ParsedSpec = { capability: 'x', requirements: [mkReq('A')] };
    const result = applyDelta(corpus, { added: [], modified: [mkReq('B', 'new')], removed: [] });
    expect(result.modifiedMissing).toEqual(['B']);
    expect(result.spec.requirements.map((r) => r.name)).toContain('B');
  });

  it('REMOVED missing target is reported, no error', () => {
    const corpus: ParsedSpec = { capability: 'x', requirements: [mkReq('A')] };
    const result = applyDelta(corpus, { added: [], modified: [], removed: ['B'] });
    expect(result.removedMissing).toEqual(['B']);
  });

  it('combined ADD + MODIFY + REMOVE in one delta', () => {
    const corpus: ParsedSpec = { capability: 'x', requirements: [mkReq('A'), mkReq('B'), mkReq('C')] };
    const result = applyDelta(corpus, {
      added: [mkReq('D')],
      modified: [mkReq('B', 'changed')],
      removed: ['A'],
    });
    expect(result.spec.requirements.map((r) => r.name)).toEqual(['B', 'C', 'D']);
    expect(result.spec.requirements[0].body).toBe('changed');
  });

  it('applyDeltaToEmptyCorpus handles ADDED-only delta', () => {
    const result = applyDeltaToEmptyCorpus('newcap', { added: [mkReq('R1')], modified: [], removed: [] });
    expect(result.spec.capability).toBe('newcap');
    expect(result.spec.requirements).toHaveLength(1);
    expect(result.added).toEqual(['R1']);
  });

  it('corpus purpose is preserved across merge', () => {
    const corpus: ParsedSpec = { capability: 'x', purpose: 'Original purpose.', requirements: [mkReq('A')] };
    const result = applyDelta(corpus, { added: [mkReq('B')], modified: [], removed: [], purpose: 'change purpose' });
    expect(result.spec.purpose).toBe('Original purpose.');
  });
});
```

- [ ] **Step 3: Run + verify**

```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/openspec/__tests__/delta-merger.test.ts
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: 9 tests green, tsc clean.

- [ ] **Step 4: Commit**

```bash
git add server/src/domains/openspec/delta-merger.ts \
        server/src/domains/openspec/__tests__/delta-merger.test.ts
git commit -m "feat(openspec): delta merger with conflict detection"
```

---

## Task 5: `SpecChangeService` — CRUD + file IO + scaffold

**Files:**
- Create: `server/src/domains/openspec/spec-change-service.ts`
- Create: `server/src/domains/openspec/__tests__/spec-change-service.test.ts`

**Goal:** A service that owns the on-disk lifecycle of an active spec_change. Methods:
- `createSpecChange({ projectId, subIssueId, slug, title })` — inserts row + writes 3 skeleton files (`proposal.md`, `design.md`, `tasks.md`) under `openspec/changes/<slug>/`
- `writeProposal(specChangeId, content)`, `writeDesign`, `writeTasks` — overwrite the corresponding file + bump status
- `writeDeltaSpec(specChangeId, capability, content)` — write `openspec/changes/<slug>/specs/<capability>/spec.md` and track in `delta_spec_paths`
- `readProposal/Design/Tasks/DeltaSpec` — read back from disk
- `cancel(specChangeId)` — sets status to 'cancelled'

- [ ] **Step 1: Inspect existing path conventions**

Quick check: what's the convention in the project for "given a projectId, find its working directory"? Look at the existing `ContextManager` in `server/src/domains/supervision/context-manager.ts`. It takes `projectRootPath` directly in the constructor. SpecChangeService follows the same shape: caller passes the project root.

- [ ] **Step 2: Create the service**

```typescript
// server/src/domains/openspec/spec-change-service.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Database } from 'better-sqlite3';
import type {
  SpecChange,
  SpecChangeStatus,
} from '@my-claudia/shared/features/spec-change';
import { SpecChangeRepository } from '../spec-change/spec-change-repository.js';

const OPENSPEC_DIR = 'openspec';
const CHANGES_DIR = 'changes';

export interface SpecChangeServiceDeps {
  db: Database;
  /** Resolve a project's filesystem root (working tree). */
  getProjectRoot: (projectId: string) => string;
}

export interface CreateSpecChangeInput {
  projectId: string;
  subIssueId: string;
  slug: string;
  title: string;
}

const SKELETON_PROPOSAL = '# Proposal\n\n## Why\n\n## What Changes\n\n## Impact\n';
const SKELETON_DESIGN = '# Design\n\n## Overview\n\n## Technical Approach\n\n## Risks\n';
const SKELETON_TASKS = '# Tasks\n\n- [ ] Task 1\n';

export class SpecChangeService {
  private repo: SpecChangeRepository;

  constructor(private deps: SpecChangeServiceDeps) {
    this.repo = new SpecChangeRepository(deps.db);
  }

  createSpecChange(input: CreateSpecChangeInput): SpecChange {
    const sc = this.repo.create({
      projectId: input.projectId,
      subIssueId: input.subIssueId,
      slug: input.slug,
      title: input.title,
    });
    // Scaffold files on disk.
    const dir = this.changeDir(input.projectId, input.slug);
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(path.join(dir, 'proposal.md'))) fs.writeFileSync(path.join(dir, 'proposal.md'), SKELETON_PROPOSAL);
    if (!fs.existsSync(path.join(dir, 'design.md')))   fs.writeFileSync(path.join(dir, 'design.md'),   SKELETON_DESIGN);
    if (!fs.existsSync(path.join(dir, 'tasks.md')))    fs.writeFileSync(path.join(dir, 'tasks.md'),    SKELETON_TASKS);
    return sc;
  }

  writeProposal(specChangeId: string, content: string): SpecChange {
    return this.writeArtifact(specChangeId, 'proposal.md', content, 'proposing');
  }

  writeDesign(specChangeId: string, content: string): SpecChange {
    return this.writeArtifact(specChangeId, 'design.md', content, 'designing');
  }

  writeTasks(specChangeId: string, content: string): SpecChange {
    return this.writeArtifact(specChangeId, 'tasks.md', content, 'tasks_ready');
  }

  /** Write or overwrite a delta spec file for a given capability. */
  writeDeltaSpec(specChangeId: string, capability: string, content: string): SpecChange {
    const sc = this.requireChange(specChangeId);
    const rel = path.join('specs', capability, 'spec.md');
    const target = path.join(this.changeDir(sc.projectId, sc.slug), rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);

    const fullRel = path.join(OPENSPEC_DIR, CHANGES_DIR, sc.slug, rel);
    const next = sc.deltaSpecPaths.includes(fullRel)
      ? sc.deltaSpecPaths
      : [...sc.deltaSpecPaths, fullRel];
    return this.repo.update(specChangeId, { deltaSpecPaths: next });
  }

  readProposal(specChangeId: string): string {
    return this.readArtifact(specChangeId, 'proposal.md');
  }

  readDesign(specChangeId: string): string {
    return this.readArtifact(specChangeId, 'design.md');
  }

  readTasks(specChangeId: string): string {
    return this.readArtifact(specChangeId, 'tasks.md');
  }

  readDeltaSpec(specChangeId: string, capability: string): string {
    const sc = this.requireChange(specChangeId);
    const target = path.join(this.changeDir(sc.projectId, sc.slug), 'specs', capability, 'spec.md');
    return fs.readFileSync(target, 'utf-8');
  }

  cancel(specChangeId: string): SpecChange {
    return this.repo.update(specChangeId, { status: 'cancelled' });
  }

  getById(specChangeId: string): SpecChange | null {
    return this.repo.findById(specChangeId);
  }

  /** Internal helpers */

  private writeArtifact(specChangeId: string, filename: 'proposal.md' | 'design.md' | 'tasks.md', content: string, nextStatus: SpecChangeStatus): SpecChange {
    const sc = this.requireChange(specChangeId);
    const target = path.join(this.changeDir(sc.projectId, sc.slug), filename);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    // Only advance status if it's a strictly later state.
    const order: SpecChangeStatus[] = ['drafting', 'proposing', 'designing', 'tasks_ready'];
    const currentIdx = order.indexOf(sc.status);
    const nextIdx = order.indexOf(nextStatus);
    const status = (currentIdx >= 0 && nextIdx > currentIdx) ? nextStatus : sc.status;
    return this.repo.update(specChangeId, { status });
  }

  private readArtifact(specChangeId: string, filename: string): string {
    const sc = this.requireChange(specChangeId);
    const target = path.join(this.changeDir(sc.projectId, sc.slug), filename);
    return fs.readFileSync(target, 'utf-8');
  }

  private requireChange(specChangeId: string): SpecChange {
    const sc = this.repo.findById(specChangeId);
    if (!sc) throw new Error(`SpecChange not found: ${specChangeId}`);
    return sc;
  }

  private changeDir(projectId: string, slug: string): string {
    return path.join(this.deps.getProjectRoot(projectId), OPENSPEC_DIR, CHANGES_DIR, slug);
  }
}
```

- [ ] **Step 3: Write tests**

```typescript
// server/src/domains/openspec/__tests__/spec-change-service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { SpecChangeService } from '../spec-change-service.js';

describe('SpecChangeService', () => {
  let db: Database.Database;
  let projectRoot: string;
  let service: SpecChangeService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('proj-1', 'P', 'code', 0, 0);
    db.prepare(`INSERT INTO local_issues (id, project_id, title, description, status, priority, labels, created_at, updated_at, type, is_anonymous)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('i', 'proj-1', 't', null, 'open', 'medium', '[]', 0, 0, 'implement', 0);
    projectRoot = mkdtempSync(path.join(tmpdir(), 'openspec-svc-'));
    service = new SpecChangeService({ db, getProjectRoot: () => projectRoot });
  });

  afterEach(() => {
    db.close();
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
  });

  it('createSpecChange writes the three skeleton files', () => {
    const sc = service.createSpecChange({ projectId: 'proj-1', subIssueId: 'i', slug: 'add-2fa', title: 'Add 2FA' });
    const dir = path.join(projectRoot, 'openspec', 'changes', 'add-2fa');
    expect(fs.existsSync(path.join(dir, 'proposal.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'design.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'tasks.md'))).toBe(true);
    expect(sc.status).toBe('drafting');
  });

  it('writeProposal advances status drafting → proposing and persists content', () => {
    const sc = service.createSpecChange({ projectId: 'proj-1', subIssueId: 'i', slug: 'x', title: 'X' });
    const updated = service.writeProposal(sc.id, '# new proposal\n');
    expect(updated.status).toBe('proposing');
    expect(service.readProposal(sc.id)).toBe('# new proposal\n');
  });

  it('writeDesign and writeTasks advance status', () => {
    const sc = service.createSpecChange({ projectId: 'proj-1', subIssueId: 'i', slug: 'x', title: 'X' });
    service.writeProposal(sc.id, 'p');
    let cur = service.writeDesign(sc.id, 'd');
    expect(cur.status).toBe('designing');
    cur = service.writeTasks(sc.id, 't');
    expect(cur.status).toBe('tasks_ready');
  });

  it('status does not regress when writing an earlier artifact', () => {
    const sc = service.createSpecChange({ projectId: 'proj-1', subIssueId: 'i', slug: 'x', title: 'X' });
    service.writeTasks(sc.id, 't');  // tasks_ready
    const updated = service.writeProposal(sc.id, 'p2');
    expect(updated.status).toBe('tasks_ready');  // does not regress to 'proposing'
  });

  it('writeDeltaSpec writes file and adds to deltaSpecPaths', () => {
    const sc = service.createSpecChange({ projectId: 'proj-1', subIssueId: 'i', slug: 'x', title: 'X' });
    const upd = service.writeDeltaSpec(sc.id, 'auth', '# auth delta\n');
    const target = path.join(projectRoot, 'openspec', 'changes', 'x', 'specs', 'auth', 'spec.md');
    expect(fs.existsSync(target)).toBe(true);
    expect(upd.deltaSpecPaths).toContain('openspec/changes/x/specs/auth/spec.md');
  });

  it('writeDeltaSpec twice for same capability does not duplicate path entry', () => {
    const sc = service.createSpecChange({ projectId: 'proj-1', subIssueId: 'i', slug: 'x', title: 'X' });
    service.writeDeltaSpec(sc.id, 'auth', 'a1');
    const upd = service.writeDeltaSpec(sc.id, 'auth', 'a2');
    expect(upd.deltaSpecPaths.filter((p) => p.endsWith('auth/spec.md'))).toHaveLength(1);
  });

  it('cancel sets status=cancelled', () => {
    const sc = service.createSpecChange({ projectId: 'proj-1', subIssueId: 'i', slug: 'x', title: 'X' });
    const c = service.cancel(sc.id);
    expect(c.status).toBe('cancelled');
  });

  it('throws when reading from a non-existent spec_change', () => {
    expect(() => service.readProposal('nope')).toThrow(/SpecChange not found/);
  });
});
```

- [ ] **Step 4: Run + verify**

```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/openspec/__tests__/spec-change-service.test.ts
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: 8 tests green, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/openspec/spec-change-service.ts \
        server/src/domains/openspec/__tests__/spec-change-service.test.ts
git commit -m "feat(openspec): SpecChangeService — CRUD + scaffold + file IO"
```

---

## Task 6: `ArchiveService` — validate + merge + folder move

**Files:**
- Create: `server/src/domains/openspec/archive-service.ts`
- Create: `server/src/domains/openspec/__tests__/archive-service.test.ts`

**Goal:** Given a `specChangeId`, run the archive flow:
1. Read each delta spec file → parse with `parseDelta`
2. Validate (all must be ok)
3. For each capability touched:
   - Read corpus file `openspec/specs/<capability>/spec.md` (if absent → empty corpus)
   - Apply delta → new corpus content
   - Write corpus back
4. Move `openspec/changes/<slug>/` → `openspec/changes/archive/<YYYY-MM-DD>-<slug>/`
5. Update spec_change row: `status='archived'`, `archivedAt=now`, `deltaPendingMerge=false`

Result returned includes summary: per-capability ADDED/MODIFIED/REMOVED counts.

- [ ] **Step 1: Create archive service**

```typescript
// server/src/domains/openspec/archive-service.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Database } from 'better-sqlite3';
import type { SpecChange } from '@my-claudia/shared/features/spec-change';
import { SpecChangeRepository } from '../spec-change/spec-change-repository.js';
import { parseSpec } from './markdown/spec-parser.js';
import { parseDelta } from './markdown/delta-parser.js';
import { formatSpec } from './markdown/spec-formatter.js';
import { applyDelta, type MergeResult } from './delta-merger.js';
import { validateDelta } from './validator.js';

const OPENSPEC_DIR = 'openspec';
const SPECS_DIR = 'specs';
const CHANGES_DIR = 'changes';
const ARCHIVE_DIR = 'archive';

export interface ArchiveServiceDeps {
  db: Database;
  getProjectRoot: (projectId: string) => string;
}

export interface CapabilityArchiveSummary {
  capability: string;
  added: string[];
  modified: string[];
  removed: string[];
  addedConflicts: string[];
  modifiedMissing: string[];
  removedMissing: string[];
}

export interface ArchiveResult {
  ok: boolean;
  /** Per-capability summary; empty if validation failed before merge. */
  capabilities: CapabilityArchiveSummary[];
  /** Validation errors (only present when ok=false). */
  validationErrors: { capability: string; issues: string[] }[];
  archivedDir?: string;
}

export class ArchiveService {
  private repo: SpecChangeRepository;

  constructor(private deps: ArchiveServiceDeps) {
    this.repo = new SpecChangeRepository(deps.db);
  }

  async archive(specChangeId: string): Promise<ArchiveResult> {
    const sc = this.repo.findById(specChangeId);
    if (!sc) throw new Error(`SpecChange not found: ${specChangeId}`);

    const projectRoot = this.deps.getProjectRoot(sc.projectId);
    const changeDir = path.join(projectRoot, OPENSPEC_DIR, CHANGES_DIR, sc.slug);
    const specsRoot = path.join(projectRoot, OPENSPEC_DIR, SPECS_DIR);

    // 1. Discover delta files: from sc.deltaSpecPaths if non-empty; else scan the dir.
    const deltaFiles = await this.findDeltaFiles(changeDir, sc.deltaSpecPaths);

    // 2. Parse + validate ALL deltas first; abort on any validation error.
    const parsed = deltaFiles.map((f) => ({
      capability: f.capability,
      delta: parseDelta(fs.readFileSync(f.absPath, 'utf-8')),
    }));

    const validationErrors = parsed
      .map((p) => ({ capability: p.capability, result: validateDelta(p.delta) }))
      .filter((r) => !r.result.ok)
      .map((r) => ({ capability: r.capability, issues: r.result.issues.filter((i) => i.severity === 'error').map((i) => `${i.location}: ${i.message}`) }));

    if (validationErrors.length > 0) {
      return { ok: false, capabilities: [], validationErrors };
    }

    // 3. Apply each delta to the corresponding corpus spec.
    const capabilities: CapabilityArchiveSummary[] = [];
    for (const { capability, delta } of parsed) {
      const corpusFile = path.join(specsRoot, capability, 'spec.md');
      const corpusSpec = fs.existsSync(corpusFile)
        ? parseSpec(fs.readFileSync(corpusFile, 'utf-8'))
        : { capability, requirements: [] };
      const merge: MergeResult = applyDelta(corpusSpec, delta);
      fs.mkdirSync(path.dirname(corpusFile), { recursive: true });
      fs.writeFileSync(corpusFile, formatSpec(merge.spec));
      capabilities.push({
        capability,
        added: merge.added,
        modified: merge.modified,
        removed: merge.removed,
        addedConflicts: merge.addedConflicts,
        modifiedMissing: merge.modifiedMissing,
        removedMissing: merge.removedMissing,
      });
    }

    // 4. Move change dir under archive/.
    const today = new Date().toISOString().slice(0, 10);
    const archiveRoot = path.join(projectRoot, OPENSPEC_DIR, CHANGES_DIR, ARCHIVE_DIR);
    fs.mkdirSync(archiveRoot, { recursive: true });
    const archivedDir = path.join(archiveRoot, `${today}-${sc.slug}`);
    if (fs.existsSync(changeDir)) {
      fs.renameSync(changeDir, archivedDir);
    }

    // 5. Mark spec_change as archived.
    this.repo.update(specChangeId, {
      status: 'archived',
      deltaPendingMerge: false,
      archivedAt: Date.now(),
    });

    return { ok: true, capabilities, validationErrors: [], archivedDir };
  }

  private async findDeltaFiles(
    changeDir: string,
    knownPaths: string[],
  ): Promise<{ capability: string; absPath: string }[]> {
    const found: { capability: string; absPath: string }[] = [];
    const specsDir = path.join(changeDir, 'specs');
    if (!fs.existsSync(specsDir)) return found;

    // Walk one level: openspec/changes/<slug>/specs/<capability>/spec.md
    for (const entry of fs.readdirSync(specsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const cap = entry.name;
      const specFile = path.join(specsDir, cap, 'spec.md');
      if (fs.existsSync(specFile)) {
        found.push({ capability: cap, absPath: specFile });
      }
    }
    return found;
  }
}
```

- [ ] **Step 2: Write tests**

```typescript
// server/src/domains/openspec/__tests__/archive-service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { ArchiveService } from '../archive-service.js';
import { SpecChangeService } from '../spec-change-service.js';

const SAMPLE_DELTA = `## Purpose
Adds 2FA.

## ADDED Requirements
### Requirement: 2FA enrollment

System SHALL allow 2FA enrollment.

#### Scenario: User enrolls
- **WHEN** user opts in
- **THEN** system SHALL provision TOTP
`;

const SAMPLE_CORPUS = `# auth Specification

## Purpose
Handles user auth.

## Requirements

### Requirement: Login

System SHALL authenticate users.

#### Scenario: Valid
- **WHEN** valid
- **THEN** SHALL return token
`;

describe('ArchiveService', () => {
  let db: Database.Database;
  let projectRoot: string;
  let scService: SpecChangeService;
  let archive: ArchiveService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('proj-1', 'P', 'code', 0, 0);
    db.prepare(`INSERT INTO local_issues (id, project_id, title, description, status, priority, labels, created_at, updated_at, type, is_anonymous)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('i', 'proj-1', 't', null, 'open', 'medium', '[]', 0, 0, 'implement', 0);
    projectRoot = mkdtempSync(path.join(tmpdir(), 'openspec-arch-'));
    scService = new SpecChangeService({ db, getProjectRoot: () => projectRoot });
    archive = new ArchiveService({ db, getProjectRoot: () => projectRoot });
  });

  afterEach(() => {
    db.close();
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
  });

  it('merges ADDED requirement into an existing corpus and moves change to archive/', async () => {
    // Seed corpus
    const corpusDir = path.join(projectRoot, 'openspec', 'specs', 'auth');
    fs.mkdirSync(corpusDir, { recursive: true });
    fs.writeFileSync(path.join(corpusDir, 'spec.md'), SAMPLE_CORPUS);

    // Create change + delta
    const sc = scService.createSpecChange({ projectId: 'proj-1', subIssueId: 'i', slug: 'add-2fa', title: 'Add 2FA' });
    scService.writeDeltaSpec(sc.id, 'auth', SAMPLE_DELTA);

    const result = await archive.archive(sc.id);
    expect(result.ok).toBe(true);
    expect(result.capabilities).toHaveLength(1);
    expect(result.capabilities[0].added).toEqual(['2FA enrollment']);
    // Change folder moved
    expect(fs.existsSync(path.join(projectRoot, 'openspec', 'changes', 'add-2fa'))).toBe(false);
    expect(fs.existsSync(result.archivedDir!)).toBe(true);
    // Corpus updated
    const newCorpus = fs.readFileSync(path.join(corpusDir, 'spec.md'), 'utf-8');
    expect(newCorpus).toContain('### Requirement: Login');
    expect(newCorpus).toContain('### Requirement: 2FA enrollment');
    // spec_change row updated
    const updated = scService.getById(sc.id)!;
    expect(updated.status).toBe('archived');
    expect(updated.archivedAt).toBeTruthy();
  });

  it('creates a fresh corpus file when capability did not exist', async () => {
    const sc = scService.createSpecChange({ projectId: 'proj-1', subIssueId: 'i', slug: 'new-cap', title: 'X' });
    scService.writeDeltaSpec(sc.id, 'newcap', SAMPLE_DELTA);
    const result = await archive.archive(sc.id);
    expect(result.ok).toBe(true);
    const newCorpus = fs.readFileSync(path.join(projectRoot, 'openspec', 'specs', 'newcap', 'spec.md'), 'utf-8');
    expect(newCorpus).toContain('### Requirement: 2FA enrollment');
  });

  it('aborts archive on validation error and does NOT move folder', async () => {
    const sc = scService.createSpecChange({ projectId: 'proj-1', subIssueId: 'i', slug: 'bad', title: 'X' });
    // Invalid delta: ADDED requirement with no scenarios
    const invalid = `## ADDED Requirements
### Requirement: Bad
System MUST do.
`;
    scService.writeDeltaSpec(sc.id, 'cap', invalid);
    const result = await archive.archive(sc.id);
    expect(result.ok).toBe(false);
    expect(result.validationErrors).toHaveLength(1);
    expect(fs.existsSync(path.join(projectRoot, 'openspec', 'changes', 'bad'))).toBe(true);
  });

  it('handles delta with no spec files (empty change)', async () => {
    const sc = scService.createSpecChange({ projectId: 'proj-1', subIssueId: 'i', slug: 'empty', title: 'X' });
    const result = await archive.archive(sc.id);
    expect(result.ok).toBe(true);
    expect(result.capabilities).toEqual([]);
    expect(fs.existsSync(result.archivedDir!)).toBe(true);
  });

  it('throws on unknown spec_change id', async () => {
    await expect(archive.archive('nope')).rejects.toThrow(/SpecChange not found/);
  });
});
```

- [ ] **Step 3: Run + verify**

```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/openspec/__tests__/archive-service.test.ts
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: 5 tests green, tsc clean.

- [ ] **Step 4: Commit**

```bash
git add server/src/domains/openspec/archive-service.ts \
        server/src/domains/openspec/__tests__/archive-service.test.ts
git commit -m "feat(openspec): ArchiveService — validate + merge + folder move"
```

---

## Task 7: index export + smoke + tag

**Files:**
- Create: `server/src/domains/openspec/index.ts`

**Goal:** Domain export surface + full regression + tag.

- [ ] **Step 1: Create `index.ts`**

```typescript
// server/src/domains/openspec/index.ts
export { SpecChangeService } from './spec-change-service.js';
export { ArchiveService } from './archive-service.js';
export { parseSpec } from './markdown/spec-parser.js';
export { parseDelta } from './markdown/delta-parser.js';
export { formatSpec, formatRequirement } from './markdown/spec-formatter.js';
export { applyDelta, applyDeltaToEmptyCorpus } from './delta-merger.js';
export { validateSpec, validateDelta } from './validator.js';
export type {
  ParsedSpec,
  ParsedRequirement,
  ParsedScenario,
  DeltaDoc,
  DeltaOp,
  RfcKeyword,
} from './markdown/types.js';
export type { MergeResult } from './delta-merger.js';
export type { ValidationResult, ValidationIssue } from './validator.js';
export type { ArchiveResult, CapabilityArchiveSummary } from './archive-service.js';
```

- [ ] **Step 2: Build**

```bash
pnpm build
```

Expected: 4 packages clean.

- [ ] **Step 3: Full server tests**

```bash
pnpm --filter @my-claudia/server exec vitest run
```

Expected: ~3560 tests green (G1's 3529 + roughly 35 new G2 tests).

- [ ] **Step 4: Type-check**

```bash
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 5: Programmatic end-to-end smoke**

```bash
cd /Users/haozhang/SourceCode/zhvala/my-claudia && node --input-type=module -e "
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fs from 'node:fs';
import Database from 'better-sqlite3';
import { applyMigrations } from './server/dist/infrastructure/storage/migrations/index.js';
import { SpecChangeService, ArchiveService } from './server/dist/domains/openspec/index.js';

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
applyMigrations(db);
db.prepare(\"INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)\").run('proj-1','P','code',0,0);
db.prepare(\"INSERT INTO local_issues (id, project_id, title, description, status, priority, labels, created_at, updated_at, type, is_anonymous) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\").run('i','proj-1','t',null,'open','medium','[]',0,0,'implement',0);
const root = mkdtempSync(join(tmpdir(), 'openspec-smoke-'));
const sc = new SpecChangeService({ db, getProjectRoot: () => root });
const ar = new ArchiveService({ db, getProjectRoot: () => root });

const created = sc.createSpecChange({ projectId: 'proj-1', subIssueId: 'i', slug: 'smoke', title: 'Smoke' });
sc.writeProposal(created.id, '# proposal\n');
sc.writeDeltaSpec(created.id, 'core', \`## ADDED Requirements
### Requirement: Smoke check
System MUST pass smoke.

#### Scenario: Pass
- **WHEN** smoke test runs
- **THEN** system MUST be ok
\`);

const result = await ar.archive(created.id);
if (!result.ok) { console.error('Archive failed', result.validationErrors); process.exit(1); }
const corpus = fs.readFileSync(join(root, 'openspec', 'specs', 'core', 'spec.md'), 'utf-8');
if (!corpus.includes('Smoke check')) { console.error('Corpus not updated'); process.exit(1); }
console.log('OpenSpec G2 smoke: PASS — corpus updated, change archived at', result.archivedDir);
"
```

Expected: `OpenSpec G2 smoke: PASS — corpus updated, change archived at <path>`.

- [ ] **Step 6: Tag**

```bash
git add server/src/domains/openspec/index.ts
git commit -m "feat(openspec): domain index export"
git tag -a openspec/phase-g2-complete -m "OpenSpec × Supervisor Phase G2 spec runtime + delta merge landed"
```

---

## Phase G2 Acceptance Criteria

- [ ] All 7 tasks complete with individual commits.
- [ ] `pnpm build` passes.
- [ ] Server vitest green (~3560 tests).
- [ ] Programmatic smoke produces archived dir + updated corpus.
- [ ] Tag `openspec/phase-g2-complete` exists.

---

## What Phase G2 Deliberately Does NOT Cover

| Item | Phase |
|------|-------|
| Sub-issue ↔ SpecChange automatic creation | G3 |
| X2 anonymous sub-issue creation | G3 |
| ExecutorInstance status propagation to spec_change / sub-issue | G3 |
| Bootstrap (`/opsx:explore` equivalent) | G4 |
| Re-scan with auto-accept ADDED + review MODIFIED/REMOVED | G4 |
| Any UI changes | G5 |
| AI-prompted spec authoring | G6 |

---

*Plan version: 1 / 2026-05-21*
*Design reference: `docs/design/openspec-integration-v2.zh-CN.md` (commit `342651f6`)*
*Predecessor: G1 (tag `openspec/phase-g1-complete`, commit `cddb0223`)*
