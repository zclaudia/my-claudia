// apps/desktop/src/features/meta-workflow/__tests__/RequirementsScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MetaWorkflowRun } from '@my-claudia/shared/features/meta-workflow';
import { RequirementsScreen } from '../components/RequirementsScreen.js';
import { useMetaWorkflowStore } from '../store.js';
import * as api from '../api.js';

function makeRun(overrides: Partial<MetaWorkflowRun> = {}): MetaWorkflowRun {
  return {
    id: 'run-1',
    projectId: 'p1',
    title: 'My run',
    status: 'requirement_draft',
    rejectCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('RequirementsScreen', () => {
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

  it('renders the run title and current status', () => {
    render(
      <RequirementsScreen
        projectId="p1"
        run={makeRun({ title: 'Awesome feature' })}
        socket={{ send: vi.fn() }}
      />,
    );
    expect(screen.getByText(/Requirements\s*—\s*Awesome feature/)).toBeInTheDocument();
    expect(screen.getByText(/requirement_draft/)).toBeInTheDocument();
  });

  it('Submit Requirements button invokes sendSubmitRequirements with edited path', async () => {
    const submitSpy = vi
      .spyOn(api, 'sendSubmitRequirements')
      .mockImplementation(() => {});
    const user = userEvent.setup();
    const socket = { send: vi.fn() };
    render(
      <RequirementsScreen
        projectId="p1"
        run={makeRun({ status: 'requirement_draft' })}
        socket={socket}
      />,
    );
    // Path input is the only textbox; default seeded to 'design/requirements.md'.
    const pathInput = screen.getByRole('textbox') as HTMLInputElement;
    expect(pathInput.value).toBe('design/requirements.md');
    await user.clear(pathInput);
    await user.type(pathInput, 'design/req.md');

    await user.click(screen.getByRole('button', { name: /Submit Requirements/i }));

    expect(submitSpy).toHaveBeenCalledWith(socket, {
      runId: 'run-1',
      requirementsPath: 'design/req.md',
    });
  });

  it('Approve button in review status calls sendResolveRequirements with approve and switches to phase-graph', async () => {
    const resolveSpy = vi
      .spyOn(api, 'sendResolveRequirements')
      .mockImplementation(() => {});
    const user = userEvent.setup();
    const socket = { send: vi.fn() };
    render(
      <RequirementsScreen
        projectId="p1"
        run={makeRun({ status: 'requirement_review' })}
        socket={socket}
      />,
    );
    // Submit must NOT be present in review state; Approve/Reject must be.
    expect(screen.queryByRole('button', { name: /Submit Requirements/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Approve$/ }));

    expect(resolveSpy).toHaveBeenCalledWith(socket, {
      runId: 'run-1',
      decision: 'approve',
    });
    const view = useMetaWorkflowStore.getState().viewByProject['p1'];
    expect(view.screen).toBe('phase-graph');
  });

  it('Reject button in review status calls sendResolveRequirements with reject', async () => {
    const resolveSpy = vi
      .spyOn(api, 'sendResolveRequirements')
      .mockImplementation(() => {});
    const user = userEvent.setup();
    const socket = { send: vi.fn() };
    render(
      <RequirementsScreen
        projectId="p1"
        run={makeRun({ status: 'requirement_review' })}
        socket={socket}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^Reject$/ }));

    expect(resolveSpy).toHaveBeenCalledWith(socket, {
      runId: 'run-1',
      decision: 'reject',
    });
    // Reject does NOT switch the view away from requirements.
    const view = useMetaWorkflowStore.getState().viewByProject['p1'];
    expect(view).toBeUndefined();
  });

  it('shows the escape-hatch warning when rejectCount >= 4', () => {
    render(
      <RequirementsScreen
        projectId="p1"
        run={makeRun({ status: 'requirement_review', rejectCount: 4 })}
        socket={{ send: vi.fn() }}
      />,
    );
    expect(screen.getByText(/Reject count:\s*4/)).toBeInTheDocument();
    expect(screen.getByText(/escape hatch/i)).toBeInTheDocument();
  });
});
