import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LocalPRCard } from '../LocalPRCard';
import type { LocalPR } from '@my-claudia/shared';

vi.mock('../../../hooks/useMediaQuery', () => ({
  useIsMobile: () => false,
}));

vi.mock('../../../services/api', () => ({
  getSessions: vi.fn().mockResolvedValue([]),
  cancelLocalPRQueue: vi.fn().mockResolvedValue(undefined),
  retryLocalPR: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../DiffViewerModal', () => ({
  DiffViewerModal: (props: any) => <div data-testid="diff-modal">Diff: {props.title}</div>,
}));

const mockClosePR = vi.fn().mockResolvedValue(undefined);
const mockReviewPR = vi.fn().mockResolvedValue(undefined);
const mockMergePR = vi.fn().mockResolvedValue(undefined);
const mockCancelMergePR = vi.fn().mockResolvedValue(undefined);
const mockResolveConflictPR = vi.fn().mockResolvedValue(undefined);
const mockReopenPR = vi.fn().mockResolvedValue(undefined);
const mockRevertMergedPR = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../stores/localPRStore', () => {
  const store = vi.fn((selector?: (s: any) => any) => {
    const state = {
      closePR: mockClosePR,
      reviewPR: mockReviewPR,
      mergePR: mockMergePR,
      cancelMergePR: mockCancelMergePR,
      resolveConflictPR: mockResolveConflictPR,
      reopenPR: mockReopenPR,
      revertMergedPR: mockRevertMergedPR,
    };
    return selector ? selector(state) : state;
  });
  (store as any).getState = () => ({});
  return { useLocalPRStore: store };
});

const mockSelectSession = vi.fn();

vi.mock('../../../stores/projectStore', () => {
  const store = vi.fn((selector?: (s: any) => any) => {
    const state = {
      providers: [],
      projects: [{ id: 'proj-1', providerId: 'prov-1' }],
      sessions: [],
      selectSession: mockSelectSession,
    };
    return selector ? selector(state) : state;
  });
  (store as any).getState = () => ({
    setDashboardView: vi.fn(),
    mergeSessions: vi.fn(),
    sessions: [],
  });
  return { useProjectStore: store };
});

beforeEach(() => {
  vi.clearAllMocks();
});

function createPR(overrides: Partial<LocalPR> = {}): LocalPR {
  return {
    id: 'pr-1',
    projectId: 'proj-1',
    worktreePath: '/worktree/feat-1',
    branchName: 'feat/my-feature',
    baseBranch: 'main',
    title: 'Add my feature',
    description: '',
    status: 'open',
    executionState: 'idle',
    autoTriggered: false,
    autoReview: false,
    commits: [{ hash: 'abc123', message: 'init', date: '2026-01-01' }],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as LocalPR;
}

describe('LocalPRCard', () => {
  it('renders PR title and status', () => {
    const pr = createPR();
    render(<LocalPRCard pr={pr} projectId="proj-1" />);
    expect(screen.getByText('Add my feature')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('renders branch info and commit count', () => {
    const pr = createPR();
    const { container } = render(<LocalPRCard pr={pr} projectId="proj-1" />);
    expect(container.textContent).toContain('my-feature');
    expect(container.textContent).toContain('main');
    expect(container.textContent).toContain('1 commit');
  });

  it('shows auto badge when autoTriggered', () => {
    const pr = createPR({ autoTriggered: true });
    render(<LocalPRCard pr={pr} projectId="proj-1" />);
    expect(screen.getByText('auto')).toBeInTheDocument();
  });

  it('shows auto-review badge when autoReview', () => {
    const pr = createPR({ autoReview: true });
    render(<LocalPRCard pr={pr} projectId="proj-1" />);
    expect(screen.getByText('auto-review')).toBeInTheDocument();
  });

  it('shows status message when present', () => {
    const pr = createPR({ statusMessage: 'Waiting for review...' });
    render(<LocalPRCard pr={pr} projectId="proj-1" />);
    expect(screen.getByText('Waiting for review...')).toBeInTheDocument();
  });

  it('renders close button for open PR', () => {
    const pr = createPR({ status: 'open' });
    const { container } = render(<LocalPRCard pr={pr} projectId="proj-1" />);
    const closeBtn = container.querySelector('button[title="Close PR"]');
    expect(closeBtn).toBeInTheDocument();
  });

  it('renders merge button for approved PR', () => {
    const pr = createPR({ status: 'approved' });
    const { container } = render(<LocalPRCard pr={pr} projectId="proj-1" />);
    const mergeBtn = container.querySelector('button[title="Merge now"]');
    expect(mergeBtn).toBeInTheDocument();
  });

  it('renders revert button for merged PR', () => {
    const pr = createPR({ status: 'merged' });
    const { container } = render(<LocalPRCard pr={pr} projectId="proj-1" />);
    const revertBtn = container.querySelector('button[title="Revert merge"]');
    expect(revertBtn).toBeInTheDocument();
  });

  it('renders reopen button for closed PR', () => {
    const pr = createPR({ status: 'closed' });
    const { container } = render(<LocalPRCard pr={pr} projectId="proj-1" />);
    const reopenBtn = container.querySelector('button[title="Reopen PR"]');
    expect(reopenBtn).toBeInTheDocument();
  });

  it('shows execution state when not idle', () => {
    const pr = createPR({ executionState: 'running' });
    render(<LocalPRCard pr={pr} projectId="proj-1" />);
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('shows review session link when reviewSessionId exists', () => {
    const pr = createPR({ reviewSessionId: 'session-1' });
    render(<LocalPRCard pr={pr} projectId="proj-1" />);
    expect(screen.getByText('View review session')).toBeInTheDocument();
  });

  it('shows conflict session link when conflictSessionId exists', () => {
    const pr = createPR({ conflictSessionId: 'session-2' });
    render(<LocalPRCard pr={pr} projectId="proj-1" />);
    expect(screen.getByText('View conflict session')).toBeInTheDocument();
  });

  it('shows review notes toggle when reviewNotes exists', () => {
    const pr = createPR({ reviewNotes: 'Looks good overall' });
    render(<LocalPRCard pr={pr} projectId="proj-1" />);
    expect(screen.getByText('Review notes')).toBeInTheDocument();
  });

  it('renders cancel and retry buttons for merging status', () => {
    const pr = createPR({ status: 'merging' });
    const { container } = render(<LocalPRCard pr={pr} projectId="proj-1" />);
    const cancelBtn = container.querySelector('button[title="Cancel merge"]');
    const retryBtn = container.querySelector('button[title="Cancel and retry"]');
    expect(cancelBtn).toBeInTheDocument();
    expect(retryBtn).toBeInTheDocument();
  });

  it('renders resolve with AI button for conflict status', () => {
    const pr = createPR({ status: 'conflict' });
    const { container } = render(<LocalPRCard pr={pr} projectId="proj-1" />);
    const resolveBtn = container.querySelector('button[title="Resolve with AI"]');
    expect(resolveBtn).toBeInTheDocument();
  });

  it('calls closePR when close button is clicked', async () => {
    const pr = createPR({ status: 'open' });
    const { container } = render(<LocalPRCard pr={pr} projectId="proj-1" />);
    const closeBtn = container.querySelector('button[title="Close PR"]') as HTMLButtonElement;
    fireEvent.click(closeBtn);
    await waitFor(() => {
      expect(mockClosePR).toHaveBeenCalledWith('pr-1', 'proj-1');
    });
  });

  it('calls mergePR when merge button is clicked', async () => {
    const pr = createPR({ status: 'approved' });
    const { container } = render(<LocalPRCard pr={pr} projectId="proj-1" />);
    const mergeBtn = container.querySelector('button[title="Merge now"]') as HTMLButtonElement;
    fireEvent.click(mergeBtn);
    await waitFor(() => {
      expect(mockMergePR).toHaveBeenCalledWith('pr-1', 'proj-1');
    });
  });

  it('calls reopenPR when reopen button is clicked', async () => {
    const pr = createPR({ status: 'closed' });
    const { container } = render(<LocalPRCard pr={pr} projectId="proj-1" />);
    const reopenBtn = container.querySelector('button[title="Reopen PR"]') as HTMLButtonElement;
    fireEvent.click(reopenBtn);
    await waitFor(() => {
      expect(mockReopenPR).toHaveBeenCalledWith('pr-1', 'proj-1');
    });
  });

  it('calls revertMergedPR when revert button is clicked', async () => {
    const pr = createPR({ status: 'merged' });
    const { container } = render(<LocalPRCard pr={pr} projectId="proj-1" />);
    const revertBtn = container.querySelector('button[title="Revert merge"]') as HTMLButtonElement;
    fireEvent.click(revertBtn);
    await waitFor(() => {
      expect(mockRevertMergedPR).toHaveBeenCalledWith('pr-1', 'proj-1');
    });
  });

  it('calls resolveConflictPR when resolve AI button is clicked', async () => {
    const pr = createPR({ status: 'conflict' });
    const { container } = render(<LocalPRCard pr={pr} projectId="proj-1" />);
    const resolveBtn = container.querySelector('button[title="Resolve with AI"]') as HTMLButtonElement;
    fireEvent.click(resolveBtn);
    await waitFor(() => {
      expect(mockResolveConflictPR).toHaveBeenCalledWith('pr-1', 'proj-1');
    });
  });

  it('toggles review notes visibility when notes button is clicked', async () => {
    const pr = createPR({ reviewNotes: 'LGTM! Minor comments below.' });
    render(<LocalPRCard pr={pr} projectId="proj-1" />);
    fireEvent.click(screen.getByText('Review notes'));
    await waitFor(() => {
      expect(screen.getByText('LGTM! Minor comments below.')).toBeInTheDocument();
    });
    // Click again to close
    fireEvent.click(screen.getByText('Review notes'));
  });

  it('shows review button for review_failed status', () => {
    const pr = createPR({ status: 'review_failed' });
    const { container } = render(<LocalPRCard pr={pr} projectId="proj-1" />);
    // canReview is true for open and review_failed statuses
    const reviewBtn = container.querySelector('button[title="AI Review"]');
    expect(reviewBtn).toBeInTheDocument();
  });

  it('shows cancel queue button for queued execution state', () => {
    const pr = createPR({ executionState: 'queued' });
    const { container } = render(<LocalPRCard pr={pr} projectId="proj-1" />);
    const cancelQueueBtn = container.querySelector('button[title="Cancel queue"]');
    expect(cancelQueueBtn).toBeInTheDocument();
  });

  it('shows queued execution state badge', () => {
    const pr = createPR({ executionState: 'queued' });
    render(<LocalPRCard pr={pr} projectId="proj-1" />);
    expect(screen.getByText('Queued')).toBeInTheDocument();
  });

  it('shows failed execution state badge', () => {
    const pr = createPR({ executionState: 'failed' });
    render(<LocalPRCard pr={pr} projectId="proj-1" />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('shows error message when action fails', async () => {
    mockClosePR.mockRejectedValueOnce(new Error('Network error'));
    const pr = createPR({ status: 'open' });
    const { container } = render(<LocalPRCard pr={pr} projectId="proj-1" />);
    const closeBtn = container.querySelector('button[title="Close PR"]') as HTMLButtonElement;
    fireEvent.click(closeBtn);
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('shows reviewing status badge', () => {
    const pr = createPR({ status: 'reviewing' });
    render(<LocalPRCard pr={pr} projectId="proj-1" />);
    expect(screen.getByText('Reviewing')).toBeInTheDocument();
  });

  it('shows review failed status badge', () => {
    const pr = createPR({ status: 'review_failed' });
    render(<LocalPRCard pr={pr} projectId="proj-1" />);
    expect(screen.getByText('Review Failed')).toBeInTheDocument();
  });

  it('displays multiple commits text', () => {
    const pr = createPR({
      commits: [
        { hash: 'abc', message: 'feat 1', date: '2026-01-01' },
        { hash: 'def', message: 'feat 2', date: '2026-01-02' },
        { hash: 'ghi', message: 'feat 3', date: '2026-01-03' },
      ],
    });
    const { container } = render(<LocalPRCard pr={pr} projectId="proj-1" />);
    expect(container.textContent).toContain('3 commits');
  });

  it('calls cancelMergePR when cancel merge button is clicked', async () => {
    const pr = createPR({ status: 'merging' });
    const { container } = render(<LocalPRCard pr={pr} projectId="proj-1" />);
    const cancelBtn = container.querySelector('button[title="Cancel merge"]') as HTMLButtonElement;
    fireEvent.click(cancelBtn);
    await waitFor(() => {
      expect(mockCancelMergePR).toHaveBeenCalledWith('pr-1', 'proj-1');
    });
  });

  it('calls cancelMergePR and mergePR when cancel and retry button is clicked', async () => {
    const pr = createPR({ status: 'merging' });
    const { container } = render(<LocalPRCard pr={pr} projectId="proj-1" />);
    const retryBtn = container.querySelector('button[title="Cancel and retry"]') as HTMLButtonElement;
    fireEvent.click(retryBtn);
    await waitFor(() => {
      expect(mockCancelMergePR).toHaveBeenCalledWith('pr-1', 'proj-1');
      expect(mockMergePR).toHaveBeenCalledWith('pr-1', 'proj-1');
    });
  });

  it('calls reviewPR when review button is clicked', async () => {
    const pr = createPR({ status: 'open' });
    const { container } = render(<LocalPRCard pr={pr} projectId="proj-1" />);
    const reviewBtn = container.querySelector('button[title="AI Review"]') as HTMLButtonElement;
    fireEvent.click(reviewBtn);
    // Opens review picker
    await waitFor(() => {
      expect(screen.getByText('Review with:')).toBeInTheDocument();
    });
    // Click default provider option - the text includes "Default" with optional provider name
    const defaultBtn = screen.getByRole('button', { name: /Default/ });
    fireEvent.click(defaultBtn);
    await waitFor(() => {
      // The default provider ID comes from project.providerId in the mock which is 'prov-1'
      expect(mockReviewPR).toHaveBeenCalledWith('pr-1', 'proj-1', 'prov-1');
    });
  });

  it('shows loading spinner when action is in progress', async () => {
    mockClosePR.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));
    const pr = createPR({ status: 'open' });
    const { container } = render(<LocalPRCard pr={pr} projectId="proj-1" />);
    const closeBtn = container.querySelector('button[title="Close PR"]') as HTMLButtonElement;
    fireEvent.click(closeBtn);
    // Button should be disabled during loading
    expect(closeBtn).toBeDisabled();
  });

  it('renders diff viewer when view diff is clicked', async () => {
    const pr = createPR({ diffSummary: 'diff --git a/file.ts b/file.ts\n+added line' });
    const { container } = render(<LocalPRCard pr={pr} projectId="proj-1" />);
    const viewDiffBtn = container.querySelector('button');
    fireEvent.click(screen.getByText('View diff'));
    expect(screen.getByTestId('diff-modal')).toBeInTheDocument();
  });

  it('shows open status badge', () => {
    const pr = createPR({ status: 'open' });
    render(<LocalPRCard pr={pr} projectId="proj-1" />);
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('shows merging status badge', () => {
    const pr = createPR({ status: 'merging' });
    render(<LocalPRCard pr={pr} projectId="proj-1" />);
    expect(screen.getByText('Merging')).toBeInTheDocument();
  });

  it('shows approved status badge', () => {
    const pr = createPR({ status: 'approved' });
    render(<LocalPRCard pr={pr} projectId="proj-1" />);
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('shows merged status badge', () => {
    const pr = createPR({ status: 'merged' });
    render(<LocalPRCard pr={pr} projectId="proj-1" />);
    expect(screen.getByText('Merged')).toBeInTheDocument();
  });

  it('shows closed status badge', () => {
    const pr = createPR({ status: 'closed' });
    render(<LocalPRCard pr={pr} projectId="proj-1" />);
    expect(screen.getByText('Closed')).toBeInTheDocument();
  });

  it('shows conflict status badge', () => {
    const pr = createPR({ status: 'conflict' });
    render(<LocalPRCard pr={pr} projectId="proj-1" />);
    expect(screen.getByText('Conflict')).toBeInTheDocument();
  });

  it('handles error with non-Error object', async () => {
    mockClosePR.mockRejectedValueOnce('string error');
    const pr = createPR({ status: 'open' });
    const { container } = render(<LocalPRCard pr={pr} projectId="proj-1" />);
    const closeBtn = container.querySelector('button[title="Close PR"]') as HTMLButtonElement;
    fireEvent.click(closeBtn);
    await waitFor(() => {
      expect(screen.getByText('Failed to close PR')).toBeInTheDocument();
    });
  });

  it('renders review picker with providers', async () => {
    const { useProjectStore } = await import('../../../stores/projectStore');
    (useProjectStore as any).mockImplementation((selector?: (s: any) => any) => {
      const state = {
        providers: [
          { id: 'prov-1', name: 'Claude', type: 'anthropic' },
          { id: 'prov-2', name: 'GPT-4', type: 'openai' },
        ],
        projects: [{ id: 'proj-1', providerId: 'prov-1', reviewProviderId: 'prov-1' }],
        sessions: [],
        selectSession: mockSelectSession,
      };
      return selector ? selector(state) : state;
    });

    const pr = createPR({ status: 'open' });
    const { container } = render(<LocalPRCard pr={pr} projectId="proj-1" />);
    const reviewBtn = container.querySelector('button[title="AI Review"]') as HTMLButtonElement;
    fireEvent.click(reviewBtn);
    await waitFor(() => {
      expect(screen.getByText('Review with:')).toBeInTheDocument();
    });
    // Check for provider names in the picker
    expect(screen.getByRole('button', { name: /Claude/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /GPT-4/ })).toBeInTheDocument();
  });

  it('calls cancelLocalPRQueue when cancel queue button is clicked', async () => {
    const api = await import('../../../services/api');
    const pr = createPR({ executionState: 'queued' });
    const { container } = render(<LocalPRCard pr={pr} projectId="proj-1" />);
    const cancelBtn = container.querySelector('button[title="Cancel queue"]') as HTMLButtonElement;
    fireEvent.click(cancelBtn);
    await waitFor(() => {
      expect(api.cancelLocalPRQueue).toHaveBeenCalledWith('pr-1');
    });
  });

  it('calls retryLocalPR when retry button is clicked', async () => {
    const api = await import('../../../services/api');
    const pr = createPR({ executionState: 'failed' });
    const { container } = render(<LocalPRCard pr={pr} projectId="proj-1" />);
    const retryBtn = container.querySelector('button[title="Retry"]') as HTMLButtonElement;
    fireEvent.click(retryBtn);
    await waitFor(() => {
      expect(api.retryLocalPR).toHaveBeenCalledWith('pr-1');
    });
  });
});
