import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const mockCreateSupervisionTask = vi.fn();
const mockUpsertTask = vi.fn();

vi.mock('../../../services/api', () => ({
  createSupervisionTask: (...args: unknown[]) => mockCreateSupervisionTask(...args),
}));

vi.mock('../../../stores/supervisionStore', () => ({
  useSupervisionStore: (selector: (s: any) => any) => {
    const state = { upsertTask: mockUpsertTask };
    return selector(state);
  },
}));

import { CreateTaskDialog } from '../CreateTaskDialog';
import type { SupervisionTask } from '@my-claudia/shared';

function makeTask(overrides: Partial<SupervisionTask> = {}): SupervisionTask {
  return {
    id: 'task-new',
    projectId: 'proj-1',
    title: 'New Task',
    description: 'New desc',
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

describe('CreateTaskDialog', () => {
  const defaultProps = {
    projectId: 'proj-1',
    existingTasks: [] as SupervisionTask[],
    isOpen: true,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('returns null when isOpen is false', () => {
    const { container } = render(<CreateTaskDialog {...defaultProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders dialog header when open', () => {
    render(<CreateTaskDialog {...defaultProps} />);
    expect(screen.getByRole('heading', { name: 'Create Task' })).toBeInTheDocument();
  });

  it('shows Title and Description inputs', () => {
    render(<CreateTaskDialog {...defaultProps} />);
    expect(screen.getByPlaceholderText('Task title...')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Describe what this task should accomplish...')).toBeInTheDocument();
  });

  it('disables Create Task button when title is empty', () => {
    render(<CreateTaskDialog {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Create Task' })).toBeDisabled();
  });

  it('enables Create Task button when title has text', () => {
    render(<CreateTaskDialog {...defaultProps} />);
    const titleInput = screen.getByPlaceholderText('Task title...');
    fireEvent.change(titleInput, { target: { value: 'My Task' } });
    expect(screen.getByRole('button', { name: 'Create Task' })).not.toBeDisabled();
  });

  it('calls Cancel and onClose when Cancel is clicked', () => {
    render(<CreateTaskDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('creates task with correct params on submit', async () => {
    const createdTask = makeTask({ title: 'My New Task' });
    mockCreateSupervisionTask.mockResolvedValue(createdTask);

    render(<CreateTaskDialog {...defaultProps} />);

    const titleInput = screen.getByPlaceholderText('Task title...');
    fireEvent.change(titleInput, { target: { value: 'My New Task' } });

    const descInput = screen.getByPlaceholderText('Describe what this task should accomplish...');
    fireEvent.change(descInput, { target: { value: 'Task description' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    await waitFor(() => {
      expect(mockCreateSupervisionTask).toHaveBeenCalledWith('proj-1', expect.objectContaining({
        title: 'My New Task',
        description: 'Task description',
        priority: 0,
      }));
      expect(mockUpsertTask).toHaveBeenCalledWith('proj-1', createdTask);
      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  it('adds acceptance criteria', () => {
    render(<CreateTaskDialog {...defaultProps} />);

    const criterionInput = screen.getByPlaceholderText('Add acceptance criterion...');
    fireEvent.change(criterionInput, { target: { value: 'Tests pass' } });
    fireEvent.click(screen.getByText('Add'));

    expect(screen.getByText('Tests pass')).toBeInTheDocument();
  });

  it('adds acceptance criteria via Enter key', () => {
    render(<CreateTaskDialog {...defaultProps} />);

    const criterionInput = screen.getByPlaceholderText('Add acceptance criterion...');
    fireEvent.change(criterionInput, { target: { value: 'No regressions' } });
    fireEvent.keyDown(criterionInput, { key: 'Enter', code: 'Enter' });

    expect(screen.getByText('No regressions')).toBeInTheDocument();
  });

  it('shows dependencies when existing tasks are provided', () => {
    const existingTasks = [
      makeTask({ id: 'dep-1', title: 'Dependency Task' }),
    ];

    render(<CreateTaskDialog {...defaultProps} existingTasks={existingTasks} />);
    expect(screen.getByText('Dependencies')).toBeInTheDocument();
    expect(screen.getByText('Dependency Task')).toBeInTheDocument();
  });

  it('does not show dependencies when no existing tasks', () => {
    render(<CreateTaskDialog {...defaultProps} existingTasks={[]} />);
    expect(screen.queryByText('Dependencies')).not.toBeInTheDocument();
  });

  it('displays error when creation fails', async () => {
    mockCreateSupervisionTask.mockRejectedValue(new Error('Server error'));

    render(<CreateTaskDialog {...defaultProps} />);

    const titleInput = screen.getByPlaceholderText('Task title...');
    fireEvent.change(titleInput, { target: { value: 'Failing Task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });

  it('shows generic error for non-Error rejection', async () => {
    mockCreateSupervisionTask.mockRejectedValue('string error');

    render(<CreateTaskDialog {...defaultProps} />);
    fireEvent.change(screen.getByPlaceholderText('Task title...'), { target: { value: 'Task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    await waitFor(() => {
      expect(screen.getByText('Failed to create task')).toBeInTheDocument();
    });
  });

  it('toggles dependency selection', () => {
    const existingTasks = [
      makeTask({ id: 'dep-1', title: 'Dep 1' }),
      makeTask({ id: 'dep-2', title: 'Dep 2' }),
    ];

    render(<CreateTaskDialog {...defaultProps} existingTasks={existingTasks} />);

    const checkboxes = screen.getAllByRole('checkbox');
    // Toggle dep-1 on
    fireEvent.click(checkboxes[0]);
    expect(checkboxes[0]).toBeChecked();

    // Toggle dep-1 off
    fireEvent.click(checkboxes[0]);
    expect(checkboxes[0]).not.toBeChecked();
  });

  it('removes acceptance criterion', () => {
    render(<CreateTaskDialog {...defaultProps} />);

    // Add a criterion
    const input = screen.getByPlaceholderText('Add acceptance criterion...');
    fireEvent.change(input, { target: { value: 'Test pass' } });
    fireEvent.click(screen.getByText('Add'));
    expect(screen.getByText('Test pass')).toBeInTheDocument();

    // Remove it - find the X button in the criterion list item
    const removeButtons = screen.getAllByRole('button').filter(btn => {
      return btn.closest('li') !== null;
    });
    if (removeButtons.length > 0) {
      fireEvent.click(removeButtons[0]);
    }
    expect(screen.queryByText('Test pass')).not.toBeInTheDocument();
  });

  it('does not add empty criterion', () => {
    render(<CreateTaskDialog {...defaultProps} />);
    const addButton = screen.getByText('Add');
    expect(addButton).toBeDisabled();
  });

  it('changes priority', () => {
    render(<CreateTaskDialog {...defaultProps} />);
    const priorityInput = screen.getByRole('spinbutton');
    fireEvent.change(priorityInput, { target: { value: '5' } });
    expect(priorityInput).toHaveValue(5);
  });

  it('includes criteria and deps in submit payload', async () => {
    const createdTask = makeTask();
    mockCreateSupervisionTask.mockResolvedValue(createdTask);
    const existingTasks = [makeTask({ id: 'dep-1', title: 'Dep Task' })];

    render(<CreateTaskDialog {...defaultProps} existingTasks={existingTasks} />);

    fireEvent.change(screen.getByPlaceholderText('Task title...'), { target: { value: 'Task' } });

    // Add criterion
    fireEvent.change(screen.getByPlaceholderText('Add acceptance criterion...'), { target: { value: 'Criterion 1' } });
    fireEvent.click(screen.getByText('Add'));

    // Select dependency
    fireEvent.click(screen.getByRole('checkbox'));

    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    await waitFor(() => {
      expect(mockCreateSupervisionTask).toHaveBeenCalledWith('proj-1', expect.objectContaining({
        acceptanceCriteria: ['Criterion 1'],
        dependencies: ['dep-1'],
      }));
    });
  });

  it('closes on backdrop click', () => {
    render(<CreateTaskDialog {...defaultProps} />);
    // The backdrop is the first div with bg-black/50
    const backdrop = document.querySelector('.bg-black\\/50');
    if (backdrop) fireEvent.click(backdrop);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
