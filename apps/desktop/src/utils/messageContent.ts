import type { MessageInput } from '@my-claudia/shared';

/**
 * User messages may arrive serialized as `MessageInput` JSON
 * (`{"text":"...","attachments":[...]}`) from the message composer, or as
 * Anthropic-style content blocks (`[{"type":"text","text":"..."}, ...]`), or
 * as plain text (e.g. slash commands like `/commit`). Return the displayable
 * text in a way consistent with MessageList rendering — falling back to the
 * raw content when the input isn't a recognised structured shape.
 */
export function extractMessageText(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return content;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && 'text' in parsed) {
      const text = (parsed as MessageInput).text;
      if (typeof text === 'string') return text;
    }
    if (Array.isArray(parsed)) {
      const parts = parsed
        .map((b) => (b && typeof b === 'object' && (b as { type?: unknown }).type === 'text'
          ? String((b as { text?: unknown }).text ?? '')
          : ''))
        .filter(Boolean);
      if (parts.length > 0) return parts.join(' ');
    }
  } catch {
    // fall through
  }
  return content;
}

/**
 * Parse a user-message content as a `MessageInput` if it has that JSON shape,
 * else return `null`. Used where attachments matter (chat list rendering).
 */
export function tryParseMessageInput(content: string): MessageInput | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && 'text' in parsed) {
      return parsed as MessageInput;
    }
  } catch {
    // not JSON
  }
  return null;
}

/**
 * Extract <think>...</think> blocks from message content.
 * Also tolerates partially persisted content such as a dangling `<think>`
 * prefix saved mid-stream before the closing tag arrives.
 */
export function extractThinking(text: string): { thinking: string; content: string } {
  const thinkSections: string[] = [];
  const contentSections: string[] = [];
  const tagRegex = /<\/?think>/gi;

  let cursor = 0;
  let inThinkBlock = false;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(text)) !== null) {
    const chunk = text.slice(cursor, match.index);
    if (chunk) {
      if (inThinkBlock) {
        thinkSections.push(chunk);
      } else {
        contentSections.push(chunk);
      }
    }

    inThinkBlock = match[0].toLowerCase() === '<think>';
    cursor = match.index + match[0].length;
  }

  const tail = text.slice(cursor);
  if (tail) {
    if (inThinkBlock) {
      thinkSections.push(tail);
    } else {
      contentSections.push(tail);
    }
  }

  const thinking = thinkSections
    .map((section) => section.trim())
    .filter(Boolean)
    .join('\n\n');

  const content = contentSections
    .join('')
    .replace(/<\/?think>/gi, '')
    .trim();

  return { thinking, content };
}

export function normalizeMarkdownForRender(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n');
  const fenceCount = (normalized.match(/^```/gm) || []).length;
  if (fenceCount % 2 === 1) {
    return `${normalized}\n\`\`\``;
  }
  return normalized;
}

export function hasLikelyGfmTable(content: string): boolean {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const header = lines[i].trim();
    const separator = lines[i + 1].trim();
    if (!header.includes('|')) continue;
    if (/^\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(separator)) {
      return true;
    }
  }
  return false;
}

export function logSuspiciousMarkdownRender(original: string, normalized: string): void {
  const unbalancedFence = original !== normalized;
  const tableSyntax = hasLikelyGfmTable(original);
  if (!unbalancedFence && !tableSyntax) return;

  const tail = original.slice(-400);
  console.info('[MarkdownRender]', {
    unbalancedFence,
    tableSyntax,
    originalLength: original.length,
    normalizedLength: normalized.length,
    tailPreview: tail,
  });
}
