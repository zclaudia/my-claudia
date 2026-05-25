import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { SupervisorWorkspacePanel } from '../SupervisorWorkspacePanel';
import { useSupervisionStore } from '../../store';
import type { ChangeExecutionPlan, ProjectAgent, ProjectChange, SupervisionTask } from '@my-claudia/shared';

const mockGetActiveProjectChange = vi.fn();
const mockGetChangeExecutionPlan = vi.fn();
const mockGetSupervisionTasks = vi.fn();
const mockGetSupervisionContext = vi.fn();
const mockRequestDesignGate = vi.fn();
const mockRequestAcceptance = vi.fn();
const mockResolveAcceptance = vi.fn();
const mockGetProjectChanges = vi.fn();
const mockUpdateChangeDocument = vi.fn();

vi.mock('../../../../services/api', () => ({
  getActiveProjectChange: (...args: unknown[]) => mockGetActiveProjectChange(...args),
  getChangeExecutionPlan: (...args: unknown[]) => mockGetChangeExecutionPlan(...args),
  getSupervisionTasks: (...args: unknown[]) => mockGetSupervisionTasks(...args),
  getSupervisionContext: (...args: unknown[]) => mockGetSupervisionContext(...args),
  getProjectChanges: (...args: unknown[]) => mockGetProjectChanges(...args),
  updateChangeDocument: (...args: unknown[]) => mockUpdateChangeDocument(...args),
  createProjectChange: vi.fn(),
  requestDesignGate: (...args: unknown[]) => mockRequestDesignGate(...args),
  resolveDesignGate: vi.fn(),
  requestExecutionGate: vi.fn(),
  resolveExecutionGate: vi.fn(),
  requestAcceptance: (...args: unknown[]) => mockRequestAcceptance(...args),
  resolveAcceptance: (...args: unknown[]) => mockResolveAcceptance(...args),
  requestChangeSync: vi.fn(),
  completeProjectChange: vi.fn(),
}));

vi.mock('../TaskBoard', () => ({
  TaskBoard: ({ title, tasks }: { title?: string; tasks: SupervisionTask[] }) => (
    <div data-testid="task-board">
      <span>{title}</span>
      <span>{tasks.length}</span>
    </div>
  ),
}));

function makeAgent(overrides: Partial<ProjectAgent> = {}): ProjectAgent {
  return {
    type: 'supervisor',
    mode: 'full',
    phase: 'active',
    config: {
      maxConcurrentTasks: 1,
      trustLevel: 'low',
      autoDiscoverTasks: false,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeChange(overrides: Partial<ProjectChange> = {}): ProjectChange {
  return {
    id: 'change-1',
    projectId: 'proj-1',
    title: 'Refactor settings',
    slug: 'refactor-settings',
    status: 'draft',
    summary: 'Restructure settings domain',
    nonGoals: [],
    scope: [],
    acceptanceCriteria: [],
    active: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeExecutionPlan(overrides: Partial<ChangeExecutionPlan> = {}): ChangeExecutionPlan {
  return {
    changeId: 'change-1',
    designVersion: 1,
    summary: 'Execution plan',
    automation: {
      strategy: 'serial',
      autoReview: true,
      autoRetry: true,
      autoSyncDraft: false,
    },
    verification: [],
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('SupervisorWorkspacePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSupervisionStore.setState({
      tasks: {},
      agents: {},
      activeChanges: {},
      executionPlans: {},
      lastCheckpoint: {},
    });
    mockGetChangeExecutionPlan.mockResolvedValue(makeExecutionPlan());
    mockGetSupervisionTasks.mockResolvedValue([]);
    mockRequestDesignGate.mockResolvedValue(makeChange({ status: 'awaiting_design_review' }));
    mockRequestAcceptance.mockResolvedValue(makeChange({ status: 'accepting' }));
    mockResolveAcceptance.mockResolvedValue(makeChange({ status: 'syncing' }));
    mockGetProjectChanges.mockResolvedValue([makeChange()]);
    mockUpdateChangeDocument.mockResolvedValue(makeChange({ status: 'designing' }));
    mockGetSupervisionContext.mockResolvedValue([
      { id: 'changes/change-1/design.md', version: 1, content: '# Design' },
      { id: 'changes/change-1/execution.md', version: 1, content: '# Execution' },
      { id: 'changes/change-1/tasks.md', version: 1, content: '# Tasks' },
      { id: 'changes/change-1/acceptance.md', version: 1, content: '# Acceptance' },
      { id: 'changes/change-1/sync-log.md', version: 1, content: '# Sync Log' },
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  it('enables only design request in draft state', async () => {
    mockGetActiveProjectChange.mockResolvedValue(makeChange({ status: 'draft' }));

    render(<SupervisorWorkspacePanel projectId="proj-1" agent={makeAgent()} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Request Design Review' })).not.toBeDisabled();
    });

    expect(screen.getByRole('button', { name: 'Approve Design' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Request Execution Review' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start Execution' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Request Acceptance' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Approve Acceptance' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Complete Change' })).toBeDisabled();
    expect(screen.getByText('Next Action')).toBeInTheDocument();
    expect(screen.getByText('Finish the design draft')).toBeInTheDocument();
    // Phase E1 Task 12 replaced the "Start Change" button with a "New ▾" dropdown
    // that includes both Classic Change and Meta Workflow Run options.
    expect(screen.getByRole('button', { name: /^New/ })).toBeInTheDocument();
  });

  it('enables execution approval in awaiting execution review state', async () => {
    mockGetActiveProjectChange.mockResolvedValue(makeChange({ status: 'awaiting_execution_review' }));

    render(<SupervisorWorkspacePanel projectId="proj-1" agent={makeAgent()} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start Execution' })).not.toBeDisabled();
    });

    expect(screen.getByRole('button', { name: 'Request Design Review' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Approve Design' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Request Execution Review' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Request Acceptance' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Approve Acceptance' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Complete Change' })).toBeDisabled();
  });

  it('enables sync completion only in syncing state', async () => {
    mockGetActiveProjectChange.mockResolvedValue(makeChange({ status: 'syncing' }));

    render(<SupervisorWorkspacePanel projectId="proj-1" agent={makeAgent()} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Complete Change' })).not.toBeDisabled();
    });

    expect(screen.getByRole('button', { name: 'Request Acceptance' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start Execution' })).toBeDisabled();
  });

  it('enables acceptance actions in accepting state', async () => {
    mockGetActiveProjectChange.mockResolvedValue(makeChange({ status: 'accepting' }));

    render(<SupervisorWorkspacePanel projectId="proj-1" agent={makeAgent()} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Approve Acceptance' })).not.toBeDisabled();
    });

    expect(screen.getByRole('button', { name: 'Reopen Execution' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Complete Change' })).toBeDisabled();
    expect(screen.getByText('Review acceptance')).toBeInTheDocument();
  });

  it('passes notes to gate actions', async () => {
    mockGetActiveProjectChange.mockResolvedValue(makeChange({ status: 'draft' }));

    render(<SupervisorWorkspacePanel projectId="proj-1" agent={makeAgent()} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Request Design Review' })).not.toBeDisabled();
    });

    fireEvent.change(screen.getByLabelText('Review / Sync Notes'), {
      target: { value: 'ready for design review' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request Design Review' }));

    await waitFor(() => {
      expect(mockRequestDesignGate).toHaveBeenCalledWith('change-1', 'ready for design review');
    });
  });

  it('renders recent non-active change history', async () => {
    mockGetActiveProjectChange.mockResolvedValue(makeChange({ status: 'executing' }));
    mockGetProjectChanges.mockResolvedValue([
      makeChange({ id: 'change-1', status: 'executing', active: true }),
      makeChange({ id: 'change-2', title: 'Old refactor', summary: 'Completed cleanup', status: 'completed', active: false }),
      makeChange({ id: 'change-3', title: 'Dropped spike', summary: 'Cancelled experiment', status: 'cancelled', active: false }),
    ]);

    render(<SupervisorWorkspacePanel projectId="proj-1" agent={makeAgent()} />);

    await waitFor(() => {
      expect(screen.getByText('Recent Changes')).toBeInTheDocument();
    });

    expect(screen.getByText('Old refactor')).toBeInTheDocument();
    expect(screen.getByText('Dropped spike')).toBeInTheDocument();
    expect(screen.getByText('Completed cleanup')).toBeInTheDocument();
    expect(screen.getByText('Cancelled experiment')).toBeInTheDocument();
  });

  it('switches doc preview to a historical change', async () => {
    const oldUpdatedAt = Date.parse('2026-04-10T08:00:00.000Z');
    mockGetActiveProjectChange.mockResolvedValue(makeChange({ status: 'executing' }));
    mockGetProjectChanges.mockResolvedValue([
      makeChange({ id: 'change-1', status: 'executing', active: true }),
      makeChange({ id: 'change-2', title: 'Old refactor', summary: 'Completed cleanup', status: 'completed', active: false, updatedAt: oldUpdatedAt }),
    ]);
    mockGetSupervisionContext.mockResolvedValue([
      { id: 'changes/change-1/design.md', version: 1, content: '# Active Design' },
      { id: 'changes/change-1/execution.md', version: 1, content: '# Active Execution' },
      { id: 'changes/change-1/tasks.md', version: 1, content: '# Active Tasks' },
      { id: 'changes/change-1/acceptance.md', version: 1, content: '# Active Acceptance' },
      { id: 'changes/change-1/sync-log.md', version: 1, content: '# Active Sync Log' },
      { id: 'changes/change-2/design.md', version: 2, content: '# Old Design' },
      { id: 'changes/change-2/execution.md', version: 2, content: '# Old Execution' },
      { id: 'changes/change-2/tasks.md', version: 2, content: '# Old Tasks' },
      { id: 'changes/change-2/acceptance.md', version: 2, content: '# Old Acceptance' },
      { id: 'changes/change-2/sync-log.md', version: 2, content: '# Old Sync Log' },
    ]);

    render(<SupervisorWorkspacePanel projectId="proj-1" agent={makeAgent()} />);

    await waitFor(() => {
      expect(screen.getByText('Old refactor')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Preview Old refactor' }));

    await waitFor(() => {
      expect(screen.getByText('Viewing `.supervision/changes/change-2`')).toBeInTheDocument();
      expect(screen.getByText('# Old Design')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Back To Active' })).toBeInTheDocument();
    expect(screen.getByText('Change ID:')).toBeInTheDocument();
    expect(screen.getByText('change-2')).toBeInTheDocument();
    expect(screen.getByText('Updated:')).toBeInTheDocument();
    expect(screen.getByText('2026-04-10')).toBeInTheDocument();
    expect(screen.getAllByText('Acceptance').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sync').length).toBeGreaterThan(0);
  });

  it('supports quick doc switches for historical changes', async () => {
    mockGetActiveProjectChange.mockResolvedValue(makeChange({ status: 'executing' }));
    mockGetProjectChanges.mockResolvedValue([
      makeChange({ id: 'change-1', status: 'executing', active: true }),
      makeChange({ id: 'change-2', title: 'Old refactor', summary: 'Completed cleanup', status: 'completed', active: false }),
    ]);
    mockGetSupervisionContext.mockResolvedValue([
      { id: 'changes/change-1/design.md', version: 1, content: '# Active Design' },
      { id: 'changes/change-1/execution.md', version: 1, content: '# Active Execution' },
      { id: 'changes/change-1/tasks.md', version: 1, content: '# Active Tasks' },
      { id: 'changes/change-1/acceptance.md', version: 1, content: '# Active Acceptance' },
      { id: 'changes/change-1/sync-log.md', version: 1, content: '# Active Sync Log' },
      { id: 'changes/change-2/design.md', version: 2, content: '# Old Design' },
      { id: 'changes/change-2/execution.md', version: 2, content: '# Old Execution' },
      { id: 'changes/change-2/tasks.md', version: 2, content: '# Old Tasks' },
      { id: 'changes/change-2/acceptance.md', version: 2, content: '# Old Acceptance' },
      { id: 'changes/change-2/sync-log.md', version: 2, content: '# Old Sync Log' },
    ]);

    render(<SupervisorWorkspacePanel projectId="proj-1" agent={makeAgent()} />);

    await waitFor(() => {
      expect(screen.getByText('Recent Changes')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open Old refactor execution' }));

    await waitFor(() => {
      expect(screen.getByText('Viewing `.supervision/changes/change-2`')).toBeInTheDocument();
      expect(screen.getByText('# Old Execution')).toBeInTheDocument();
    });
  });

  it('allows editing and saving the active design document', async () => {
    mockGetActiveProjectChange.mockResolvedValue(makeChange({ status: 'designing' }));

    render(<SupervisorWorkspacePanel projectId="proj-1" agent={makeAgent()} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const editor = screen.getByDisplayValue('# Design');
    fireEvent.change(editor, { target: { value: '# Updated Design\n\nNew details' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateChangeDocument).toHaveBeenCalledWith(
        'change-1',
        'design',
        '# Updated Design\n\nNew details',
      );
    });
  });

  it('shows all changes list with filter controls', async () => {
    mockGetActiveProjectChange.mockResolvedValue(makeChange({ status: 'executing' }));
    mockGetProjectChanges.mockResolvedValue([
      makeChange({ id: 'change-1', status: 'executing', active: true }),
      makeChange({ id: 'change-2', title: 'Old refactor', summary: 'Completed cleanup', status: 'completed', active: false }),
      makeChange({ id: 'change-3', title: 'Dropped spike', summary: 'Cancelled experiment', status: 'cancelled', active: false }),
    ]);

    render(<SupervisorWorkspacePanel projectId="proj-1" agent={makeAgent()} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'View All' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'View All' }));

    await waitFor(() => {
      expect(screen.getByText('All Changes')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Completed' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancelled' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Completed' }));
    expect(screen.getAllByText('Old refactor').length).toBeGreaterThan(0);
  });

  it('passes notes to acceptance actions', async () => {
    mockGetActiveProjectChange.mockResolvedValue(makeChange({ status: 'executing' }));

    render(<SupervisorWorkspacePanel projectId="proj-1" agent={makeAgent()} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Request Acceptance' })).not.toBeDisabled();
    });

    fireEvent.change(screen.getByLabelText('Review / Sync Notes'), {
      target: { value: 'ready for acceptance review' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request Acceptance' }));

    await waitFor(() => {
      expect(mockRequestAcceptance).toHaveBeenCalledWith('change-1', 'ready for acceptance review');
    });
  });

  it('shows sync summary for completed change previews', async () => {
    mockGetActiveProjectChange.mockResolvedValue(makeChange({ status: 'completed', active: false }));
    mockGetProjectChanges.mockResolvedValue([
      makeChange({ id: 'change-1', status: 'completed', active: false }),
    ]);
    mockGetSupervisionContext.mockResolvedValue([
      { id: 'changes/change-1/design.md', version: 1, content: '# Design' },
      { id: 'changes/change-1/execution.md', version: 1, content: '# Execution' },
      { id: 'changes/change-1/tasks.md', version: 1, content: '# Tasks' },
      { id: 'changes/change-1/acceptance.md', version: 1, content: '# Acceptance\n\nAccepted, synced, and completed.' },
      { id: 'changes/change-1/sync-log.md', version: 1, content: '# Sync Log\n\nSpecs synced to baseline and change docs.' },
    ]);

    render(<SupervisorWorkspacePanel projectId="proj-1" agent={makeAgent()} />);

    await waitFor(() => {
      expect(screen.getByText('Accepted, synced, and completed.')).toBeInTheDocument();
    });

    expect(screen.getByText('Specs synced to baseline and change docs.')).toBeInTheDocument();
  });

});
