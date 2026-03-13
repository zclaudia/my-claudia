import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  downloadPushedFile,
  isAndroid,
  formatFileSize,
  openFileAndroid,
  openFile,
  openFolder,
} from '../fileDownload.js';

// Mock stores (path from __tests__/ to ../../stores/)
const mockFilePushStoreState = {
  items: [
    {
      fileId: 'file-123',
      fileName: 'test.txt',
      mimeType: 'text/plain',
      fileSize: 12,
      sessionId: 'session-1',
      autoDownload: false,
      status: 'pending' as string,
      downloadProgress: 0,
      createdAt: Date.now(),
    },
  ],
  updateStatus: vi.fn(),
  updateProgress: vi.fn(),
  updateSavedPath: vi.fn(),
  updatePrivatePath: vi.fn(),
};

vi.mock('../../stores/filePushStore', () => ({
  useFilePushStore: {
    getState: () => mockFilePushStoreState,
  },
}));

// Mock API (path from __tests__/ to ../)
vi.mock('../api', () => ({
  getBaseUrl: vi.fn(() => 'http://localhost:3100'),
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer token' })),
}));

// Mock Tauri APIs
vi.mock('@tauri-apps/api/path', () => ({
  downloadDir: vi.fn(() => Promise.resolve('/home/user/Downloads')),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeFile: vi.fn(() => Promise.resolve()),
  exists: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: vi.fn(() => Promise.resolve()),
}));

describe('services/fileDownload', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  const mockTauriInternals = () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: vi.fn(),
        convertFileSrc: vi.fn(),
        metadata: {},
      },
      writable: true,
      configurable: true,
    });
  };

  const removeTauriInternals = () => {
    delete (window as any).__TAURI_INTERNALS__;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    removeTauriInternals();

    // Reset store state
    mockFilePushStoreState.items = [
      {
        fileId: 'file-123',
        fileName: 'test.txt',
        mimeType: 'text/plain',
        fileSize: 12,
        sessionId: 'session-1',
        autoDownload: false,
        status: 'pending',
        downloadProgress: 0,
        createdAt: Date.now(),
      },
    ];
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    removeTauriInternals();
  });

  describe('isAndroid', () => {
    it('returns false when not in Tauri', () => {
      removeTauriInternals();

      expect(isAndroid()).toBe(false);
    });

    it('returns false when in Tauri desktop', () => {
      mockTauriInternals();
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        writable: true,
        configurable: true,
      });

      expect(isAndroid()).toBe(false);
    });

    it('returns true when on Android', () => {
      mockTauriInternals();
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Linux; Android 10)',
        writable: true,
        configurable: true,
      });

      expect(isAndroid()).toBe(true);
    });
  });

  describe('formatFileSize', () => {
    it('formats bytes', () => {
      expect(formatFileSize(500)).toBe('500 B');
    });

    it('formats kilobytes', () => {
      expect(formatFileSize(1024)).toBe('1.0 KB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
    });

    it('formats megabytes', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
      expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
    });

    it('formats gigabytes', () => {
      expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.00 GB');
      expect(formatFileSize(2.5 * 1024 * 1024 * 1024)).toBe('2.50 GB');
    });
  });

  describe('downloadPushedFile', () => {
    it('returns early if file not found in store', async () => {
      mockFilePushStoreState.items = [];

      await downloadPushedFile('nonexistent');

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('No push item found')
      );
    });

    it('updates status to downloading', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({
          'Content-Length': '12',
          'Content-Type': 'text/plain',
        }),
        body: {
          getReader: () => ({
            read: vi.fn()
              .mockResolvedValueOnce({ done: false, value: new Uint8Array([116, 101, 115, 116]) })
              .mockResolvedValueOnce({ done: true }),
          }),
        },
      }));

      // Mock URL and document for browser download fallback
      vi.stubGlobal('URL', {
        createObjectURL: vi.fn(() => 'blob:test'),
        revokeObjectURL: vi.fn(),
      });
      const mockAnchor = { href: '', download: '', click: vi.fn() };
      vi.stubGlobal('document', {
        body: { appendChild: vi.fn(), removeChild: vi.fn() },
        createElement: vi.fn(() => mockAnchor),
      });

      await downloadPushedFile('file-123');

      expect(mockFilePushStoreState.updateStatus).toHaveBeenCalledWith('file-123', 'downloading');
    });

    it('handles download error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      }));

      await downloadPushedFile('file-123');

      expect(mockFilePushStoreState.updateStatus).toHaveBeenCalledWith(
        'file-123',
        'error',
        expect.stringContaining('404')
      );
    });

    it('handles streaming download with progress', async () => {
      const chunks = [
        new Uint8Array([116, 101, 115, 116]),
        new Uint8Array([32, 99, 111, 110, 116, 101, 110, 116]),
      ];

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({
          'Content-Length': '12',
          'Content-Type': 'text/plain',
        }),
        body: {
          getReader: () => ({
            read: vi.fn()
              .mockResolvedValueOnce({ done: false, value: chunks[0] })
              .mockResolvedValueOnce({ done: false, value: chunks[1] })
              .mockResolvedValueOnce({ done: true }),
          }),
        },
      }));

      vi.stubGlobal('URL', {
        createObjectURL: vi.fn(() => 'blob:test'),
        revokeObjectURL: vi.fn(),
      });

      const mockAnchor = { href: '', download: '', click: vi.fn() };
      vi.stubGlobal('document', {
        body: { appendChild: vi.fn(), removeChild: vi.fn() },
        createElement: vi.fn(() => mockAnchor),
      });

      await downloadPushedFile('file-123');

      expect(mockFilePushStoreState.updateProgress).toHaveBeenCalled();
      expect(mockFilePushStoreState.updateStatus).toHaveBeenCalledWith('file-123', 'completed');
    });

    it('falls back to blob download when no streaming', async () => {
      const mockBlob = new Blob(['test content'], { type: 'text/plain' });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({
          'Content-Length': '12',
          'Content-Type': 'text/plain',
        }),
        body: null,
        blob: vi.fn().mockResolvedValue(mockBlob),
      }));

      vi.stubGlobal('URL', {
        createObjectURL: vi.fn(() => 'blob:test'),
        revokeObjectURL: vi.fn(),
      });

      const mockAnchor = { href: '', download: '', click: vi.fn() };
      vi.stubGlobal('document', {
        body: { appendChild: vi.fn(), removeChild: vi.fn() },
        createElement: vi.fn(() => mockAnchor),
      });

      await downloadPushedFile('file-123');

      expect(mockFilePushStoreState.updateStatus).toHaveBeenCalledWith('file-123', 'completed');
    });
  });

  describe('openFileAndroid', () => {
    it('calls AndroidFiles interface when available', () => {
      (window as any).AndroidFiles = {
        openFile: vi.fn(),
      };

      openFileAndroid('/path/to/file.txt', 'text/plain');

      expect((window as any).AndroidFiles.openFile).toHaveBeenCalledWith(
        '/path/to/file.txt',
        'text/plain'
      );

      delete (window as any).AndroidFiles;
    });

    it('handles missing AndroidFiles interface gracefully', () => {
      delete (window as any).AndroidFiles;

      expect(() => openFileAndroid('/path/to/file.txt', 'text/plain')).not.toThrow();
    });

    it('handles errors gracefully', () => {
      (window as any).AndroidFiles = {
        openFile: vi.fn().mockImplementation(() => {
          throw new Error('Android error');
        }),
      };

      expect(() => openFileAndroid('/path/to/file.txt', 'text/plain')).not.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalled();

      delete (window as any).AndroidFiles;
    });
  });

  describe('Tauri integration', () => {
    it('saves file to Downloads folder on Tauri desktop', async () => {
      mockTauriInternals();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({
          'Content-Length': '12',
          'Content-Type': 'text/plain',
        }),
        body: {
          getReader: () => ({
            read: vi.fn().mockResolvedValue({ done: true }),
          }),
        },
      }));

      await downloadPushedFile('file-123');

      expect(mockFilePushStoreState.updateStatus).toHaveBeenCalledWith('file-123', 'completed');
    });

    it('deduplicates files with same name', async () => {
      mockTauriInternals();

      const { exists } = await import('@tauri-apps/plugin-fs');
      vi.mocked(exists)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({
          'Content-Length': '12',
          'Content-Type': 'text/plain',
        }),
        body: {
          getReader: () => ({
            read: vi.fn().mockResolvedValue({ done: true }),
          }),
        },
      }));

      await downloadPushedFile('file-123');

      expect(mockFilePushStoreState.updateStatus).toHaveBeenCalledWith('file-123', 'completed');
    });

    it('saves to Android shared Downloads on Android', async () => {
      mockTauriInternals();
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Linux; Android 10)',
        writable: true,
        configurable: true,
      });

      (window as any).AndroidFiles = {
        saveToDownloads: vi.fn().mockReturnValue('/storage/emulated/0/Download/test.txt'),
        openFile: vi.fn(),
      };

      // Mock Blob.prototype.arrayBuffer for jsdom
      const mockArrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(4));
      const origArrayBuffer = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = mockArrayBuffer;

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({
          'Content-Length': '4',
          'Content-Type': 'text/plain',
        }),
        body: {
          getReader: () => ({
            read: vi.fn()
              .mockResolvedValueOnce({ done: false, value: new Uint8Array([116, 101, 115, 116]) })
              .mockResolvedValueOnce({ done: true }),
          }),
        },
      }));

      await downloadPushedFile('file-123');

      expect(mockFilePushStoreState.updatePrivatePath).toHaveBeenCalled();
      expect(mockFilePushStoreState.updateSavedPath).toHaveBeenCalledWith(
        'file-123',
        '/storage/emulated/0/Download/test.txt'
      );

      delete (window as any).AndroidFiles;
      Blob.prototype.arrayBuffer = origArrayBuffer;
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        writable: true,
        configurable: true,
      });
    });

    it('handles Android saveToDownloads failure gracefully', async () => {
      mockTauriInternals();
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Linux; Android 10)',
        writable: true,
        configurable: true,
      });

      (window as any).AndroidFiles = {
        saveToDownloads: vi.fn().mockImplementation(() => { throw new Error('copy failed'); }),
        openFile: vi.fn(),
      };

      // Mock Blob.prototype.arrayBuffer for jsdom
      const mockArrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(4));
      const origArrayBuffer = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = mockArrayBuffer;

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'Content-Length': '4', 'Content-Type': 'text/plain' }),
        body: {
          getReader: () => ({
            read: vi.fn()
              .mockResolvedValueOnce({ done: false, value: new Uint8Array([116, 101, 115, 116]) })
              .mockResolvedValueOnce({ done: true }),
          }),
        },
      }));

      await downloadPushedFile('file-123');

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to copy to shared Downloads'),
        expect.any(Error)
      );
      // Still saves with privatePath
      expect(mockFilePushStoreState.updateSavedPath).toHaveBeenCalled();

      delete (window as any).AndroidFiles;
      Blob.prototype.arrayBuffer = origArrayBuffer;
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        writable: true,
        configurable: true,
      });
    });

    it('falls back to browser download when Tauri save fails', async () => {
      mockTauriInternals();

      const { writeFile } = await import('@tauri-apps/plugin-fs');
      vi.mocked(writeFile).mockRejectedValueOnce(new Error('write failed'));

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'Content-Length': '4', 'Content-Type': 'text/plain' }),
        body: {
          getReader: () => ({
            read: vi.fn()
              .mockResolvedValueOnce({ done: false, value: new Uint8Array([116, 101, 115, 116]) })
              .mockResolvedValueOnce({ done: true }),
          }),
        },
      }));

      vi.stubGlobal('URL', {
        createObjectURL: vi.fn(() => 'blob:test'),
        revokeObjectURL: vi.fn(),
      });
      const mockAnchor = { href: '', download: '', click: vi.fn() };
      vi.stubGlobal('document', {
        body: { appendChild: vi.fn(), removeChild: vi.fn() },
        createElement: vi.fn(() => mockAnchor),
      });

      await downloadPushedFile('file-123');

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Tauri save failed'),
        expect.any(Error)
      );
      expect(mockFilePushStoreState.updateStatus).toHaveBeenCalledWith('file-123', 'completed');
    });

    it('handles network error during download', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      await downloadPushedFile('file-123');

      expect(mockFilePushStoreState.updateStatus).toHaveBeenCalledWith(
        'file-123',
        'error',
        'Network error'
      );
    });

    it('handles non-Error throw during download', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue('string error'));

      await downloadPushedFile('file-123');

      expect(mockFilePushStoreState.updateStatus).toHaveBeenCalledWith(
        'file-123',
        'error',
        'Download failed'
      );
    });
  });

  describe('openFile', () => {
    it('calls shell open with file path', async () => {
      const { open } = await import('@tauri-apps/plugin-shell');
      await openFile('/path/to/file.txt');
      expect(open).toHaveBeenCalledWith('/path/to/file.txt');
    });
  });

  describe('openFolder', () => {
    it('calls shell open with parent directory', async () => {
      const { open } = await import('@tauri-apps/plugin-shell');
      await openFolder('/path/to/file.txt');
      expect(open).toHaveBeenCalledWith('/path/to');
    });
  });

  describe('openFileAndroid - additional', () => {
    it('uses default mime type when empty', () => {
      (window as any).AndroidFiles = {
        openFile: vi.fn(),
      };

      openFileAndroid('/path/to/file', '');

      expect((window as any).AndroidFiles.openFile).toHaveBeenCalledWith(
        '/path/to/file',
        'application/octet-stream'
      );

      delete (window as any).AndroidFiles;
    });
  });

  describe('streaming without content-length', () => {
    it('downloads without progress tracking when content-length is 0', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'Content-Type': 'text/plain' }),
        body: {
          getReader: () => ({
            read: vi.fn()
              .mockResolvedValueOnce({ done: false, value: new Uint8Array([116, 101, 115, 116]) })
              .mockResolvedValueOnce({ done: true }),
          }),
        },
      }));

      vi.stubGlobal('URL', {
        createObjectURL: vi.fn(() => 'blob:test'),
        revokeObjectURL: vi.fn(),
      });
      const mockAnchor = { href: '', download: '', click: vi.fn() };
      vi.stubGlobal('document', {
        body: { appendChild: vi.fn(), removeChild: vi.fn() },
        createElement: vi.fn(() => mockAnchor),
      });

      await downloadPushedFile('file-123');

      expect(mockFilePushStoreState.updateProgress).not.toHaveBeenCalled();
      expect(mockFilePushStoreState.updateStatus).toHaveBeenCalledWith('file-123', 'completed');
    });
  });
});
