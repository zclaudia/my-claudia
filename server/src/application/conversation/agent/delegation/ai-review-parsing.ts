import type { AIReviewResult } from '@my-claudia/shared/interaction/permissions';

export type ExtendedAIReviewMetadata = NonNullable<AIReviewResult['metadata']> & {
  payloadDisposition?: 'safe_to_send' | 'send_with_redaction' | 'do_not_send';
  redactionCount?: number;
  reviewedFileCount?: number;
};

export type AIReviewModelResponse =
  | {
      type: 'final';
      decision: 'approve' | 'deny' | 'uncertain';
      reasoning: string;
      confidence: number;
    }
  | {
      type: 'read_file';
      path: string;
      reason?: string;
    };

export function summarizeAIReviewResponse(response: string): string {
  return response.slice(0, 400).replace(/\s+/g, ' ').trim();
}

export function normalizeAIReviewDecision(value: unknown): 'approve' | 'deny' | 'uncertain' | null {
  if (typeof value !== 'string') return null;
  switch (value.trim().toLowerCase()) {
    case 'approve':
    case 'approved':
    case 'allow':
    case 'allowed':
    case 'safe':
    case 'yes':
      return 'approve';
    case 'deny':
    case 'denied':
    case 'reject':
    case 'rejected':
    case 'block':
    case 'blocked':
    case 'unsafe':
    case 'sensitive':
      return 'deny';
    case 'uncertain':
    case 'unknown':
    case 'unsure':
    case 'maybe':
    case 'suspicious':
    case 'escalate':
      return 'uncertain';
    default:
      return null;
  }
}

export function normalizeAIReviewModelResponse(parsed: Record<string, unknown>): AIReviewModelResponse | null {
  const normalizedType = typeof parsed.type === 'string' ? parsed.type.trim().toLowerCase() : undefined;

  if (
    normalizedType === 'read_file'
    || (typeof parsed.path === 'string' && normalizeAIReviewDecision(parsed.decision ?? parsed.label ?? parsed.verdict) === null)
  ) {
    if (typeof parsed.path !== 'string' || !parsed.path.trim()) return null;
    const reason = typeof parsed.reason === 'string'
      ? parsed.reason
      : typeof parsed.reasoning === 'string'
        ? parsed.reasoning
        : undefined;
    return {
      type: 'read_file',
      path: parsed.path.trim(),
      reason,
    };
  }

  const decision = normalizeAIReviewDecision(parsed.decision ?? parsed.label ?? parsed.verdict);
  if (!decision) return null;

  const reasoning = typeof parsed.reasoning === 'string'
    ? parsed.reasoning
    : typeof parsed.reason === 'string'
      ? parsed.reason
      : typeof parsed.explanation === 'string'
        ? parsed.explanation
        : 'No reasoning provided';

  return {
    type: 'final',
    decision,
    reasoning,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
  };
}

export function buildRepairPrompt(previousResponse: string, errorMessage: string): string {
  return `Your previous reply for the AI security review was invalid.

Validation error:
${errorMessage}

Previous reply:
<previous_reply>
${previousResponse.slice(0, 2000)}
</previous_reply>

Return ONLY one valid JSON object matching exactly one of these shapes:
{"type":"final","decision":"approve"|"deny"|"uncertain","reasoning":"one sentence explanation","confidence":0.0}
{"type":"read_file","path":"relative/path.sh","reason":"why you need it"}

Rules:
- No markdown
- No code fences
- No extra text before or after the JSON
- Use "decision", not synonyms like "allow" or "reject"
- Use "reasoning", not "reason"
- "confidence" must be a number between 0 and 1`;
}

export function extractJSONObjects(response: string): string[] {
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let i = 0; i < response.length; i += 1) {
    const ch = response[i];

    if (start === -1) {
      if (ch === '{') {
        start = i;
        depth = 1;
        inString = false;
        escaping = false;
      }
      continue;
    }

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (ch === '\\') {
        escaping = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      depth += 1;
      continue;
    }

    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        objects.push(response.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return objects;
}

export function sanitizeJSONControlCharsInStrings(json: string): string {
  let sanitized = '';
  let inString = false;
  let escaping = false;

  for (const ch of json) {
    if (inString) {
      if (escaping) {
        sanitized += ch;
        escaping = false;
        continue;
      }

      if (ch === '\\') {
        sanitized += ch;
        escaping = true;
        continue;
      }

      if (ch === '"') {
        sanitized += ch;
        inString = false;
        continue;
      }

      if (ch === '\n') {
        sanitized += '\\n';
        continue;
      }

      if (ch === '\r') {
        sanitized += '\\r';
        continue;
      }

      if (ch === '\t') {
        sanitized += '\\t';
        continue;
      }

      const code = ch.charCodeAt(0);
      if ((code >= 0 && code < 0x20) || code === 0x7f) {
        continue;
      }

      sanitized += ch;
      continue;
    }

    if (ch === '"') {
      sanitized += ch;
      inString = true;
      continue;
    }

    const code = ch.charCodeAt(0);
    if ((code >= 0 && code < 0x20) || code === 0x7f) {
      if (ch === '\n' || ch === '\r' || ch === '\t') {
        sanitized += ch;
      }
      continue;
    }

    sanitized += ch;
  }

  return sanitized;
}

export function extractLooseField(text: string, fieldNames: string[]): string | null {
  for (const fieldName of fieldNames) {
    const quoted = new RegExp(`["']${fieldName}["']\\s*:\\s*["']([^"']+)["']`, 'i').exec(text);
    if (quoted?.[1]) return quoted[1].trim();

    const bare = new RegExp(`["']${fieldName}["']\\s*:\\s*([^,}\\n\\r]+)`, 'i').exec(text);
    if (bare?.[1]) return bare[1].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

export function salvageMalformedAIReviewResponse(text: string): AIReviewModelResponse | null {
  const path = extractLooseField(text, ['path']);
  const decision = normalizeAIReviewDecision(
    extractLooseField(text, ['decision', 'verdict', 'label'])
  );
  const reasoning = extractLooseField(text, ['reasoning', 'reason', 'explanation']);
  const confidenceRaw = extractLooseField(text, ['confidence']);
  const confidence = Math.max(0, Math.min(1, Number(confidenceRaw) || 0));

  if (path && !decision) {
    return {
      type: 'read_file',
      path,
      reason: reasoning || undefined,
    };
  }

  if (!decision) return null;

  return {
    type: 'final',
    decision,
    reasoning: reasoning || 'No reasoning provided',
    confidence,
  };
}

export function parseCandidateJSONObject(jsonCandidate: string): AIReviewModelResponse {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonCandidate) as Record<string, unknown>;
  } catch {
    try {
      parsed = JSON.parse(sanitizeJSONControlCharsInStrings(jsonCandidate)) as Record<string, unknown>;
    } catch {
      const salvaged = salvageMalformedAIReviewResponse(jsonCandidate);
      if (salvaged) return salvaged;
      throw new Error('LLM response contained malformed JSON');
    }
  }

  const normalized = normalizeAIReviewModelResponse(parsed);
  if (normalized) return normalized;

  const salvaged = salvageMalformedAIReviewResponse(jsonCandidate);
  if (salvaged) return salvaged;
  throw new Error('LLM response did not match AI review schema');
}

export function parseAIReviewResponse(response: string): AIReviewModelResponse {
  const jsonCandidates = extractJSONObjects(response);
  if (jsonCandidates.length === 0) {
    throw new Error('LLM response did not contain valid JSON');
  }

  let lastError: Error | null = null;
  for (let i = jsonCandidates.length - 1; i >= 0; i -= 1) {
    try {
      return parseCandidateJSONObject(jsonCandidates[i]);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error('LLM response did not match AI review schema');
}
