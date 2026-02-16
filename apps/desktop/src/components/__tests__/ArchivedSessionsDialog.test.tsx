import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const mockGetArchivedSessions = vi.fn();
const mockRestoreSessions = vi.fn();
const mockDeleteSession = vi.fn();
const mockGetSessions = vi.fn();

vi.mock('../../services/api', () => ({
  getArchivedSessions: (...args: unknown[]) => mockGetArchivedSessions(...args),
  restoreSessions: (...args: unknown[]) => mockRestoreSessions(...args),
  deleteSession: (...args: unknown[]) => mockDeleteSession(...args),
  getSessions: (...args: unknown[]) => mockGetSessions(...args),
}));

let mockProjects = [
  { id: 'proj-1', name: 'Test Project' },
];

const mockSetSessions = vi.fn();
vi.mock('../../stores/projectStore', () => ({
  useProjectStore: Object.assign(
    (selector: (s: any) => any) => selector({ projects: mockProjects }),
    { getState: () => ({ setSessions: mockSetSessions }) }
  ),
}));

import { ArchivedSessionsDialog } from '../ArchivedSessionsDialog';

const mockArchivedSessions = [
  {
    id: 'sess-1',
    projectId: 'proj-1',
    name: 'Archived Session 1',
    archivedAt: Date.now() - 60000,
    createdAt: Date.now() - 300000,
    updatedAt: Date.now() - 60000,
  },
  {
    id: 'sess-2',
    projectId: 'proj-1',
    name: 'Archived Session 2',
    archivedAt: Date.now() - 3600000,
    createdAt: Date.now() - 600000,
    updatedAt: Date.now() - 3600000,
  },
];

describe('ArchivedSessionsDialog', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockProjects = [{ id: 'proj-1', name: 'Test Project' }];
    mockGetArchivedSessions.mockResolvedValue([]);
    mockRestoreSessions.mockResolvedValue(undefined);
    mockDeleteSession.mockResolvedValue(undefined);
    mockGetSessions.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('returns null when isOpen is false', () => {
    const { container } = render(
      <ArchivedSessionsDialog {...defaultProps} isOpen={false} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders "Archived Sessions" header when open', () => {
    render(<ArchivedSessionsDialog {...defaultProps} />);
    expect(screen.getByText('Archived Sessions')).toBeInTheDocument();
  });

  it('shows loading state while fetching', () => {
    let resolvePromise: (value: unknown) => void;
    mockGetArchivedSessions.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );

    render(<ArchivedSessionsDialog {...defaultProps} />);
    expect(screen.getByText('Loading archived sessions...')).toBeInTheDocument();

    // Resolve so the test can clean up
    resolvePromise!([]);
  });

  it('shows empty state "No archived sessions" when no sessions', async () => {
    mockGetArchivedSessions.mockResolvedValue([]);

    render(<ArchivedSessionsDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('No archived sessions')).toBeInTheDocument();
    });
  });

  it('renders session list after loading', async () => {
    mockGetArchivedSessions.mockResolvedValue(mockArchivedSessions);

    render(<ArchivedSessionsDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Archived Session 1')).toBeInTheDocument();
      expect(screen.getByText('Archived Session 2')).toBeInTheDocument();
    });
  });

  it('groups sessions by project name', async () => {
    mockGetArchivedSessions.mockResolvedValue(mockArchivedSessions);

    render(<ArchivedSessionsDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Test Project')).toBeInTheDocument();
    });
  });

  it('shows "Archived Xm ago" time text', async () => {
    mockGetArchivedSessions.mockResolvedValue(mockArchivedSessions);

    render(<ArchivedSessionsDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Archived 1m ago')).toBeInTheDocument();
      expect(screen.getByText('Archived 1h ago')).toBeInTheDocument();
    });
  });

  it('checkbox toggles selection', async () => {
    mockGetArchivedSessions.mockResolvedValue(mockArchivedSessions);

    render(<ArchivedSessionsDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Archived Session 1')).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).not.toBeChecked();

    fireEvent.click(checkboxes[0]);
    expect(checkboxes[0]).toBeChecked();

    fireEvent.click(checkboxes[0]);
    expect(checkboxes[0]).not.toBeChecked();
  });

  it('"Select All" button selects all sessions', async () => {
    mockGetArchivedSessions.mockResolvedValue(mockArchivedSessions);

    render(<ArchivedSessionsDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Archived Session 1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Select All'));

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).toBeChecked();
  });

  it('"Clear All" button deselects all', async () => {
    mockGetArchivedSessions.mockResolvedValue(mockArchivedSessions);

    render(<ArchivedSessionsDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Archived Session 1')).toBeInTheDocument();
    });

    // Select all first
    fireEvent.click(screen.getByText('Select All'));

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).toBeChecked();

    // Now the button should say "Clear All"
    fireEvent.click(screen.getByText('Clear All'));

    expect(checkboxes[0]).not.toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
  });

  it('shows "{n} selected" counter', async () => {
    mockGetArchivedSessions.mockResolvedValue(mockArchivedSessions);

    render(<ArchivedSessionsDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Archived Session 1')).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    expect(screen.getByText('1 selected')).toBeInTheDocument();

    fireEvent.click(checkboxes[1]);

    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('"Restore Selected" button calls restoreSessions with selected ids', async () => {
    mockGetArchivedSessions.mockResolvedValue(mockArchivedSessions);

    render(<ArchivedSessionsDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Archived Session 1')).toBeInTheDocument();
    });

    // Select first session
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    fireEvent.click(screen.getByText('Restore Selected'));

    await waitFor(() => {
      expect(mockRestoreSessions).toHaveBeenCalledWith(['sess-1']);
    });
  });

  it('after restore, session is removed from list', async () => {
    mockGetArchivedSessions.mockResolvedValue(mockArchivedSessions);

    render(<ArchivedSessionsDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Archived Session 1')).toBeInTheDocument();
    });

    // Select first session
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    fireEvent.click(screen.getByText('Restore Selected'));

    await waitFor(() => {
      expect(screen.queryByText('Archived Session 1')).not.toBeInTheDocument();
    });

    // Second session should still be present
    expect(screen.getByText('Archived Session 2')).toBeInTheDocument();
  });

  it('"Delete Forever" button calls deleteSession for each id', async () => {
    mockGetArchivedSessions.mockResolvedValue(mockArchivedSessions);

    render(<ArchivedSessionsDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Archived Session 1')).toBeInTheDocument();
    });

    // Select both sessions
    fireEvent.click(screen.getByText('Select All'));

    fireEvent.click(screen.getByText('Delete Forever'));

    await waitFor(() => {
      expect(mockDeleteSession).toHaveBeenCalledWith('sess-1');
      expect(mockDeleteSession).toHaveBeenCalledWith('sess-2');
      expect(mockDeleteSession).toHaveBeenCalledTimes(2);
    });
  });

  it('after delete, session is removed from list', async () => {
    mockGetArchivedSessions.mockResolvedValue(mockArchivedSessions);

    render(<ArchivedSessionsDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Archived Session 1')).toBeInTheDocument();
    });

    // Select first session
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    fireEvent.click(screen.getByText('Delete Forever'));

    await waitFor(() => {
      expect(screen.queryByText('Archived Session 1')).not.toBeInTheDocument();
    });

    // Second session should still be present
    expect(screen.getByText('Archived Session 2')).toBeInTheDocument();
  });

  it('shows error message when API fails', async () => {
    mockGetArchivedSessions.mockRejectedValue(new Error('Network error'));

    render(<ArchivedSessionsDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });
});
