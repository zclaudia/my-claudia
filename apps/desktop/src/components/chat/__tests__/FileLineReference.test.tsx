// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import {
  FileLineReference,
  parseFileLineRef,
  INLINE_FILE_REF_REGEX,
  FILE_LINE_REF_REGEX,
} from '../FileLineReference';

const mockOpenFile = vi.fn();
vi.mock('../../../stores/fileViewerStore', () => ({
  useFileViewerStore: (selector: any) => selector({ openFile: mockOpenFile }),
}));

const mockSetActiveTab = vi.fn();
vi.mock('../../../stores/bottomPanelStore', () => ({
  useBottomPanelStore: {
    getState: () => ({ setActiveTab: mockSetActiveTab }),
  },
}));

const mockToastAdd = vi.fn();
vi.mock('../../../stores/toastStore', () => ({
  useToastStore: {
    getState: () => ({ add: mockToastAdd }),
  },
}));

const mockListDirectory = vi.fn();
vi.mock('../../../services/api', () => ({
  listDirectory: (...args: unknown[]) => mockListDirectory(...args),
}));

describe('parseFileLineRef', () => {
  it('parses single line', () => {
    expect(parseFileLineRef('foo.ts:10')).toEqual({
      pathOrName: 'foo.ts',
      start: 10,
      end: undefined,
    });
  });

  it('parses line range', () => {
    expect(parseFileLineRef('a/b/c.tsx:5-12')).toEqual({
      pathOrName: 'a/b/c.tsx',
      start: 5,
      end: 12,
    });
  });

  it('rejects content without a line number', () => {
    expect(parseFileLineRef('foo.ts')).toBeNull();
  });

  it('rejects content with extra text', () => {
    expect(parseFileLineRef('see foo.ts:10 here')).toBeNull();
  });
});

describe('FILE_LINE_REF_REGEX', () => {
  it.each([
    'foo.ts:1',
    'foo.tsx:42',
    'a/b/c.ts:10-20',
    'snake_case.py:1',
    '.hidden.json:3',
  ])('matches %s', (s) => {
    expect(FILE_LINE_REF_REGEX.test(s)).toBe(true);
  });

  it.each([
    'foo.ts',
    'foo:42',
    '4 + 2',
    'const x = 1',
    'foo.ts:abc',
  ])('does not match %s', (s) => {
    expect(FILE_LINE_REF_REGEX.test(s)).toBe(false);
  });
});

describe('INLINE_FILE_REF_REGEX', () => {
  it.each([
    'foo.ts',
    'foo.tsx',
    'a/b/c.ts',
    'snake_case.py',
    '.hidden.json',
    'foo.ts:1',
    'foo.ts:1-3',
  ])('matches %s', (s) => {
    expect(INLINE_FILE_REF_REGEX.test(s)).toBe(true);
  });

  it.each([
    'foo',
    'foo:42',
    '4 + 2',
    'const x = 1',
    'see foo.ts',
    'foo.ts:abc',
  ])('does not match %s', (s) => {
    expect(INLINE_FILE_REF_REGEX.test(s)).toBe(false);
  });
});

describe('FileLineReference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the literal text inside a button', () => {
    render(<FileLineReference text="foo.ts:42" projectRoot="/repo" />);
    const button = screen.getByRole('button', { name: /foo\.ts:42/ });
    expect(button.textContent).toBe('foo.ts:42');
  });

  it('resolves an exact relative path via search', async () => {
    mockListDirectory.mockResolvedValueOnce({
      entries: [
        { name: 'foo.ts', path: 'src/foo.ts', type: 'file' },
      ],
      currentPath: '',
      hasMore: false,
    });

    render(<FileLineReference text="src/foo.ts:42" projectRoot="/repo" />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(mockOpenFile).toHaveBeenCalledWith('/repo', 'src/foo.ts', 42, undefined);
    });
    expect(mockSetActiveTab).toHaveBeenCalledWith('file-viewer');
    // searches by basename, not full path
    expect(mockListDirectory).toHaveBeenCalledWith({
      projectRoot: '/repo',
      backendId: undefined,
      query: 'foo.ts',
      maxResults: 20,
    });
  });

  it('forwards a line range when present', async () => {
    mockListDirectory.mockResolvedValueOnce({
      entries: [{ name: 'foo.ts', path: 'src/foo.ts', type: 'file' }],
      currentPath: '',
      hasMore: false,
    });

    render(<FileLineReference text="src/foo.ts:5-12" projectRoot="/repo" />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(mockOpenFile).toHaveBeenCalledWith('/repo', 'src/foo.ts', 5, 12);
    });
  });

  it('resolves a relative file path without a line target', async () => {
    mockListDirectory.mockResolvedValueOnce({
      entries: [{ name: 'foo.ts', path: 'src/foo.ts', type: 'file' }],
      currentPath: '',
      hasMore: false,
    });

    render(<FileLineReference text="src/foo.ts" projectRoot="/repo" />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(mockOpenFile).toHaveBeenCalledWith('/repo', 'src/foo.ts', undefined, undefined);
    });
    expect(mockSetActiveTab).toHaveBeenCalledWith('file-viewer');
  });

  it('matches a partial path by suffix (app/Foo.tsx → apps/desktop/src/app/Foo.tsx)', async () => {
    mockListDirectory.mockResolvedValueOnce({
      entries: [
        { name: 'MobileOverlays.tsx', path: 'apps/desktop/src/app/MobileOverlays.tsx', type: 'file' },
      ],
      currentPath: '',
      hasMore: false,
    });

    render(<FileLineReference text="app/MobileOverlays.tsx:1" projectRoot="/repo" />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(mockOpenFile).toHaveBeenCalledWith(
        '/repo',
        'apps/desktop/src/app/MobileOverlays.tsx',
        1,
        undefined,
      );
    });
    expect(mockListDirectory).toHaveBeenCalledWith({
      projectRoot: '/repo',
      backendId: undefined,
      query: 'MobileOverlays.tsx',
      maxResults: 20,
    });
  });

  it('prefers a path-suffix match over an unrelated basename hit', async () => {
    mockListDirectory.mockResolvedValueOnce({
      entries: [
        // unrelated basename match
        { name: 'index.ts', path: 'src/lib/index.ts', type: 'file' },
        // suffix-matching candidate
        { name: 'index.ts', path: 'apps/desktop/src/utils/index.ts', type: 'file' },
      ],
      currentPath: '',
      hasMore: false,
    });

    render(<FileLineReference text="utils/index.ts:3" projectRoot="/repo" />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(mockOpenFile).toHaveBeenCalledWith(
        '/repo',
        'apps/desktop/src/utils/index.ts',
        3,
        undefined,
      );
    });
  });

  it('looks up a bare basename via listDirectory and prefers an exact match', async () => {
    mockListDirectory.mockResolvedValueOnce({
      entries: [
        { name: 'fooBar.ts', path: 'src/fooBar.ts', type: 'file' },
        { name: 'foo.ts', path: 'pkg/foo.ts', type: 'file' },
      ],
      currentPath: '',
      hasMore: false,
    });

    render(
      <FileLineReference text="foo.ts:7" projectRoot="/repo" backendId="b1" />,
    );
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(mockOpenFile).toHaveBeenCalledWith('/repo', 'pkg/foo.ts', 7, undefined);
    });
    expect(mockListDirectory).toHaveBeenCalledWith({
      projectRoot: '/repo',
      backendId: 'b1',
      query: 'foo.ts',
      maxResults: 20,
    });
  });

  it('looks up a bare basename without a line target', async () => {
    mockListDirectory.mockResolvedValueOnce({
      entries: [
        { name: 'App.tsx', path: 'src/App.tsx', type: 'file' },
      ],
      currentPath: '',
      hasMore: false,
    });

    render(<FileLineReference text="App.tsx" projectRoot="/repo" />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(mockOpenFile).toHaveBeenCalledWith('/repo', 'src/App.tsx', undefined, undefined);
    });
  });

  it('falls back to the first file entry when no exact basename match exists', async () => {
    mockListDirectory.mockResolvedValueOnce({
      entries: [
        { name: 'fooBar.ts', path: 'src/fooBar.ts', type: 'file' },
        { name: 'fooBaz.ts', path: 'pkg/fooBaz.ts', type: 'file' },
      ],
      currentPath: '',
      hasMore: false,
    });

    render(<FileLineReference text="foo.ts:1" projectRoot="/repo" />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(mockOpenFile).toHaveBeenCalledWith('/repo', 'src/fooBar.ts', 1, undefined);
    });
  });

  it('shows a toast and does not open when no project root is available', () => {
    render(<FileLineReference text="src/foo.ts:1" />);
    fireEvent.click(screen.getByRole('button'));
    expect(mockOpenFile).not.toHaveBeenCalled();
    expect(mockToastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'No project selected' }),
    );
  });

  it('shows a toast when no matches are found', async () => {
    mockListDirectory.mockResolvedValueOnce({
      entries: [],
      currentPath: '',
      hasMore: false,
    });

    render(<FileLineReference text="missing.ts:1" projectRoot="/repo" />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(mockToastAdd).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'File not found' }),
      );
    });
    expect(mockOpenFile).not.toHaveBeenCalled();
  });
});
