import { describe, it, expect } from 'vitest';
import { extractThinking, normalizeMarkdownForRender } from './MessageList';

describe('extractThinking', () => {
  it('extracts balanced think tags from assistant content', () => {
    expect(extractThinking('<think>internal plan</think>\nVisible answer')).toEqual({
      thinking: 'internal plan',
      content: 'Visible answer',
    });
  });

  it('extracts a dangling think block saved mid-stream', () => {
    expect(extractThinking('<think>internal plan still streaming')).toEqual({
      thinking: 'internal plan still streaming',
      content: '',
    });
  });

  it('keeps visible content when a dangling think block is followed by text', () => {
    expect(extractThinking('Visible intro\n<think>internal plan')).toEqual({
      thinking: 'internal plan',
      content: 'Visible intro',
    });
  });

  it('extracts a later dangling think block after visible content', () => {
    expect(extractThinking('<think>first thought</think>\nVisible answer.\n<think>second thought')).toEqual({
      thinking: 'first thought\n\nsecond thought',
      content: 'Visible answer.',
    });
  });
});

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
