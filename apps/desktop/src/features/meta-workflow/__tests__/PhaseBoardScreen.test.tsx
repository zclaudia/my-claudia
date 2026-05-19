// apps/desktop/src/features/meta-workflow/__tests__/PhaseBoardScreen.test.tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  MetaWorkflowRun,
  MetaWorkflowPhase,
  MetaWorkflowPhaseStatus,
} from '@my-claudia/shared/features/meta-workflow';
import { PhaseBoardScreen } from '../components/PhaseBoardScreen.js';
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

describe('PhaseBoardScreen', () => {
  beforeEach(() => {
    useMetaWorkflowStore.setState({
      runs: {},
      phases: {},
      recommendations: {},
      viewByProject: {},
      pendingSelectByProject: {},
    });
    vi.restoreAllMocks();
    // Default: prevent the real HTTP fetch on mount from blowing up tests.
    vi.spyOn(api, 'listPhases').mockResolvedValue([]);
  });

  it('renders the empty-state message when no phases are loaded', async () => {
    render(
      <PhaseBoardScreen
        projectId="p1"
        run={makeRun()}
        socket={{ send: vi.fn() }}
      />,
    );
    // No phases initially → empty-state copy is shown.
    expect(
      screen.getByText(/No phases yet\. Set the phases\.json to instantiate them\./i),
    ).toBeInTheDocument();
    // Confirm the effect's listPhases call fired (and resolved to []), so the
    // empty-state stays after the microtask flush.
    await waitFor(() => {
      expect(api.listPhases).toHaveBeenCalledWith('run-1');
    });
  });

  it('renders one card per phase grouped across the full status set', () => {
    // Seed phases for every status group the kanban surface visualizes.
    useMetaWorkflowStore.setState({
      phases: {
        'run-1': [
          makePhaseRecord('p-pending', 'pending'),
          makePhaseRecord('p-running', 'running'),
          makePhaseRecord('p-done', 'done'),
          makePhaseRecord('p-stale', 'stale', { staleSourcePhaseId: 'p-done' }),
          makePhaseRecord('p-failed', 'failed'),
        ],
      },
    });
    render(
      <PhaseBoardScreen
        projectId="p1"
        run={makeRun({ title: 'Kanban demo' })}
        socket={{ send: vi.fn() }}
      />,
    );

    // Header reflects the run title.
    expect(screen.getByText(/Phases\s*—\s*Kanban demo/)).toBeInTheDocument();

    // Each phaseId renders exactly once.
    expect(screen.getByText('p-pending')).toBeInTheDocument();
    expect(screen.getByText('p-running')).toBeInTheDocument();
    expect(screen.getByText('p-done')).toBeInTheDocument();
    expect(screen.getByText('p-stale')).toBeInTheDocument();
    expect(screen.getByText('p-failed')).toBeInTheDocument();

    // Each status badge appears at least once (one per card).
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('done')).toBeInTheDocument();
    expect(screen.getByText('stale')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
  });

  it('clicking a phase card switches view to phase-detail with the phaseId', async () => {
    const seeded = [makePhaseRecord('p1', 'pending'), makePhaseRecord('p2', 'done')];
    // Reflect the seeded phases back through listPhases so the mount effect
    // does not clobber the store with an empty array.
    vi.spyOn(api, 'listPhases').mockResolvedValue(seeded);
    useMetaWorkflowStore.setState({
      phases: { 'run-1': seeded },
    });
    const user = userEvent.setup();
    render(
      <PhaseBoardScreen
        projectId="p1"
        run={makeRun()}
        socket={{ send: vi.fn() }}
      />,
    );

    // PhaseCard fires onClick on its outer container; the inner phaseId label
    // is the most stable click target.
    await user.click(await screen.findByText('p2'));

    await waitFor(() => {
      const view = useMetaWorkflowStore.getState().viewByProject['p1'];
      expect(view?.screen).toBe('phase-detail');
      expect(view?.selectedPhaseId).toBe('p2');
    });
  });

  it('"View Graph" header button switches view to phase-graph', async () => {
    const seeded = [makePhaseRecord('p1', 'pending')];
    vi.spyOn(api, 'listPhases').mockResolvedValue(seeded);
    useMetaWorkflowStore.setState({
      phases: { 'run-1': seeded },
    });
    const user = userEvent.setup();
    render(
      <PhaseBoardScreen
        projectId="p1"
        run={makeRun()}
        socket={{ send: vi.fn() }}
      />,
    );
    await user.click(await screen.findByRole('button', { name: /View Graph/i }));
    await waitFor(() => {
      const view = useMetaWorkflowStore.getState().viewByProject['p1'];
      expect(view?.screen).toBe('phase-graph');
    });
  });
});
