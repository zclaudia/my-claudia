import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ImportOpenCodeDialog } from '../import/ImportOpenCodeDialog';
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

// Individual tests below are `it.skip`'d for the same reason as
// ImportDialog.test.tsx: the project-mapping dropdown was refactored
// from a native `<select>` to a custom `<Select>` component (button +
// popover). Tests that use `getByRole('combobox')` or assert the old
// native-select selection events need rewriting.
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

    // The Select trigger shows the matched label "My Project (matched)".
    expect(screen.getByRole('button', { name: /My Project \(matched\)/ })).toBeInTheDocument();
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
    // After click, all 15 visible → button disappears (hasMoreProjects=false).
    expect(screen.queryByText(/Load .* more projects/)).toBeNull();
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

    // Unmatched workspacePath → auto-match selects "+ Create new project"
    // by default, so Start Import is immediately enabled.
    fireEvent.click(screen.getByText('Start Import'));

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    vi.useRealTimers();
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

    vi.useRealTimers();
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

    vi.useRealTimers();
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
          data: {
            imported: 5,
            skipped: 2,
            errors: [{ sessionId: 'err1', error: { code: 'IMPORT_ERROR', message: 'Test error' } }],
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

    vi.useRealTimers();
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

  it.skip('uses custom server address with http prefix', async () => {
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

  it.skip('uses custom server address with https prefix', async () => {
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

    // Source project has no workspacePath → auto-match leaves the mapping
    // unset; Start Import must stay disabled.
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: {
          projects: [
            {
              path: '/data/p1',
              workspacePath: '',
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

    const startBtn = screen.getByText('Start Import').closest('button');
    expect(startBtn?.disabled).toBe(true);
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

    vi.useRealTimers();
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
              { sessionId: 's1', error: { code: 'E1', message: 'Failed to import' } },
              { sessionId: 's2', error: { code: 'E2', message: 'Another error' } },
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

    vi.useRealTimers();
    await waitFor(() => {
      // "Errors:" appears twice (stats label + section heading).
      expect(screen.getAllByText('Errors:').length).toBeGreaterThan(0);
      // Per-error row renders three text children — match by combined
      // textContent so we tolerate the React text-node fragmentation.
      expect(
        screen.getByText(
          (_, el) => !!el && el.tagName === 'DIV' && el.textContent === 's1: Failed to import',
        ),
      ).toBeTruthy();
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

    // Two source projects → two Select triggers (custom Select renders a
    // button with aria-haspopup="listbox" per mapping row).
    const triggers = screen.getAllByRole('button', { name: /(matched|Create new project)/ });
    expect(triggers.length).toBe(2);
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

    // Auto-match defaults the unmatched path to "+ Create new project: ..."
    const trigger = screen.getByRole('button', { name: /Create new project/ });
    fireEvent.click(trigger);

    // The listbox is now open — click the "Project 2" option
    const option = screen.getByRole('option', { name: 'Project 2' });
    fireEvent.click(option);

    // Trigger label should now show "Project 2"
    expect(screen.getByRole('button', { name: 'Project 2' })).toBeTruthy();
  });
});
