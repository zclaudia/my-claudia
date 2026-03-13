import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useWorkflowStore } from '../../../stores/workflowStore';

// Mock @xyflow/react
vi.mock('@xyflow/react', () => ({
  ReactFlow: (props: any) => <div data-testid="reactflow">{props.children}</div>,
  useNodesState: () => [[], vi.fn(), vi.fn()],
  useEdgesState: () => [[], vi.fn(), vi.fn()],
  useReactFlow: () => ({ getNodes: vi.fn(() => []), getEdges: vi.fn(() => []), setNodes: vi.fn(), setEdges: vi.fn(), fitView: vi.fn(), screenToFlowPosition: vi.fn(() => ({ x: 0, y: 0 })) }),
  ReactFlowProvider: ({ children }: any) => <div>{children}</div>,
  Background: () => <div />,
  Controls: () => <div />,
  MiniMap: () => null,
  addEdge: vi.fn(),
  Panel: (props: any) => <div>{props.children}</div>,
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
  MarkerType: { ArrowClosed: 'arrowclosed' },
  BaseEdge: () => null,
  EdgeLabelRenderer: (props: any) => <div>{props.children}</div>,
  getBezierPath: () => ['M0,0', 0, 0],
}));

// Mock sub-components
vi.mock('../StepConfigForm', () => ({
  StepConfigForm: ({ step, onDelete }: any) => (
    <div data-testid="step-config-form">
      Step: {step?.name}
      <button onClick={onDelete}>Delete Node</button>
    </div>
  ),
}));

vi.mock('../TriggerConfigForm', () => ({
  TriggerConfigForm: ({ triggers }: any) => (
    <div data-testid="trigger-config-form">Triggers: {triggers?.length}</div>
  ),
}));

vi.mock('../NodePalette', () => ({
  NodePalette: () => <div data-testid="node-palette">NodePalette</div>,
}));

vi.mock('../WorkflowGraphEditor', () => ({
  WorkflowGraphEditor: (props: any) => (
    <div data-testid="graph-editor" data-graph-editor>
      GraphEditor
    </div>
  ),
  fromFlowNodes: (nodes: any[]) => nodes.map((n: any) => ({
    id: n.id,
    name: n.data?.label || '',
    type: n.data?.stepType || '',
    config: n.data?.config || {},
    position: n.position || { x: 0, y: 0 },
  })),
  fromFlowEdges: (edges: any[]) => edges.map((e: any) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: e.data?.edgeType || 'success',
  })),
}));

// Mock shared utilities
vi.mock('@my-claudia/shared', () => ({
  isV2Definition: (def: any) => def?.version === 2,
  migrateV1ToV2: (def: any) => ({
    version: 2,
    nodes: def?.steps?.map((s: any, i: number) => ({ id: `node_${i}`, name: s.name || '', type: s.type || '', config: {}, position: { x: 0, y: i * 100 } })) || [],
    edges: [],
    entryNodeId: '',
    triggers: def?.triggers || [{ type: 'manual' }],
  }),
}));

// Mock Tauri
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: vi.fn(),
}));

import { WorkflowEditor } from '../WorkflowEditor';

describe('WorkflowEditor', () => {
  const mockCreateWorkflow = vi.fn().mockResolvedValue({ id: 'wf-new' });
  const mockUpdateWorkflow = vi.fn().mockResolvedValue(undefined);
  const mockLoadStepTypes = vi.fn();
  const mockOnBack = vi.fn();
  const mockOnSaved = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    useWorkflowStore.setState({
      workflows: {},
      runs: {},
      stepRuns: {},
      templates: [],
      stepTypes: [],
      createWorkflow: mockCreateWorkflow,
      updateWorkflow: mockUpdateWorkflow,
      loadStepTypes: mockLoadStepTypes,
    } as any);
  });

  it('renders without crashing for new workflow', () => {
    const { container } = render(
      <WorkflowEditor
        projectId="proj-1"
        onBack={mockOnBack}
        onSaved={mockOnSaved}
      />
    );
    expect(container).toBeTruthy();
  });

  it('renders name input with placeholder', () => {
    render(
      <WorkflowEditor
        projectId="proj-1"
        onBack={mockOnBack}
        onSaved={mockOnSaved}
      />
    );
    expect(screen.getByPlaceholderText('Workflow name...')).toBeTruthy();
  });

  it('renders description input', () => {
    render(
      <WorkflowEditor
        projectId="proj-1"
        onBack={mockOnBack}
        onSaved={mockOnSaved}
      />
    );
    expect(screen.getByPlaceholderText('Description (optional)')).toBeTruthy();
  });

  it('renders Save button', () => {
    render(
      <WorkflowEditor
        projectId="proj-1"
        onBack={mockOnBack}
        onSaved={mockOnSaved}
      />
    );
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('Save button is disabled when name is empty', () => {
    render(
      <WorkflowEditor
        projectId="proj-1"
        onBack={mockOnBack}
        onSaved={mockOnSaved}
      />
    );
    const saveBtn = screen.getByText('Save');
    expect(saveBtn.closest('button')).toBeDisabled();
  });

  it('populates name and description for existing workflow', () => {
    const workflow = {
      id: 'wf-1',
      name: 'My Workflow',
      description: 'A test workflow',
      definition: {
        version: 2,
        nodes: [],
        edges: [],
        entryNodeId: '',
        triggers: [{ type: 'manual' }],
      },
    } as any;

    render(
      <WorkflowEditor
        workflow={workflow}
        projectId="proj-1"
        onBack={mockOnBack}
        onSaved={mockOnSaved}
      />
    );

    const nameInput = screen.getByPlaceholderText('Workflow name...') as HTMLInputElement;
    expect(nameInput.value).toBe('My Workflow');

    const descInput = screen.getByPlaceholderText('Description (optional)') as HTMLInputElement;
    expect(descInput.value).toBe('A test workflow');
  });

  it('updates name input value', () => {
    render(
      <WorkflowEditor
        projectId="proj-1"
        onBack={mockOnBack}
        onSaved={mockOnSaved}
      />
    );

    const nameInput = screen.getByPlaceholderText('Workflow name...') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'New Name' } });
    expect(nameInput.value).toBe('New Name');
  });

  it('calls loadStepTypes on mount (non-standalone)', () => {
    render(
      <WorkflowEditor
        projectId="proj-1"
        onBack={mockOnBack}
        onSaved={mockOnSaved}
      />
    );
    expect(mockLoadStepTypes).toHaveBeenCalled();
  });

  it('does not call loadStepTypes on mount when standalone', () => {
    render(
      <WorkflowEditor
        projectId="proj-1"
        onBack={mockOnBack}
        onSaved={mockOnSaved}
        standalone
        serverUrl="http://localhost:3100"
      />
    );
    expect(mockLoadStepTypes).not.toHaveBeenCalled();
  });

  it('renders breadcrumb navigation (non-standalone)', () => {
    render(
      <WorkflowEditor
        projectId="proj-1"
        onBack={mockOnBack}
        onSaved={mockOnSaved}
      />
    );
    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(screen.getByText('Workflows')).toBeTruthy();
    expect(screen.getByText('Editor')).toBeTruthy();
  });

  it('does not render breadcrumb when standalone', () => {
    render(
      <WorkflowEditor
        projectId="proj-1"
        onBack={mockOnBack}
        onSaved={mockOnSaved}
        standalone
        serverUrl="http://localhost:3100"
      />
    );
    expect(screen.queryByText('Dashboard')).toBeNull();
  });

  it('shows "Edit Workflow" in breadcrumb for existing workflow', () => {
    const workflow = {
      id: 'wf-1',
      name: 'Test WF',
      definition: {
        version: 2,
        nodes: [],
        edges: [],
        entryNodeId: '',
        triggers: [{ type: 'manual' }],
      },
    } as any;

    render(
      <WorkflowEditor
        workflow={workflow}
        projectId="proj-1"
        onBack={mockOnBack}
        onSaved={mockOnSaved}
      />
    );
    expect(screen.getByText('Edit Workflow')).toBeTruthy();
  });

  it('calls onBack when back button is clicked', () => {
    render(
      <WorkflowEditor
        projectId="proj-1"
        onBack={mockOnBack}
        onSaved={mockOnSaved}
      />
    );
    fireEvent.click(screen.getByTitle('Back to Workflows'));
    expect(mockOnBack).toHaveBeenCalled();
  });

  it('renders Toolbox panel by default', () => {
    render(
      <WorkflowEditor
        projectId="proj-1"
        onBack={mockOnBack}
        onSaved={mockOnSaved}
      />
    );
    expect(screen.getByText('Toolbox')).toBeTruthy();
    expect(screen.getByTestId('node-palette')).toBeTruthy();
    expect(screen.getByTestId('trigger-config-form')).toBeTruthy();
  });

  it('collapses left panel', () => {
    render(
      <WorkflowEditor
        projectId="proj-1"
        onBack={mockOnBack}
        onSaved={mockOnSaved}
      />
    );

    fireEvent.click(screen.getByTitle('Collapse panel'));
    expect(screen.queryByText('Toolbox')).toBeNull();
    expect(screen.getByTitle('Expand panel')).toBeTruthy();
  });

  it('expands left panel after collapsing', () => {
    render(
      <WorkflowEditor
        projectId="proj-1"
        onBack={mockOnBack}
        onSaved={mockOnSaved}
      />
    );

    fireEvent.click(screen.getByTitle('Collapse panel'));
    fireEvent.click(screen.getByTitle('Expand panel'));
    expect(screen.getByText('Toolbox')).toBeTruthy();
  });

  it('renders graph editor', () => {
    render(
      <WorkflowEditor
        projectId="proj-1"
        onBack={mockOnBack}
        onSaved={mockOnSaved}
      />
    );
    expect(screen.getByTestId('graph-editor')).toBeTruthy();
  });

  it('calls createWorkflow when saving new workflow', async () => {
    render(
      <WorkflowEditor
        projectId="proj-1"
        onBack={mockOnBack}
        onSaved={mockOnSaved}
      />
    );

    const nameInput = screen.getByPlaceholderText('Workflow name...');
    fireEvent.change(nameInput, { target: { value: 'Test Workflow' } });

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockCreateWorkflow).toHaveBeenCalledWith(
        'proj-1',
        expect.objectContaining({ name: 'Test Workflow' })
      );
    });
  });

  it('calls updateWorkflow when saving existing workflow', async () => {
    const workflow = {
      id: 'wf-1',
      name: 'Existing',
      definition: {
        version: 2,
        nodes: [],
        edges: [],
        entryNodeId: '',
        triggers: [{ type: 'manual' }],
      },
    } as any;

    render(
      <WorkflowEditor
        workflow={workflow}
        projectId="proj-1"
        onBack={mockOnBack}
        onSaved={mockOnSaved}
      />
    );

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockUpdateWorkflow).toHaveBeenCalledWith(
        'wf-1',
        'proj-1',
        expect.objectContaining({ name: 'Existing' })
      );
    });
  });

  it('calls onSaved after successful save (non-standalone)', async () => {
    render(
      <WorkflowEditor
        projectId="proj-1"
        onBack={mockOnBack}
        onSaved={mockOnSaved}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Workflow name...'), {
      target: { value: 'Name' },
    });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockOnSaved).toHaveBeenCalled();
    });
  });

  it('uses direct fetch for standalone save (new workflow)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: 'wf-new' } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    render(
      <WorkflowEditor
        projectId="proj-1"
        onBack={mockOnBack}
        onSaved={mockOnSaved}
        standalone
        serverUrl="http://localhost:3100"
        authToken="my-token"
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Workflow name...'), {
      target: { value: 'Standalone WF' },
    });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/api/projects/proj-1/workflows',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'my-token' }),
        })
      );
    });
  });

  it('uses PUT for standalone save of existing workflow', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: 'wf-1' } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const workflow = {
      id: 'wf-1',
      name: 'Existing',
      definition: {
        version: 2,
        nodes: [],
        edges: [],
        entryNodeId: '',
        triggers: [{ type: 'manual' }],
      },
    } as any;

    render(
      <WorkflowEditor
        workflow={workflow}
        projectId="proj-1"
        onBack={mockOnBack}
        onSaved={mockOnSaved}
        standalone
        serverUrl="http://localhost:3100"
      />
    );

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/api/workflows/wf-1',
        expect.objectContaining({ method: 'PUT' })
      );
    });
  });

  it('handles V1 workflow definition by migrating', () => {
    const workflow = {
      id: 'wf-old',
      name: 'Legacy',
      definition: {
        steps: [{ name: 'Step 1', type: 'ai_prompt' }],
        triggers: [{ type: 'manual' }],
      },
    } as any;

    const { container } = render(
      <WorkflowEditor
        workflow={workflow}
        projectId="proj-1"
        onBack={mockOnBack}
        onSaved={mockOnSaved}
      />
    );

    expect(container).toBeTruthy();
    const nameInput = screen.getByPlaceholderText('Workflow name...') as HTMLInputElement;
    expect(nameInput.value).toBe('Legacy');
  });
});
