import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FileViewerWindow } from '../FileViewerWindow';

vi.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
  isDarkTheme: (theme: string) => theme === 'dark',
}));

vi.mock('../../../services/api', () => ({
  getFileContent: vi.fn().mockResolvedValue({ content: 'mock file content' }),
}));

vi.mock('react-syntax-highlighter', () => ({
  Prism: (props: any) => <pre data-testid="syntax-highlighter">{props.children}</pre>,
}));

vi.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({
  oneDark: {},
  oneLight: {},
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FileViewerWindow', () => {
  it('renders file path in the header', () => {
    render(<FileViewerWindow filePath="src/app.ts" projectRoot="/project" />);
    expect(screen.getByText('src/app.ts')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    render(<FileViewerWindow filePath="src/app.ts" projectRoot="/project" />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders content after loading via api', async () => {
    render(<FileViewerWindow filePath="src/app.ts" projectRoot="/project" />);
    await waitFor(() => {
      expect(screen.getByTestId('syntax-highlighter')).toBeInTheDocument();
    });
    expect(screen.getByText('mock file content')).toBeInTheDocument();
  });

  it('renders close button when onClose is provided', () => {
    const onClose = vi.fn();
    const { container } = render(
      <FileViewerWindow filePath="src/app.ts" projectRoot="/project" onClose={onClose} />
    );
    // The close/back button is the first button in the header
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('does not render close button when onClose is not provided', () => {
    const { container } = render(
      <FileViewerWindow filePath="src/app.ts" projectRoot="/project" />
    );
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(0);
  });

  it('fetches directly from serverUrl when provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { content: 'server content' } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    render(
      <FileViewerWindow
        filePath="src/app.ts"
        projectRoot="/project"
        serverUrl="http://localhost:3100"
      />
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    expect(mockFetch.mock.calls[0][0]).toContain('http://localhost:3100/api/files/content');

    vi.unstubAllGlobals();
  });

  it('shows error state on fetch failure', async () => {
    const { getFileContent } = await import('../../../services/api');
    (getFileContent as any).mockRejectedValueOnce(new Error('Network error'));

    render(<FileViewerWindow filePath="src/app.ts" projectRoot="/project" />);
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('fetches directly from serverUrl with authToken when provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { content: 'server content' } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    render(
      <FileViewerWindow
        filePath="src/app.ts"
        projectRoot="/project"
        serverUrl="http://localhost:3100"
        authToken="test-token"
      />
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    const fetchOptions = mockFetch.mock.calls[0][1];
    // authToken is in the Authorization header, not in the URL
    expect(fetchOptions.headers['Authorization']).toBe('test-token');

    vi.unstubAllGlobals();
  });

  it('handles non-ok HTTP response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });
    vi.stubGlobal('fetch', mockFetch);

    render(
      <FileViewerWindow
        filePath="src/app.ts"
        projectRoot="/project"
        serverUrl="http://localhost:3100"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('HTTP 404')).toBeInTheDocument();
    });

    vi.unstubAllGlobals();
  });

  it('handles failed response without success flag', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: false, error: { message: 'File not found' } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    render(
      <FileViewerWindow
        filePath="src/app.ts"
        projectRoot="/project"
        serverUrl="http://localhost:3100"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('File not found')).toBeInTheDocument();
    });

    vi.unstubAllGlobals();
  });
});
