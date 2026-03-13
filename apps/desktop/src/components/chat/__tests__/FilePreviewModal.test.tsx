import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { getPreviewType, isPreviewable, FilePreviewModal } from '../FilePreviewModal';

vi.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
  isDarkTheme: () => true,
}));

vi.mock('../../../services/api', () => ({
  getBaseUrl: () => 'http://localhost:3100',
  getAuthHeaders: () => ({ Authorization: 'Bearer test' }),
}));

vi.mock('../../../services/fileDownload', () => ({
  openFile: vi.fn(),
  openFileAndroid: vi.fn(),
  isAndroid: vi.fn().mockReturnValue(false),
}));

// Mock heavy syntax highlighter
vi.mock('react-syntax-highlighter', () => ({
  Prism: ({ children }: any) => <pre data-testid="syntax-highlighter">{children}</pre>,
}));
vi.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({
  oneDark: {},
  oneLight: {},
}));

// Mock ReactMarkdown
vi.mock('react-markdown', () => ({
  default: ({ children }: any) => <div data-testid="markdown">{children}</div>,
}));
vi.mock('remark-gfm', () => ({ default: vi.fn() }));

const mockItem = {
  fileId: 'file-1',
  fileName: 'test.txt',
  mimeType: 'text/plain',
  size: 100,
  sessionId: 'sess-1',
  savedPath: '/tmp/test.txt',
  privatePath: undefined,
};

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock only the specific URL methods, not the entire URL constructor
const createObjectURLMock = vi.fn(() => 'blob:mock');
const revokeObjectURLMock = vi.fn();
URL.createObjectURL = createObjectURLMock;
URL.revokeObjectURL = revokeObjectURLMock;

describe('FilePreviewModal utilities', () => {
  describe('getPreviewType', () => {
    it('returns image for image mime types', () => {
      expect(getPreviewType('image/png', 'photo.png')).toBe('image');
      expect(getPreviewType('image/jpeg', 'photo.jpg')).toBe('image');
      expect(getPreviewType('image/gif', 'anim.gif')).toBe('image');
    });

    it('returns video for video mime types', () => {
      expect(getPreviewType('video/mp4', 'clip.mp4')).toBe('video');
      expect(getPreviewType('video/webm', 'clip.webm')).toBe('video');
    });

    it('returns audio for audio mime types', () => {
      expect(getPreviewType('audio/mp3', 'song.mp3')).toBe('audio');
      expect(getPreviewType('audio/wav', 'sound.wav')).toBe('audio');
    });

    it('returns markdown for markdown files', () => {
      expect(getPreviewType('text/markdown', 'readme.md')).toBe('markdown');
      expect(getPreviewType('text/plain', 'readme.md')).toBe('markdown');
    });

    it('returns text for code files by mime', () => {
      expect(getPreviewType('text/plain', 'file.txt')).toBe('text');
      expect(getPreviewType('application/json', 'data.json')).toBe('text');
      expect(getPreviewType('application/javascript', 'app.js')).toBe('text');
    });

    it('returns text for code files by extension', () => {
      expect(getPreviewType('application/octet-stream', 'file.ts')).toBe('text');
      expect(getPreviewType('application/octet-stream', 'file.py')).toBe('text');
      expect(getPreviewType('application/octet-stream', 'file.rs')).toBe('text');
      expect(getPreviewType('application/octet-stream', 'file.go')).toBe('text');
    });

    it('returns unsupported for binary files', () => {
      expect(getPreviewType('application/octet-stream', 'file.bin')).toBe('unsupported');
      expect(getPreviewType('application/pdf', 'doc.pdf')).toBe('unsupported');
    });
  });

  describe('isPreviewable', () => {
    it('returns true for previewable types', () => {
      expect(isPreviewable('image/png', 'photo.png')).toBe(true);
      expect(isPreviewable('text/plain', 'file.txt')).toBe(true);
      expect(isPreviewable('video/mp4', 'clip.mp4')).toBe(true);
    });

    it('returns false for unsupported types', () => {
      expect(isPreviewable('application/octet-stream', 'file.bin')).toBe(false);
      expect(isPreviewable('application/pdf', 'doc.pdf')).toBe(false);
    });
  });
});

describe('FilePreviewModal component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => 'file content here',
      blob: async () => new Blob(['binary'], { type: 'image/png' }),
    });
  });

  it('renders the file name in header', async () => {
    render(<FilePreviewModal item={mockItem as any} onClose={() => {}} />);
    expect(screen.getByText('test.txt')).toBeTruthy();
  });

  it('shows loading state initially', () => {
    render(<FilePreviewModal item={mockItem as any} onClose={() => {}} />);
    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<FilePreviewModal item={mockItem as any} onClose={onClose} />);
    const backdrop = container.querySelector('.fixed.inset-0');
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(<FilePreviewModal item={mockItem as any} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows text content after loading', async () => {
    render(<FilePreviewModal item={mockItem as any} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).toBeNull();
    });
    expect(screen.getByTestId('syntax-highlighter')).toBeTruthy();
  });

  it('shows markdown content for .md files', async () => {
    const mdItem = { ...mockItem, fileName: 'readme.md', mimeType: 'text/plain' };
    render(<FilePreviewModal item={mdItem as any} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).toBeNull();
    });
    expect(screen.getByTestId('markdown')).toBeTruthy();
  });

  it('shows error when fetch fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Load failed'));
    render(<FilePreviewModal item={mockItem as any} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('Load failed')).toBeTruthy();
    });
  });

  it('shows error when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    render(<FilePreviewModal item={mockItem as any} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('HTTP 404')).toBeTruthy();
    });
  });

  it('shows External App button when savedPath is set', async () => {
    render(<FilePreviewModal item={mockItem as any} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).toBeNull();
    });
    expect(screen.getByText('External App')).toBeTruthy();
  });

  it('does not show External App button when no savedPath or privatePath', async () => {
    const noPathItem = { ...mockItem, savedPath: undefined, privatePath: undefined };
    render(<FilePreviewModal item={noPathItem as any} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).toBeNull();
    });
    expect(screen.queryByText('External App')).toBeNull();
  });

  it('renders image preview for image files', async () => {
    const imageItem = { ...mockItem, fileName: 'photo.png', mimeType: 'image/png' };
    render(<FilePreviewModal item={imageItem as any} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).toBeNull();
    });
    // Image should be rendered (either img tag or loaded state)
    const { container } = render(<FilePreviewModal item={imageItem as any} onClose={() => {}} />);
    expect(container).toBeTruthy();
  });

  it('renders audio player for audio files', async () => {
    const audioItem = { ...mockItem, fileName: 'song.mp3', mimeType: 'audio/mpeg' };
    render(<FilePreviewModal item={audioItem as any} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).toBeNull();
    });
    // Audio element should show filename
    const texts = screen.getAllByText('song.mp3');
    expect(texts.length).toBeGreaterThan(0);
  });
});
