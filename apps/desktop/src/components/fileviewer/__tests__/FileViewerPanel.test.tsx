import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FileViewerPanel, FileViewerActions } from '../FileViewerPanel';

vi.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
  isDarkTheme: (theme: string) => theme === 'dark',
}));

vi.mock('../../../hooks/useMediaQuery', () => ({
  useIsMobile: () => false,
}));

vi.mock('../../../services/api', () => ({
  getFileContent: vi.fn().mockResolvedValue({ content: 'file content' }),
  getBaseUrl: vi.fn(() => 'http://localhost:3100'),
  getAuthHeaders: vi.fn(() => ({})),
}));

vi.mock('../FileSearchInput', () => ({
  FileSearchInput: (props: any) => <div data-testid="file-search">FileSearchInput</div>,
}));

vi.mock('react-syntax-highlighter', () => ({
  Prism: (props: any) => <pre data-testid="syntax-highlighter">{props.children}</pre>,
}));

vi.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({
  oneDark: {},
  oneLight: {},
}));

const mockFileViewerState = {
  filePath: null as string | null,
  content: null as string | null,
  loading: false,
  error: null as string | null,
  searchOpen: false,
  fullscreen: false,
  projectRoot: null as string | null,
  openFile: vi.fn(),
  setContent: vi.fn(),
  setError: vi.fn(),
  setSearchOpen: vi.fn(),
  setFullscreen: vi.fn(),
  isOpen: false,
};

vi.mock('../../../stores/fileViewerStore', () => {
  const store = vi.fn((selector?: (s: any) => any) => {
    return selector ? selector(mockFileViewerState) : mockFileViewerState;
  });
  (store as any).getState = () => mockFileViewerState;
  return { useFileViewerStore: store };
});

beforeEach(() => {
  vi.clearAllMocks();
  mockFileViewerState.filePath = null;
  mockFileViewerState.content = null;
  mockFileViewerState.loading = false;
  mockFileViewerState.error = null;
  mockFileViewerState.searchOpen = false;
});

describe('FileViewerPanel', () => {
  it('renders "No file selected" when no file is open', () => {
    render(<FileViewerPanel projectRoot="/project" />);
    expect(screen.getByText('No file selected')).toBeInTheDocument();
  });

  it('shows file path when a file is open', () => {
    mockFileViewerState.filePath = 'src/index.ts';
    render(<FileViewerPanel projectRoot="/project" />);
    expect(screen.getByText('src/index.ts')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    mockFileViewerState.loading = true;
    render(<FileViewerPanel projectRoot="/project" />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows error state', () => {
    mockFileViewerState.error = 'File not found';
    render(<FileViewerPanel projectRoot="/project" />);
    expect(screen.getByText('File not found')).toBeInTheDocument();
  });

  it('renders syntax highlighter when content is available', () => {
    mockFileViewerState.filePath = 'src/app.tsx';
    mockFileViewerState.content = 'const x = 1;';
    render(<FileViewerPanel projectRoot="/project" />);
    expect(screen.getByTestId('syntax-highlighter')).toBeInTheDocument();
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
  });

  it('shows empty state prompt when no file and not loading', () => {
    const { container } = render(<FileViewerPanel projectRoot="/project" />);
    expect(container.textContent).toContain('@file');
  });

  it('renders FileSearchInput when searchOpen is true', () => {
    mockFileViewerState.searchOpen = true;
    render(<FileViewerPanel projectRoot="/project" />);
    expect(screen.getByTestId('file-search')).toBeInTheDocument();
  });
});

describe('FileViewerActions', () => {
  it('renders search button', () => {
    const { container } = render(<FileViewerActions />);
    const searchBtn = container.querySelector('button[title="Search files (Cmd+P)"]');
    expect(searchBtn).toBeInTheDocument();
  });

  it('shows copy button when content is available', () => {
    mockFileViewerState.content = 'some content';
    const { container } = render(<FileViewerActions />);
    const copyBtn = container.querySelector('button[title="Copy file content"]');
    expect(copyBtn).toBeInTheDocument();
  });

  it('does not show copy button when content is null', () => {
    mockFileViewerState.content = null;
    const { container } = render(<FileViewerActions />);
    const copyBtn = container.querySelector('button[title="Copy file content"]');
    expect(copyBtn).not.toBeInTheDocument();
  });

  it('shows copied state after copy button is clicked', async () => {
    mockFileViewerState.content = 'some content';
    const { container } = render(<FileViewerActions />);
    const copyBtn = container.querySelector('button[title="Copy file content"]') as HTMLButtonElement;

    // Mock clipboard
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    copyBtn.click();
    await waitFor(() => {
      const copiedBtn = container.querySelector('button[title="Copied!"]');
      expect(copiedBtn).toBeInTheDocument();
    });

    vi.unstubAllGlobals();
  });

  it('toggles search open state when search button is clicked', () => {
    mockFileViewerState.searchOpen = false;
    const { container } = render(<FileViewerActions />);
    const searchBtn = container.querySelector('button[title="Search files (Cmd+P)"]') as HTMLButtonElement;

    searchBtn.click();
    expect(mockFileViewerState.setSearchOpen).toHaveBeenCalledWith(true);
  });

  it('does not show expand button when filePath is null', () => {
    mockFileViewerState.filePath = null;
    mockFileViewerState.projectRoot = '/project';
    const { container } = render(<FileViewerActions />);
    const expandBtn = container.querySelector('button[title="Open in new window"]');
    const fullscreenBtn = container.querySelector('button[title="Fullscreen"]');
    expect(expandBtn).not.toBeInTheDocument();
    expect(fullscreenBtn).not.toBeInTheDocument();
  });

  it('shows expand button when not mobile and filePath exists', () => {
    mockFileViewerState.filePath = 'src/test.ts';
    mockFileViewerState.projectRoot = '/project';
    const { container } = render(<FileViewerActions />);
    const expandBtn = container.querySelector('button[title="Open in new window"]');
    const fullscreenBtn = container.querySelector('button[title="Fullscreen"]');
    // Button exists (either expand or fullscreen)
    expect(expandBtn || fullscreenBtn).toBeTruthy();
  });
});
