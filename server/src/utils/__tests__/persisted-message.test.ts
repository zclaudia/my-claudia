import { describe, expect, it } from 'vitest';
import { parsePersistedMessageContent, parsePersistedMessageMetadata } from '../persisted-message.js';

describe('parsePersistedMessageContent', () => {
  it('parses JSON content when stored as serialized JSON', () => {
    expect(parsePersistedMessageContent('{"text":"hello"}')).toEqual({ text: 'hello' });
  });

  it('falls back to raw text when stored content is not valid JSON', () => {
    expect(parsePersistedMessageContent('hello world')).toBe('hello world');
  });

  it('returns null for empty content', () => {
    expect(parsePersistedMessageContent(null)).toBeNull();
  });
});

describe('parsePersistedMessageMetadata', () => {
  it('parses valid metadata JSON', () => {
    expect(parsePersistedMessageMetadata<{ foo: string }>('{\"foo\":\"bar\"}')).toEqual({ foo: 'bar' });
  });

  it('returns undefined for invalid metadata JSON', () => {
    expect(parsePersistedMessageMetadata<{ foo: string }>('not-json')).toBeUndefined();
  });
});
