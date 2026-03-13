import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScheduledTasksPanel } from '../ScheduledTasksPanel';
import type { ScheduledTask, ScheduledTaskTemplate } from '@my-claudia/shared';

vi.mock('../../../hooks/useMediaQuery', () => ({
  useIsMobile: () => false,
}));

vi.mock('../CreateScheduledTaskDialog', () => ({
  CreateScheduledTaskDialog: (props: any) => (
    <div data-testid="create-task-dialog">
      <button onClick={props.onClose}>Close</button>
    </div>
  ),
}));

let mockTasks: Record<string, ScheduledTask[]> = {};
let mockTemplates: ScheduledTaskTemplate[] = [];
const mockLoadTasks = vi.fn().mockResolvedValue(undefined);
const mockLoadTemplates = vi.fn().mockResolvedValue(undefined);
const mockEnableTemplate = vi.fn().mockResolvedValue(undefined);
const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockTrigger = vi.fn().mockResolvedValue(undefined);
const mockRemove = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../stores/scheduledTaskStore', () => {
  const store = vi.fn((selector?: (s: any) => any) => {
    const state = {
      tasks: mockTasks,
      templates: mockTemplates,
      loadTasks: mockLoadTasks,
      loadTemplates: mockLoadTemplates,
      enableTemplate: mockEnableTemplate,
      update: mockUpdate,
      trigger: mockTrigger,
      remove: mockRemove,
    };
    return selector ? selector(state) : state;
  });
  (store as any).getState = () => ({
    tasks: mockTasks,
    templates: mockTemplates,
  });
  return { useScheduledTaskStore: store };
});

beforeEach(() => {
  vi.clearAllMocks();
  mockTasks = {};
  mockTemplates = [];
});

function createTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    name: 'Test Task',
    prompt: 'do something',
    scheduleType: 'interval',
    scheduleIntervalMinutes: 30,
    enabled: true,
    status: 'idle',
    runCount: 5,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as ScheduledTask;
}

describe('ScheduledTasksPanel', () => {
  it('renders the header with title', () => {
    render(<ScheduledTasksPanel projectId="proj-1" />);
    expect(screen.getByText('Scheduled Tasks')).toBeInTheDocument();
  });

  it('renders New button', () => {
    render(<ScheduledTasksPanel projectId="proj-1" />);
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('calls loadTasks and loadTemplates on mount', () => {
    render(<ScheduledTasksPanel projectId="proj-1" />);
    expect(mockLoadTasks).toHaveBeenCalledWith('proj-1');
    expect(mockLoadTemplates).toHaveBeenCalled();
  });

  it('shows empty state when no tasks and no templates', () => {
    render(<ScheduledTasksPanel projectId="proj-1" />);
    expect(screen.getByText('No scheduled tasks')).toBeInTheDocument();
  });

  it('renders active tasks section', () => {
    mockTasks = {
      'proj-1': [createTask({ enabled: true })],
    };
    const { container } = render(<ScheduledTasksPanel projectId="proj-1" />);
    expect(container.textContent).toContain('Active (1)');
    expect(container.textContent).toContain('Test Task');
  });

  it('renders disabled tasks section', () => {
    mockTasks = {
      'proj-1': [createTask({ id: 'task-2', name: 'Disabled Task', enabled: false })],
    };
    const { container } = render(<ScheduledTasksPanel projectId="proj-1" />);
    expect(container.textContent).toContain('Disabled (1)');
    expect(container.textContent).toContain('Disabled Task');
  });

  it('shows active count badge', () => {
    mockTasks = {
      'proj-1': [
        createTask({ id: 'task-1', enabled: true }),
        createTask({ id: 'task-2', enabled: true }),
      ],
    };
    render(<ScheduledTasksPanel projectId="proj-1" />);
    expect(screen.getByText('2 active')).toBeInTheDocument();
  });

  it('renders templates in quick start section', () => {
    mockTemplates = [
      {
        id: 'tpl-1',
        name: 'Code Review',
        description: 'Review code quality',
        category: 'ai',
        prompt: 'review code',
        scheduleType: 'interval',
        scheduleIntervalMinutes: 60,
      } as ScheduledTaskTemplate,
    ];
    render(<ScheduledTasksPanel projectId="proj-1" />);
    expect(screen.getByText('Quick Start')).toBeInTheDocument();
    expect(screen.getByText('Code Review')).toBeInTheDocument();
  });

  it('shows task run count', () => {
    mockTasks = {
      'proj-1': [createTask({ runCount: 42 })],
    };
    const { container } = render(<ScheduledTasksPanel projectId="proj-1" />);
    expect(container.textContent).toContain('Runs: 42');
  });

  it('shows schedule label for interval tasks', () => {
    mockTasks = {
      'proj-1': [createTask({ scheduleType: 'interval', scheduleIntervalMinutes: 30 })],
    };
    const { container } = render(<ScheduledTasksPanel projectId="proj-1" />);
    expect(container.textContent).toContain('every 30m');
  });

  it('shows schedule label for cron tasks', () => {
    mockTasks = {
      'proj-1': [createTask({ scheduleType: 'cron', scheduleCron: '0 * * * *' })],
    };
    const { container } = render(<ScheduledTasksPanel projectId="proj-1" />);
    expect(container.textContent).toContain('cron: 0 * * * *');
  });
});
