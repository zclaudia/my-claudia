import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ImportOpenCodeDialog } from '../ImportOpenCodeDialog';
import { useServerStore } from '../../stores/serverStore';
import { useProjectStore } from '../../stores/projectStore';
import * as api from '../../services/api';

vi.mock('../../services/api', () => ({
  createProject: vi.fn().mockResolvedValue({ id: 'new-proj-1', name: 'test' }),
  getSessions: vi.fn().mockResolvedValue([]),
  getProjects: vi.fn().mockResolvedValue([]),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('ImportOpenCodeDialog', () => {
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
      <ImportOpenCodeDialog isOpen={false} onClose={() => {}} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders the dialog header when open', () => {
    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('Import from OpenCode')).toBeTruthy();
  });

  it('renders step 1 with database path input and scan button', () => {
    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('OpenCode Database Path')).toBeTruthy();
    expect(screen.getByText('Scan')).toBeTruthy();
  });

  it('shows platform-specific default path', () => {
    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    // Should contain opencode.db in the path
    expect(input.value).toContain('opencode.db');
  });

  it('updates input value when typed', () => {
    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/custom/path/opencode.db' } });
    expect(input.value).toBe('/custom/path/opencode.db');
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<ImportOpenCodeDialog isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<ImportOpenCodeDialog isOpen={true} onClose={onClose} />);
    const backdrop = container.querySelector('.fixed.inset-0');
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows error when path is empty', async () => {
    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByText('Scan'));

    await waitFor(() => {
      expect(screen.getByText('Please enter the database path')).toBeTruthy();
    });
  });

  it('shows error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Scan'));

    await waitFor(() => {
      expect(screen.getByText('Connection refused')).toBeTruthy();
    });
  });

  it('shows error when scan response indicates failure', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: false,
        error: { message: 'Database file not found' },
      }),
    });

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Scan'));

    await waitFor(() => {
      expect(screen.getByText('Database file not found')).toBeTruthy();
    });
  });

  it('calls scan API with correct endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: { projects: [] },
      }),
    });

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Scan'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/import/opencode/scan'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
  });

  it('triggers scan on Enter key', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: { projects: [] },
      }),
    });

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
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
                { id: 's1', summary: 'OpenCode session', messageCount: 10, timestamp: Date.now() },
              ],
            },
          ],
        },
      }),
    });

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText('Select All')).toBeTruthy();
    expect(screen.getByText('OpenCode session')).toBeTruthy();
  });

  it('Select All and Clear All work correctly', async () => {
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

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
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
                { id: 's1', summary: 'S1', messageCount: 1, timestamp: Date.now() },
              ],
            },
          ],
        },
      }),
    });

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText('Next (0 selected)')).toBeDisabled();
  });

  it('Back button returns to detect DB step', async () => {
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

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('OpenCode Database Path')).toBeTruthy();
  });

  it('navigates to configure step with selected sessions', async () => {
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

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    fireEvent.click(screen.getByText('Select All'));
    fireEvent.click(screen.getByText('Next (1 selected)'));

    expect(screen.getByText(/Configure target projects/)).toBeTruthy();
    expect(screen.getByText('Start Import')).toBeTruthy();
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

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
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

  it('filters internal projects from target list', () => {
    useProjectStore.setState({
      projects: [
        { id: 'proj-1', name: 'Public', rootPath: '/pub', isInternal: false },
        { id: 'proj-int', name: 'Internal', rootPath: '/int', isInternal: true },
      ],
    } as any);

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('Import from OpenCode')).toBeTruthy();
  });

  // Additional tests for better coverage
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

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
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

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
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

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
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

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
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

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
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

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
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

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
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

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Scan'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('http://custom:4000/api/import/opencode/scan'),
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

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Scan'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://secure:443/api/import/opencode/scan'),
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

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
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

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
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

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText(/5 messages/)).toBeTruthy();
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

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
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

  it('handles scan with empty sessions array', async () => {
    vi.useFakeTimers();

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: {
          projects: [
            {
              path: '/data/p1',
              workspacePath: '/ws/p1',
              sessions: [],
            },
          ],
        },
      }),
    });

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText(/0 sessions across 1 projects/)).toBeTruthy();
  });

  it('handles scan with null sessions', async () => {
    vi.useFakeTimers();

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: {
          projects: [
            {
              path: '/data/p1',
              workspacePath: '/ws/p1',
              sessions: null as any,
            },
          ],
        },
      }),
    });

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText(/0 sessions across 1 projects/)).toBeTruthy();
  });

  it('shows errors in complete step', async () => {
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
          data: {
            imported: 0,
            skipped: 0,
            errors: [
              { sessionId: 's1', error: 'Failed to import' },
              { sessionId: 's2', error: 'Another error' },
            ],
          },
        }),
      });

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
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
      expect(screen.getByText('Errors:')).toBeTruthy();
      expect(screen.getByText(/s1: Failed to import/)).toBeTruthy();
    });
  });

  it('handles select and deselect individual sessions', async () => {
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

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    expect(screen.getByText('Next (1 selected)')).toBeTruthy();

    fireEvent.click(checkboxes[0]);
    expect(screen.getByText('Next (0 selected)')).toBeTruthy();
  });

  it('handles multiple source projects mapping', async () => {
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
            {
              path: '/data/p2',
              workspacePath: '/unmatched/path',
              sessions: [
                { id: 's2', summary: 'S2', messageCount: 1, timestamp: Date.now() },
              ],
            },
          ],
        },
      }),
    });

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    fireEvent.click(screen.getByText('Select All'));
    fireEvent.click(screen.getByText('Next (2 selected)'));

    // Should have two project mapping selects
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(2);
  });

  it('handles project mapping selection change', async () => {
    vi.useFakeTimers();

    useProjectStore.setState({
      projects: [
        { id: 'proj-1', name: 'Project 1', rootPath: '/path1', isInternal: false },
        { id: 'proj-2', name: 'Project 2', rootPath: '/path2', isInternal: false },
      ],
    } as any);

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

    render(<ImportOpenCodeDialog isOpen={true} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Scan'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    fireEvent.click(screen.getByText('Select All'));
    fireEvent.click(screen.getByText('Next (1 selected)'));

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'proj-2' } });

    expect(select.value).toBe('proj-2');
  });
});
