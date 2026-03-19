import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockSetNodes = vi.fn((fn: any) => {
  if (typeof fn === 'function') fn([]);
  return [];
});
const mockSetEdges = vi.fn((fn: any) => {
  if (typeof fn === 'function') fn([]);
  return [];
});
const mockOnNodesChange = vi.fn();
const mockOnEdgesChange = vi.fn();

// Mock @xyflow/react
vi.mock('@xyflow/react', () => ({
  ReactFlow: (props: any) => (
    <div
      data-testid="reactflow"
      data-fit-view={props.fitView ? 'true' : 'false'}
    >
      {props.children}
    </div>
  ),
  useNodesState: (initial: any[]) => [initial || [], mockSetNodes, mockOnNodesChange],
  useEdgesState: (initial: any[]) => [initial || [], mockSetEdges, mockOnEdgesChange],
  useReactFlow: () => ({
    getNodes: vi.fn(() => []),
    getEdges: vi.fn(() => []),
    setNodes: vi.fn(),
    setEdges: vi.fn(),
    fitView: vi.fn(),
    screenToFlowPosition: vi.fn(({ x, y }: any) => ({ x, y })),
  }),
  ReactFlowProvider: ({ children }: any) => <div data-testid="reactflow-provider">{children}</div>,
  Background: () => <div data-testid="background" />,
  Controls: () => <div data-testid="controls" />,
  MiniMap: () => <div data-testid="minimap" />,
  addEdge: vi.fn(),
  Panel: (props: any) => <div>{props.children}</div>,
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
  MarkerType: { ArrowClosed: 'arrowclosed' },
  BaseEdge: () => null,
  EdgeLabelRenderer: (props: any) => <div>{props.children}</div>,
  getBezierPath: () => ['M0,0', 0, 0],
}));

vi.mock('@xyflow/react/dist/style.css', () => ({}));

// Mock sub-components used by WorkflowGraphEditor
vi.mock('../nodes/StepNode', () => ({
  StepNode: () => <div data-testid="step-node">StepNode</div>,
}));

vi.mock('../edges/WorkflowEdge', () => ({
  WorkflowEdge: () => <div data-testid="workflow-edge">WorkflowEdge</div>,
}));

import { WorkflowGraphEditor, fromFlowNodes, fromFlowEdges } from '../WorkflowGraphEditor';

describe('WorkflowGraphEditor', () => {
  const mockOnNodesChangeCallback = vi.fn();
  const mockOnEdgesChangeCallback = vi.fn();
  const mockOnNodeSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing with empty initial data', () => {
    const { container } = render(
      <WorkflowGraphEditor
        initialNodes={[]}
        initialEdges={[]}
        onNodesChange={mockOnNodesChangeCallback}
        onEdgesChange={mockOnEdgesChangeCallback}
        onNodeSelect={mockOnNodeSelect}
      />
    );
    expect(container).toBeTruthy();
  });

  it('renders ReactFlowProvider wrapper', () => {
    render(
      <WorkflowGraphEditor
        initialNodes={[]}
        initialEdges={[]}
        onNodesChange={mockOnNodesChangeCallback}
        onEdgesChange={mockOnEdgesChangeCallback}
        onNodeSelect={mockOnNodeSelect}
      />
    );
    expect(screen.getByTestId('reactflow-provider')).toBeTruthy();
  });

  it('renders ReactFlow component', () => {
    render(
      <WorkflowGraphEditor
        initialNodes={[]}
        initialEdges={[]}
        onNodesChange={mockOnNodesChangeCallback}
        onEdgesChange={mockOnEdgesChangeCallback}
        onNodeSelect={mockOnNodeSelect}
      />
    );
    expect(screen.getByTestId('reactflow')).toBeTruthy();
  });

  it('renders Background, Controls, and MiniMap', () => {
    render(
      <WorkflowGraphEditor
        initialNodes={[]}
        initialEdges={[]}
        onNodesChange={mockOnNodesChangeCallback}
        onEdgesChange={mockOnEdgesChangeCallback}
        onNodeSelect={mockOnNodeSelect}
      />
    );
    expect(screen.getByTestId('background')).toBeTruthy();
    expect(screen.getByTestId('controls')).toBeTruthy();
    expect(screen.getByTestId('minimap')).toBeTruthy();
  });

  it('has data-graph-editor attribute on wrapper', () => {
    const { container } = render(
      <WorkflowGraphEditor
        initialNodes={[]}
        initialEdges={[]}
        onNodesChange={mockOnNodesChangeCallback}
        onEdgesChange={mockOnEdgesChangeCallback}
        onNodeSelect={mockOnNodeSelect}
      />
    );
    expect(container.querySelector('[data-graph-editor]')).toBeTruthy();
  });

  it('renders with initial nodes', () => {
    const initialNodes = [
      { id: 'n1', name: 'Step 1', type: 'ai_prompt', config: {}, position: { x: 0, y: 0 } },
      { id: 'n2', name: 'Step 2', type: 'shell', config: {}, position: { x: 200, y: 0 } },
    ];

    const { container } = render(
      <WorkflowGraphEditor
        initialNodes={initialNodes as any}
        initialEdges={[]}
        onNodesChange={mockOnNodesChangeCallback}
        onEdgesChange={mockOnEdgesChangeCallback}
        onNodeSelect={mockOnNodeSelect}
      />
    );
    expect(container).toBeTruthy();
  });

  it('renders with initial edges', () => {
    const initialEdges = [
      { id: 'e1', source: 'n1', target: 'n2', type: 'success' as const },
    ];

    const { container } = render(
      <WorkflowGraphEditor
        initialNodes={[]}
        initialEdges={initialEdges as any}
        onNodesChange={mockOnNodesChangeCallback}
        onEdgesChange={mockOnEdgesChangeCallback}
        onNodeSelect={mockOnNodeSelect}
      />
    );
    expect(container).toBeTruthy();
  });

  it('enables fitView on ReactFlow', () => {
    render(
      <WorkflowGraphEditor
        initialNodes={[]}
        initialEdges={[]}
        onNodesChange={mockOnNodesChangeCallback}
        onEdgesChange={mockOnEdgesChangeCallback}
        onNodeSelect={mockOnNodeSelect}
      />
    );
    expect(screen.getByTestId('reactflow').getAttribute('data-fit-view')).toBe('true');
  });
});

describe('fromFlowNodes', () => {
  it('converts flow nodes to workflow node defs', () => {
    const flowNodes = [
      {
        id: 'n1',
        data: {
          label: 'My Step',
          stepType: 'ai_prompt',
          config: { model: 'claude' },
          onError: 'abort',
          retryCount: 3,
          timeoutMs: 5000,
          condition: { expression: 'true' },
        },
        position: { x: 100, y: 200 },
      },
    ];

    const result = fromFlowNodes(flowNodes as any);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'n1',
      name: 'My Step',
      type: 'ai_prompt',
      config: { model: 'claude' },
      position: { x: 100, y: 200 },
      onError: 'abort',
      retryCount: 3,
      timeoutMs: 5000,
      condition: { expression: 'true' },
    });
  });

  it('handles empty config', () => {
    const flowNodes = [
      {
        id: 'n1',
        data: { label: 'Step', stepType: 'shell' },
        position: { x: 0, y: 0 },
      },
    ];

    const result = fromFlowNodes(flowNodes as any);
    expect(result[0].config).toEqual({});
  });

  it('returns empty array for empty input', () => {
    expect(fromFlowNodes([])).toEqual([]);
  });
});

describe('fromFlowEdges', () => {
  it('converts flow edges to workflow edge defs', () => {
    const flowEdges = [
      {
        id: 'e1',
        source: 'n1',
        target: 'n2',
        sourceHandle: 'success',
        data: { edgeType: 'success' },
      },
    ];

    const result = fromFlowEdges(flowEdges as any);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'e1',
      source: 'n1',
      target: 'n2',
      type: 'success',
    });
  });

  it('falls back to sourceHandle when data.edgeType is missing', () => {
    const flowEdges = [
      {
        id: 'e1',
        source: 'n1',
        target: 'n2',
        sourceHandle: 'error',
      },
    ];

    const result = fromFlowEdges(flowEdges as any);
    expect(result[0].type).toBe('error');
  });

  it('defaults to success when no edgeType or sourceHandle', () => {
    const flowEdges = [
      {
        id: 'e1',
        source: 'n1',
        target: 'n2',
      },
    ];

    const result = fromFlowEdges(flowEdges as any);
    expect(result[0].type).toBe('success');
  });

  it('returns empty array for empty input', () => {
    expect(fromFlowEdges([])).toEqual([]);
  });
});
