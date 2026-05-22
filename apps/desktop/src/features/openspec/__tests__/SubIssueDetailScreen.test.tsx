// apps/desktop/src/features/openspec/__tests__/SubIssueDetailScreen.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SubIssueDetailScreen } from '../components/SubIssueDetailScreen.js';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';

function mkIssue(over: Record<string, unknown>) {
  return {
    id: 's',
    projectId: 'p1',
    title: 'S',
    status: 'open',
    priority: 'medium',
    labels: [],
    type: 'implement',
    isAnonymous: false,
    parentIssueId: undefined,
    specChangeId: 'sc1',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as never;
}

describe('SubIssueDetailScreen', () => {
  beforeEach(() => {
    useOpenSpecStore.setState({
      issuesByProject: {},
      specChangesById: {},
      executorsBySpecChange: {},
      corpusByProject: {},
      viewByProject: {},
    });
    vi.restoreAllMocks();
    vi.spyOn(api, 'getSpecChange').mockResolvedValue({
      id: 'sc1',
      slug: 'x',
      status: 'drafting',
    } as never);
    vi.spyOn(api, 'listExecutors').mockResolvedValue([]);
  });

  it('renders title + breadcrumb', () => {
    useOpenSpecStore.setState({
      issuesByProject: { p1: [mkIssue({ id: 's', title: 'My Change' })] },
    } as never);
    render(<SubIssueDetailScreen projectId="p1" subIssueId="s" />);
    // Title appears in both the breadcrumb and the <h3> heading.
    expect(screen.getAllByText('My Change').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'My Change' })).toBeInTheDocument();
  });

  it('shows "→ planning" button for open issue', () => {
    useOpenSpecStore.setState({
      issuesByProject: { p1: [mkIssue({ id: 's', status: 'open' })] },
    } as never);
    render(<SubIssueDetailScreen projectId="p1" subIssueId="s" />);
    expect(screen.getByRole('button', { name: /→ planning/ })).toBeInTheDocument();
  });

  it('shows Close & Archive when status=reviewing', () => {
    useOpenSpecStore.setState({
      issuesByProject: { p1: [mkIssue({ id: 's', status: 'reviewing' })] },
    } as never);
    render(<SubIssueDetailScreen projectId="p1" subIssueId="s" />);
    expect(screen.getByRole('button', { name: /Close & Archive/ })).toBeInTheDocument();
  });

  it('clicking Close & Archive opens the confirm dialog', () => {
    useOpenSpecStore.setState({
      issuesByProject: { p1: [mkIssue({ id: 's', status: 'reviewing' })] },
    } as never);
    render(<SubIssueDetailScreen projectId="p1" subIssueId="s" />);
    fireEvent.click(screen.getByRole('button', { name: /Close & Archive/ }));
    expect(useOpenSpecStore.getState().viewByProject.p1.showArchiveConfirm).toBe(true);
  });

  it('clicking Manual Executor + button calls createExecutor', async () => {
    useOpenSpecStore.setState({
      issuesByProject: { p1: [mkIssue({ id: 's' })] },
    } as never);
    const spy = vi.spyOn(api, 'createExecutor').mockResolvedValue({
      id: 'e1',
      projectId: 'p1',
      specChangeId: 'sc1',
      type: 'manual',
      statusSummary: 'pending',
      createdAt: 0,
      updatedAt: 0,
    } as never);
    render(<SubIssueDetailScreen projectId="p1" subIssueId="s" />);
    fireEvent.click(screen.getByRole('button', { name: /\+ Manual Executor/ }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
  });
});
