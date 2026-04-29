import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FilePushCard, FilePushNotificationList } from '../FilePushNotification';
import type { FilePushItem } from '../../../stores/filePushStore';

// Mock dependencies
vi.mock('../../../stores/filePushStore', () => {
  const items: FilePushItem[] = [];
  return {
    useFilePushStore: Object.assign(
      (selector: any) => selector({ items }),
      {
        getState: () => ({
          removeItem: vi.fn(),
          items,
        }),
      }
    ),
    __setItems: (newItems: FilePushItem[]) => {
      items.length = 0;
      items.push(...newItems);
    },
  };
});

vi.mock('../../../services/fileDownload', () => ({
  downloadPushedFile: vi.fn(),
  formatFileSize: (size: number) => `${Math.round(size / 1024)} KB`,
  openFile: vi.fn(),
  openFileAndroid: vi.fn(),
  openFolder: vi.fn(),
  isAndroid: vi.fn(() => false),
}));

vi.mock('../FilePreviewModal', () => ({
  isPreviewable: vi.fn(() => false),
  FilePreviewModal: ({ item, onClose }: any) => (
    <div data-testid="preview-modal">{item.fileName}</div>
  ),
}));

describe('FilePushCard', () => {
  const mockOnPreview = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const baseItem: FilePushItem = {
    fileId: 'f1',
    sessionId: 's1',
    fileName: 'test.txt',
    fileSize: 1024,
    mimeType: 'text/plain',
    status: 'pending',
    autoDownload: false,
    downloadProgress: 0,
  };

  it('renders file name and size', () => {
    render(<FilePushCard item={baseItem} onPreview={mockOnPreview} />);
    expect(screen.getByText('test.txt')).toBeInTheDocument();
    expect(screen.getByText(/1 KB/)).toBeInTheDocument();
  });

  it('shows download button for pending status', () => {
    render(<FilePushCard item={baseItem} onPreview={mockOnPreview} />);
    expect(screen.getByText('Download')).toBeInTheDocument();
  });

  it('shows progress for downloading status', () => {
    render(
      <FilePushCard
        item={{ ...baseItem, status: 'downloading', downloadProgress: 45 }}
        onPreview={mockOnPreview}
      />
    );
    expect(screen.getByText('45%')).toBeInTheDocument();
  });

  it('shows Saved text for auto-downloaded completed items without path', () => {
    render(
      <FilePushCard
        item={{ ...baseItem, status: 'completed', autoDownload: true }}
        onPreview={mockOnPreview}
      />
    );
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('shows Downloaded text for manually-downloaded completed items without path', () => {
    render(
      <FilePushCard
        item={{ ...baseItem, status: 'completed', autoDownload: false }}
        onPreview={mockOnPreview}
      />
    );
    expect(screen.getByText('Downloaded')).toBeInTheDocument();
  });

  it('shows Open button for completed items with path', () => {
    render(
      <FilePushCard
        item={{ ...baseItem, status: 'completed', savedPath: '/path/to/file.txt' }}
        onPreview={mockOnPreview}
      />
    );
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('shows error message and retry for error status', () => {
    render(
      <FilePushCard
        item={{ ...baseItem, status: 'error', error: 'Network failed' }}
        onPreview={mockOnPreview}
      />
    );
    expect(screen.getByText('Network failed')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('shows default Failed text when no error message', () => {
    render(
      <FilePushCard
        item={{ ...baseItem, status: 'error' }}
        onPreview={mockOnPreview}
      />
    );
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('shows dismiss button for completed items', () => {
    render(
      <FilePushCard
        item={{ ...baseItem, status: 'completed' }}
        onPreview={mockOnPreview}
      />
    );
    expect(screen.getByLabelText('Dismiss')).toBeInTheDocument();
  });

  it('shows description when provided', () => {
    render(
      <FilePushCard
        item={{ ...baseItem, description: 'Test file description' }}
        onPreview={mockOnPreview}
      />
    );
    expect(screen.getByText(/Test file description/)).toBeInTheDocument();
  });

  it('renders image icon for image mime type', () => {
    render(
      <FilePushCard
        item={{ ...baseItem, mimeType: 'image/png' }}
        onPreview={mockOnPreview}
      />
    );
    // Icon is an SVG, just check it renders without error
    expect(screen.getByText('test.txt')).toBeInTheDocument();
  });

  it('renders APK icon for android package', () => {
    render(
      <FilePushCard
        item={{ ...baseItem, mimeType: 'application/vnd.android.package-archive' }}
        onPreview={mockOnPreview}
      />
    );
    expect(screen.getByText('test.txt')).toBeInTheDocument();
  });

  it('renders archive icon for zip files', () => {
    render(
      <FilePushCard
        item={{ ...baseItem, mimeType: 'application/zip' }}
        onPreview={mockOnPreview}
      />
    );
    expect(screen.getByText('test.txt')).toBeInTheDocument();
  });

  it('calls downloadPushedFile on download click', async () => {
    const { downloadPushedFile } = await import('../../../services/fileDownload');
    render(<FilePushCard item={baseItem} onPreview={mockOnPreview} />);
    fireEvent.click(screen.getByText('Download'));
    expect(downloadPushedFile).toHaveBeenCalledWith('f1');
  });

  it('does not download when already downloading', async () => {
    const { downloadPushedFile } = await import('../../../services/fileDownload');
    render(
      <FilePushCard
        item={{ ...baseItem, status: 'downloading', downloadProgress: 50 }}
        onPreview={mockOnPreview}
      />
    );
    // No download button shown during downloading
    expect(screen.queryByText('Download')).not.toBeInTheDocument();
  });

  it('calls dismiss and removes item', async () => {
    const store = await import('../../../stores/filePushStore');
    const removeItem = vi.fn();
    vi.spyOn(store.useFilePushStore, 'getState').mockReturnValue({
      removeItem,
      items: [],
    } as any);

    render(
      <FilePushCard
        item={{ ...baseItem, status: 'completed' }}
        onPreview={mockOnPreview}
      />
    );
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(removeItem).toHaveBeenCalledWith('f1');
  });

  it('opens previewable file in-app', async () => {
    const { isPreviewable } = await import('../FilePreviewModal');
    vi.mocked(isPreviewable).mockReturnValue(true);

    render(
      <FilePushCard
        item={{ ...baseItem, status: 'completed', savedPath: '/path/to/image.png', mimeType: 'image/png' }}
        onPreview={mockOnPreview}
      />
    );
    fireEvent.click(screen.getByText('Open'));
    expect(mockOnPreview).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'test.txt' }));

    vi.mocked(isPreviewable).mockReturnValue(false);
  });

  it('opens non-previewable file with external app', async () => {
    const { openFile, isAndroid } = await import('../../../services/fileDownload');
    const { isPreviewable } = await import('../FilePreviewModal');
    vi.mocked(isPreviewable).mockReturnValue(false);
    vi.mocked(isAndroid).mockReturnValue(false);

    render(
      <FilePushCard
        item={{ ...baseItem, status: 'completed', savedPath: '/path/to/file.pdf' }}
        onPreview={mockOnPreview}
      />
    );
    fireEvent.click(screen.getByText('Open'));
    expect(openFile).toHaveBeenCalledWith('/path/to/file.pdf');
  });

  it('opens file on android with openFileAndroid', async () => {
    const { openFileAndroid, isAndroid } = await import('../../../services/fileDownload');
    const { isPreviewable } = await import('../FilePreviewModal');
    vi.mocked(isPreviewable).mockReturnValue(false);
    vi.mocked(isAndroid).mockReturnValue(true);

    render(
      <FilePushCard
        item={{ ...baseItem, status: 'completed', privatePath: '/data/file.pdf', mimeType: 'application/pdf' }}
        onPreview={mockOnPreview}
      />
    );
    fireEvent.click(screen.getByText('Open'));
    expect(openFileAndroid).toHaveBeenCalledWith('/data/file.pdf', 'application/pdf');

    vi.mocked(isAndroid).mockReturnValue(false);
  });

  it('does nothing when opening file with no path', async () => {
    const { openFile, openFileAndroid, isAndroid } = await import('../../../services/fileDownload');
    const { isPreviewable } = await import('../FilePreviewModal');
    vi.mocked(isPreviewable).mockReturnValue(false);
    vi.mocked(isAndroid).mockReturnValue(false);

    render(
      <FilePushCard
        item={{ ...baseItem, status: 'completed' }}
        onPreview={mockOnPreview}
      />
    );
    // No Open button since hasOpenablePath is false
    expect(screen.queryByText('Open')).not.toBeInTheDocument();
  });

  it('shows folder button on non-android and calls openFolder', async () => {
    const { openFolder, isAndroid } = await import('../../../services/fileDownload');
    vi.mocked(isAndroid).mockReturnValue(false);

    render(
      <FilePushCard
        item={{ ...baseItem, status: 'completed', savedPath: '/path/to/file.txt' }}
        onPreview={mockOnPreview}
      />
    );
    const folderBtn = screen.getByTitle('Show in folder');
    fireEvent.click(folderBtn);
    expect(openFolder).toHaveBeenCalledWith('/path/to/file.txt');
  });

  it('calls downloadPushedFile on retry click for error status', async () => {
    const { downloadPushedFile } = await import('../../../services/fileDownload');
    render(
      <FilePushCard
        item={{ ...baseItem, status: 'error', error: 'Failed' }}
        onPreview={mockOnPreview}
      />
    );
    fireEvent.click(screen.getByText('Retry'));
    expect(downloadPushedFile).toHaveBeenCalledWith('f1');
  });

  it('renders tar archive icon', () => {
    render(
      <FilePushCard
        item={{ ...baseItem, mimeType: 'application/x-tar' }}
        onPreview={mockOnPreview}
      />
    );
    expect(screen.getByText('test.txt')).toBeInTheDocument();
  });

  it('renders gzip archive icon', () => {
    render(
      <FilePushCard
        item={{ ...baseItem, mimeType: 'application/gzip' }}
        onPreview={mockOnPreview}
      />
    );
    expect(screen.getByText('test.txt')).toBeInTheDocument();
  });
});

describe('FilePushNotificationList', () => {
  afterEach(() => {
    cleanup();
  });

  it('returns null when no items for session', () => {
    const { container } = render(<FilePushNotificationList sessionId="s1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders cards for session items', async () => {
    const { __setItems } = await import('../../../stores/filePushStore') as any;
    __setItems([
      {
        fileId: 'f1',
        sessionId: 's1',
        fileName: 'file1.txt',
        fileSize: 1024,
        mimeType: 'text/plain',
        status: 'pending',
        autoDownload: false,
        downloadProgress: 0,
      },
    ]);
    render(<FilePushNotificationList sessionId="s1" />);
    expect(screen.getByText('file1.txt')).toBeInTheDocument();
    __setItems([]); // cleanup
  });
});
