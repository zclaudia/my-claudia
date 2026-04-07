import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import { fileStore } from '../../infrastructure/storage/fileStore.js';
import {
  FileTransferError,
  FileTransferService,
  type FilesRouteBroadcastContext,
} from '../file-transfer-service.js';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock('../../infrastructure/storage/fileStore.js', () => ({
  fileStore: {
    storeFileByMoving: vi.fn(),
    storeFileFromBuffer: vi.fn(),
    storeFileFromPath: vi.fn(),
    getFileMetadata: vi.fn(),
    getFilePath: vi.fn(),
  },
}));

describe('FileTransferService', () => {
  let service: FileTransferService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FileTransferService();
  });

  it('stores uploaded temp files via file store', () => {
    vi.mocked(fileStore.storeFileByMoving).mockReturnValue('file-1');

    const result = service.storeUploadedTempFile({
      path: '/tmp/upload-1',
      originalname: 'test.txt',
      mimetype: 'text/plain',
      size: 12,
    });

    expect(result).toEqual({
      fileId: 'file-1',
      name: 'test.txt',
      mimeType: 'text/plain',
      size: 12,
    });
    expect(fileStore.storeFileByMoving).toHaveBeenCalledWith('/tmp/upload-1', 'test.txt', 'text/plain');
  });

  it('throws NO_FILE when multipart payload has no file', () => {
    expect(() => service.storeUploadedTempFile(undefined)).toThrowError(FileTransferError);
    expect(() => service.storeUploadedTempFile(undefined)).toThrowError('No file provided');
  });

  it('stores JSON uploads after decoding base64', () => {
    vi.mocked(fileStore.storeFileFromBuffer).mockReturnValue('file-2');

    const result = service.storeJsonUpload(
      'test.txt',
      'text/plain',
      Buffer.from('hello').toString('base64'),
    );

    expect(result).toEqual({
      fileId: 'file-2',
      name: 'test.txt',
      mimeType: 'text/plain',
      size: 5,
    });
    expect(fileStore.storeFileFromBuffer).toHaveBeenCalledWith(
      'test.txt',
      'text/plain',
      Buffer.from('hello'),
    );
  });

  it('rejects oversized JSON uploads', () => {
    const data = Buffer.alloc(11 * 1024 * 1024).toString('base64');

    expect(() => service.storeJsonUpload('large.bin', 'application/octet-stream', data)).toThrowError(
      FileTransferError,
    );
  });

  it('resolves download metadata and path', () => {
    vi.mocked(fileStore.getFileMetadata).mockReturnValue({
      id: 'file-3',
      name: 'report.pdf',
      mimeType: 'application/pdf',
      size: 42,
      createdAt: 1,
    });
    vi.mocked(fileStore.getFilePath).mockReturnValue('/store/file-3');

    const result = service.resolveDownload('file-3');

    expect(result).toEqual({
      filePath: '/store/file-3',
      metadata: {
        id: 'file-3',
        name: 'report.pdf',
        mimeType: 'application/pdf',
        size: 42,
        createdAt: 1,
      },
    });
  });

  it('pushes local file and broadcasts notification when context exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      isFile: () => true,
      size: 256,
    } as fs.Stats);
    vi.mocked(fileStore.storeFileFromPath).mockReturnValue('file-4');

    const insertRun = vi.fn();
    const prepare = vi.fn((sql: string) => {
      if (sql.includes('SELECT 1 FROM sessions')) {
        return { get: vi.fn().mockReturnValue({ id: 'sess-1' }) };
      }
      return { run: insertRun };
    });
    const sendMessage = vi.fn();
    const ws = {} as Parameters<typeof sendMessage>[0];
    const ctx: FilesRouteBroadcastContext = {
      db: { prepare } as never,
      getAuthenticatedClients: vi.fn().mockReturnValue([{ ws }]),
      getNextOffset: vi.fn().mockReturnValue(7),
      sendMessage,
    };

    const result = service.pushLocalFile('/tmp/file.txt', 'sess-1', 'hello', ctx);

    expect(result).toEqual({
      fileId: 'file-4',
      fileName: 'file.txt',
      mimeType: 'text/plain',
      fileSize: 256,
      autoDownload: true,
    });
    expect(fileStore.storeFileFromPath).toHaveBeenCalledWith('/tmp/file.txt', 'file.txt', 'text/plain');
    expect(insertRun).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        type: 'file_push',
        sessionId: 'sess-1',
        fileId: 'file-4',
        fileName: 'file.txt',
      }),
    );
  });

  it('rejects push when source path is missing', () => {
    expect(() => service.pushLocalFile(undefined, 'sess-1', undefined)).toThrowError(FileTransferError);
  });
});
