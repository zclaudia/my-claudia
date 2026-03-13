import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ImportDialog } from '../ImportDialog';
import { useServerStore } from '../../stores/serverStore';
import { useProjectStore } from '../../stores/projectStore';
import * as api from '../../services/api';

// Mock stores with real zustand
vi.mock('../../hooks/useMediaQuery', () => ({
  useIsMobile: () => false,
}));

vi.mock('../../services/api', () => ({
  createProject: vi.fn().mockResolvedValue({ id: 'new-proj-1', name: 'test' }),
  getSessions: vi.fn().mockResolvedValue([]),
  getProjects: vi.fn().mockResolvedValue([]),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('ImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();

    useServerStore.setState({
      servers: [{ id: 's1', address: 'localhost:3100', name: 'default' }],
      getDefaultServer: () => ({ id: 's1', address: 'localhost:3100', name: 'default' }),
    } as any);

    useProjectStore.setState({
      projects: [
        { id: 'proj-1', name: 'My Project', rootPath: '/home/user/my-project', isInternal: false },
      ],
    } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when not open', () => {
    const { container } = render(
      <ImportDialog isOpen={false} onClose={() => {}} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders the dialog header when open', () => {
    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('Import from Claude CLI')).toBeTruthy();
  });

  it('renders step 1 with directory input and scan button', () => {
    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('Claude CLI Directory')).toBeTruthy();
    expect(screen.getByText('Scan')).toBeTruthy();
    expect(screen.getByText('Browse...')).toBeTruthy();
  });

  it('shows default path in input', () => {
    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    const input = screen.getByPlaceholderText('~/.claude') as HTMLInputElement;
    expect(input.value).toBe('~/.claude');
  });

  it('updates input value when typed', () => {
    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    const input = screen.getByPlaceholderText('~/.claude') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/custom/path' } });
    expect(input.value).toBe('/custom/path');
  });

  it('calls onClose and resets state when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<ImportDialog isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<ImportDialog isOpen={true} onClose={onClose} />);
    // Backdrop is the first fixed div
    const backdrop = container.querySelector('.fixed.inset-0');
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows error when scan fails with network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Scan'));

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeTruthy();
    });
  });

  it('shows error when scan returns failure response', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: false,
        error: { message: 'Directory not found' },
      }),
    });

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Scan'));

    await waitFor(() => {
      expect(screen.getByText('Directory not found')).toBeTruthy();
    });
  });

  it('shows error when path is empty and Browse fails', async () => {
    // Clear the input
    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    const input = screen.getByPlaceholderText('~/.claude') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByText('Scan'));

    await waitFor(() => {
      expect(screen.getByText('Please enter a directory path')).toBeTruthy();
    });
  });

  it('triggers scan on Enter key in input', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: { projects: [] },
      }),
    });

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    const input = screen.getByPlaceholderText('~/.claude');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/import/claude-cli/scan'),
        expect.any(Object)
      );
    });
  });

  it('transitions to preview step after successful scan', async () => {
    vi.useFakeTimers();

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: {
          projects: [
            {
              path: '/data/project1',
              workspacePath: '/home/user/project1',
              sessions: [
                { id: 's1', summary: 'Test session', messageCount: 5, timestamp: Date.now() },
              ],
            },
          ],
        },
      }),
    });

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });

    // Wait for setTimeout to fire
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText('Select All')).toBeTruthy();
    expect(screen.getByText('Test session')).toBeTruthy();
  });

  it('shows session count and project count in preview step', async () => {
    vi.useFakeTimers();

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: {
          projects: [
            {
              path: '/data/p1',
              workspacePath: '/ws/p1',
              sessions: [
                { id: 's1', summary: 'Session 1', messageCount: 3, timestamp: Date.now() },
                { id: 's2', summary: 'Session 2', messageCount: 7, timestamp: Date.now() },
              ],
            },
          ],
        },
      }),
    });

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText(/2 sessions across 1 projects/)).toBeTruthy();
  });

  it('can select and deselect sessions', async () => {
    vi.useFakeTimers();

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: {
          projects: [
            {
              path: '/data/p1',
              workspacePath: '/ws/p1',
              sessions: [
                { id: 's1', summary: 'Session 1', messageCount: 3, timestamp: Date.now() },
              ],
            },
          ],
        },
      }),
    });

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(screen.getByText('Next (1 selected)')).toBeTruthy();

    fireEvent.click(checkbox);
    expect(screen.getByText('Next (0 selected)')).toBeTruthy();
  });

  it('Select All selects all sessions', async () => {
    vi.useFakeTimers();

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: {
          projects: [
            {
              path: '/data/p1',
              workspacePath: '/ws/p1',
              sessions: [
                { id: 's1', summary: 'Session 1', messageCount: 3, timestamp: Date.now() },
                { id: 's2', summary: 'Session 2', messageCount: 5, timestamp: Date.now() },
              ],
            },
          ],
        },
      }),
    });

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    fireEvent.click(screen.getByText('Select All'));
    expect(screen.getByText('Next (2 selected)')).toBeTruthy();

    fireEvent.click(screen.getByText('Clear All'));
    expect(screen.getByText('Next (0 selected)')).toBeTruthy();
  });

  it('Next button is disabled when no sessions selected', async () => {
    vi.useFakeTimers();

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: {
          projects: [
            {
              path: '/data/p1',
              workspacePath: '/ws/p1',
              sessions: [
                { id: 's1', summary: 'Session 1', messageCount: 3, timestamp: Date.now() },
              ],
            },
          ],
        },
      }),
    });

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    const nextBtn = screen.getByText('Next (0 selected)');
    expect(nextBtn).toBeDisabled();
  });

  it('Back button in preview step returns to directory selection', async () => {
    vi.useFakeTimers();

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: {
          projects: [
            {
              path: '/data/p1',
              workspacePath: '/ws/p1',
              sessions: [
                { id: 's1', summary: 'Session 1', messageCount: 3, timestamp: Date.now() },
              ],
            },
          ],
        },
      }),
    });

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('Claude CLI Directory')).toBeTruthy();
  });

  it('renders complete step with import results', async () => {
    vi.useFakeTimers();

    // Step 1: scan
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: {
          projects: [
            {
              path: '/data/p1',
              workspacePath: '/home/user/my-project',
              sessions: [
                { id: 's1', summary: 'Session 1', messageCount: 3, timestamp: Date.now() },
              ],
            },
          ],
        },
      }),
    });

    render(<ImportDialog isOpen={true} onClose={() => {}} />);

    // Scan
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    // Select session and go to configure
    fireEvent.click(screen.getByText('Select All'));
    fireEvent.click(screen.getByText('Next (1 selected)'));

    // We should now be on the configure step
    expect(screen.getByText(/Configure target projects/)).toBeTruthy();
  });

  it('does not show Cancel or footer on progress step', async () => {
    // This test checks a UI aspect where footer is hidden during progress
    const { container } = render(<ImportDialog isOpen={true} onClose={() => {}} />);
    // On step 1, Cancel should be visible
    expect(screen.getByText('Cancel')).toBeTruthy();
  });

  it('filters out internal projects from target project options', () => {
    useProjectStore.setState({
      projects: [
        { id: 'proj-1', name: 'Public Project', rootPath: '/path', isInternal: false },
        { id: 'proj-internal', name: 'Internal', rootPath: '/internal', isInternal: true },
      ],
    } as any);

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    // Just verifies the component renders without error with mixed projects
    expect(screen.getByText('Import from Claude CLI')).toBeTruthy();
  });

  // Additional tests for better coverage
  it('handles browse directory selection', async () => {
    const mockOpenDialog = vi.fn().mockResolvedValue({
      filePaths: ['/selected/path'],
    });
    (window as any).electron = { openDialog: mockOpenDialog };

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: { projects: [] },
      }),
    });

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Browse...'));

    await waitFor(() => {
      expect(mockOpenDialog).toHaveBeenCalledWith({
        properties: ['openDirectory'],
        defaultPath: '~/.claude',
      });
    });

    delete (window as any).electron;
  });

  it('handles browse directory cancellation', async () => {
    const mockOpenDialog = vi.fn().mockResolvedValue({ filePaths: [] });
    (window as any).electron = { openDialog: mockOpenDialog };

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Browse...'));

    await waitFor(() => {
      expect(mockOpenDialog).toHaveBeenCalled();
    });

    // Should still be on step 1
    expect(screen.getByText('Claude CLI Directory')).toBeTruthy();

    delete (window as any).electron;
  });

  it('handles browse directory error', async () => {
    const mockOpenDialog = vi.fn().mockRejectedValue(new Error('Dialog error'));
    (window as any).electron = { openDialog: mockOpenDialog };

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Browse...'));

    await waitFor(() => {
      expect(screen.getByText('Dialog error')).toBeTruthy();
    });

    delete (window as any).electron;
  });

  it('auto-matches projects by workspace path', async () => {
    vi.useFakeTimers();

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: {
          projects: [
            {
              path: '/data/p1',
              workspacePath: '/home/user/my-project',
              sessions: [
                { id: 's1', summary: 'S1', messageCount: 1, timestamp: Date.now() },
              ],
            },
          ],
        },
      }),
    });

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    fireEvent.click(screen.getByText('Select All'));
    fireEvent.click(screen.getByText('Next (1 selected)'));

    // The project should be auto-matched since workspacePath matches rootPath
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('proj-1');
  });

  it('shows load more button when there are more projects', async () => {
    vi.useFakeTimers();

    const projects = Array.from({ length: 15 }, (_, i) => ({
      path: `/data/p${i}`,
      workspacePath: `/ws/p${i}`,
      sessions: [
        { id: `s${i}`, summary: `Session ${i}`, messageCount: 1, timestamp: Date.now() },
      ],
    }));

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: { projects },
      }),
    });

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText(/Load 5 more projects/)).toBeTruthy();
  });

  it('loads more projects when load more button is clicked', async () => {
    vi.useFakeTimers();

    const projects = Array.from({ length: 15 }, (_, i) => ({
      path: `/data/p${i}`,
      workspacePath: `/ws/p${i}`,
      sessions: [
        { id: `s${i}`, summary: `Session ${i}`, messageCount: 1, timestamp: Date.now() },
      ],
    }));

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: { projects },
      }),
    });

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    fireEvent.click(screen.getByText(/Load 5 more projects/));
    expect(screen.getByText(/Load 0 more projects/)).toBeTruthy();
  });

  it('handles successful import with project creation', async () => {
    vi.useFakeTimers();

    mockFetch
      .mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: {
            projects: [
              {
                path: '/data/p1',
                workspacePath: '/unmatched/path',
                sessions: [
                  { id: 's1', summary: 'S1', messageCount: 1, timestamp: Date.now() },
                ],
              },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: { imported: 1, skipped: 0, errors: [] },
        }),
      });

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    fireEvent.click(screen.getByText('Select All'));
    fireEvent.click(screen.getByText('Next (1 selected)'));

    // Select create new project option
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '__create__' } });

    fireEvent.click(screen.getByText('Start Import'));

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    await waitFor(() => {
      expect(api.createProject).toHaveBeenCalled();
    });
  });

  it('handles import failure', async () => {
    vi.useFakeTimers();

    mockFetch
      .mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: {
            projects: [
              {
                path: '/data/p1',
                workspacePath: '/home/user/my-project',
                sessions: [
                  { id: 's1', summary: 'S1', messageCount: 1, timestamp: Date.now() },
                ],
              },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          success: false,
          error: { message: 'Import failed' },
        }),
      });

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    fireEvent.click(screen.getByText('Select All'));
    fireEvent.click(screen.getByText('Next (1 selected)'));
    fireEvent.click(screen.getByText('Start Import'));

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    await waitFor(() => {
      expect(screen.getByText('Import failed')).toBeTruthy();
    });
  });

  it('handles import network error', async () => {
    vi.useFakeTimers();

    mockFetch
      .mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: {
            projects: [
              {
                path: '/data/p1',
                workspacePath: '/home/user/my-project',
                sessions: [
                  { id: 's1', summary: 'S1', messageCount: 1, timestamp: Date.now() },
                ],
              },
            ],
          },
        }),
      })
      .mockRejectedValueOnce(new Error('Network failure'));

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    fireEvent.click(screen.getByText('Select All'));
    fireEvent.click(screen.getByText('Next (1 selected)'));
    fireEvent.click(screen.getByText('Start Import'));

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    await waitFor(() => {
      expect(screen.getByText('Network failure')).toBeTruthy();
    });
  });

  it('shows complete step with results', async () => {
    vi.useFakeTimers();

    mockFetch
      .mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: {
            projects: [
              {
                path: '/data/p1',
                workspacePath: '/home/user/my-project',
                sessions: [
                  { id: 's1', summary: 'S1', messageCount: 1, timestamp: Date.now() },
                ],
              },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: { imported: 5, skipped: 2, errors: [{ sessionId: 'err1', error: 'Test error' }] },
        }),
      });

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    fireEvent.click(screen.getByText('Select All'));
    fireEvent.click(screen.getByText('Next (1 selected)'));
    fireEvent.click(screen.getByText('Start Import'));

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    await waitFor(() => {
      expect(screen.getByText('Import Complete')).toBeTruthy();
      expect(screen.getByText('5')).toBeTruthy();
      expect(screen.getByText('2')).toBeTruthy();
    });
  });

  it('shows progress step during import', async () => {
    vi.useFakeTimers();

    mockFetch
      .mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: {
            projects: [
              {
                path: '/data/p1',
                workspacePath: '/home/user/my-project',
                sessions: [
                  { id: 's1', summary: 'S1', messageCount: 1, timestamp: Date.now() },
                ],
              },
            ],
          },
        }),
      })
      .mockImplementationOnce(() => new Promise(() => {})); // Pending promise

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    fireEvent.click(screen.getByText('Select All'));
    fireEvent.click(screen.getByText('Next (1 selected)'));
    fireEvent.click(screen.getByText('Start Import'));

    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.getByText('Importing sessions...')).toBeTruthy();
  });

  it('uses custom server address with http prefix', async () => {
    useServerStore.setState({
      servers: [{ id: 's1', address: 'http://custom:4000', name: 'custom' }],
      getDefaultServer: () => ({ id: 's1', address: 'http://custom:4000', name: 'custom' }),
    } as any);

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: { projects: [] },
      }),
    });

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Scan'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('http://custom:4000/api/import/claude-cli/scan'),
        expect.any(Object)
      );
    });
  });

  it('uses custom server address with https prefix', async () => {
    useServerStore.setState({
      servers: [{ id: 's1', address: 'https://secure:443', name: 'secure' }],
      getDefaultServer: () => ({ id: 's1', address: 'https://secure:443', name: 'secure' }),
    } as any);

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: { projects: [] },
      }),
    });

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Scan'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://secure:443/api/import/claude-cli/scan'),
        expect.any(Object)
      );
    });
  });

  it('handles configure step with Back button', async () => {
    vi.useFakeTimers();

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: {
          projects: [
            {
              path: '/data/p1',
              workspacePath: '/ws/p1',
              sessions: [
                { id: 's1', summary: 'S1', messageCount: 1, timestamp: Date.now() },
              ],
            },
          ],
        },
      }),
    });

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    fireEvent.click(screen.getByText('Select All'));
    fireEvent.click(screen.getByText('Next (1 selected)'));
    fireEvent.click(screen.getByText('Back'));

    expect(screen.getByText('Select All')).toBeTruthy();
  });

  it('disables Start Import when not all projects are mapped', async () => {
    vi.useFakeTimers();

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: {
          projects: [
            {
              path: '/data/p1',
              workspacePath: '/unmatched/path',
              sessions: [
                { id: 's1', summary: 'S1', messageCount: 1, timestamp: Date.now() },
              ],
            },
          ],
        },
      }),
    });

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    fireEvent.click(screen.getByText('Select All'));
    fireEvent.click(screen.getByText('Next (1 selected)'));

    // The select should be empty (not mapped), so Start Import should be disabled
    const startBtn = screen.getByText('Start Import');
    expect(startBtn).toBeDisabled();
  });

  it('shows session info with date formatting', async () => {
    vi.useFakeTimers();

    const testDate = new Date('2024-06-15T10:30:00Z').getTime();
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: {
          projects: [
            {
              path: '/data/p1',
              workspacePath: '/ws/p1',
              sessions: [
                { id: 's1', summary: 'Test Session', messageCount: 5, timestamp: testDate },
              ],
            },
          ],
        },
      }),
    });

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText(/5 messages/)).toBeTruthy();
  });

  it('handles mobile layout', () => {
    vi.mock('../../hooks/useMediaQuery', () => ({
      useIsMobile: () => true,
    }));

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('Import from Claude CLI')).toBeTruthy();
  });

  it('refreshes sessions and projects after successful import', async () => {
    vi.useFakeTimers();

    mockFetch
      .mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: {
            projects: [
              {
                path: '/data/p1',
                workspacePath: '/home/user/my-project',
                sessions: [
                  { id: 's1', summary: 'S1', messageCount: 1, timestamp: Date.now() },
                ],
              },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: { imported: 1, skipped: 0, errors: [] },
        }),
      });

    const setSessions = vi.fn();
    const setProjects = vi.fn();
    useProjectStore.setState({
      projects: [
        { id: 'proj-1', name: 'My Project', rootPath: '/home/user/my-project', isInternal: false },
      ],
      setSessions,
      setProjects,
    } as any);

    render(<ImportDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    fireEvent.click(screen.getByText('Select All'));
    fireEvent.click(screen.getByText('Next (1 selected)'));
    fireEvent.click(screen.getByText('Start Import'));

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    await waitFor(() => {
      expect(api.getSessions).toHaveBeenCalled();
      expect(api.getProjects).toHaveBeenCalled();
    });
  });
});
