import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { DiffViewerModal } from '../DiffViewerModal';

describe('DiffViewerModal', () => {
  const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;`;

  it('renders title and diff content', () => {
    const { getByText } = render(
      <DiffViewerModal title="My PR" diff={diff} onClose={() => {}} />
    );
    expect(getByText('My PR')).toBeTruthy();
  });

  it('applies correct classes for add/remove lines', () => {
    const { container } = render(
      <DiffViewerModal title="Test" diff={diff} onClose={() => {}} />
    );
    expect(container.innerHTML).toContain('bg-green-500/15');
    expect(container.innerHTML).toContain('bg-red-500/15');
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <DiffViewerModal title="Test" diff={diff} onClose={onClose} />
    );
    const closeBtn = container.querySelector('button');
    if (closeBtn) fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when backdrop clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <DiffViewerModal title="Test" diff={diff} onClose={onClose} />
    );
    // Click the outermost fixed div (backdrop)
    const backdrop = container.firstElementChild as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders empty diff without errors', () => {
    const { container } = render(
      <DiffViewerModal title="Empty" diff="" onClose={() => {}} />
    );
    expect(container.querySelector('pre')).toBeInTheDocument();
  });

  it('renders diff with hunk headers', () => {
    const diffWithHunk = `diff --git a/src/main.ts b/src/main.ts
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,5 +1,6 @@
+// Added line
 const x = 1;
 const y = 2;
-// Removed line`;
    const { container } = render(
      <DiffViewerModal title="Hunk Test" diff={diffWithHunk} onClose={() => {}} />
    );
    expect(container.textContent).toContain('@@');
  });

  it('renders unchanged lines', () => {
    const unchangedDiff = ` const x = 1;
 const y = 2;`;
    const { container } = render(
      <DiffViewerModal title="Unchanged" diff={unchangedDiff} onClose={() => {}} />
    );
    expect(container.textContent).toContain('const x = 1');
  });

  it('escapes special characters in diff content', () => {
    const specialCharDiff = ` const html = '<div>test</div>';
 const code = \`console.log("test")\`;`;
    const { container } = render(
      <DiffViewerModal title="Special Chars" diff={specialCharDiff} onClose={() => {}} />
    );
    expect(container.textContent).toContain('<div>test</div>');
  });
});
