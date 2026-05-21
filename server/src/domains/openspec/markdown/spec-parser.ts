import type { ParsedSpec, ParsedRequirement, ParsedScenario, RfcKeyword } from './types.js';

const RFC_KEYWORDS: RfcKeyword[] = ['MUST NOT', 'MUST', 'SHALL NOT', 'SHALL', 'SHOULD NOT', 'SHOULD', 'MAY'];

function detectRfcKeywords(body: string): RfcKeyword[] {
  const seen = new Set<RfcKeyword>();
  const out: RfcKeyword[] = [];
  // Walk keywords longest-first ("MUST NOT" before "MUST"). After matching, blank out
  // matched ranges so the shorter keyword doesn't re-trigger on the same span.
  let scratch = body;
  for (const kw of RFC_KEYWORDS) {
    const pattern = new RegExp(`\\b${kw.replace(' ', '\\s+')}\\b`, 'g');
    if (pattern.test(scratch) && !seen.has(kw)) {
      seen.add(kw);
      out.push(kw);
    }
    // Strip every occurrence (whether or not it triggered first-add) so longer keywords
    // can't seed shorter false-positives like detecting "MUST" inside "MUST NOT".
    scratch = scratch.replace(new RegExp(`\\b${kw.replace(' ', '\\s+')}\\b`, 'g'), ' '.repeat(kw.length));
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
