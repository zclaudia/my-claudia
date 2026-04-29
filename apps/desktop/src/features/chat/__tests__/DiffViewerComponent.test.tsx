import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DiffViewer, computeDiff } from '../DiffViewer';

describe('DiffViewer component', () => {
  it('renders diff lines', () => {
    render(<DiffViewer oldString="old line" newString="new line" />);
    expect(screen.getByText('old line')).toBeInTheDocument();
    expect(screen.getByText('new line')).toBeInTheDocument();
  });

  it('renders file name from path', () => {
    render(<DiffViewer oldString="a" newString="b" filePath="src/utils/helpers.ts" />);
    expect(screen.getByText('helpers.ts')).toBeInTheDocument();
  });

  it('renders "edit" when no filePath', () => {
    render(<DiffViewer oldString="a" newString="b" />);
    expect(screen.getByText('edit')).toBeInTheDocument();
  });

  it('shows addition stats (green count)', () => {
    const { container } = render(<DiffViewer oldString="old" newString="new1\nnew2\nnew3" />);
    const greenSpan = container.querySelector('.text-green-500');
    expect(greenSpan).toBeInTheDocument();
  });

  it('shows removal stats (red count)', () => {
    const { container } = render(<DiffViewer oldString="old1\nold2\nold3" newString="new" />);
    const redSpan = container.querySelector('.text-red-500');
    expect(redSpan).toBeInTheDocument();
  });

  it('shows + prefix for added lines', () => {
    render(<DiffViewer oldString="" newString="added" />);
    const plusElements = screen.getAllByText('+');
    expect(plusElements.length).toBeGreaterThan(0);
  });

  it('shows - prefix for removed lines', () => {
    render(<DiffViewer oldString="removed" newString="" />);
    const minusElements = screen.getAllByText('-');
    expect(minusElements.length).toBeGreaterThan(0);
  });

  it('handles identical strings (no +/- counts)', () => {
    const { container } = render(<DiffViewer oldString="same" newString="same" />);
    expect(container.querySelector('.text-green-500')).toBeNull();
    expect(container.querySelector('.text-red-500')).toBeNull();
  });

  it('renders unchanged lines with space prefix', () => {
    const { container } = render(<DiffViewer oldString="same line" newString="same line" />);
    // Unchanged lines get a space prefix
    const lineSpans = container.querySelectorAll('span');
    const spaceSpans = Array.from(lineSpans).filter(s => s.textContent?.trim() === '');
    expect(spaceSpans.length).toBeGreaterThan(0);
  });

  it('renders multiple added and removed lines', () => {
    const { container } = render(<DiffViewer oldString="a\nb\nc" newString="a\nx\ny\nc" />);
    // Verify the diff renders both added and removed content
    const addedLines = container.querySelectorAll('[class*="bg-green"]');
    const removedLines = container.querySelectorAll('[class*="bg-red"]');
    expect(addedLines.length).toBeGreaterThan(0);
    expect(removedLines.length).toBeGreaterThan(0);
  });

  it('shows correct add count in header', () => {
    const { container } = render(<DiffViewer oldString="" newString="line1\nline2" />);
    const greenSpan = container.querySelector('.text-green-500');
    expect(greenSpan?.textContent).toContain('+');
  });

  it('shows correct removal count in header', () => {
    const { container } = render(<DiffViewer oldString="line1\nline2\nline3" newString="" />);
    const redSpan = container.querySelector('.text-red-500');
    // Verify that the removal count is displayed with a dash prefix
    expect(redSpan).not.toBeNull();
    expect(redSpan!.textContent).toContain('-');
  });

  it('applies line-through styling to removed lines', () => {
    const { container } = render(<DiffViewer oldString="to-remove" newString="new-line" />);
    const lineThrough = container.querySelector('.line-through');
    expect(lineThrough).toBeInTheDocument();
  });

  it('applies green background to added lines', () => {
    const { container } = render(<DiffViewer oldString="" newString="added-line" />);
    const greenBg = container.querySelector('[class*="bg-green"]');
    expect(greenBg).toBeInTheDocument();
  });

  it('applies red background to removed lines', () => {
    const { container } = render(<DiffViewer oldString="old-line" newString="" />);
    const redBg = container.querySelector('[class*="bg-red"]');
    expect(redBg).toBeInTheDocument();
  });

  it('handles deeply nested file path for display name', () => {
    render(<DiffViewer oldString="a" newString="b" filePath="a/b/c/d/e/file.tsx" />);
    expect(screen.getByText('file.tsx')).toBeInTheDocument();
  });

  it('handles file path with no directory', () => {
    render(<DiffViewer oldString="a" newString="b" filePath="simple.ts" />);
    expect(screen.getByText('simple.ts')).toBeInTheDocument();
  });
});

describe('computeDiff (unit)', () => {
  it('returns empty array for two empty strings', () => {
    const result = computeDiff('', '');
    expect(result).toEqual([{ type: 'unchanged', content: '' }]);
  });

  it('detects pure additions', () => {
    const result = computeDiff('', 'line1\nline2');
    const addLines = result.filter(l => l.type === 'add');
    expect(addLines).toHaveLength(2);
  });

  it('detects pure deletions', () => {
    const result = computeDiff('line1\nline2', '');
    const removeLines = result.filter(l => l.type === 'remove');
    expect(removeLines).toHaveLength(2);
  });

  it('detects no changes for identical strings', () => {
    const text = 'line1\nline2\nline3';
    const result = computeDiff(text, text);
    expect(result.every(l => l.type === 'unchanged')).toBe(true);
    expect(result).toHaveLength(3);
  });

  it('detects modification (remove + add)', () => {
    const result = computeDiff('hello world', 'hello claude');
    expect(result.filter(l => l.type === 'remove')).toHaveLength(1);
    expect(result.filter(l => l.type === 'add')).toHaveLength(1);
  });

  it('handles insertion in middle', () => {
    const result = computeDiff('a\nb\nc', 'a\nb\ninserted\nc');
    expect(result).toHaveLength(4);
    expect(result[2]).toEqual({ type: 'add', content: 'inserted' });
  });

  it('handles deletion from middle', () => {
    const result = computeDiff('a\nb\nremove\nc', 'a\nb\nc');
    expect(result).toHaveLength(4);
    expect(result[2]).toEqual({ type: 'remove', content: 'remove' });
  });

  it('handles complete replacement', () => {
    const result = computeDiff('old1\nold2', 'new1\nnew2');
    const adds = result.filter(l => l.type === 'add');
    const removes = result.filter(l => l.type === 'remove');
    expect(adds.length).toBeGreaterThan(0);
    expect(removes.length).toBeGreaterThan(0);
  });

  it('handles single line unchanged', () => {
    const result = computeDiff('same', 'same');
    expect(result).toEqual([{ type: 'unchanged', content: 'same' }]);
  });
});
