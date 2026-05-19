// apps/desktop/src/features/meta-workflow/__tests__/PromotionDialog.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MetaWorkflowRun } from '@my-claudia/shared/features/meta-workflow';
import { PromotionDialog } from '../components/PromotionDialog.js';
import { useMetaWorkflowStore } from '../store.js';
import * as api from '../api.js';

function makeRun(overrides: Partial<MetaWorkflowRun> = {}): MetaWorkflowRun {
  return {
    id: 'run-1',
    projectId: 'p1',
    title: 'My run',
    status: 'splitting',
    rejectCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('PromotionDialog', () => {
  beforeEach(() => {
    useMetaWorkflowStore.setState({
      runs: {},
      phases: {},
      recommendations: {},
      viewByProject: {
        p1: { screen: 'promotion', selectedRunId: 'run-1', promotingPoolItemId: 'pool-item-1' },
      },
      pendingSelectByProject: {},
    });
    vi.restoreAllMocks();
  });

  it('does not render the form when closed (no poolItemId selected)', () => {
    render(
      <PromotionDialog
        projectId="p1"
        run={makeRun()}
        poolItemId={undefined}
        socket={{ send: vi.fn() }}
      />,
    );
    // Form heading + fields are absent in the fallback (closed) state.
    expect(screen.queryByText(/Promote Reusable Pool Item/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Promote$/i })).not.toBeInTheDocument();
    // Fallback message + Close affordance are visible.
    expect(screen.getByText(/No pool item selected for promotion\./i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Close/i })).toBeInTheDocument();
  });

  it('Cancel switches the view back to phase-board without calling the promote API', async () => {
    const promoteSpy = vi
      .spyOn(api, 'promotePoolItem')
      .mockResolvedValue({} as never);
    const user = userEvent.setup();
    render(
      <PromotionDialog
        projectId="p1"
        run={makeRun()}
        poolItemId="pool-item-1"
        socket={{ send: vi.fn() }}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(promoteSpy).not.toHaveBeenCalled();
    const view = useMetaWorkflowStore.getState().viewByProject['p1'];
    expect(view.screen).toBe('phase-board');
    expect(view.promotingPoolItemId).toBeUndefined();
  });

  it('Promote button submits the configured payload via promotePoolItem', async () => {
    const promoteSpy = vi
      .spyOn(api, 'promotePoolItem')
      .mockResolvedValue({} as never);
    const user = userEvent.setup();
    render(
      <PromotionDialog
        projectId="p1"
        run={makeRun()}
        poolItemId="pool-item-1"
        socket={{ send: vi.fn() }}
      />,
    );
    // Labels in PromotionDialog are not associated with their inputs (no htmlFor/id),
    // so use positional selection: tags (placeholder), name (2nd textbox), description (3rd textbox = textarea).
    await user.type(screen.getByPlaceholderText(/my-template/i), 'tag-a, tag-b');
    const textboxes = screen.getAllByRole('textbox');
    expect(textboxes).toHaveLength(3);
    await user.type(textboxes[1], 'reusable-x');
    await user.type(textboxes[2], 'Promoted helper');

    await user.click(screen.getByRole('button', { name: /^Promote$/i }));

    expect(promoteSpy).toHaveBeenCalledWith(
      'run-1',
      'pool-item-1',
      ['tag-a', 'tag-b'],
      'reusable-x',
      'Promoted helper',
    );
  });
});
