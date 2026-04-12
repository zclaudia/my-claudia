import type { AIReviewCliJobResult } from './types.js';
import { extractJSONObjects } from './json-extract.js';

export function normalizeReviewDecision(value: unknown): 'approve' | 'deny' | 'uncertain' | null {
  if (typeof value !== 'string') return null;
  switch (value.trim().toLowerCase()) {
    case 'approve':
    case 'approved':
    case 'allow':
    case 'allowed':
    case 'safe':
      return 'approve';
    case 'deny':
    case 'denied':
    case 'reject':
    case 'rejected':
    case 'block':
    case 'blocked':
    case 'unsafe':
      return 'deny';
    case 'uncertain':
    case 'unknown':
    case 'unsure':
    case 'maybe':
    case 'suspicious':
      return 'uncertain';
    default:
      return null;
  }
}

export function parseFinalReviewFromText(rawOutput: string, errorPrefix: string): Pick<AIReviewCliJobResult, 'decision' | 'reasoning' | 'confidence'> {
  const candidates = extractJSONObjects(rawOutput);

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(candidates[i]) as Record<string, unknown>;
      const decision = normalizeReviewDecision(parsed.decision ?? parsed.verdict ?? parsed.label);
      if (!decision) continue;
      const reasoning = typeof parsed.reasoning === 'string'
        ? parsed.reasoning
        : typeof parsed.reason === 'string'
          ? parsed.reason
          : typeof parsed.explanation === 'string'
            ? parsed.explanation
            : 'No reasoning provided';
      return {
        decision,
        reasoning,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      };
    } catch {
      // Ignore malformed candidates and keep scanning backwards.
    }
  }

  throw new Error(`${errorPrefix} did not produce a valid final JSON result`);
}

export function summarizeCliOutput(text: string | undefined, maxLength = 600): string {
  if (!text) return '(empty)';
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

export class CliReviewParseError extends Error {
  /** Raw assistant text that failed to parse — callers may pass this upstream for a second parse attempt. */
  readonly rawAssistantText: string;
  constructor(errorPrefix: string, stdout: string, stderr: string, rawAssistantText: string, cause: unknown) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(`${causeMsg} | stdout=${summarizeCliOutput(stdout)} | stderr=${summarizeCliOutput(stderr)}`);
    this.name = 'CliReviewParseError';
    this.rawAssistantText = rawAssistantText;
  }
}

export function buildCliReviewParseError(
  errorPrefix: string,
  stdout: string,
  stderr: string,
  cause: unknown,
  rawAssistantText?: string,
): CliReviewParseError {
  return new CliReviewParseError(errorPrefix, stdout, stderr, rawAssistantText ?? stdout, cause);
}
