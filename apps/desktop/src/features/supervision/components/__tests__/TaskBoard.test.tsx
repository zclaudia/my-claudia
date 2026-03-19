import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// Mock child components to simplify testing
vi.mock('../TaskCard', () => ({
  TaskCard: ({ task, onSelect }: any) => (
    <div data-testid={`task-card-${task.id}`} onClick={() => onSelect(task)}>
      {task.title}
    </div>
  ),
}));

vi.mock('../TaskDetail', () => ({
  TaskDetail: ({ task, onClose }: any) => (
    <div data-testid="task-detail">
      <span>Detail: {task.title}</span>
      <button onClick={onClose}>Close Detail</button>
    </div>
  ),
}));

vi.mock('../CreateTaskDialog', () => ({
  CreateTaskDialog: ({ isOpen, onClose }: any) =>
    isOpen ? (
      <div data-testid="create-dialog">
        <button onClick={onClose}>Close Create</button>
      </div>
    ) : null,
}));

import { TaskBoard } from '../TaskBoard';
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

describe('TaskBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows empty state when no tasks', () => {
    render(<TaskBoard projectId="proj-1" tasks={[]} />);
    expect(screen.getByText('No tasks yet. Click "Add Task" to create one.')).toBeInTheDocument();
  });

  it('shows task count in header', () => {
    const tasks = [
      makeTask({ id: 't1', status: 'pending' }),
      makeTask({ id: 't2', status: 'running' }),
    ];
    render(<TaskBoard projectId="proj-1" tasks={tasks} />);
    // Header shows "(2)" — find it within the header's flex container next to "Tasks"
    const tasksHeader = screen.getByText('Tasks');
    const headerContainer = tasksHeader.parentElement!;
    expect(headerContainer.textContent).toContain('(2)');
  });

  it('renders task cards', () => {
    const tasks = [
      makeTask({ id: 't1', title: 'Task One', status: 'pending' }),
      makeTask({ id: 't2', title: 'Task Two', status: 'running' }),
    ];
    render(<TaskBoard projectId="proj-1" tasks={tasks} />);
    expect(screen.getByText('Task One')).toBeInTheDocument();
    expect(screen.getByText('Task Two')).toBeInTheDocument();
  });

  it('groups tasks by status', () => {
    const tasks = [
      makeTask({ id: 't1', status: 'proposed' }),
      makeTask({ id: 't2', status: 'running' }),
      makeTask({ id: 't3', status: 'integrated' }),
      makeTask({ id: 't4', status: 'failed' }),
    ];
    render(<TaskBoard projectId="proj-1" tasks={tasks} />);
    expect(screen.getByText('Needs Action')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Issues')).toBeInTheDocument();
  });

  it('does not render empty groups', () => {
    const tasks = [makeTask({ id: 't1', status: 'running' })];
    render(<TaskBoard projectId="proj-1" tasks={tasks} />);
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.queryByText('Needs Action')).not.toBeInTheDocument();
    expect(screen.queryByText('Done')).not.toBeInTheDocument();
    expect(screen.queryByText('Issues')).not.toBeInTheDocument();
  });

  it('shows "Add Task" button', () => {
    render(<TaskBoard projectId="proj-1" tasks={[]} />);
    expect(screen.getByText('Add Task')).toBeInTheDocument();
  });

  it('opens create dialog when "Add Task" is clicked', () => {
    render(<TaskBoard projectId="proj-1" tasks={[]} />);
    expect(screen.queryByTestId('create-dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Add Task'));
    expect(screen.getByTestId('create-dialog')).toBeInTheDocument();
  });

  it('opens task detail when a task card is clicked', () => {
    const task = makeTask({ id: 't1', title: 'Click Me' });
    render(<TaskBoard projectId="proj-1" tasks={[task]} />);

    expect(screen.queryByTestId('task-detail')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('task-card-t1'));
    expect(screen.getByTestId('task-detail')).toBeInTheDocument();
    expect(screen.getByText('Detail: Click Me')).toBeInTheDocument();
  });

  it('closes task detail when Close Detail is clicked', () => {
    const task = makeTask({ id: 't1', title: 'Close Me' });
    render(<TaskBoard projectId="proj-1" tasks={[task]} />);

    fireEvent.click(screen.getByTestId('task-card-t1'));
    expect(screen.getByTestId('task-detail')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Close Detail'));
    expect(screen.queryByTestId('task-detail')).not.toBeInTheDocument();
  });
});
