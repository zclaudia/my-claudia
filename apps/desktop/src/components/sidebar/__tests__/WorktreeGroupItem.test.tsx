import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { WorktreeGroupItem } from '../WorktreeGroupItem';
import type { WorktreeGroup } from '../worktreeGrouping';

function makeGroup(overrides: Partial<WorktreeGroup> = {}): WorktreeGroup {
  return {
    key: '__root__',
    label: 'main',
    isRoot: true,
    sessions: [
      { id: 's1', title: 'Session 1', updatedAt: 1000 } as any,
      { id: 's2', title: 'Session 2', updatedAt: 2000 } as any,
    ],
    branchName: 'main',
    ...overrides,
  };
}

describe('WorktreeGroupItem', () => {
  it('renders group label', () => {
    const group = makeGroup({ label: 'feature/cool' });
    const { container } = render(
      <WorktreeGroupItem group={group} isExpanded={false} onToggle={() => {}}>
        <li>child</li>
      </WorktreeGroupItem>,
    );
    expect(container.textContent).toContain('feature/cool');
  });

  it('renders session count', () => {
    const group = makeGroup();
    const { container } = render(
      <WorktreeGroupItem group={group} isExpanded={false} onToggle={() => {}}>
        <li>child</li>
      </WorktreeGroupItem>,
    );
    expect(container.textContent).toContain('2');
  });

  it('does not render children when collapsed', () => {
    const group = makeGroup();
    const { container } = render(
      <WorktreeGroupItem group={group} isExpanded={false} onToggle={() => {}}>
        <li>child-content</li>
      </WorktreeGroupItem>,
    );
    expect(container.textContent).not.toContain('child-content');
  });

  it('renders children when expanded', () => {
    const group = makeGroup();
    const { container } = render(
      <WorktreeGroupItem group={group} isExpanded={true} onToggle={() => {}}>
        <li>child-content</li>
      </WorktreeGroupItem>,
    );
    expect(container.textContent).toContain('child-content');
  });

  it('calls onToggle when header button clicked', () => {
    const onToggle = vi.fn();
    const group = makeGroup();
    const { container } = render(
      <WorktreeGroupItem group={group} isExpanded={false} onToggle={onToggle}>
        <li>child</li>
      </WorktreeGroupItem>,
    );
    const button = container.querySelector('button')!;
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalled();
  });

  it('applies mobile styling when isMobile is true', () => {
    const group = makeGroup();
    const { container } = render(
      <WorktreeGroupItem group={group} isExpanded={false} onToggle={() => {}} isMobile>
        <li>child</li>
      </WorktreeGroupItem>,
    );
    const button = container.querySelector('button')!;
    expect(button.className).toContain('min-h-[36px]');
  });

  it('applies rotate-90 to chevron when expanded', () => {
    const group = makeGroup();
    const { container } = render(
      <WorktreeGroupItem group={group} isExpanded={true} onToggle={() => {}}>
        <li>child</li>
      </WorktreeGroupItem>,
    );
    const chevronSvg = container.querySelector('button svg');
    expect(chevronSvg?.classList.toString()).toContain('rotate-90');
  });
});
