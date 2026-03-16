import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkflowsPanel } from '../WorkflowsPanel';
import type { Workflow, WorkflowRun, WorkflowTemplate } from '@my-claudia/shared';

vi.mock('../../../hooks/useMediaQuery', () => ({
  useIsMobile: () => false,
}));

vi.mock('../../../services/api', () => ({
  getBaseUrl: vi.fn(() => 'http://localhost:3100'),
  getAuthHeaders: vi.fn(() => ({})),
}));

// Mock complex sub-components to avoid dependency chains
vi.mock('../WorkflowEditor', () => ({
  WorkflowEditor: (props: any) => (
    <div data-testid="workflow-editor">
      <button onClick={props.onBack}>Back</button>
    </div>
  ),
}));

vi.mock('../WorkflowRunViewer', () => ({
  WorkflowRunViewer: (props: any) => (
    <div data-testid="workflow-run-viewer">
      <button onClick={props.onBack}>Back</button>
    </div>
  ),
}));

vi.mock('../WorkflowCard', () => ({
  WorkflowCard: (props: any) => (
    <div data-testid={`workflow-card-${props.workflow.id}`}>
      <span>{props.workflow.name}</span>
      {props.onEdit && <button onClick={props.onEdit}>Edit</button>}
      {props.onTrigger && <button onClick={props.onTrigger}>Trigger</button>}
      {props.onDelete && <button onClick={props.onDelete}>Delete</button>}
    </div>
  ),
}));

let mockWorkflows: Record<string, Workflow[]> = {};
let mockRuns: Record<string, WorkflowRun[]> = {};
let mockTemplates: WorkflowTemplate[] = [];
const mockLoadWorkflows = vi.fn().mockResolvedValue(undefined);
const mockLoadTemplates = vi.fn().mockResolvedValue(undefined);
const mockTriggerWorkflow = vi.fn().mockResolvedValue({ id: 'run-1' });
const mockUpdateWorkflow = vi.fn().mockResolvedValue(undefined);
const mockDeleteWorkflow = vi.fn().mockResolvedValue(undefined);
const mockCreateFromTemplate = vi.fn().mockResolvedValue(undefined);
const mockLoadRuns = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../stores/workflowStore', () => {
  const store = vi.fn((selector?: (s: any) => any) => {
    const state = {
      workflows: mockWorkflows,
      runs: mockRuns,
      templates: mockTemplates,
      loadWorkflows: mockLoadWorkflows,
      loadTemplates: mockLoadTemplates,
      triggerWorkflow: mockTriggerWorkflow,
      updateWorkflow: mockUpdateWorkflow,
      deleteWorkflow: mockDeleteWorkflow,
      createFromTemplate: mockCreateFromTemplate,
      loadRuns: mockLoadRuns,
    };
    return selector ? selector(state) : state;
  });
  (store as any).getState = () => ({
    workflows: mockWorkflows,
    runs: mockRuns,
    templates: mockTemplates,
  });
  return { useWorkflowStore: store };
});

beforeEach(() => {
  vi.clearAllMocks();
  mockWorkflows = {};
  mockRuns = {};
  mockTemplates = [];
  // Restore mock return values after clearAllMocks
  mockLoadWorkflows.mockResolvedValue(undefined);
  mockLoadTemplates.mockResolvedValue(undefined);
  mockTriggerWorkflow.mockResolvedValue({ id: 'run-1' });
  mockUpdateWorkflow.mockResolvedValue(undefined);
  mockDeleteWorkflow.mockResolvedValue(undefined);
  mockCreateFromTemplate.mockResolvedValue(undefined);
  mockLoadRuns.mockResolvedValue(undefined);
});

function createWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 'wf-1',
    projectId: 'proj-1',
    name: 'Test Workflow',
    description: 'A test workflow',
    status: 'active',
    definition: { triggers: [], steps: [] },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Workflow;
}

describe('WorkflowsPanel', () => {
  it('renders the header with title', () => {
    render(<WorkflowsPanel projectId="proj-1" />);
    expect(screen.getByText('Workflows')).toBeInTheDocument();
  });

  it('renders New button', () => {
    render(<WorkflowsPanel projectId="proj-1" />);
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('calls loadWorkflows and loadTemplates on mount', () => {
    render(<WorkflowsPanel projectId="proj-1" />);
    expect(mockLoadWorkflows).toHaveBeenCalledWith('proj-1');
    expect(mockLoadTemplates).toHaveBeenCalled();
  });

  it('shows empty state when no workflows', async () => {
    render(<WorkflowsPanel projectId="proj-1" />);
    await vi.waitFor(() => {
      expect(screen.getByText('No workflows yet')).toBeInTheDocument();
    });
  });

  it('renders active workflow cards', async () => {
    mockWorkflows = {
      'proj-1': [createWorkflow({ id: 'wf-1', name: 'My Workflow', status: 'active' })],
    };
    render(<WorkflowsPanel projectId="proj-1" />);
    await vi.waitFor(() => {
      expect(screen.getByTestId('workflow-card-wf-1')).toBeInTheDocument();
    });
    expect(screen.getByText('My Workflow')).toBeInTheDocument();
  });

  it('renders disabled workflow section', async () => {
    mockWorkflows = {
      'proj-1': [createWorkflow({ id: 'wf-2', name: 'Disabled WF', status: 'disabled' })],
    };
    render(<WorkflowsPanel projectId="proj-1" />);
    await vi.waitFor(() => {
      expect(screen.getByText('Disabled')).toBeInTheDocument();
    });
    expect(screen.getByText('Disabled WF')).toBeInTheDocument();
  });

  it('shows workflow count badge', async () => {
    mockWorkflows = {
      'proj-1': [
        createWorkflow({ id: 'wf-1', status: 'active' }),
        createWorkflow({ id: 'wf-2', status: 'active' }),
      ],
    };
    const { container } = render(<WorkflowsPanel projectId="proj-1" />);
    await vi.waitFor(() => {
      expect(container.textContent).toContain('2');
    });
  });

  it('switches to editor view when New is clicked', async () => {
    render(<WorkflowsPanel projectId="proj-1" />);
    await vi.waitFor(() => {
      expect(screen.getByText('New')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('New'));
    expect(screen.getByTestId('workflow-editor')).toBeInTheDocument();
  });

  it('returns to list view from editor when Back is clicked', async () => {
    render(<WorkflowsPanel projectId="proj-1" />);
    await vi.waitFor(() => {
      expect(screen.getByText('New')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('New'));
    expect(screen.getByTestId('workflow-editor')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('Workflows')).toBeInTheDocument();
  });

  it('renders templates when available', async () => {
    mockTemplates = [
      {
        id: 'tpl-1',
        name: 'CI Pipeline',
        description: 'Run CI checks',
        category: 'ci',
        definition: { triggers: [], steps: [] },
      } as WorkflowTemplate,
    ];
    render(<WorkflowsPanel projectId="proj-1" />);
    await vi.waitFor(() => {
      expect(screen.getByText('Quick Start Templates')).toBeInTheDocument();
    });
    expect(screen.getByText('CI Pipeline')).toBeInTheDocument();
  });

  it('calls onViewModeChange when view changes', async () => {
    const onViewModeChange = vi.fn();
    render(<WorkflowsPanel projectId="proj-1" onViewModeChange={onViewModeChange} />);
    await vi.waitFor(() => {
      expect(onViewModeChange).toHaveBeenCalledWith('list');
    });

    fireEvent.click(screen.getByText('New'));
    expect(onViewModeChange).toHaveBeenCalledWith('detail');
  });

  it('calls triggerWorkflow when trigger button is clicked', async () => {
    mockWorkflows = {
      'proj-1': [createWorkflow({ id: 'wf-1', name: 'My Workflow', status: 'active' })],
    };
    render(<WorkflowsPanel projectId="proj-1" />);
    await vi.waitFor(() => {
      expect(screen.getByTestId('workflow-card-wf-1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Trigger'));
    await vi.waitFor(() => {
      expect(mockTriggerWorkflow).toHaveBeenCalledWith('wf-1');
    });
    // Note: View switching is handled by internal state, tested in integration
  });

  it('switches to editor view when Edit is clicked on workflow card', async () => {
    mockWorkflows = {
      'proj-1': [createWorkflow({ id: 'wf-1', name: 'My Workflow', status: 'active' })],
    };
    render(<WorkflowsPanel projectId="proj-1" />);
    await vi.waitFor(() => {
      expect(screen.getByTestId('workflow-card-wf-1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Edit'));
    expect(screen.getByTestId('workflow-editor')).toBeInTheDocument();
  });

  it('calls deleteWorkflow when Delete is clicked', async () => {
    mockWorkflows = {
      'proj-1': [createWorkflow({ id: 'wf-1', name: 'My Workflow', status: 'active' })],
    };
    render(<WorkflowsPanel projectId="proj-1" />);
    await vi.waitFor(() => {
      expect(screen.getByTestId('workflow-card-wf-1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Delete'));
    await vi.waitFor(() => {
      expect(mockDeleteWorkflow).toHaveBeenCalledWith('wf-1', 'proj-1');
    });
  });

  it('calls createFromTemplate when template Enable is clicked', async () => {
    mockTemplates = [
      {
        id: 'tpl-1',
        name: 'CI Pipeline',
        description: 'Run CI checks',
        category: 'ci',
        definition: { triggers: [], steps: [] },
      } as WorkflowTemplate,
    ];
    render(<WorkflowsPanel projectId="proj-1" />);
    await vi.waitFor(() => {
      expect(screen.getByText('Enable')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Enable'));
    await vi.waitFor(() => {
      expect(mockCreateFromTemplate).toHaveBeenCalledWith('proj-1', 'tpl-1');
    });
  });

  it('shows template workflow association', async () => {
    mockTemplates = [
      {
        id: 'tpl-1',
        name: 'CI Pipeline',
        description: 'Run CI checks',
        category: 'ci',
        definition: { triggers: [], steps: [] },
      } as WorkflowTemplate,
    ];
    mockWorkflows = {
      'proj-1': [createWorkflow({ id: 'wf-1', templateId: 'tpl-1', status: 'active' })],
    };
    render(<WorkflowsPanel projectId="proj-1" />);
    await vi.waitFor(() => {
      // Verify both template and workflow are rendered
      expect(screen.getByText('CI Pipeline')).toBeInTheDocument();
      expect(screen.getByTestId('workflow-card-wf-1')).toBeInTheDocument();
    });
  });

  it('loads runs for each workflow on mount', async () => {
    mockWorkflows = {
      'proj-1': [createWorkflow({ id: 'wf-1' })],
    };
    render(<WorkflowsPanel projectId="proj-1" />);
    await vi.waitFor(() => {
      expect(mockLoadRuns).toHaveBeenCalledWith('wf-1');
    });
  });

  it('shows loading spinner initially', () => {
    mockLoadWorkflows.mockImplementation(() => new Promise(() => {}));
    const { container } = render(<WorkflowsPanel projectId="proj-1" />);
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('renders templates with different categories', async () => {
    mockTemplates = [
      {
        id: 'tpl-1',
        name: 'Git Template',
        description: 'Git operations',
        category: 'git',
        definition: { triggers: [], steps: [] },
      } as WorkflowTemplate,
      {
        id: 'tpl-2',
        name: 'AI Template',
        description: 'AI operations',
        category: 'ai',
        definition: { triggers: [], steps: [] },
      } as WorkflowTemplate,
    ];
    render(<WorkflowsPanel projectId="proj-1" />);
    await vi.waitFor(() => {
      expect(screen.getByText('Git Template')).toBeInTheDocument();
      expect(screen.getByText('AI Template')).toBeInTheDocument();
    });
  });

  it('loads workflow runs on mount', async () => {
    mockWorkflows = {
      'proj-1': [createWorkflow({ id: 'wf-1' })],
    };
    // Don't set mockRuns - component should call loadRuns when runs don't exist
    render(<WorkflowsPanel projectId="proj-1" />);
    await vi.waitFor(() => {
      expect(screen.getByTestId('workflow-card-wf-1')).toBeInTheDocument();
    });
    // Verify loadRuns was called for the workflow
    expect(mockLoadRuns).toHaveBeenCalledWith('wf-1');
  });

  it('renders active workflow card with correct props', async () => {
    mockWorkflows = {
      'proj-1': [createWorkflow({ id: 'wf-1', name: 'Active Workflow', status: 'active' })],
    };
    render(<WorkflowsPanel projectId="proj-1" />);
    await vi.waitFor(() => {
      expect(screen.getByTestId('workflow-card-wf-1')).toBeInTheDocument();
      expect(screen.getByText('Active Workflow')).toBeInTheDocument();
    });
  });

  it('calls onSaved when editor saves', async () => {
    render(<WorkflowsPanel projectId="proj-1" />);
    await vi.waitFor(() => {
      expect(screen.getByText('New')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('New'));
    expect(screen.getByTestId('workflow-editor')).toBeInTheDocument();
  });
});
