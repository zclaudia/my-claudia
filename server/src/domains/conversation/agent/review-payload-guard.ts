import { basename, extname, sep } from 'path';

export type ReviewPayloadDisposition = 'safe_to_send' | 'send_with_redaction' | 'do_not_send';

export interface ReviewPayloadGuardResult {
  disposition: ReviewPayloadDisposition;
  text: string;
  reasons: string[];
  redactionCount: number;
}

const BLOCK_PATH_SEGMENTS = [
  `${sep}.ssh${sep}`,
  `${sep}.aws${sep}`,
  `${sep}.gnupg${sep}`,
  `${sep}.config${sep}gh${sep}`,
  `${sep}Library${sep}Keychains${sep}`,
  `${sep}System${sep}`,
  `${sep}private${sep}`,
  `${sep}etc${sep}`,
];

const BLOCK_FILE_NAMES = new Set([
  '.env',
  '.npmrc',
  '.pypirc',
  '.netrc',
  'id_rsa',
  'id_ed25519',
  'known_hosts',
]);

const BLOCK_EXTENSIONS = new Set([
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.crt',
  '.der',
]);

const BLOCK_TEXT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bprintenv\b/i, reason: 'Command accesses full environment variables' },
  { pattern: /\benv\b(?![A-Za-z0-9_-])/i, reason: 'Command accesses full environment variables' },
  { pattern: /\bset\b(?![A-Za-z0-9_-])/i, reason: 'Command may print shell variables' },
  { pattern: /\bcat\s+['"]?(?:\.env(?:\.[^'"\\/\s]+)?|~\/\.ssh\/|~\/\.aws\/)/i, reason: 'Command reads a known sensitive file' },
];

const REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string; label: string }> = [
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
    label: 'private_key',
  },
  {
    pattern: /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]+\b/g,
    replacement: '[REDACTED_GITHUB_TOKEN]',
    label: 'github_token',
  },
  {
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: '[REDACTED_AWS_KEY]',
    label: 'aws_key',
  },
  {
    pattern: /\bAIza[0-9A-Za-z\-_]{20,}\b/g,
    replacement: '[REDACTED_API_KEY]',
    label: 'google_api_key',
  },
  {
    pattern: /\b(?:sk|rk)-[A-Za-z0-9]{16,}\b/g,
    replacement: '[REDACTED_SECRET]',
    label: 'api_secret',
  },
  {
    pattern: /\bBearer\s+[A-Za-z0-9._\-+/=]{16,}\b/gi,
    replacement: 'Bearer [REDACTED_TOKEN]',
    label: 'bearer_token',
  },
  {
    pattern: /([?&](?:token|access_token|api_key|apikey|client_secret|password)=)[^&\s]+/gi,
    replacement: '$1[REDACTED_SECRET]',
    label: 'query_secret',
  },
  {
    pattern: /(["']?(?:api[_-]?key|token|secret|password|client_secret|access_token)["']?\s*[:=]\s*["']?)[^"'\n\r\s]+/gi,
    replacement: '$1[REDACTED_SECRET]',
    label: 'named_secret',
  },
  {
    pattern: /(Authorization["']?\s*[:=]\s*["']?Bearer\s+)[^"'\n\r]+/gi,
    replacement: '$1[REDACTED_TOKEN]',
    label: 'authorization_header',
  },
  {
    pattern: /(Cookie["']?\s*[:=]\s*["']?)[^"'\n\r]+/gi,
    replacement: '$1[REDACTED_COOKIE]',
    label: 'cookie_header',
  },
];

export function isBlockedReviewPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, sep);
  const fileName = basename(normalized).toLowerCase();
  const extension = extname(normalized).toLowerCase();
  if (BLOCK_FILE_NAMES.has(fileName) || fileName.startsWith('.env.')) return true;
  if (BLOCK_EXTENSIONS.has(extension)) return true;
  return BLOCK_PATH_SEGMENTS.some((segment) => normalized.includes(segment));
}

function collectBlockReasons(text: string): string[] {
  const reasons: string[] = [];
  for (const { pattern, reason } of BLOCK_TEXT_PATTERNS) {
    if (pattern.test(text)) reasons.push(reason);
  }
  return reasons;
}

export function guardReviewText(text: string): ReviewPayloadGuardResult {
  const blockReasons = collectBlockReasons(text);
  if (blockReasons.length > 0) {
    return {
      disposition: 'do_not_send',
      text,
      reasons: blockReasons,
      redactionCount: 0,
    };
  }

  let next = text;
  const reasons: string[] = [];
  let redactionCount = 0;

  for (const { pattern, replacement, label } of REDACTION_PATTERNS) {
    const matches = next.match(pattern);
    if (!matches?.length) continue;
    redactionCount += matches.length;
    next = next.replace(pattern, replacement);
    reasons.push(`Redacted ${label}`);
  }

  return {
    disposition: redactionCount > 0 ? 'send_with_redaction' : 'safe_to_send',
    text: next,
    reasons,
    redactionCount,
  };
}

export function guardReviewFileContent(filePath: string, content: string): ReviewPayloadGuardResult {
  if (isBlockedReviewPath(filePath)) {
    return {
      disposition: 'do_not_send',
      text: content,
      reasons: ['File path matched a sensitive file rule'],
      redactionCount: 0,
    };
  }

  return guardReviewText(content);
}
