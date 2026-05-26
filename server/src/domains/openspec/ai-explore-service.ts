// server/src/domains/openspec/ai-explore-service.ts
import type { AiRunPort } from '../meta-workflow/run-entities/subagent-run-entity.js';
import type { DeltaDoc, ParsedRequirement, ParsedScenario, RfcKeyword } from './markdown/types.js';

export interface AiExploreServiceDeps {
  aiRunPort: AiRunPort;
  /** Maximum tokens/time to wait for the AI response. Default 120s. */
  timeoutMs?: number;
  /** Optional providerId override (passed straight to aiRunPort). */
  providerId?: string;
}

export interface ExploreInput {
  projectId: string;
  /** Working directory the AI scans. */
  workingDirectory: string;
  /** Optional: existing corpus shown to the AI for diff-based re-scan. */
  existingCorpusSummary?: string;
  /** First-time bootstrap vs incremental re-scan — affects prompt. */
  mode: 'initial' | 'rescan';
}

export interface ExploreResult {
  /** Map capability → delta. Empty if AI returned nothing usable. */
  perCapability: Record<string, DeltaDoc>;
  /** Raw AI output (for debugging / persistence). */
  rawResponse: string;
  /** Parse errors collected during JSON extraction. */
  parseErrors: string[];
}

export interface DiscoveredCapability {
  name: string;
  description: string;
}

export interface DiscoverInput {
  projectId: string;
  workingDirectory: string;
  existingCapabilities?: string[];
}

export interface DiscoverResult {
  capabilities: DiscoveredCapability[];
  uncertainties: string[];
}

export class AiExploreService {
  constructor(private deps: AiExploreServiceDeps) {}

  async explore(input: ExploreInput): Promise<ExploreResult> {
    const prompt = buildExplorePrompt(input);
    let collected = '';
    let resolved = false;
    let portError: string | null = null;
    let runFailedMessage: string | null = null;
    let timedOut = false;
    const timeoutMs = this.deps.timeoutMs ?? 120_000;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (!resolved) {
          timedOut = true;
          resolved = true;
          resolve();
        }
      }, timeoutMs);
      this.deps.aiRunPort
        .startVirtualRun({
          input: prompt,
          workingDirectory: input.workingDirectory,
          providerId: this.deps.providerId,
          onMessage: (m) => {
            if (m.content) collected += m.content;
            if (m.kind === 'run_failed') {
              runFailedMessage = m.content || 'run_failed (no detail)';
            }
            if (
              m.kind === 'run_completed' ||
              m.kind === 'completed' ||
              m.kind === 'final' ||
              m.kind === 'run_failed'
            ) {
              if (!resolved) {
                resolved = true;
                clearTimeout(timer);
                resolve();
              }
            }
          },
        })
        .catch((err: unknown) => {
          portError = (err as Error)?.message ?? String(err);
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve();
          }
        });
    });

    const parsed = parseExploreResponse(collected);
    if (portError) parsed.parseErrors.push(`AI run port error: ${portError}`);
    if (runFailedMessage) parsed.parseErrors.push(`AI run failed: ${runFailedMessage}`);
    if (timedOut && collected.length === 0) {
      parsed.parseErrors.push(`AI run timed out after ${timeoutMs}ms with no output`);
    }
    if (parsed.parseErrors.length > 0) {
      console.warn(
        `[AiExploreService] explore returned with ${parsed.parseErrors.length} parse error(s):`,
        parsed.parseErrors,
      );
      if (collected.length > 0) {
        console.warn(
          `[AiExploreService] raw response (first 500 chars):`,
          collected.slice(0, 500),
        );
      }
    }
    return parsed;
  }

  async discoverCapabilities(input: DiscoverInput): Promise<DiscoverResult> {
    const basePrompt = buildDiscoverPrompt(input);
    let repairContext: string | null = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const prompt = repairContext ? `${repairContext}\n\n${basePrompt}` : basePrompt;
      const raw = await this.runAi(prompt, input.workingDirectory);
      const parsed = tryParseDiscoverResponse(raw);
      if (parsed) return parsed;
      repairContext =
        'Your previous response did not contain a parseable JSON object matching the required schema. Try again.';
    }
    throw new Error('AI did not emit parseable JSON for capability discovery after 2 attempts');
  }

  private async runAi(prompt: string, workingDirectory: string): Promise<string> {
    let collected = '';
    let resolved = false;
    const timeoutMs = this.deps.timeoutMs ?? 120_000;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      }, timeoutMs);
      this.deps.aiRunPort
        .startVirtualRun({
          input: prompt,
          workingDirectory,
          providerId: this.deps.providerId,
          onMessage: (m: { kind: string; content?: string }) => {
            if (m.content) collected += m.content;
            if (['run_completed', 'completed', 'final', 'run_failed'].includes(m.kind)) {
              if (!resolved) {
                resolved = true;
                clearTimeout(timer);
                resolve();
              }
            }
          },
        })
        .catch(() => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve();
          }
        });
    });
    return collected;
  }
}

/**
 * Build the explore prompt. The AI is told to emit a single JSON object on its own line
 * after any prose, with the shape: { perCapability: { <cap>: { added: [...], modified: [...], removed: [...] } } }
 */
export function buildExplorePrompt(input: ExploreInput): string {
  const intro =
    input.mode === 'initial'
      ? `You are bootstrapping a project specification corpus. Scan the codebase at the working directory and identify the system's current behaviors. Group them into "capabilities" (e.g. auth, billing, notifications).`
      : `You are re-scanning a project to find specification drift. Compare the codebase to the existing corpus summary below and emit deltas for what has changed.`;
  const corpusBlock = input.existingCorpusSummary
    ? `\n\n## Existing corpus summary\n\n${input.existingCorpusSummary}\n`
    : '';

  return [
    intro,
    corpusBlock,
    ``,
    `## Output format`,
    ``,
    `Emit a SINGLE JSON object on its own line, in this shape:`,
    ``,
    `\`\`\`json`,
    `{`,
    `  "perCapability": {`,
    `    "<capability-name>": {`,
    `      "added": [`,
    `        {`,
    `          "name": "<requirement name>",`,
    `          "body": "The system MUST/SHOULD/MAY <behavior>.",`,
    `          "scenarios": [`,
    `            { "name": "<scenario name>", "bodyLines": ["- **WHEN** ...", "- **THEN** ..."] }`,
    `          ]`,
    `        }`,
    `      ],`,
    `      "modified": [ /* same shape as added */ ],`,
    `      "removed": [ "<requirement name>", ... ]`,
    `    }`,
    `  }`,
    `}`,
    `\`\`\``,
    ``,
    `Rules:`,
    `- For initial bootstrap, "modified" and "removed" arrays should be empty for every capability.`,
    `- Each requirement body MUST contain at least one of: MUST, MUST NOT, SHALL, SHALL NOT, SHOULD, SHOULD NOT, MAY.`,
    `- Each requirement MUST have at least one scenario.`,
    `- Scenario bodyLines should be bullet items using **WHEN**/**THEN**/**AND**.`,
    `- Do not include implementation details (class names, file paths) — describe behavior only.`,
    `- The JSON must be valid (no comments, no trailing commas).`,
  ].join('\n');
}

/** Extract the JSON object and convert to per-capability DeltaDoc map. */
export function parseExploreResponse(rawResponse: string): ExploreResult {
  const parseErrors: string[] = [];
  const empty: ExploreResult = { perCapability: {}, rawResponse, parseErrors };

  // Find the first `{ ... }` block by brace-matching (skips JSON inside ```json fences too).
  const jsonText = extractJsonObject(rawResponse);
  if (!jsonText) {
    parseErrors.push('No JSON object found in AI response');
    return empty;
  }
  let parsed: { perCapability?: Record<string, unknown> };
  try {
    parsed = JSON.parse(jsonText) as { perCapability?: Record<string, unknown> };
  } catch (e) {
    parseErrors.push(`JSON.parse failed: ${(e as Error).message}`);
    return empty;
  }
  if (!parsed.perCapability || typeof parsed.perCapability !== 'object') {
    parseErrors.push('Missing or invalid `perCapability` field');
    return empty;
  }

  const perCapability: Record<string, DeltaDoc> = {};
  for (const [cap, val] of Object.entries(parsed.perCapability)) {
    const slot = val as { added?: unknown[]; modified?: unknown[]; removed?: unknown[] };
    perCapability[cap] = {
      added: (slot.added ?? []).map(toRequirement).filter((r): r is ParsedRequirement => r !== null),
      modified: (slot.modified ?? [])
        .map(toRequirement)
        .filter((r): r is ParsedRequirement => r !== null),
      removed: (slot.removed ?? []).filter((x): x is string => typeof x === 'string'),
    };
  }
  return { perCapability, rawResponse, parseErrors };
}

function extractJsonObject(text: string): string | null {
  // Walk character by character to find a balanced { ... } pair, respecting strings.
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

const RFC_KEYWORDS: RfcKeyword[] = [
  'MUST NOT',
  'MUST',
  'SHALL NOT',
  'SHALL',
  'SHOULD NOT',
  'SHOULD',
  'MAY',
];

function detectRfcKeywords(body: string): RfcKeyword[] {
  const out: RfcKeyword[] = [];
  let scratch = body;
  for (const kw of RFC_KEYWORDS) {
    const pattern = new RegExp(`\\b${kw.replace(' ', '\\s+')}\\b`);
    if (pattern.test(scratch)) {
      out.push(kw);
      scratch = scratch.replace(new RegExp(`\\b${kw.replace(' ', '\\s+')}\\b`, 'g'), ' '.repeat(kw.length));
    }
  }
  return out;
}

function toRequirement(raw: unknown): ParsedRequirement | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { name?: string; body?: string; scenarios?: unknown[] };
  if (typeof obj.name !== 'string' || typeof obj.body !== 'string') return null;
  const scenarios: ParsedScenario[] = Array.isArray(obj.scenarios)
    ? obj.scenarios
        .map((s) => {
          if (!s || typeof s !== 'object') return null;
          const sObj = s as { name?: string; bodyLines?: unknown[] };
          if (typeof sObj.name !== 'string') return null;
          const bodyLines = Array.isArray(sObj.bodyLines)
            ? sObj.bodyLines.filter((l): l is string => typeof l === 'string')
            : [];
          return { name: sObj.name, bodyLines };
        })
        .filter((s): s is ParsedScenario => s !== null)
    : [];
  return {
    name: obj.name,
    body: obj.body,
    rfcKeywords: detectRfcKeywords(obj.body),
    scenarios,
  };
}

function buildDiscoverPrompt(input: DiscoverInput): string {
  const existing = input.existingCapabilities && input.existingCapabilities.length > 0
    ? `\n\nExisting openspec/specs/ already documents these capabilities (skip them in your output):\n${input.existingCapabilities.map(c => `- ${c}`).join('\n')}`
    : '';
  return [
    'You are a code archaeologist looking at an existing project. Your job in this phase is NOT to write specs — it is to identify the system\'s capability boundaries so a follow-up phase can document them one at a time.',
    '',
    '## Stance',
    '- Curious, not prescriptive. Investigate before classifying.',
    '- Grounded — read the actual code, don\'t theorize.',
    '- Open threads — when uncertain about a directory\'s purpose, say so.',
    '',
    '## Steps',
    '1. Use Read / Glob / Grep to investigate: README, package manifests, entry points, top-level src/ directories.',
    '2. Identify high-cohesion functional groups (capabilities). Examples:',
    '   - good: auth / billing / notifications / workspace-isolation',
    '   - too fine: login / logout / reset-password (merge to auth)',
    '   - too coarse: core / main / misc (says nothing)',
    '3. For each capability give a kebab-case name + one-sentence description.',
    '4. List any directories or subsystems you couldn\'t make sense of, in `uncertainties`.' + existing,
    '',
    '## Output (strict JSON, single object, in its own fenced code block at the end)',
    '```json',
    '{',
    '  "capabilities": [',
    '    { "name": "<kebab-case>", "description": "<one line>" }',
    '  ],',
    '  "uncertainties": ["<thing you couldn\'t classify>"]',
    '}',
    '```',
    '',
    '## Hard rules',
    '- No spec content, no requirements, no scenarios in this phase.',
    '- If the project shows no recognizable structure, output empty arrays.',
    '- 3-10 capabilities is typical. >15 means you over-split — consolidate.',
  ].join('\n');
}

function tryParseDiscoverResponse(raw: string): DiscoverResult | null {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return null;
  try {
    const obj = JSON.parse(jsonText) as { capabilities?: unknown; uncertainties?: unknown };
    if (!Array.isArray(obj.capabilities)) return null;
    const caps: DiscoveredCapability[] = [];
    for (const c of obj.capabilities) {
      if (typeof c !== 'object' || c === null) return null;
      const cc = c as { name?: unknown; description?: unknown };
      if (typeof cc.name !== 'string' || typeof cc.description !== 'string') return null;
      caps.push({ name: cc.name, description: cc.description });
    }
    const uncertainties = Array.isArray(obj.uncertainties)
      ? obj.uncertainties.filter((x): x is string => typeof x === 'string')
      : [];
    return { capabilities: caps, uncertainties };
  } catch {
    return null;
  }
}
