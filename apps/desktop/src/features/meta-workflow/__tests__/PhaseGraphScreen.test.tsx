// apps/desktop/src/features/meta-workflow/__tests__/PhaseGraphScreen.test.tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  MetaWorkflowRun,
  MetaWorkflowPhase,
  MetaWorkflowPhaseStatus,
  PhasesDoc,
  PhaseDef,
} from '@my-claudia/shared/features/meta-workflow';

// Mock @xyflow/react before importing the component. The real component is opaque
// to RTL — replace ReactFlow with a div carrying node/edge metadata + a click hook
// on the node label so we can simulate "user clicks a node" interactions.
vi.mock('@xyflow/react', () => {
  type RFNode = {
    id: string;
    position: { x: number; y: number };
    data?: { label?: React.ReactNode };
    style?: Record<string, unknown>;
  };
  type RFEdge = { id: string; source: string; target: string };

  const ReactFlow = ({
    nodes,
    edges,
    children,
  }: {
    nodes: RFNode[];
    edges: RFEdge[];
    children?: React.ReactNode;
  }) => (
    <div
      data-testid="reactflow"
      data-node-count={String(nodes.length)}
      data-edge-count={String(edges.length)}
      data-node-ids={nodes.map((n) => n.id).join(',')}
      data-edge-ids={edges.map((e) => e.id).join(',')}
    >
      <ul data-testid="reactflow-nodes">
        {nodes.map((n) => (
          <li key={n.id} data-testid={`rf-node-${n.id}`} data-node-id={n.id}>
            {n.data?.label}
          </li>
        ))}
      </ul>
      <ul data-testid="reactflow-edges">
        {edges.map((e) => (
          <li key={e.id} data-testid={`rf-edge-${e.id}`} data-source={e.source} data-target={e.target}>
            {e.source}-&gt;{e.target}
          </li>
        ))}
      </ul>
      {children}
    </div>
  );
  return {
    ReactFlow,
    Background: () => <div data-testid="reactflow-background" />,
    Controls: () => <div data-testid="reactflow-controls" />,
    Handle: () => null,
    Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
    useNodesState: (initial: unknown[]) => [initial, () => {}, () => {}],
  };
});

// Stub the CSS import so vitest doesn't choke on the @xyflow stylesheet.
vi.mock('@xyflow/react/dist/style.css', () => ({}));

import { PhaseGraphScreen } from '../components/PhaseGraphScreen.js';
import { useMetaWorkflowStore } from '../store.js';

function makeRun(overrides: Partial<MetaWorkflowRun> = {}): MetaWorkflowRun {
  return {
    id: 'run-1',
    projectId: 'p1',
    title: 'My run',
    status: 'executing',
    rejectCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makePhaseDef(overrides: Partial<PhaseDef> = {}): PhaseDef {
  return {
    id: 'p1',
    name: 'Phase 1',
    description: 'First phase',
    phaseType: 'code-implement',
    dependsOn: [],
    inputs: [],
    outputs: [],
    acceptanceGates: [],
    ...overrides,
  };
}

function makePhasesDoc(phases: PhaseDef[]): PhasesDoc {
  return {
    version: '1',
    phases,
    smokePath: phases.map((p) => p.id),
    metadata: { generatedAt: 1, requirementsPath: 'design/req.md' },
  };
}

function makePhaseRecord(
  phaseId: string,
  status: MetaWorkflowPhaseStatus,
  overrides: Partial<MetaWorkflowPhase> = {},
): MetaWorkflowPhase {
  return {
    id: `rec-${phaseId}`,
    runId: 'run-1',
    phaseId,
    phaseType: 'code-implement',
    status,
    executeEntity: 'workflow',
    attempt: 0,
    maxRetries: 3,
    gatesSnapshot: [],
    createdAt: 1,
    ...overrides,
  };
}

describe('PhaseGraphScreen', () => {
  beforeEach(() => {
    useMetaWorkflowStore.setState({
      runs: {},
      phases: {},
      recommendations: {},
      viewByProject: {},
      pendingSelectByProject: {},
    });
    vi.restoreAllMocks();
  });

  it('renders the empty-state message when run.phasesJson is absent', () => {
    render(
      <PhaseGraphScreen
        projectId="p1"
        run={makeRun({ phasesJson: undefined })}
        socket={{ send: vi.fn() }}
      />,
    );
    expect(screen.getByText(/Phase Graph\s*—\s*My run/)).toBeInTheDocument();
    expect(
      screen.getByText(/Run has no phases\.json yet/i),
    ).toBeInTheDocument();
    // The mocked ReactFlow must NOT have been rendered in the empty state.
    expect(screen.queryByTestId('reactflow')).not.toBeInTheDocument();
  });

  it('renders one node per phase plus edges for every dependsOn link', () => {
    const doc = makePhasesDoc([
      makePhaseDef({ id: 'p1', dependsOn: [] }),
      makePhaseDef({ id: 'p2', dependsOn: ['p1'] }),
      makePhaseDef({ id: 'p3', dependsOn: ['p1', 'p2'] }),
    ]);
    useMetaWorkflowStore.setState({
      phases: {
        'run-1': [
          makePhaseRecord('p1', 'done'),
          makePhaseRecord('p2', 'running'),
          makePhaseRecord('p3', 'pending'),
        ],
      },
    });
    render(
      <PhaseGraphScreen
        projectId="p1"
        run={makeRun({ phasesJson: JSON.stringify(doc) })}
        socket={{ send: vi.fn() }}
      />,
    );

    const rf = screen.getByTestId('reactflow');
    expect(rf.getAttribute('data-node-count')).toBe('3');
    // 3 dependsOn edges: p1->p2, p1->p3, p2->p3
    expect(rf.getAttribute('data-edge-count')).toBe('3');
    const nodeIds = (rf.getAttribute('data-node-ids') ?? '').split(',').sort();
    expect(nodeIds).toEqual(['p1', 'p2', 'p3']);
    const edgeIds = (rf.getAttribute('data-edge-ids') ?? '').split(',').sort();
    expect(edgeIds).toEqual(['p1->p2', 'p1->p3', 'p2->p3']);

    // Status text from the phase store is reflected in the rendered node labels.
    expect(screen.getByTestId('rf-node-p1')).toHaveTextContent(/done/);
    expect(screen.getByTestId('rf-node-p2')).toHaveTextContent(/running/);
    expect(screen.getByTestId('rf-node-p3')).toHaveTextContent(/pending/);

    // Edge endpoints — confirm dependsOn direction is "dep -> phase".
    expect(screen.getByTestId('rf-edge-p1->p2').getAttribute('data-source')).toBe('p1');
    expect(screen.getByTestId('rf-edge-p1->p2').getAttribute('data-target')).toBe('p2');
  });

  it('renders an empty graph when run.phasesJson is malformed JSON', () => {
    render(
      <PhaseGraphScreen
        projectId="p1"
        run={makeRun({ phasesJson: '{not valid json' })}
        socket={{ send: vi.fn() }}
      />,
    );
    // Malformed JSON falls through to the empty {nodes:[], edges:[]} render.
    const rf = screen.getByTestId('reactflow');
    expect(rf.getAttribute('data-node-count')).toBe('0');
    expect(rf.getAttribute('data-edge-count')).toBe('0');
  });

  it('"View Board" header button switches view to phase-board', async () => {
    const doc = makePhasesDoc([makePhaseDef({ id: 'p1' })]);
    useMetaWorkflowStore.setState({
      phases: { 'run-1': [makePhaseRecord('p1', 'pending')] },
    });
    const user = userEvent.setup();
    render(
      <PhaseGraphScreen
        projectId="p1"
        run={makeRun({ phasesJson: JSON.stringify(doc) })}
        socket={{ send: vi.fn() }}
      />,
    );
    await user.click(screen.getByRole('button', { name: /View Board/i }));
    const view = useMetaWorkflowStore.getState().viewByProject['p1'];
    expect(view.screen).toBe('phase-board');
  });
});
