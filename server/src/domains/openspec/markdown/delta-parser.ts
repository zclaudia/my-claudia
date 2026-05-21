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
