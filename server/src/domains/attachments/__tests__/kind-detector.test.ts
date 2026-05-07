import { describe, it, expect } from 'vitest';
import { detectKindFromMime, isValidOwnerKind } from '../kind-detector.js';

describe('detectKindFromMime', () => {
  it.each([
    ['image/png', 'image'],
    ['image/jpeg', 'image'],
    ['video/mp4', 'video'],
    ['audio/mpeg', 'audio'],
    ['application/pdf', 'document'],
    ['application/msword', 'document'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document'],
    ['text/plain', 'document'],
    ['text/markdown', 'document'],
    ['application/zip', 'file'],
    ['application/octet-stream', 'file'],
    ['', 'file'],
  ] as const)('maps %s -> %s', (mime, expected) => {
    expect(detectKindFromMime(mime)).toBe(expected);
  });

  it('is case insensitive', () => {
    expect(detectKindFromMime('IMAGE/PNG')).toBe('image');
  });
});

describe('isValidOwnerKind', () => {
  it('accepts known kinds', () => {
    expect(isValidOwnerKind('local_issue')).toBe(true);
    expect(isValidOwnerKind('local_pr')).toBe(true);
    expect(isValidOwnerKind('comment')).toBe(true);
  });

  it('rejects unknown / non-string', () => {
    expect(isValidOwnerKind('something_else')).toBe(false);
    expect(isValidOwnerKind('')).toBe(false);
    expect(isValidOwnerKind(undefined)).toBe(false);
    expect(isValidOwnerKind(null)).toBe(false);
    expect(isValidOwnerKind(123)).toBe(false);
  });
});
