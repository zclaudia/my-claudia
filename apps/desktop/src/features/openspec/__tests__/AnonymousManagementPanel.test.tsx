// apps/desktop/src/features/openspec/__tests__/AnonymousManagementPanel.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnonymousManagementPanel } from '../components/AnonymousManagementPanel.js';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';

function mkAnon(over: Partial<{ id: string; status: string; title: string }>) {
  return {
    id: over.id ?? 'a1',
    projectId: 'p1',
    title: over.title ?? 'A',
    status: over.status ?? 'open',
    priority: 'medium',
    labels: [],
    type: 'implement',
    isAnonymous: true,
    createdAt: 0,
    updatedAt: 0,
  } as never;
}

describe('AnonymousManagementPanel', () => {
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

  it('renders empty state', () => {
    render(<AnonymousManagementPanel projectId="p1" />);
    expect(screen.getByText(/No anonymous issues/)).toBeInTheDocument();
  });

  it('lists anonymous issues with counts header', () => {
    useOpenSpecStore.setState({
      issuesByProject: {
        p1: [
          mkAnon({ id: 'a1', status: 'open', title: 'A' }),
          mkAnon({ id: 'a2', status: 'closed', title: 'B' }),
        ],
      },
    } as never);
    render(<AnonymousManagementPanel projectId="p1" />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText(/1 open · 1 closed/)).toBeInTheDocument();
  });

  it('Select all open ticks all non-closed checkboxes', () => {
    useOpenSpecStore.setState({
      issuesByProject: {
        p1: [
          mkAnon({ id: 'a1', status: 'open' }),
          mkAnon({ id: 'a2', status: 'closed' }),
          mkAnon({ id: 'a3', status: 'open' }),
        ],
      },
    } as never);
    render(<AnonymousManagementPanel projectId="p1" />);
    fireEvent.click(screen.getByText(/Select all open/));
    const cancelBtn = screen.getByRole('button', { name: /Cancel selected/ });
    expect(cancelBtn.textContent).toContain('(2)');
  });

  it('Cancel selected calls transitionStatus for each picked', async () => {
    useOpenSpecStore.setState({
      issuesByProject: {
        p1: [mkAnon({ id: 'a1', status: 'open' }), mkAnon({ id: 'a2', status: 'open' })],
      },
    } as never);
    const spy = vi
      .spyOn(api, 'transitionStatus')
      .mockImplementation(async (id) => mkAnon({ id, status: 'cancelled' }));
    render(<AnonymousManagementPanel projectId="p1" />);
    fireEvent.click(screen.getByText(/Select all open/));
    fireEvent.click(screen.getByRole('button', { name: /Cancel selected/ }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy).toHaveBeenCalledWith('a1', 'cancelled');
    expect(spy).toHaveBeenCalledWith('a2', 'cancelled');
  });

  it('Cancel selected is disabled when nothing selected', () => {
    useOpenSpecStore.setState({
      issuesByProject: { p1: [mkAnon({ id: 'a1' })] },
    } as never);
    render(<AnonymousManagementPanel projectId="p1" />);
    expect(screen.getByRole('button', { name: /Cancel selected/ })).toBeDisabled();
  });
});
