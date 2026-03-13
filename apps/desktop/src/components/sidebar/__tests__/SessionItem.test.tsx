import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionItem } from '../SessionItem';

const mockSession = {
  id: 's1',
  name: 'Test Session',
  projectId: 'p1',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  type: 'interactive' as const,
  lastRunStatus: undefined,
  planStatus: undefined,
} as any;

describe('SessionItem', () => {
  it('renders session name', () => {
    render(
      <SessionItem
        session={mockSession}
        isSelected={false}
        onSelect={vi.fn()}
        hasPending={false}
      />
    );
    expect(screen.getByText('Test Session')).toBeDefined();
  });

  it('calls onSelect when clicked', () => {
    const onSelect = vi.fn();
    render(
      <SessionItem
        session={mockSession}
        isSelected={false}
        onSelect={onSelect}
        hasPending={false}
      />
    );
    fireEvent.click(screen.getByText('Test Session'));
    expect(onSelect).toHaveBeenCalledWith('s1');
  });

  it('shows pending indicator', () => {
    render(
      <SessionItem
        session={mockSession}
        isSelected={false}
        onSelect={vi.fn()}
        hasPending={true}
      />
    );
    expect(screen.getByText('waiting')).toBeDefined();
  });

  it('applies selected styles', () => {
    const { container } = render(
      <SessionItem
        session={mockSession}
        isSelected={true}
        onSelect={vi.fn()}
        hasPending={false}
      />
    );
    expect(container.firstChild).toBeDefined();
  });

  it('shows active running state', () => {
    render(
      <SessionItem
        session={mockSession}
        isSelected={false}
        onSelect={vi.fn()}
        hasPending={false}
        isActive={true}
      />
    );
    expect(screen.getByText('running')).toBeDefined();
  });
});
