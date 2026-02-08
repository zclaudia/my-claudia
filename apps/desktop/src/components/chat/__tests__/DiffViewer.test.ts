import { describe, it, expect } from 'vitest';
import { computeDiff } from '../DiffViewer';

describe('computeDiff', () => {
  it('returns empty array for two empty strings', () => {
    const result = computeDiff('', '');
    // An empty string splits into [''], so we get one unchanged line
    expect(result).toEqual([{ type: 'unchanged', content: '' }]);
  });

  it('detects pure additions (empty old, non-empty new)', () => {
    const result = computeDiff('', 'line1\nline2');
    const addLines = result.filter((l) => l.type === 'add');
    expect(addLines).toHaveLength(2);
    expect(addLines[0].content).toBe('line1');
    expect(addLines[1].content).toBe('line2');
  });

  it('detects pure deletions (non-empty old, empty new)', () => {
    const result = computeDiff('line1\nline2', '');
    const removeLines = result.filter((l) => l.type === 'remove');
    expect(removeLines).toHaveLength(2);
    expect(removeLines[0].content).toBe('line1');
    expect(removeLines[1].content).toBe('line2');
  });

  it('detects no changes when strings are identical', () => {
    const text = 'line1\nline2\nline3';
    const result = computeDiff(text, text);
    expect(result.every((l) => l.type === 'unchanged')).toBe(true);
    expect(result).toHaveLength(3);
  });

  it('detects a single line modification (remove old + add new)', () => {
    const result = computeDiff('hello world', 'hello claude');
    const removeLines = result.filter((l) => l.type === 'remove');
    const addLines = result.filter((l) => l.type === 'add');
    expect(removeLines).toHaveLength(1);
    expect(removeLines[0].content).toBe('hello world');
    expect(addLines).toHaveLength(1);
    expect(addLines[0].content).toBe('hello claude');
  });

  it('detects mixed changes with context', () => {
    const oldStr = 'line1\nline2\nline3\nline4';
    const newStr = 'line1\nmodified\nline3\nnew line\nline4';
    const result = computeDiff(oldStr, newStr);

    // line1 unchanged
    expect(result[0]).toEqual({ type: 'unchanged', content: 'line1' });

    // line2 removed, modified added
    const removed = result.filter((l) => l.type === 'remove');
    const added = result.filter((l) => l.type === 'add');
    expect(removed.some((l) => l.content === 'line2')).toBe(true);
    expect(added.some((l) => l.content === 'modified')).toBe(true);
    expect(added.some((l) => l.content === 'new line')).toBe(true);

    // line3 and line4 unchanged
    const unchanged = result.filter((l) => l.type === 'unchanged');
    expect(unchanged.some((l) => l.content === 'line3')).toBe(true);
    expect(unchanged.some((l) => l.content === 'line4')).toBe(true);
  });

  it('handles insertion in the middle of unchanged lines', () => {
    const oldStr = 'a\nb\nc';
    const newStr = 'a\nb\ninserted\nc';
    const result = computeDiff(oldStr, newStr);

    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ type: 'unchanged', content: 'a' });
    expect(result[1]).toEqual({ type: 'unchanged', content: 'b' });
    expect(result[2]).toEqual({ type: 'add', content: 'inserted' });
    expect(result[3]).toEqual({ type: 'unchanged', content: 'c' });
  });

  it('handles deletion from the middle of lines', () => {
    const oldStr = 'a\nb\nto-remove\nc';
    const newStr = 'a\nb\nc';
    const result = computeDiff(oldStr, newStr);

    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ type: 'unchanged', content: 'a' });
    expect(result[1]).toEqual({ type: 'unchanged', content: 'b' });
    expect(result[2]).toEqual({ type: 'remove', content: 'to-remove' });
    expect(result[3]).toEqual({ type: 'unchanged', content: 'c' });
  });
});
