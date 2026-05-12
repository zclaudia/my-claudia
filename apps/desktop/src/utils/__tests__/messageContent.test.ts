import { describe, expect, it } from 'vitest';
import {
  extractThinking,
  normalizeMarkdownForRender,
} from '../messageContent';

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
});
