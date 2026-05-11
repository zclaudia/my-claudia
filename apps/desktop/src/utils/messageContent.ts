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
