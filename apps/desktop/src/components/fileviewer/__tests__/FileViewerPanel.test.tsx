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

vi.mock('../FileTree', () => ({
  FileTree: (props: any) => (
    <button data-testid="file-tree" onClick={() => props.onOpenFile('src/from-tree.ts')}>
      {props.projectRoot}:{props.backendId ?? 'none'}:{props.selectedPath ?? 'none'}
    </button>
  ),
}));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock('remark-gfm', () => ({ default: () => {} }));

vi.mock('prism-react-renderer', () => ({
  Highlight: ({ code, children }: any) =>
    children({
      tokens: code.split(/\r?\n/).map((line: string) => [{ types: ['plain'], content: line }]),
      getLineProps: () => ({ style: {}, className: '' }),
      getTokenProps: ({ token }: any) => ({ style: {}, className: '', children: token.content }),
      style: {},
      className: '',
    }),
  themes: { oneDark: {}, oneLight: {} },
}));

vi.mock('react-window', () => ({
  List: ({ rowComponent: Row, rowCount, rowProps }: any) => (
    <div data-testid="code-viewer">
      {Array.from({ length: rowCount }).map((_, idx) => (
        <Row
          key={idx}
          index={idx}
          style={{}}
          ariaAttributes={{ role: 'listitem', 'aria-posinset': idx + 1, 'aria-setsize': rowCount }}
          {...rowProps}
        />
      ))}
    </div>
  ),
  useListRef: () => ({ current: null }),
}));

const mockFileViewerState = {
  filePath: null as string | null,
  content: null as string | null,
  loading: false,
  error: null as string | null,
  searchOpen: false,
  showTree: true,
  fullscreen: false,
  projectRoot: null as string | null,
  openFile: vi.fn(),
  setContent: vi.fn(),
  setError: vi.fn(),
  setSearchOpen: vi.fn(),
  setFullscreen: vi.fn(),
  toggleTree: vi.fn(),
  setShowTree: vi.fn(),
  isOpen: false,
  targetLine: null as number | null,
  targetEndLine: null as number | null,
  targetNonce: 0,
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
  mockFileViewerState.showTree = true;
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

  it('renders code viewer when content is available', () => {
    mockFileViewerState.filePath = 'src/app.tsx';
    mockFileViewerState.content = 'const x = 1;';
    render(<FileViewerPanel projectRoot="/project" />);
    expect(screen.getByTestId('code-viewer')).toBeInTheDocument();
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
  });

  it('renders markdown viewer for markdown files', () => {
    mockFileViewerState.filePath = 'docs/readme.md';
    mockFileViewerState.content = '| A |\n| - |\n| B |';
    render(<FileViewerPanel projectRoot="/project" />);
    expect(screen.getByTestId('markdown')).toBeInTheDocument();
    expect(screen.queryByTestId('code-viewer')).not.toBeInTheDocument();
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

  it('renders file tree and opens files selected from the tree', () => {
    mockFileViewerState.filePath = 'src/current.ts';
    render(<FileViewerPanel projectRoot="/project" />);

    const tree = screen.getByTestId('file-tree');
    expect(tree).toHaveTextContent('/project');
    expect(tree).toHaveTextContent('src/current.ts');

    tree.click();
    expect(mockFileViewerState.openFile).toHaveBeenCalledWith('/project', 'src/from-tree.ts');
  });

  it('hides the file tree when showTree is false on desktop', () => {
    mockFileViewerState.showTree = false;
    mockFileViewerState.filePath = 'src/current.ts';
    mockFileViewerState.content = 'const x = 1;';

    render(<FileViewerPanel projectRoot="/project" />);

    expect(screen.queryByTestId('file-tree')).not.toBeInTheDocument();
    expect(screen.getByTestId('code-viewer')).toBeInTheDocument();
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

  it('shows file tree toggle button on desktop and toggles tree visibility', () => {
    mockFileViewerState.showTree = true;
    const { container } = render(<FileViewerActions />);
    const toggleBtn = container.querySelector('button[title="Hide file tree"]') as HTMLButtonElement;

    expect(toggleBtn).toBeInTheDocument();
    toggleBtn.click();
    expect(mockFileViewerState.toggleTree).toHaveBeenCalled();
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
