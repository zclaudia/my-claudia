import { describe, it, expect } from 'vitest';
import { normalizeMarkdownForRender } from './MessageList';

describe('normalizeMarkdownForRender', () => {
  it('keeps balanced fenced code blocks unchanged', () => {
    const input = 'before\n```text\nhello\n```\nafter';
    expect(normalizeMarkdownForRender(input)).toBe(input);
  });

  it('auto-closes an unmatched fenced code block', () => {
    const input = 'before\n```text\nhello';
    expect(normalizeMarkdownForRender(input)).toBe('before\n```text\nhello\n```');
  });

  it('normalizes CRLF line endings before checking fences', () => {
    const input = 'before\r\n```text\r\nhello';
    expect(normalizeMarkdownForRender(input)).toBe('before\n```text\nhello\n```');
  });
});
