// apps/desktop/src/features/meta-workflow/__tests__/PhaseDetailScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../workflows/components/WorkflowRunViewer.js', () => ({
  WorkflowRunViewer: ({ runId }: { runId: string }) => (
    <div data-testid="sub-workflow-stub" data-run-id={runId}>SUB:{runId}</div>
  ),
}));

import type {
  MetaWorkflowRun,
  MetaWorkflowPhase,
  MetaWorkflowPhaseStatus,
  AcceptanceGate,
} from '@my-claudia/shared/features/meta-workflow';
import { PhaseDetailScreen } from '../components/PhaseDetailScreen.js';
import { useMetaWorkflowStore } from '../store.js';
import * as api from '../api.js';

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

function makePhase(
  overrides: Partial<MetaWorkflowPhase> = {},
  status: MetaWorkflowPhaseStatus = 'pending',
): MetaWorkflowPhase {
  const gates: AcceptanceGate[] = [
    {
      id: 'gate-build',
      description: 'pnpm build passes',
      command: 'pnpm build',
      expect: { exitCode: 0 },
    },
  ];
  return {
    id: 'phase-rec-1',
    runId: 'run-1',
    phaseId: 'p1',
    phaseType: 'code-implement',
    status,
    executeEntity: 'workflow',
    attempt: 0,
    maxRetries: 3,
    gatesSnapshot: gates,
    createdAt: 1,
    ...overrides,
  };
}

describe('PhaseDetailScreen', () => {
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

  it('renders "Phase not found" when the phaseId does not match a known phase', async () => {
    // No phases registered for run-1 → lookup fails.
    const user = userEvent.setup();
    render(
      <PhaseDetailScreen
        projectId="p1"
        run={makeRun()}
        phaseId="missing-phase"
        socket={{ send: vi.fn() }}
      />,
    );
    expect(screen.getByText(/Phase not found\./i)).toBeInTheDocument();

    // Back button switches the view back to phase-board and clears the selectedPhaseId.
    await user.click(screen.getByRole('button', { name: /Back to Board/i }));
    const view = useMetaWorkflowStore.getState().viewByProject['p1'];
    expect(view.screen).toBe('phase-board');
    expect(view.selectedPhaseId).toBeUndefined();
  });

  it('renders phase metadata + acceptance gates snapshot for a pending phase', () => {
    useMetaWorkflowStore.setState({
      phases: { 'run-1': [makePhase()] },
    });
    render(
      <PhaseDetailScreen
        projectId="p1"
        run={makeRun()}
        phaseId="p1"
        socket={{ send: vi.fn() }}
      />,
    );
    // Phase id heading.
    expect(screen.getByRole('heading', { name: 'p1' })).toBeInTheDocument();
    // Metadata line contains the phase type + executeEntity + status + attempt counter.
    expect(screen.getByText(/code-implement/)).toBeInTheDocument();
    expect(screen.getByText(/workflow/)).toBeInTheDocument();
    expect(screen.getByText(/pending/)).toBeInTheDocument();
    expect(screen.getByText(/attempt 0\/3/)).toBeInTheDocument();
    // Acceptance gates snapshot is serialized into the <details> JSON dump.
    expect(screen.getByText(/gate-build/)).toBeInTheDocument();
    expect(screen.getByText(/pnpm build passes/)).toBeInTheDocument();
  });

  it('Run button on a pending phase invokes sendRunPhase with the correct ids', async () => {
    useMetaWorkflowStore.setState({
      phases: { 'run-1': [makePhase()] },
    });
    const runSpy = vi.spyOn(api, 'sendRunPhase').mockImplementation(() => {});
    const user = userEvent.setup();
    const socket = { send: vi.fn() };
    render(
      <PhaseDetailScreen
        projectId="p1"
        run={makeRun()}
        phaseId="p1"
        socket={socket}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^Run$/ }));
    expect(runSpy).toHaveBeenCalledWith(socket, { runId: 'run-1', phaseId: 'p1' });
    // Re-run and Cascade Re-run must NOT be visible for a pending phase.
    expect(screen.queryByRole('button', { name: /^Re-run$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cascade Re-run/i })).not.toBeInTheDocument();
  });

  it('Cascade Re-run button on a stale phase invokes sendCascadeRerun', async () => {
    useMetaWorkflowStore.setState({
      phases: { 'run-1': [makePhase({ staleSourcePhaseId: 'p0' }, 'stale')] },
    });
    const cascadeSpy = vi.spyOn(api, 'sendCascadeRerun').mockImplementation(() => {});
    const ignoreSpy = vi.spyOn(api, 'sendIgnoreStale').mockImplementation(() => {});
    const user = userEvent.setup();
    const socket = { send: vi.fn() };
    render(
      <PhaseDetailScreen
        projectId="p1"
        run={makeRun()}
        phaseId="p1"
        socket={socket}
      />,
    );
    // For stale, Re-run / Evaluate Impact / Cascade Re-run / Ignore Stale all appear.
    expect(screen.getByRole('button', { name: /^Re-run$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Evaluate Impact/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Cascade Re-run/i }));
    expect(cascadeSpy).toHaveBeenCalledWith(socket, { runId: 'run-1', phaseId: 'p1' });

    // Ignore Stale is also wired correctly when present.
    await user.click(screen.getByRole('button', { name: /Ignore Stale/i }));
    expect(ignoreSpy).toHaveBeenCalledWith(socket, { runId: 'run-1', phaseId: 'p1' });
  });

  it('renders the impact recommendation block when one is stored', () => {
    useMetaWorkflowStore.setState({
      phases: { 'run-1': [makePhase({}, 'stale')] },
      recommendations: {
        'run-1:p1': {
          runId: 'run-1',
          phaseId: 'p1',
          kind: 'minor-fix',
          reason: 'Only logging changed.',
        },
      },
    });
    render(
      <PhaseDetailScreen
        projectId="p1"
        run={makeRun()}
        phaseId="p1"
        socket={{ send: vi.fn() }}
      />,
    );
    expect(screen.getByText(/Impact recommendation/i)).toBeInTheDocument();
    expect(screen.getByText(/minor-fix/)).toBeInTheDocument();
    expect(screen.getByText(/Only logging changed\./)).toBeInTheDocument();
  });

  it('renders the sub-workflow viewer when phase.currentRunId is set', () => {
    useMetaWorkflowStore.setState({
      phases: { 'run-1': [makePhase({ currentRunId: 'sub-run-xyz' })] },
    });
    render(
      <PhaseDetailScreen
        projectId="p1"
        run={makeRun()}
        phaseId="p1"
        socket={{ send: vi.fn() }}
      />,
    );
    const stub = screen.getByTestId('sub-workflow-stub');
    expect(stub).toHaveAttribute('data-run-id', 'sub-run-xyz');
  });

  it('does not render the viewer when currentRunId is absent', () => {
    useMetaWorkflowStore.setState({
      phases: { 'run-1': [makePhase()] },
    });
    render(
      <PhaseDetailScreen
        projectId="p1"
        run={makeRun()}
        phaseId="p1"
        socket={{ send: vi.fn() }}
      />,
    );
    expect(screen.queryByTestId('sub-workflow-stub')).not.toBeInTheDocument();
  });
});
