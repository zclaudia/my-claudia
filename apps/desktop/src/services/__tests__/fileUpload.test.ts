import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  uploadFile,
  validateFile,
  downloadFile,
  readFileAsBase64,
} from '../fileUpload.js';
import { isGatewayTarget } from '../../stores/gatewayStore';

const mockServerStoreState = {
  activeServerId: 'local',
};

const mockGatewayStoreState = {
  gatewayUrl: 'http://localhost:3100',
};

vi.mock('../../stores/serverStore', () => ({
  useServerStore: {
    getState: () => mockServerStoreState,
  },
}));

vi.mock('../../stores/gatewayStore', () => ({
  useGatewayStore: {
    getState: () => mockGatewayStoreState,
  },
  isGatewayTarget: vi.fn(() => false),
  parseBackendId: vi.fn((id: string) => id),
  toGatewayServerId: vi.fn((id: string) => `gateway:${id}`),
}));

vi.mock('../api', () => ({
  getBaseUrl: vi.fn(() => 'http://localhost:3100'),
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer token' })),
}));

class MockFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  readAsDataURL = vi.fn(function (this: MockFileReader, file: File) {
    this.result = `data:${file.type};base64,dGVzdCBkYXRh`;
    setTimeout(() => this.onload?.(), 0);
  });
}

vi.stubGlobal('FileReader', MockFileReader);

class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = [];
  static nextStatus = 200;
  static nextResponseText = JSON.stringify({
    success: true,
    data: { fileId: 'file-123', name: 'test.txt', mimeType: 'text/plain', size: 100 },
  });

  status: number;
  responseText: string;
  upload: {
    addEventListener: ReturnType<typeof vi.fn>;
  };
  addEventListener: ReturnType<typeof vi.fn>;
  open = vi.fn();
  send: ReturnType<typeof vi.fn>;
  private listeners = new Map<string, () => void>();
  private progressHandler?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void;

  constructor() {
    this.status = MockXMLHttpRequest.nextStatus;
    this.responseText = MockXMLHttpRequest.nextResponseText;
    this.upload = {
      addEventListener: vi.fn((event: string, handler: (e: { lengthComputable: boolean; loaded: number; total: number }) => void) => {
        if (event === 'progress') this.progressHandler = handler;
      }),
    };
    this.addEventListener = vi.fn((event: string, handler: () => void) => {
      this.listeners.set(event, handler);
    });
    this.send = vi.fn(() => {
      setTimeout(() => {
        this.progressHandler?.({ lengthComputable: true, loaded: 50, total: 100 });
        this.listeners.get('load')?.();
      }, 0);
    });
    MockXMLHttpRequest.instances.push(this);
  }
}

vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest);

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('services/fileUpload', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    MockXMLHttpRequest.instances = [];
    MockXMLHttpRequest.nextStatus = 200;
    MockXMLHttpRequest.nextResponseText = JSON.stringify({
      success: true,
      data: { fileId: 'file-123', name: 'test.txt', mimeType: 'text/plain', size: 100 },
    });
    vi.mocked(isGatewayTarget).mockReturnValue(false);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('reads file as base64 string', async () => {
    const file = new File(['test content'], 'test.txt', { type: 'text/plain' });

    const result = await readFileAsBase64(file);

    expect(result).toBe('dGVzdCBkYXRh');
  });

  it('validates file within size limit', () => {
    const file = new File(['x'.repeat(100)], 'test.txt', { type: 'text/plain' });

    expect(validateFile(file, { maxSize: 1000 })).toEqual({ valid: true });
  });

  it('rejects file exceeding size limit', () => {
    const file = new File(['x'.repeat(100)], 'test.txt', { type: 'text/plain' });

    const result = validateFile(file, { maxSize: 50 });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('exceeds');
  });

  it('validates allowed file types', () => {
    const file = new File(['content'], 'test.txt', { type: 'text/plain' });

    expect(validateFile(file, { allowedTypes: ['text/plain', 'application/json'] })).toEqual({ valid: true });
  });

  it('rejects disallowed file types', () => {
    const file = new File(['content'], 'test.exe', { type: 'application/octet-stream' });

    const result = validateFile(file, { allowedTypes: ['text/plain', 'application/json'] });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('not allowed');
  });

  it('uploads file in direct mode', async () => {
    const file = new File(['test content'], 'test.txt', { type: 'text/plain' });

    const result = await uploadFile(file);

    expect(result.fileId).toBe('file-123');
    expect(result.name).toBe('test.txt');
    expect(MockXMLHttpRequest.instances[0].open).toHaveBeenCalledWith('POST', 'http://localhost:3100/api/files/upload');
  });

  it('reports upload progress in direct mode', async () => {
    const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
    const progressCallback = vi.fn();

    await uploadFile(file, progressCallback);

    const xhr = MockXMLHttpRequest.instances[0];
    expect(xhr.upload.addEventListener).toHaveBeenCalledWith('progress', expect.any(Function));
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({ loaded: 50, total: 100, percentage: 50 }),
    );
  });

  it('uploads file in gateway mode', async () => {
    const { isGatewayTarget } = await import('../../stores/gatewayStore');
    vi.mocked(isGatewayTarget).mockReturnValue(true);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: { fileId: 'gw-file-123', name: 'test.txt', mimeType: 'text/plain', size: 100 },
        }),
    });

    const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
    const progressCallback = vi.fn();
    const result = await uploadFile(file, progressCallback);

    expect(result.fileId).toBe('gw-file-123');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3100/api/files/upload-json',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({ loaded: file.size, total: file.size, percentage: 100 }),
    );
  });

  it('handles direct upload failure', async () => {
    MockXMLHttpRequest.nextStatus = 500;
    MockXMLHttpRequest.nextResponseText = JSON.stringify({
      success: false,
      error: { message: 'Server error' },
    });

    const file = new File(['test content'], 'test.txt', { type: 'text/plain' });

    await expect(uploadFile(file)).rejects.toThrow('Upload failed with status 500');
  });

  it('handles gateway mode upload failure', async () => {
    const { isGatewayTarget } = await import('../../stores/gatewayStore');
    vi.mocked(isGatewayTarget).mockReturnValue(true);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const file = new File(['test content'], 'test.txt', { type: 'text/plain' });

    await expect(uploadFile(file)).rejects.toThrow('Upload failed with status 500');
  });

  it('downloads file data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            fileId: 'file-123',
            name: 'test.txt',
            mimeType: 'text/plain',
            data: 'dGVzdCBkYXRh',
          },
        }),
    });

    const result = await downloadFile('file-123');

    expect(result.fileId).toBe('file-123');
    expect(result.data).toBe('dGVzdCBkYXRh');
  });

  it('handles download failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    await expect(downloadFile('nonexistent')).rejects.toThrow('Download failed with status 404');
  });

  it('handles error response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: false,
          error: { message: 'File not found' },
        }),
    });

    await expect(downloadFile('nonexistent')).rejects.toThrow('File not found');
  });
});
