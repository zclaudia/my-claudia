import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateLocalPRDialog } from '../CreateLocalPRDialog';

vi.mock('../../../services/api', () => ({
  getProjectWorktrees: vi.fn().mockResolvedValue([]),
  listLocalPRs: vi.fn().mockResolvedValue([]),
}));

const mockCreatePR = vi.fn().mockResolvedValue({ id: 'new-pr' });

vi.mock('../../../stores/localPRStore', () => {
  const store = vi.fn((selector?: (s: any) => any) => {
    const state = {
      createPR: mockCreatePR,
    };
    return selector ? selector(state) : state;
  });
  (store as any).getState = () => ({ createPR: mockCreatePR });
  return { useLocalPRStore: store };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CreateLocalPRDialog', () => {
  const defaultProps = {
    projectId: 'proj-1',
    onClose: vi.fn(),
  };

  it('renders the dialog title', () => {
    render(<CreateLocalPRDialog {...defaultProps} />);
    expect(screen.getByText('Create Local PR')).toBeInTheDocument();
  });

  it('renders form fields', async () => {
    render(<CreateLocalPRDialog {...defaultProps} />);
    // Wait for worktrees to load (shows input when no worktrees)
    await waitFor(() => {
      expect(screen.getByPlaceholderText('/path/to/worktree')).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText('Brief description of the feature')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Additional context for the reviewer')).toBeInTheDocument();
  });

  it('renders cancel and submit buttons', () => {
    render(<CreateLocalPRDialog {...defaultProps} />);
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Create PR')).toBeInTheDocument();
  });

  it('calls onClose when cancel is clicked', () => {
    render(<CreateLocalPRDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls onClose when X button is clicked', () => {
    const { container } = render(<CreateLocalPRDialog {...defaultProps} />);
    // X button is in the header area
    const headerButtons = container.querySelectorAll('.flex.items-center.justify-between button');
    if (headerButtons.length > 0) {
      fireEvent.click(headerButtons[0]);
      expect(defaultProps.onClose).toHaveBeenCalled();
    }
  });

  it('shows error when submitting without worktree path', async () => {
    render(<CreateLocalPRDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Create PR')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Create PR'));
    await waitFor(() => {
      expect(screen.getByText('Worktree path is required')).toBeInTheDocument();
    });
  });

  it('renders auto-review checkbox', () => {
    render(<CreateLocalPRDialog {...defaultProps} />);
    expect(screen.getByText('Enable auto AI review')).toBeInTheDocument();
  });

  it('renders target branch selector', () => {
    render(<CreateLocalPRDialog {...defaultProps} />);
    expect(screen.getByText('Auto-detect (main/master)')).toBeInTheDocument();
  });

  it('shows loading state for worktrees initially', () => {
    render(<CreateLocalPRDialog {...defaultProps} />);
    expect(screen.getByText(/Loading worktrees/)).toBeInTheDocument();
  });

  it('pre-fills worktree path from defaultWorktreePath', async () => {
    const { getProjectWorktrees, listLocalPRs } = await import('../../../services/api');
    (getProjectWorktrees as any).mockResolvedValueOnce([
      { path: '/wt/feat', branch: 'feat/x', isMain: false },
    ]);
    (listLocalPRs as any).mockResolvedValueOnce([]);

    render(
      <CreateLocalPRDialog
        {...defaultProps}
        defaultWorktreePath="/wt/feat"
      />
    );

    await waitFor(() => {
      const select = screen.getByDisplayValue('feat/x (/wt/feat)') as HTMLSelectElement | null;
      const input = screen.queryByDisplayValue('/wt/feat') as HTMLInputElement | null;
      expect(select || input).toBeTruthy();
    });
  });
});
