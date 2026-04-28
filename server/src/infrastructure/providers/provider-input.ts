import type { MessageInput, MessageAttachment } from '@my-claudia/shared/core/message';
import { buildNonImageAttachmentNotes } from './attachment-utils.js';

export interface ParsedInput {
  text: string;
  attachments: MessageAttachment[];
}

/**
 * Parse raw input string into structured text + attachments.
 * Returns null if input is not a valid MessageInput JSON (plain text).
 */
export function parseMessageInput(raw: string): ParsedInput | null {
  let messageInput: MessageInput;
  try {
    messageInput = JSON.parse(raw);
    if (typeof messageInput !== 'object' || !('text' in messageInput)) {
      return null;
    }
  } catch {
    return null;
  }

  return {
    text: messageInput.text || raw,
    attachments: messageInput.attachments || [],
  };
}

/**
 * Prepend non-image attachment notes to text.
 * Shared across all providers — images are handled differently per provider.
 */
export function prependNonImageNotes(text: string, attachments: MessageAttachment[]): string {
  if (!attachments || attachments.length === 0) return text;
  const notes = buildNonImageAttachmentNotes(attachments);
  if (notes.length === 0) return text;
  return `${notes.join('\n\n')}\n\n${text}`;
}
