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

import { TaskCard } from '../TaskCard';
import type { SupervisionTask } from '@my-claudia/shared';

function makeTask(overrides: Partial<SupervisionTask> = {}): SupervisionTask {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    title: 'Test Task',
    description: 'A test task',
    source: 'user',
    status: 'pending',
    priority: 0,
    dependencies: [],
    dependencyMode: 'all',
    acceptanceCriteria: [],
    maxRetries: 2,
    attempt: 1,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('TaskCard', () => {
  const onSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders task title and description', () => {
    render(<TaskCard task={makeTask()} onSelect={onSelect} />);
    expect(screen.getByText('Test Task')).toBeInTheDocument();
    expect(screen.getByText('A test task')).toBeInTheDocument();
  });

  it('renders correct status badge for pending', () => {
    render(<TaskCard task={makeTask({ status: 'pending' })} onSelect={onSelect} />);
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('renders correct status badge for running', () => {
    render(<TaskCard task={makeTask({ status: 'running' })} onSelect={onSelect} />);
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('shows priority when priority > 0', () => {
    render(<TaskCard task={makeTask({ priority: 3 })} onSelect={onSelect} />);
    expect(screen.getByText('P3')).toBeInTheDocument();
  });

  it('does not show priority when priority is 0', () => {
    render(<TaskCard task={makeTask({ priority: 0 })} onSelect={onSelect} />);
    expect(screen.queryByText('P0')).not.toBeInTheDocument();
  });

  it('shows attempt count when attempt > 1', () => {
    render(<TaskCard task={makeTask({ attempt: 3 })} onSelect={onSelect} />);
    expect(screen.getByText('Attempt 3')).toBeInTheDocument();
  });

  it('does not show attempt when attempt is 1', () => {
    render(<TaskCard task={makeTask({ attempt: 1 })} onSelect={onSelect} />);
    expect(screen.queryByText('Attempt 1')).not.toBeInTheDocument();
  });

  it('shows dependency count when has dependencies', () => {
    render(<TaskCard task={makeTask({ dependencies: ['d1', 'd2'] })} onSelect={onSelect} />);
    expect(screen.getByText('2 deps')).toBeInTheDocument();
  });

  it('calls onSelect when card is clicked', () => {
    const task = makeTask();
    render(<TaskCard task={task} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Test Task'));
    expect(onSelect).toHaveBeenCalledWith(task);
  });

  // Proposed task actions
  it('shows Approve/Reject buttons for proposed tasks', () => {
    render(<TaskCard task={makeTask({ status: 'proposed' })} onSelect={onSelect} />);
    expect(screen.getByText('Approve')).toBeInTheDocument();
    expect(screen.getByText('Reject')).toBeInTheDocument();
  });

  it('does not show Approve/Reject for non-proposed tasks', () => {
    render(<TaskCard task={makeTask({ status: 'pending' })} onSelect={onSelect} />);
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
    expect(screen.queryByText('Reject')).not.toBeInTheDocument();
  });

  it('calls approveSupervisionTask when Approve is clicked', async () => {
    const updatedTask = makeTask({ id: 'task-1', status: 'pending' });
    mockApproveSupervisionTask.mockResolvedValue(updatedTask);

    render(<TaskCard task={makeTask({ status: 'proposed' })} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Approve'));

    await waitFor(() => {
      expect(mockApproveSupervisionTask).toHaveBeenCalledWith('task-1');
      expect(mockUpsertTask).toHaveBeenCalledWith('proj-1', updatedTask);
    });
  });

  it('calls rejectSupervisionTask when Reject is clicked', async () => {
    const updatedTask = makeTask({ id: 'task-1', status: 'cancelled' });
    mockRejectSupervisionTask.mockResolvedValue(updatedTask);

    render(<TaskCard task={makeTask({ status: 'proposed' })} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Reject'));

    await waitFor(() => {
      expect(mockRejectSupervisionTask).toHaveBeenCalledWith('task-1');
      expect(mockUpsertTask).toHaveBeenCalledWith('proj-1', updatedTask);
    });
  });

  // Merge conflict actions
  it('shows Resolve Conflict button for merge_conflict tasks', () => {
    render(<TaskCard task={makeTask({ status: 'merge_conflict' })} onSelect={onSelect} />);
    expect(screen.getByText('Resolve Conflict')).toBeInTheDocument();
  });

  it('calls resolveSupervisionConflict when Resolve Conflict is clicked', async () => {
    const updatedTask = makeTask({ id: 'task-1', status: 'running' });
    mockResolveSupervisionConflict.mockResolvedValue(updatedTask);

    render(<TaskCard task={makeTask({ status: 'merge_conflict' })} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Resolve Conflict'));

    await waitFor(() => {
      expect(mockResolveSupervisionConflict).toHaveBeenCalledWith('task-1');
      expect(mockUpsertTask).toHaveBeenCalledWith('proj-1', updatedTask);
    });
  });

  it('handles approve error gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockApproveSupervisionTask.mockRejectedValue(new Error('Network error'));

    render(<TaskCard task={makeTask({ status: 'proposed' })} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Approve'));

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to approve task:', expect.any(Error));
    });
    consoleSpy.mockRestore();
  });

  it('handles reject error gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRejectSupervisionTask.mockRejectedValue(new Error('Network error'));

    render(<TaskCard task={makeTask({ status: 'proposed' })} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Reject'));

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to reject task:', expect.any(Error));
    });
    consoleSpy.mockRestore();
  });

  it('handles resolve conflict error gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockResolveSupervisionConflict.mockRejectedValue(new Error('fail'));

    render(<TaskCard task={makeTask({ status: 'merge_conflict' })} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Resolve Conflict'));

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to resolve conflict:', expect.any(Error));
    });
    consoleSpy.mockRestore();
  });

  it('renders all status badge types', () => {
    const statuses: Array<[string, string]> = [
      ['proposed', 'Proposed'],
      ['queued', 'Queued'],
      ['planning', 'Planning'],
      ['completed', 'Completed'],
      ['reviewing', 'Reviewing'],
      ['approved', 'Approved'],
      ['integrated', 'Integrated'],
      ['rejected', 'Rejected'],
      ['merge_conflict', 'Conflict'],
      ['blocked', 'Blocked'],
      ['failed', 'Failed'],
      ['cancelled', 'Cancelled'],
    ];
    for (const [status, label] of statuses) {
      cleanup();
      render(<TaskCard task={makeTask({ status: status as any })} onSelect={onSelect} />);
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('falls back to raw status for unknown status', () => {
    render(<TaskCard task={makeTask({ status: 'custom_unknown' as any })} onSelect={onSelect} />);
    expect(screen.getByText('custom_unknown')).toBeInTheDocument();
  });

  it('does not show description when empty', () => {
    render(<TaskCard task={makeTask({ description: '' })} onSelect={onSelect} />);
    expect(screen.queryByText('A test task')).not.toBeInTheDocument();
  });

  it('does not show dependency count when no dependencies', () => {
    render(<TaskCard task={makeTask({ dependencies: [] })} onSelect={onSelect} />);
    expect(screen.queryByText(/deps/)).not.toBeInTheDocument();
  });

  it('calls approveSupervisionTaskResult when Approve Result is clicked', async () => {
    const updatedTask = makeTask({ status: 'approved' });
    mockApproveSupervisionTaskResult.mockResolvedValue(updatedTask);

    render(
      <TaskCard
        task={makeTask({
          status: 'reviewing',
          result: { summary: 'Done', filesChanged: [], reviewVerdict: 'approve' },
        })}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText('Approve Result'));

    await waitFor(() => {
      expect(mockApproveSupervisionTaskResult).toHaveBeenCalledWith('task-1');
      expect(mockUpsertTask).toHaveBeenCalledWith('proj-1', updatedTask);
    });
  });

  it('calls rejectSupervisionTaskResult when Reject Result is clicked', async () => {
    const updatedTask = makeTask({ status: 'rejected' });
    mockRejectSupervisionTaskResult.mockResolvedValue(updatedTask);

    render(
      <TaskCard
        task={makeTask({
          status: 'reviewing',
          result: { summary: 'Done', filesChanged: [], reviewVerdict: 'approve' },
        })}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText('Reject Result'));

    await waitFor(() => {
      expect(mockRejectSupervisionTaskResult).toHaveBeenCalledWith('task-1', 'Rejected by user');
      expect(mockUpsertTask).toHaveBeenCalledWith('proj-1', updatedTask);
    });
  });

  it('handles approve result error gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockApproveSupervisionTaskResult.mockRejectedValue(new Error('fail'));

    render(
      <TaskCard
        task={makeTask({
          status: 'reviewing',
          result: { summary: 'Done', filesChanged: [], reviewVerdict: 'approve' },
        })}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText('Approve Result'));

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });
    consoleSpy.mockRestore();
  });

  it('handles reject result error gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRejectSupervisionTaskResult.mockRejectedValue(new Error('fail'));

    render(
      <TaskCard
        task={makeTask({
          status: 'reviewing',
          result: { summary: 'Done', filesChanged: [], reviewVerdict: 'approve' },
        })}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText('Reject Result'));

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });
    consoleSpy.mockRestore();
  });

  // Reviewing task actions
  it('shows review buttons for reviewing tasks with verdict', () => {
    render(
      <TaskCard
        task={makeTask({
          status: 'reviewing',
          result: { summary: 'Done', filesChanged: [], reviewVerdict: 'approve' },
        })}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText('Approve Result')).toBeInTheDocument();
    expect(screen.getByText('Reject Result')).toBeInTheDocument();
  });

  it('does not show review buttons when no verdict', () => {
    render(
      <TaskCard
        task={makeTask({
          status: 'reviewing',
          result: { summary: 'Done', filesChanged: [] },
        })}
        onSelect={onSelect}
      />,
    );
    expect(screen.queryByText('Approve Result')).not.toBeInTheDocument();
  });
});
