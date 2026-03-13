import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LocalPRsPanel } from '../LocalPRsPanel';
import type { LocalPR } from '@my-claudia/shared';

vi.mock('../../../hooks/useMediaQuery', () => ({
  useIsMobile: () => false,
}));

vi.mock('../../../services/api', () => ({
  getProjectWorktrees: vi.fn().mockResolvedValue([]),
  getWorktreeConfigs: vi.fn().mockResolvedValue([]),
  precheckLocalPRCreation: vi.fn().mockResolvedValue({ canCreate: true }),
  upsertWorktreeConfig: vi.fn().mockResolvedValue(undefined),
}));

const mockLoadPRs = vi.fn().mockResolvedValue(undefined);
const mockCreatePR = vi.fn().mockResolvedValue({ id: 'new-pr' });
let mockPRs: Record<string, LocalPR[]> = {};

vi.mock('../../../stores/localPRStore', () => {
  const store = vi.fn((selector?: (s: any) => any) => {
    const state = {
      prs: mockPRs,
      loadPRs: mockLoadPRs,
      createPR: mockCreatePR,
    };
    return selector ? selector(state) : state;
  });
  (store as any).getState = () => ({
    prs: mockPRs,
    loadPRs: mockLoadPRs,
    createPR: mockCreatePR,
  });
  return { useLocalPRStore: store };
});

vi.mock('../LocalPRCard', () => ({
  LocalPRCard: (props: any) => <div data-testid={`pr-card-${props.pr.id}`}>{props.pr.title}</div>,
}));

vi.mock('../CreateLocalPRDialog', () => ({
  CreateLocalPRDialog: (props: any) => (
    <div data-testid="create-dialog">
      <button onClick={props.onClose}>Close Dialog</button>
    </div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockPRs = {};
});

describe('LocalPRsPanel', () => {
  it('renders the header with title', () => {
    render(<LocalPRsPanel projectId="proj-1" />);
    expect(screen.getByText('Local Pull Requests')).toBeInTheDocument();
  });

  it('renders New PR button', () => {
    render(<LocalPRsPanel projectId="proj-1" />);
    expect(screen.getByText('New PR')).toBeInTheDocument();
  });

  it('calls loadPRs on mount', () => {
    render(<LocalPRsPanel projectId="proj-1" />);
    expect(mockLoadPRs).toHaveBeenCalledWith('proj-1');
  });

  it('shows empty state when no PRs exist', async () => {
    const { container } = render(<LocalPRsPanel projectId="proj-1" />);
    // Wait for loading to finish
    await vi.waitFor(() => {
      expect(container.textContent).toContain('No local pull requests yet');
    });
  });

  it('renders PR cards when PRs exist', () => {
    mockPRs = {
      'proj-1': [
        {
          id: 'pr-1',
          projectId: 'proj-1',
          worktreePath: '/wt/feat',
          branchName: 'feat/a',
          baseBranch: 'main',
          title: 'Feature A',
          status: 'open',
          executionState: 'idle',
          autoTriggered: false,
          autoReview: false,
          commits: [],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        } as LocalPR,
      ],
    };
    render(<LocalPRsPanel projectId="proj-1" />);
    expect(screen.getByTestId('pr-card-pr-1')).toBeInTheDocument();
    expect(screen.getByText('Feature A')).toBeInTheDocument();
  });

  it('opens create dialog when New PR button is clicked', () => {
    render(<LocalPRsPanel projectId="proj-1" />);
    fireEvent.click(screen.getByText('New PR'));
    expect(screen.getByTestId('create-dialog')).toBeInTheDocument();
  });

  it('shows active PR count badge', () => {
    mockPRs = {
      'proj-1': [
        {
          id: 'pr-1',
          projectId: 'proj-1',
          worktreePath: '/wt/feat',
          branchName: 'feat/a',
          baseBranch: 'main',
          title: 'Feature A',
          status: 'open',
          executionState: 'idle',
          autoTriggered: false,
          autoReview: false,
          commits: [],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        } as LocalPR,
      ],
    };
    const { container } = render(<LocalPRsPanel projectId="proj-1" />);
    // Active PRs badge should show "1"
    expect(container.textContent).toContain('1');
  });

  it('does not count merged/closed PRs in active badge', async () => {
    mockPRs = {
      'proj-1': [
        {
          id: 'pr-1',
          projectId: 'proj-1',
          worktreePath: '/wt/feat',
          branchName: 'feat/a',
          baseBranch: 'main',
          title: 'Feature A',
          status: 'merged',
          executionState: 'idle',
          autoTriggered: false,
          autoReview: false,
          commits: [],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        } as LocalPR,
      ],
    };
    const { container } = render(<LocalPRsPanel projectId="proj-1" />);
    await vi.waitFor(() => {
      // No active PRs badge should be shown (only merged/closed)
      const badge = container.querySelector('.bg-primary\\/20');
      expect(badge).toBeNull();
    });
  });

  it('groups PRs by status', async () => {
    mockPRs = {
      'proj-1': [
        {
          id: 'pr-1',
          projectId: 'proj-1',
          worktreePath: '/wt/feat',
          branchName: 'feat/a',
          baseBranch: 'main',
          title: 'Feature A',
          status: 'open',
          executionState: 'idle',
          autoTriggered: false,
          autoReview: false,
          commits: [],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        } as LocalPR,
        {
          id: 'pr-2',
          projectId: 'proj-1',
          worktreePath: '/wt/feat2',
          branchName: 'feat/b',
          baseBranch: 'main',
          title: 'Feature B',
          status: 'approved',
          executionState: 'idle',
          autoTriggered: false,
          autoReview: false,
          commits: [],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        } as LocalPR,
      ],
    };
    render(<LocalPRsPanel projectId="proj-1" />);
    await vi.waitFor(() => {
      expect(screen.getByTestId('pr-card-pr-1')).toBeInTheDocument();
      expect(screen.getByTestId('pr-card-pr-2')).toBeInTheDocument();
    });
  });

  it('shows worktrees section when worktrees exist', async () => {
    const api = await import('../../../services/api');
    (api.getProjectWorktrees as any).mockResolvedValueOnce([
      { path: '/wt/feat', branch: 'feat/a', isMain: false },
    ]);
    render(<LocalPRsPanel projectId="proj-1" />);
    await vi.waitFor(() => {
      expect(screen.getByText('Worktrees')).toBeInTheDocument();
    });
  });

  it('calls createPR when quick create is clicked', async () => {
    const api = await import('../../../services/api');
    (api.getProjectWorktrees as any).mockResolvedValueOnce([
      { path: '/wt/feat', branch: 'feat/a', isMain: false },
    ]);
    (api.getWorktreeConfigs as any).mockResolvedValueOnce([
      { worktreePath: '/wt/feat', autoCreatePR: false, autoReview: false },
    ]);
    (api.precheckLocalPRCreation as any).mockResolvedValueOnce({ canCreate: true });

    render(<LocalPRsPanel projectId="proj-1" />);
    await vi.waitFor(() => {
      expect(screen.getByText('Create PR')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Create PR'));
    await vi.waitFor(() => {
      expect(mockCreatePR).toHaveBeenCalledWith('proj-1', '/wt/feat', { autoReview: undefined });
    });
  });

  it('closes create dialog when onClose is called', async () => {
    render(<LocalPRsPanel projectId="proj-1" />);
    fireEvent.click(screen.getByText('New PR'));
    expect(screen.getByTestId('create-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Close Dialog'));
    expect(screen.queryByTestId('create-dialog')).not.toBeInTheDocument();
  });

  it('calls getProjectWorktrees on mount', async () => {
    const api = await import('../../../services/api');
    render(<LocalPRsPanel projectId="proj-1" />);
    await vi.waitFor(() => {
      expect(api.getProjectWorktrees).toHaveBeenCalledWith('proj-1');
    });
  });

  it('calls getWorktreeConfigs on mount', async () => {
    const api = await import('../../../services/api');
    render(<LocalPRsPanel projectId="proj-1" />);
    await vi.waitFor(() => {
      expect(api.getWorktreeConfigs).toHaveBeenCalledWith('proj-1');
    });
  });

  it('handles worktree config toggle', async () => {
    const api = await import('../../../services/api');
    (api.getProjectWorktrees as any).mockResolvedValueOnce([
      { path: '/wt/feat', branch: 'feat/a', isMain: false },
    ]);
    (api.getWorktreeConfigs as any).mockResolvedValueOnce([
      { worktreePath: '/wt/feat', autoCreatePR: false, autoReview: false },
    ]);
    (api.precheckLocalPRCreation as any).mockResolvedValueOnce({ canCreate: true });

    render(<LocalPRsPanel projectId="proj-1" />);
    await vi.waitFor(() => {
      expect(screen.getByText('Auto Create PR')).toBeInTheDocument();
    });
    const checkbox = screen.getByRole('checkbox', { name: /auto create pr/i });
    fireEvent.click(checkbox);
    await vi.waitFor(() => {
      expect(api.upsertWorktreeConfig).toHaveBeenCalled();
    });
  });

  it('shows loading state initially', () => {
    // Mock loadPRs to never resolve
    mockLoadPRs.mockImplementation(() => new Promise(() => {}));
    const { container } = render(<LocalPRsPanel projectId="proj-1" />);
    expect(container.textContent).toContain('Loading');
  });
});
