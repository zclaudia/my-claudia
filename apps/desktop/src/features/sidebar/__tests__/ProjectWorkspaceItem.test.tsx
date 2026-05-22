import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectWorkspaceItem } from '../ProjectWorkspaceItem';

describe('ProjectWorkspaceItem', () => {
  it('renders Project Workspace label', () => {
    render(
      <ProjectWorkspaceItem
        onSelect={() => {}}
        isSelected={false}
        taskCount={0}
        taskChildren={null}
      />
    );

    expect(screen.getByText('Project Workspace')).toBeInTheDocument();
  });

  it('shows active indicator when active', () => {
    render(
      <ProjectWorkspaceItem
        onSelect={() => {}}
        isSelected={false}
        isActive={true}
        taskCount={0}
        taskChildren={null}
      />
    );

    // The active indicator is a span with animate-pulse class
    const indicator = document.querySelector('.animate-pulse');
    expect(indicator).toBeInTheDocument();
  });

  it('does not show active indicator when not active', () => {
    render(
      <ProjectWorkspaceItem
        onSelect={() => {}}
        isSelected={false}
        isActive={false}
        taskCount={0}
        taskChildren={null}
      />
    );

    const indicator = document.querySelector('.animate-pulse');
    expect(indicator).not.toBeInTheDocument();
  });

  it('shows task count when greater than 0', () => {
    render(
      <ProjectWorkspaceItem
        onSelect={() => {}}
        isSelected={false}
        taskCount={3}
        taskChildren={null}
      />
    );

    expect(screen.getByText('3 tasks')).toBeInTheDocument();
  });

  it('shows singular "task" for count of 1', () => {
    render(
      <ProjectWorkspaceItem
        onSelect={() => {}}
        isSelected={false}
        taskCount={1}
        taskChildren={null}
      />
    );

    expect(screen.getByText('1 task')).toBeInTheDocument();
  });

  it('does not show task count when 0', () => {
    render(
      <ProjectWorkspaceItem
        onSelect={() => {}}
        isSelected={false}
        taskCount={0}
        taskChildren={null}
      />
    );

    expect(screen.queryByText(/task/)).not.toBeInTheDocument();
  });

  it('calls onSelect on click', () => {
    const handleSelect = vi.fn();
    render(
      <ProjectWorkspaceItem
        onSelect={handleSelect}
        isSelected={false}
        taskCount={0}
        taskChildren={null}
      />
    );

    fireEvent.click(screen.getByRole('button'));

    expect(handleSelect).toHaveBeenCalledTimes(1);
  });

  it('shows selected state with different styling', () => {
    render(
      <ProjectWorkspaceItem
        onSelect={() => {}}
        isSelected={true}
        taskCount={0}
        taskChildren={null}
      />
    );

    const button = screen.getByRole('button');
    expect(button.className).toContain('text-foreground');
  });

  it('renders task children', () => {
    render(
      <ProjectWorkspaceItem
        onSelect={() => {}}
        isSelected={false}
        taskCount={1}
        taskChildren={<li data-testid="task-child">Task Item</li>}
      />
    );

    expect(screen.getByTestId('task-child')).toBeInTheDocument();
  });

  it('does not render task children list when taskCount is 0', () => {
    render(
      <ProjectWorkspaceItem
        onSelect={() => {}}
        isSelected={false}
        taskCount={0}
        taskChildren={<li data-testid="task-child">Task Item</li>}
      />
    );

    expect(screen.queryByTestId('task-child')).not.toBeInTheDocument();
  });

  it('has correct data-testid', () => {
    render(
      <ProjectWorkspaceItem
        onSelect={() => {}}
        isSelected={false}
        taskCount={0}
        taskChildren={null}
      />
    );

    expect(screen.getByTestId('supervisor-group')).toBeInTheDocument();
  });
});
