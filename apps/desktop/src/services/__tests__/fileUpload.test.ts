import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  uploadFile,
  validateFile,
  downloadFile,
  readFileAsBase64,
} from '../fileUpload.js';
import type { UploadProgress } from '../fileUpload.js';

// Mock stores
const mockServerStoreState = {
  activeServerId: 'local',
};

vi.mock('../stores/serverStore', () => ({
  useServerStore: {
    getState: () => mockServerStoreState,
  },
}));

vi.mock('../../stores/gatewayStore', () => ({
  isGatewayTarget: vi.fn(() => false),
  parseBackendId: vi.fn((id: string) => id),
  toGatewayServerId: vi.fn((id: string) => `gateway:${id}`),
}));

// Mock API
vi.mock('./api', () => ({
  getBaseUrl: vi.fn(() => 'http://localhost:3100'),
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer token' })),
}));

// Mock FileReader
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

// Mock XMLHttpRequest
class MockXMLHttpRequest {
  status = 200;
  responseText = JSON.stringify({
    success: true,
    data: { fileId: 'file-123', name: 'test.txt', mimeType: 'text/plain', size: 100 },
  });
  upload = {
    addEventListener: vi.fn(),
  };
  addEventListener = vi.fn();
  open = vi.fn();
  send = vi.fn();
}

vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest);

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('services/fileUpload', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('readFileAsBase64', () => {
    it('reads file as base64 string', async () => {
      const file = new File(['test content'], 'test.txt', { type: 'text/plain' });

      const result = await readFileAsBase64(file);

      expect(result).toBe('dGVzdCBkYXRh');
    });
  });

  describe('validateFile', () => {
    it('validates file within size limit', () => {
      const file = new File(['x'.repeat(100)], 'test.txt', { type: 'text/plain' });

      const result = validateFile(file, { maxSize: 1000 });

      expect(result.valid).toBe(true);
    });

    it('rejects file exceeding size limit', () => {
      const file = new File(['x'.repeat(100)], 'test.txt', { type: 'text/plain' });

      const result = validateFile(file, { maxSize: 50 });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceeds');
    });

    it('uses default 10MB limit', () => {
      const file = new File(['x'.repeat(100)], 'test.txt', { type: 'text/plain' });

      const result = validateFile(file);

      expect(result.valid).toBe(true);
    });

    it('validates allowed file types', () => {
      const file = new File(['content'], 'test.txt', { type: 'text/plain' });

      const result = validateFile(file, { allowedTypes: ['text/plain', 'application/json'] });

      expect(result.valid).toBe(true);
    });

    it('rejects disallowed file types', () => {
      const file = new File(['content'], 'test.exe', { type: 'application/octet-stream' });

      const result = validateFile(file, { allowedTypes: ['text/plain', 'application/json'] });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('not allowed');
    });

    it('allows all types when no restriction', () => {
      const file = new File(['content'], 'test.txt', { type: 'text/plain' });

      const result = validateFile(file);

      expect(result.valid).toBe(true);
    });
  });

  describe('uploadFile', () => {
    it('uploads file in direct mode', async () => {
      const file = new File(['test content'], 'test.txt', { type: 'text/plain' });

      const result = await uploadFile(file);

      expect(result.fileId).toBe('file-123');
      expect(result.name).toBe('test.txt');
    });

    it('reports upload progress', async () => {
      const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
      const progressCallback = vi.fn();

      // Mock progress event
      MockXMLHttpRequest.prototype.upload.addEventListener.mockImplementation(
        (event: string, handler: (e: { lengthComputable: boolean; loaded: number; total: number }) => void) => {
          if (event === 'progress') {
            setTimeout(() => handler({ lengthComputable: true, loaded: 50, total: 100 }), 0);
          }
        }
      );

      await uploadFile(file, progressCallback);

      // Progress callback should have been set up
      expect(MockXMLHttpRequest.prototype.upload.addEventListener).toHaveBeenCalledWith(
        'progress',
        expect.any(Function)
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

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/files/upload-json'),
        expect.objectContaining({ method: 'POST' })
      );
      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ percentage: 100 })
      );
    });

    it('handles upload failure', async () => {
      MockXMLHttpRequest.prototype.status = 500;
      MockXMLHttpRequest.prototype.responseText = JSON.stringify({
        success: false,
        error: { message: 'Server error' },
      });

      const file = new File(['test content'], 'test.txt', { type: 'text/plain' });

      await expect(uploadFile(file)).rejects.toThrow();
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
  });

  describe('downloadFile', () => {
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
      expect(result.name).toBe('test.txt');
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
});
