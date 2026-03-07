import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const mockApproveSupervisionTask = vi.fn();
const mockRejectSupervisionTask = vi.fn();
const mockApproveSupervisionTaskResult = vi.fn();
const mockRejectSupervisionTaskResult = vi.fn();
const mockResolveSupervisionConflict = vi.fn();
const mockUpsertTask = vi.fn();

vi.mock('../../../services/api', () => ({
  approveSupervisionTask: (...args: unknown[]) => mockApproveSupervisionTask(...args),
  rejectSupervisionTask: (...args: unknown[]) => mockRejectSupervisionTask(...args),
  approveSupervisionTaskResult: (...args: unknown[]) => mockApproveSupervisionTaskResult(...args),
  rejectSupervisionTaskResult: (...args: unknown[]) => mockRejectSupervisionTaskResult(...args),
  resolveSupervisionConflict: (...args: unknown[]) => mockResolveSupervisionConflict(...args),
}));

vi.mock('../../../stores/supervisionStore', () => ({
  useSupervisionStore: (selector: (s: any) => any) => {
    const state = { upsertTask: mockUpsertTask };
    return selector(state);
  },
}));

import { TaskDetail } from '../TaskDetail';
import type { SupervisionTask } from '@my-claudia/shared';

function makeTask(overrides: Partial<SupervisionTask> = {}): SupervisionTask {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    title: 'Test Task',
    description: 'A test task description',
    source: 'user',
    status: 'pending',
    priority: 3,
    dependencies: [],
    dependencyMode: 'all',
    acceptanceCriteria: [],
    maxRetries: 2,
    attempt: 1,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('TaskDetail', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders task title and status badge', () => {
    render(<TaskDetail task={makeTask()} onClose={onClose} />);
    expect(screen.getByText('Test Task')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('renders task description', () => {
    render(<TaskDetail task={makeTask()} onClose={onClose} />);
    expect(screen.getByText('A test task description')).toBeInTheDocument();
  });

  it('shows "No description" when description is empty', () => {
    render(<TaskDetail task={makeTask({ description: '' })} onClose={onClose} />);
    expect(screen.getByText('No description')).toBeInTheDocument();
  });

  it('renders meta information', () => {
    render(<TaskDetail task={makeTask({ priority: 5, attempt: 2, maxRetries: 3 })} onClose={onClose} />);
    expect(screen.getByText('User')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('2 / 4')).toBeInTheDocument(); // attempt / maxRetries + 1
  });

  it('shows "None" when no dependencies', () => {
    render(<TaskDetail task={makeTask({ dependencies: [] })} onClose={onClose} />);
    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('shows dependency list', () => {
    render(<TaskDetail task={makeTask({ dependencies: ['dep-1', 'dep-2'] })} onClose={onClose} />);
    expect(screen.getByText('dep-1, dep-2')).toBeInTheDocument();
  });

  it('renders acceptance criteria', () => {
    render(
      <TaskDetail
        task={makeTask({ acceptanceCriteria: ['Tests pass', 'No regressions'] })}
        onClose={onClose}
      />,
    );
    expect(screen.getByText('Tests pass')).toBeInTheDocument();
    expect(screen.getByText('No regressions')).toBeInTheDocument();
  });

  it('renders scope chips', () => {
    render(
      <TaskDetail
        task={makeTask({ scope: ['src/auth', 'src/api'] })}
        onClose={onClose}
      />,
    );
    expect(screen.getByText('src/auth')).toBeInTheDocument();
    expect(screen.getByText('src/api')).toBeInTheDocument();
  });

  it('renders result summary and files changed', () => {
    render(
      <TaskDetail
        task={makeTask({
          result: {
            summary: 'All done',
            filesChanged: ['a.ts', 'b.ts'],
          },
        })}
        onClose={onClose}
      />,
    );
    expect(screen.getByText('All done')).toBeInTheDocument();
    expect(screen.getByText('a.ts')).toBeInTheDocument();
    expect(screen.getByText('b.ts')).toBeInTheDocument();
  });

  it('renders review notes', () => {
    render(
      <TaskDetail
        task={makeTask({
          result: {
            summary: 'Done',
            filesChanged: [],
            reviewNotes: 'Looks good but needs error handling',
          },
        })}
        onClose={onClose}
      />,
    );
    expect(screen.getByText('Looks good but needs error handling')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    render(<TaskDetail task={makeTask()} onClose={onClose} />);
    // The X button in the header
    const closeButtons = screen.getAllByRole('button');
    const closeBtn = closeButtons.find((btn) => btn.getAttribute('aria-label') || btn.querySelector('svg'));
    if (closeBtn) fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  // Footer action buttons
  it('shows Approve/Reject for proposed tasks', () => {
    render(<TaskDetail task={makeTask({ status: 'proposed' })} onClose={onClose} />);
    expect(screen.getByText('Approve')).toBeInTheDocument();
    expect(screen.getByText('Reject')).toBeInTheDocument();
  });

  it('shows Resolve Conflict for merge_conflict tasks', () => {
    render(<TaskDetail task={makeTask({ status: 'merge_conflict' })} onClose={onClose} />);
    expect(screen.getByText('Resolve Conflict')).toBeInTheDocument();
  });

  it('shows review buttons for reviewing tasks with verdict', () => {
    render(
      <TaskDetail
        task={makeTask({
          status: 'reviewing',
          result: { summary: 'Done', filesChanged: [], reviewVerdict: 'approve' },
        })}
        onClose={onClose}
      />,
    );
    expect(screen.getByText('Approve Result')).toBeInTheDocument();
    expect(screen.getByText('Reject Result')).toBeInTheDocument();
  });

  it('calls approveSupervisionTask on Approve click for proposed task', async () => {
    const updatedTask = makeTask({ status: 'pending' });
    mockApproveSupervisionTask.mockResolvedValue(updatedTask);

    render(<TaskDetail task={makeTask({ status: 'proposed' })} onClose={onClose} />);
    fireEvent.click(screen.getByText('Approve'));

    await waitFor(() => {
      expect(mockApproveSupervisionTask).toHaveBeenCalledWith('task-1');
      expect(mockUpsertTask).toHaveBeenCalledWith('proj-1', updatedTask);
    });
  });

  it('calls resolveSupervisionConflict on Resolve Conflict click', async () => {
    const updatedTask = makeTask({ status: 'running' });
    mockResolveSupervisionConflict.mockResolvedValue(updatedTask);

    render(<TaskDetail task={makeTask({ status: 'merge_conflict' })} onClose={onClose} />);
    fireEvent.click(screen.getByText('Resolve Conflict'));

    await waitFor(() => {
      expect(mockResolveSupervisionConflict).toHaveBeenCalledWith('task-1');
      expect(mockUpsertTask).toHaveBeenCalledWith('proj-1', updatedTask);
    });
  });

  it('does not show action buttons for pending tasks', () => {
    render(<TaskDetail task={makeTask({ status: 'pending' })} onClose={onClose} />);
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
    expect(screen.queryByText('Reject')).not.toBeInTheDocument();
    expect(screen.queryByText('Resolve Conflict')).not.toBeInTheDocument();
  });
});
