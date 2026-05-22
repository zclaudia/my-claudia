// apps/desktop/src/features/openspec/__tests__/InitializeSpecsDialog.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InitializeSpecsDialog } from '../components/InitializeSpecsDialog.js';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';

describe('InitializeSpecsDialog', () => {
  beforeEach(() => {
    useOpenSpecStore.setState({
      issuesByProject: {},
      specChangesById: {},
      executorsBySpecChange: {},
      corpusByProject: {},
      viewByProject: {},
    });
    vi.restoreAllMocks();
  });

  it('starts the scan on mount and shows the auto-applied summary', async () => {
    vi.spyOn(api, 'startBootstrap').mockResolvedValue({
      scan: { id: 's1', status: 'completed', appliedCount: 2, pendingCount: 0 } as never,
      appliedSummary: { auth: 1, billing: 1 },
      pendingSummary: {},
    });
    render(<InitializeSpecsDialog projectId="p1" mode="initial" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Scan status:/)).toBeInTheDocument());
    expect(screen.getByText(/Applied 2 requirements/)).toBeInTheDocument();
    expect(screen.getByText('auth: +1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('shows pending items when scan returns awaiting_review and allows approve', async () => {
    vi.spyOn(api, 'startBootstrap').mockResolvedValue({
      scan: { id: 's1', status: 'awaiting_review', appliedCount: 1, pendingCount: 2 } as never,
      appliedSummary: { auth: 1 },
      pendingSummary: { auth: { modified: 1, removed: 1 } },
    });
    const items = [
      {
        id: 'it1',
        capability: 'auth',
        operation: 'modify' as const,
        payloadJson: JSON.stringify({ name: 'Login', body: 'MUST do new' }),
        status: 'pending',
      },
      {
        id: 'it2',
        capability: 'auth',
        operation: 'remove' as const,
        payloadJson: JSON.stringify({ name: 'Legacy' }),
        status: 'pending',
      },
    ];
    const listSpy = vi
      .spyOn(api, 'listBootstrapItems')
      .mockResolvedValueOnce(items as never)
      .mockResolvedValueOnce([items[1]] as never);
    const approveSpy = vi
      .spyOn(api, 'approveBootstrapItem')
      .mockResolvedValue({ ...items[0], status: 'approved' } as never);
    render(<InitializeSpecsDialog projectId="p1" mode="rescan" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Pending review/)).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: 'Approve' })[0]);
    await waitFor(() => expect(approveSpy).toHaveBeenCalledWith('it1'));
    expect(listSpy).toHaveBeenCalled();
  });

  it('Finalize is disabled while pending items remain', async () => {
    vi.spyOn(api, 'startBootstrap').mockResolvedValue({
      scan: { id: 's1', status: 'awaiting_review', appliedCount: 0, pendingCount: 1 } as never,
      appliedSummary: {},
      pendingSummary: { auth: { modified: 1, removed: 0 } },
    });
    vi.spyOn(api, 'listBootstrapItems').mockResolvedValue([
      { id: 'it1', capability: 'auth', operation: 'modify', payloadJson: '{}', status: 'pending' },
    ] as never);
    render(<InitializeSpecsDialog projectId="p1" mode="rescan" onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Finalize' })).toBeDisabled(),
    );
  });

  it('Finalize calls api.finalizeBootstrap when all items resolved and refreshes corpus', async () => {
    vi.spyOn(api, 'startBootstrap').mockResolvedValue({
      scan: { id: 's1', status: 'awaiting_review', appliedCount: 0, pendingCount: 0 } as never,
      appliedSummary: {},
      pendingSummary: {},
    });
    vi.spyOn(api, 'listBootstrapItems').mockResolvedValue([] as never);
    const finalizeSpy = vi
      .spyOn(api, 'finalizeBootstrap')
      .mockResolvedValue({ scan: { id: 's1', status: 'completed' } as never, mergedSummary: {} });
    vi.spyOn(api, 'listCorpus').mockResolvedValue([] as never);
    const onClose = vi.fn();
    render(<InitializeSpecsDialog projectId="p1" mode="rescan" onClose={onClose} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Finalize' })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Finalize' }));
    await waitFor(() => expect(finalizeSpy).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
