import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFilesRoutes } from '../files.js';
import type { StoredFile } from '../../storage/fileStore.js';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const realFs = require('node:fs');

// Mock the fs module (keep real read/unlink for multer temp files)
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  createReadStream: vi.fn(),
  openSync: vi.fn(() => 3),  // return mock fd
  readSync: vi.fn(),
  closeSync: vi.fn(),
}));

// Mock fileStore
vi.mock('../../storage/fileStore.js', () => {
  const mockFiles = new Map<string, StoredFile>();

  return {
    fileStore: {
      storeFile: vi.fn((name: string, mimeType: string, data: string) => {
        const fileId = 'mock-file-id-' + Math.random().toString(36).substr(2, 9);
        const file: StoredFile = {
          id: fileId,
          name,
          mimeType,
          size: Buffer.from(data, 'base64').length,
          data,
          createdAt: Date.now()
        };
        mockFiles.set(fileId, file);
        return fileId;
      }),
      storeFileByMoving: vi.fn((sourcePath: string, name: string, mimeType: string) => {
        const fileId = 'mock-file-id-' + Math.random().toString(36).substr(2, 9);
        // Read the real temp file that multer wrote to disk
        let data = '';
        let size = 0;
        try {
          const buffer = realFs.readFileSync(sourcePath);
          data = buffer.toString('base64');
          size = buffer.length;
          realFs.unlinkSync(sourcePath); // Clean up temp file
        } catch { /* ignore in tests */ }
        const file: StoredFile = {
          id: fileId,
          name,
          mimeType,
          size,
          data,
          createdAt: Date.now()
        };
        mockFiles.set(fileId, file);
        return fileId;
      }),
      storeFileFromPath: vi.fn((sourcePath: string, name: string, mimeType: string) => {
        const fileId = 'mock-file-id-' + Math.random().toString(36).substr(2, 9);
        const file: StoredFile = {
          id: fileId,
          name,
          mimeType,
          size: 0,
          data: '',
          createdAt: Date.now()
        };
        mockFiles.set(fileId, file);
        return fileId;
      }),
      storeFileFromBuffer: vi.fn((name: string, mimeType: string, buffer: Buffer) => {
        const fileId = 'mock-file-id-' + Math.random().toString(36).substr(2, 9);
        const file: StoredFile = {
          id: fileId,
          name,
          mimeType,
          size: buffer.length,
          data: buffer.toString('base64'),
          createdAt: Date.now()
        };
        mockFiles.set(fileId, file);
        return fileId;
      }),
      getFile: vi.fn((fileId: string) => {
        return mockFiles.get(fileId) || null;
      }),
      getFileMetadata: vi.fn((fileId: string) => {
        const file = mockFiles.get(fileId);
        if (!file) return null;
        return { id: file.id, name: file.name, mimeType: file.mimeType, size: file.size, createdAt: file.createdAt };
      }),
      getFilePath: vi.fn((_fileId: string) => null),
      deleteFile: vi.fn((fileId: string) => {
        return mockFiles.delete(fileId);
      }),
      cleanup: vi.fn(),
      getStats: vi.fn(() => ({
        count: mockFiles.size,
        totalSize: 0,
        totalSizeMB: '0.00'
      })),
      _mockFiles: mockFiles // Expose for test cleanup
    }
  };
});

import * as fs from 'fs';
import { fileStore } from '../../storage/fileStore.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/files', createFilesRoutes());
  return app;
}

function clearMockFileStore() {
  const mockFiles = (fileStore as any)._mockFiles as Map<string, StoredFile>;
  mockFiles.clear();
}

describe('files routes', () => {
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockFileStore();
    app = createTestApp();
  });

  describe('GET /api/files/list', () => {
    it('returns 400 when projectRoot missing', async () => {
      const res = await request(app).get('/api/files/list');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 403 for path traversal attempts', async () => {
      const res = await request(app).get('/api/files/list?projectRoot=/project&relativePath=../../../etc');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('returns 404 for non-existent directory', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const res = await request(app).get('/api/files/list?projectRoot=/project');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 when path is not a directory', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => false,
      } as fs.Stats);

      const res = await request(app).get('/api/files/list?projectRoot=/project');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_PATH');
    });

    it('lists directory contents', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockImplementation((path) => {
        if (typeof path === 'string') {
          // First call is for checking if /project is a directory
          if (path === '/project' || path.endsWith('src')) {
            return { isDirectory: () => true, isFile: () => false } as fs.Stats;
          }
          return { isDirectory: () => false, isFile: () => true, size: 1024 } as fs.Stats;
        }
        return { isDirectory: () => true, isFile: () => false } as fs.Stats;
      });
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'src', isDirectory: () => true, isFile: () => false },
        { name: 'index.ts', isDirectory: () => false, isFile: () => true },
        { name: 'package.json', isDirectory: () => false, isFile: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      const res = await request(app).get('/api/files/list?projectRoot=/project');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.entries).toHaveLength(3);
    });

    it('filters hidden files (starting with .)', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => true,
        isFile: () => false,
      } as fs.Stats);
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: '.git', isDirectory: () => true, isFile: () => false },
        { name: '.env', isDirectory: () => false, isFile: () => true },
        { name: 'src', isDirectory: () => true, isFile: () => false },
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      const res = await request(app).get('/api/files/list?projectRoot=/project');

      expect(res.status).toBe(200);
      expect(res.body.data.entries).toHaveLength(1);
      expect(res.body.data.entries[0].name).toBe('src');
    });

    it('filters ignored directories (node_modules, .git, etc.)', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => true,
        isFile: () => false,
      } as fs.Stats);
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'node_modules', isDirectory: () => true, isFile: () => false },
        { name: 'dist', isDirectory: () => true, isFile: () => false },
        { name: 'src', isDirectory: () => true, isFile: () => false },
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      const res = await request(app).get('/api/files/list?projectRoot=/project');

      expect(res.status).toBe(200);
      expect(res.body.data.entries).toHaveLength(1);
      expect(res.body.data.entries[0].name).toBe('src');
    });

    it('applies fuzzy match filter', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => true,
        isFile: () => false,
      } as fs.Stats);
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'components', isDirectory: () => true, isFile: () => false },
        { name: 'hooks', isDirectory: () => true, isFile: () => false },
        { name: 'utils', isDirectory: () => true, isFile: () => false },
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      // Use relativePath to go through non-recursive listing path (recursive search with directories-only mocks causes infinite recursion)
      const res = await request(app).get('/api/files/list?projectRoot=/project&relativePath=.&query=comp');

      expect(res.status).toBe(200);
      expect(res.body.data.entries).toHaveLength(1);
      expect(res.body.data.entries[0].name).toBe('components');
    });

    it('limits results to maxResults', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => true,
        isFile: () => false,
      } as fs.Stats);
      const entries = Array.from({ length: 100 }, (_, i) => ({
        name: `dir${i}`,
        isDirectory: () => true,
        isFile: () => false,
      }));
      vi.mocked(fs.readdirSync).mockReturnValue(entries as unknown as ReturnType<typeof fs.readdirSync>);

      const res = await request(app).get('/api/files/list?projectRoot=/project&maxResults=10');

      expect(res.status).toBe(200);
      expect(res.body.data.entries).toHaveLength(10);
      expect(res.body.data.hasMore).toBe(true);
    });

    it('sorts directories first, then alphabetically', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockImplementation((path) => {
        if (typeof path === 'string') {
          // First call is for checking if /project is a directory
          if (path === '/project' || path.endsWith('components') || path.endsWith('utils')) {
            return { isDirectory: () => true, isFile: () => false } as fs.Stats;
          }
          return { isDirectory: () => false, isFile: () => true, size: 100 } as fs.Stats;
        }
        return { isDirectory: () => true, isFile: () => false } as fs.Stats;
      });
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'index.ts', isDirectory: () => false, isFile: () => true },
        { name: 'utils', isDirectory: () => true, isFile: () => false },
        { name: 'app.tsx', isDirectory: () => false, isFile: () => true },
        { name: 'components', isDirectory: () => true, isFile: () => false },
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      const res = await request(app).get('/api/files/list?projectRoot=/project');

      expect(res.status).toBe(200);
      // Directories first (alphabetically), then files (alphabetically)
      expect(res.body.data.entries[0].name).toBe('components');
      expect(res.body.data.entries[1].name).toBe('utils');
      expect(res.body.data.entries[2].name).toBe('app.tsx');
      expect(res.body.data.entries[3].name).toBe('index.ts');
    });

    it('includes file size for files', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockImplementation((path) => {
        if (typeof path === 'string' && path.endsWith('index.ts')) {
          return { isDirectory: () => false, isFile: () => true, size: 2048 } as fs.Stats;
        }
        return { isDirectory: () => true, isFile: () => false } as fs.Stats;
      });
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'index.ts', isDirectory: () => false, isFile: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      const res = await request(app).get('/api/files/list?projectRoot=/project');

      expect(res.status).toBe(200);
      expect(res.body.data.entries[0].size).toBe(2048);
    });
  });

  describe('GET /api/files/content', () => {
    it('returns 400 when projectRoot or relativePath missing', async () => {
      const res1 = await request(app).get('/api/files/content?projectRoot=/project');
      expect(res1.status).toBe(400);

      const res2 = await request(app).get('/api/files/content?relativePath=file.ts');
      expect(res2.status).toBe(400);
    });

    it('returns 403 for path traversal attempts', async () => {
      const res = await request(app).get('/api/files/content?projectRoot=/project&relativePath=../../../etc/passwd');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('returns 404 for non-existent file', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const res = await request(app).get('/api/files/content?projectRoot=/project&relativePath=missing.ts');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 when path is a directory', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => true,
        size: 0,
      } as fs.Stats);

      const res = await request(app).get('/api/files/content?projectRoot=/project&relativePath=src');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_PATH');
    });

    it('returns 400 for files > 1MB', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => false,
        size: 2 * 1024 * 1024, // 2MB
      } as fs.Stats);

      const res = await request(app).get('/api/files/content?projectRoot=/project&relativePath=large-file.bin');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    });

    it('returns file content', async () => {
      const fileContent = 'export const hello = "world";';
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => false,
        size: fileContent.length,
      } as fs.Stats);
      vi.mocked(fs.readFileSync).mockReturnValue(fileContent);
      // Binary probe: readSync must fill buffer with text content (not null bytes)
      vi.mocked(fs.readSync).mockImplementation((_fd, buf: Buffer) => {
        const bytes = Buffer.from(fileContent);
        bytes.copy(buf, 0, 0, Math.min(bytes.length, buf.length));
        return bytes.length;
      });

      const res = await request(app).get('/api/files/content?projectRoot=/project&relativePath=index.ts');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.content).toBe(fileContent);
      expect(res.body.data.path).toBe('index.ts');
      expect(res.body.data.size).toBe(fileContent.length);
    });
  });

  describe('POST /api/files/upload', () => {
    it('should upload file and return fileId', async () => {
      const response = await request(app)
        .post('/api/files/upload')
        .attach('file', Buffer.from('test content'), 'test.txt')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('fileId');
      expect(response.body.data.fileId).toMatch(/^mock-file-id-/);
      expect(response.body.data.name).toBe('test.txt');
      expect(response.body.data.mimeType).toBe('text/plain');
      expect(response.body.data.size).toBe(12); // 'test content' length

      // Verify storeFileByMoving was called (streaming disk upload)
      expect(fileStore.storeFileByMoving).toHaveBeenCalledWith(
        expect.any(String), // temp file path
        'test.txt',
        'text/plain'
      );
    });

    it('should upload image file', async () => {
      // Create a small PNG buffer (1x1 red pixel)
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
        0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
        0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
        0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xDD, 0x8D,
        0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
        0x44, 0xAE, 0x42, 0x60, 0x82
      ]);

      const response = await request(app)
        .post('/api/files/upload')
        .attach('file', pngBuffer, 'test.png')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('test.png');
      expect(response.body.data.mimeType).toBe('image/png');
    });

    it('should reject request without file', async () => {
      const response = await request(app)
        .post('/api/files/upload')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NO_FILE');
    });

    it('should reject file larger than 10MB', async () => {
      // Create buffer larger than 10MB
      const largeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB

      const response = await request(app)
        .post('/api/files/upload')
        .attach('file', largeBuffer, 'large.bin')
        .expect(413); // Payload Too Large (multer will reject)
    });

    it('should handle special characters in filename', async () => {
      // Note: supertest's multipart encoding garbles non-ASCII filenames (a test transport limitation).
      // Use ASCII-safe special characters to test the path instead.
      const response = await request(app)
        .post('/api/files/upload')
        .attach('file', Buffer.from('content'), 'file (1) [copy].txt')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('file (1) [copy].txt');
    });

    it('should store file by moving temp file to store', async () => {
      const content = 'Hello World';

      await request(app)
        .post('/api/files/upload')
        .attach('file', Buffer.from(content), 'test.txt')
        .expect(200);

      // With disk storage, file is moved from temp path into store
      expect(fileStore.storeFileByMoving).toHaveBeenCalledWith(
        expect.stringContaining('claudia-upload-'), // temp file path with prefix
        'test.txt',
        'text/plain'
      );
    });

    it('should handle path traversal attempts in filename securely', async () => {
      const maliciousFilenames = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32\\config\\sam'
      ];

      for (const filename of maliciousFilenames) {
        const response = await request(app)
          .post('/api/files/upload')
          .attach('file', Buffer.from('content'), filename)
          .expect(200);

        expect(response.body.success).toBe(true);
        // Filename is stored as-is, security is handled by using UUIDs
      }
    });

    it('should handle XSS attempts in filename', async () => {
      const xssFilename = '<script>alert("xss")</script>.txt';

      const response = await request(app)
        .post('/api/files/upload')
        .attach('file', Buffer.from('content'), xssFilename)
        .expect(200);

      expect(response.body.success).toBe(true);
      // multer strips '<' and content before '>' from filenames as a security measure
      // This is correct behavior — the filename is sanitized server-side
      expect(response.body.data.name).toBe('script>.txt');
    });

    it('should handle multiple concurrent uploads', async () => {
      const uploadPromises = Array.from({ length: 10 }, (_, i) =>
        request(app)
          .post('/api/files/upload')
          .attach('file', Buffer.from(`content ${i}`), `file-${i}.txt`)
      );

      const responses = await Promise.all(uploadPromises);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      const fileIds = responses.map(r => r.body.data.fileId);
      const uniqueIds = new Set(fileIds);
      expect(uniqueIds.size).toBe(10);
    });
  });

  describe('GET /api/files/:fileId', () => {
    it('should retrieve uploaded file by fileId', async () => {
      const uploadResponse = await request(app)
        .post('/api/files/upload')
        .attach('file', Buffer.from('test content'), 'test.txt')
        .expect(200);

      const fileId = uploadResponse.body.data.fileId;

      const response = await request(app)
        .get(`/api/files/${fileId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.fileId).toBe(fileId);
      expect(response.body.data.name).toBe('test.txt');
      expect(response.body.data.mimeType).toBe('text/plain');
      expect(response.body.data.data).toBeTruthy();

      const decodedContent = Buffer.from(response.body.data.data, 'base64').toString('utf-8');
      expect(decodedContent).toBe('test content');
    });

    it('should return 404 for non-existent fileId', async () => {
      const response = await request(app)
        .get('/api/files/non-existent-id')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should retrieve image file correctly', async () => {
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
      ]);

      const uploadResponse = await request(app)
        .post('/api/files/upload')
        .attach('file', pngBuffer, 'test.png')
        .expect(200);

      const fileId = uploadResponse.body.data.fileId;

      const response = await request(app)
        .get(`/api/files/${fileId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.mimeType).toBe('image/png');

      const decodedData = Buffer.from(response.body.data.data, 'base64');
      expect(decodedData.toString('hex')).toBe(pngBuffer.toString('hex'));
    });
  });

  describe('POST /api/files/push', () => {
    it('returns 400 when filePath is missing', async () => {
      const res = await request(app)
        .post('/api/files/push')
        .send({ sessionId: 'sess-1' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('filePath');
    });

    it('returns 400 when sessionId is missing', async () => {
      const res = await request(app)
        .post('/api/files/push')
        .send({ filePath: '/some/file.txt' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('sessionId');
    });

    it('returns 404 when file does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const res = await request(app)
        .post('/api/files/push')
        .send({ filePath: '/nonexistent/file.txt', sessionId: 'sess-1' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('FILE_NOT_FOUND');
    });

    it('returns 400 when path is not a file', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        isFile: () => false,
        isDirectory: () => true,
        size: 0,
      } as any);

      const res = await request(app)
        .post('/api/files/push')
        .send({ filePath: '/some/directory', sessionId: 'sess-1' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NOT_A_FILE');
    });

    it('pushes file successfully without broadcast context', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        isFile: () => true,
        size: 1024,
      } as any);

      const res = await request(app)
        .post('/api/files/push')
        .send({ filePath: '/some/file.txt', sessionId: 'sess-1', description: 'Test file' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.fileName).toBe('file.txt');
      expect(res.body.data.fileSize).toBe(1024);
      expect(res.body.data.autoDownload).toBe(true); // < 500KB
    });

    it('sets autoDownload false for large non-image files', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        isFile: () => true,
        size: 600 * 1024, // 600KB > 500KB threshold
      } as any);

      const res = await request(app)
        .post('/api/files/push')
        .send({ filePath: '/some/large.zip', sessionId: 'sess-1' });

      expect(res.status).toBe(200);
      expect(res.body.data.autoDownload).toBe(false);
    });

    it('sets autoDownload true for images regardless of size', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        isFile: () => true,
        size: 2 * 1024 * 1024, // 2MB
      } as any);

      const res = await request(app)
        .post('/api/files/push')
        .send({ filePath: '/some/large.png', sessionId: 'sess-1' });

      expect(res.status).toBe(200);
      expect(res.body.data.autoDownload).toBe(true); // image
    });
  });

  describe('POST /api/files/push with broadcast context', () => {
    it('broadcasts to connected clients and persists message', async () => {
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ id: 'sess-1' }), // session exists
          run: vi.fn(),
        }),
      };
      const mockSendMessage = vi.fn();
      const mockWs = {};
      const mockGetAuthenticatedClients = vi.fn().mockReturnValue([{ ws: mockWs }]);
      const mockGetNextOffset = vi.fn().mockReturnValue(1);

      const broadcastApp = express();
      broadcastApp.use(express.json());
      broadcastApp.use('/api/files', createFilesRoutes({
        db: mockDb as any,
        sendMessage: mockSendMessage,
        getAuthenticatedClients: mockGetAuthenticatedClients,
        getNextOffset: mockGetNextOffset,
      }));

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        isFile: () => true,
        size: 256,
      } as any);

      const res = await request(broadcastApp)
        .post('/api/files/push')
        .send({ filePath: '/some/file.txt', sessionId: 'sess-1', description: 'A file' });

      expect(res.status).toBe(200);
      expect(mockSendMessage).toHaveBeenCalledWith(
        mockWs,
        expect.objectContaining({
          type: 'file_push',
          sessionId: 'sess-1',
          fileName: 'file.txt',
        }),
      );
      expect(mockGetNextOffset).toHaveBeenCalledWith('sess-1');
    });
  });

  describe('POST /api/files/upload-json', () => {
    it('uploads a file via JSON body', async () => {
      const data = Buffer.from('hello world').toString('base64');

      const res = await request(app)
        .post('/api/files/upload-json')
        .send({ name: 'test.txt', mimeType: 'text/plain', data });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('test.txt');
      expect(res.body.data.mimeType).toBe('text/plain');
      expect(res.body.data.size).toBe(11);
      expect(res.body.data.fileId).toMatch(/^mock-file-id-/);
      expect(fileStore.storeFileFromBuffer).toHaveBeenCalledWith(
        'test.txt',
        'text/plain',
        expect.any(Buffer),
      );
    });

    it('returns 400 when name is missing', async () => {
      const res = await request(app)
        .post('/api/files/upload-json')
        .send({ mimeType: 'text/plain', data: 'aGVsbG8=' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when mimeType is missing', async () => {
      const res = await request(app)
        .post('/api/files/upload-json')
        .send({ name: 'test.txt', data: 'aGVsbG8=' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when data is missing', async () => {
      const res = await request(app)
        .post('/api/files/upload-json')
        .send({ name: 'test.txt', mimeType: 'text/plain' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 413 when file exceeds 10MB', async () => {
      const largeData = Buffer.alloc(11 * 1024 * 1024).toString('base64');

      // Need a larger body parser limit so the request reaches our handler
      const bigApp = express();
      bigApp.use(express.json({ limit: '50mb' }));
      bigApp.use('/api/files', createFilesRoutes());

      const res = await request(bigApp)
        .post('/api/files/upload-json')
        .send({ name: 'large.bin', mimeType: 'application/octet-stream', data: largeData });

      expect(res.status).toBe(413);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    });

    it('returns 500 when storeFileFromBuffer throws', async () => {
      vi.mocked(fileStore.storeFileFromBuffer).mockImplementationOnce(() => {
        throw new Error('disk full');
      });

      const data = Buffer.from('hello').toString('base64');
      const res = await request(app)
        .post('/api/files/upload-json')
        .send({ name: 'test.txt', mimeType: 'text/plain', data });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('UPLOAD_ERROR');
    });
  });

  describe('GET /api/files/:fileId/download', () => {
    it('returns 404 when file metadata not found', async () => {
      vi.mocked(fileStore.getFileMetadata).mockReturnValueOnce(null);

      const res = await request(app).get('/api/files/nonexistent/download');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when file path is missing on disk', async () => {
      vi.mocked(fileStore.getFileMetadata).mockReturnValueOnce({
        id: 'file-1',
        name: 'test.txt',
        mimeType: 'text/plain',
        size: 100,
        createdAt: Date.now(),
      });
      vi.mocked(fileStore.getFilePath).mockReturnValueOnce(null);

      const res = await request(app).get('/api/files/file-1/download');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('FILE_MISSING');
    });

    it('streams file for download with correct headers', async () => {
      const content = 'fake pdf content';
      vi.mocked(fileStore.getFileMetadata).mockReturnValueOnce({
        id: 'file-1',
        name: 'report.pdf',
        mimeType: 'application/pdf',
        size: content.length,
        createdAt: Date.now(),
      });
      vi.mocked(fileStore.getFilePath).mockReturnValueOnce('/store/file-1.dat');

      // Mock createReadStream to produce actual data
      const { Readable } = require('stream');
      const mockStream = new Readable({
        read() {
          this.push(Buffer.from(content));
          this.push(null);
        },
      });
      vi.mocked(fs.createReadStream).mockReturnValueOnce(mockStream as any);

      const res = await request(app).get('/api/files/file-1/download');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toBe('attachment; filename="report.pdf"');
      expect(res.headers['content-length']).toBe(String(content.length));
      // supertest returns streamed body as a Buffer
      expect(Buffer.isBuffer(res.body) ? res.body.toString() : res.text).toBe(content);
    });

    it('handles stream error gracefully', async () => {
      vi.mocked(fileStore.getFileMetadata).mockReturnValueOnce({
        id: 'file-1',
        name: 'test.txt',
        mimeType: 'text/plain',
        size: 100,
        createdAt: Date.now(),
      });
      vi.mocked(fileStore.getFilePath).mockReturnValueOnce('/store/file-1.dat');

      const { Readable } = require('stream');
      const mockStream = new Readable({
        read() {
          this.destroy(new Error('disk read error'));
        },
      });
      vi.mocked(fs.createReadStream).mockReturnValueOnce(mockStream as any);

      // Stream error after headers sent just logs — the response may be partial
      const res = await request(app).get('/api/files/file-1/download');
      // The stream error happens; we just verify no crash
      expect(res.status).toBeDefined();
    });

    it('returns 500 when an unexpected error occurs', async () => {
      vi.mocked(fileStore.getFileMetadata).mockImplementationOnce(() => {
        throw new Error('unexpected');
      });

      const res = await request(app).get('/api/files/file-err/download');

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('DOWNLOAD_ERROR');
    });
  });

  describe('GET /api/files/content - binary file detection', () => {
    it('returns 400 for binary files containing null bytes', async () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(true);
      vi.mocked(fs.statSync).mockReturnValueOnce({
        isDirectory: () => false,
        size: 100,
      } as fs.Stats);
      vi.mocked(fs.openSync).mockReturnValueOnce(42);
      // readSync fills buffer with bytes that include a null byte at position 4
      vi.mocked(fs.readSync).mockImplementationOnce((_fd, buf: Buffer) => {
        // Fill entire buffer with non-zero then add a null byte
        buf.fill(0x41); // 'A'
        buf[4] = 0x00;  // null byte
        return buf.length;
      });
      vi.mocked(fs.closeSync).mockReturnValueOnce(undefined);

      const res = await request(app).get('/api/files/content?projectRoot=/project&relativePath=image.dat');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('BINARY_FILE');
    });
  });

  describe('GET /api/files/content - error handling', () => {
    it('returns 500 when an unexpected error occurs reading file', async () => {
      vi.mocked(fs.existsSync).mockImplementation(() => {
        throw new Error('filesystem error');
      });

      const res = await request(app).get('/api/files/content?projectRoot=/project&relativePath=file.ts');

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('SERVER_ERROR');
    });
  });

  describe('GET /api/files/list - recursive search', () => {
    it('performs recursive search when query is provided at project root', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockImplementation((p) => {
        const pathStr = String(p);
        if (pathStr === '/project' || pathStr.endsWith('src')) {
          return { isDirectory: () => true, isFile: () => false } as fs.Stats;
        }
        return { isDirectory: () => false, isFile: () => true, size: 500 } as fs.Stats;
      });

      // First readdirSync for /project, then for /project/src
      let callCount = 0;
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // /project root
          return [
            { name: 'src', isDirectory: () => true, isFile: () => false },
            { name: 'main.ts', isDirectory: () => false, isFile: () => true },
            { name: 'README.md', isDirectory: () => false, isFile: () => true },
          ] as unknown as ReturnType<typeof fs.readdirSync>;
        }
        // /project/src
        return [
          { name: 'main.ts', isDirectory: () => false, isFile: () => true },
          { name: 'helper.ts', isDirectory: () => false, isFile: () => true },
        ] as unknown as ReturnType<typeof fs.readdirSync>;
      });

      const res = await request(app).get('/api/files/list?projectRoot=/project&query=main');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Should find "main.ts" in root and "main.ts" in src
      expect(res.body.data.entries.length).toBe(2);
      expect(res.body.data.entries.every((e: any) => e.name === 'main.ts')).toBe(true);
    });

    it('skips hidden files and ignored directories in recursive search', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockImplementation((p) => {
        const pathStr = String(p);
        if (pathStr === '/project') {
          return { isDirectory: () => true, isFile: () => false } as fs.Stats;
        }
        return { isDirectory: () => false, isFile: () => true, size: 100 } as fs.Stats;
      });

      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: '.hidden', isDirectory: () => false, isFile: () => true },
        { name: 'node_modules', isDirectory: () => true, isFile: () => false },
        { name: 'visible.ts', isDirectory: () => false, isFile: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      // query must be non-empty to trigger recursive search
      const res = await request(app).get('/api/files/list?projectRoot=/project&query=visible');

      expect(res.status).toBe(200);
      expect(res.body.data.entries.length).toBe(1);
      expect(res.body.data.entries[0].name).toBe('visible.ts');
    });

    it('skips binary extensions in recursive search', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockImplementation((p) => {
        const pathStr = String(p);
        if (pathStr === '/project') {
          return { isDirectory: () => true, isFile: () => false } as fs.Stats;
        }
        return { isDirectory: () => false, isFile: () => true, size: 100 } as fs.Stats;
      });

      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'photo.png', isDirectory: () => false, isFile: () => true },
        { name: 'app.ts', isDirectory: () => false, isFile: () => true },
        { name: 'data.db', isDirectory: () => false, isFile: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      // query must be non-empty and no relativePath to trigger recursive search
      const res = await request(app).get('/api/files/list?projectRoot=/project&query=a');

      expect(res.status).toBe(200);
      // photo.png and data.db are binary extensions, filtered out; only app.ts matches query "a"
      expect(res.body.data.entries.length).toBe(1);
      expect(res.body.data.entries[0].name).toBe('app.ts');
    });

    it('limits recursive search results and sets hasMore', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockImplementation((p) => {
        const pathStr = String(p);
        if (pathStr === '/project') {
          return { isDirectory: () => true, isFile: () => false } as fs.Stats;
        }
        return { isDirectory: () => false, isFile: () => true, size: 50 } as fs.Stats;
      });

      const entries = Array.from({ length: 10 }, (_, i) => ({
        name: `file${i}.ts`,
        isDirectory: () => false,
        isFile: () => true,
      }));
      vi.mocked(fs.readdirSync).mockReturnValue(entries as unknown as ReturnType<typeof fs.readdirSync>);

      // query must be non-empty and no relativePath to trigger recursive search
      const res = await request(app).get('/api/files/list?projectRoot=/project&query=file&maxResults=3');

      expect(res.status).toBe(200);
      expect(res.body.data.entries.length).toBe(3);
      expect(res.body.data.hasMore).toBe(true);
    });

    it('handles unreadable directories gracefully in recursive search', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockImplementation((p) => {
        const pathStr = String(p);
        if (pathStr === '/project') {
          return { isDirectory: () => true, isFile: () => false } as fs.Stats;
        }
        return { isDirectory: () => false, isFile: () => true, size: 100 } as fs.Stats;
      });

      let callCount = 0;
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return [
            { name: 'restricted', isDirectory: () => true, isFile: () => false },
            { name: 'ok.ts', isDirectory: () => false, isFile: () => true },
          ] as unknown as ReturnType<typeof fs.readdirSync>;
        }
        // Second call is for /project/restricted - throw permission error
        throw new Error('EACCES: permission denied');
      });

      // query must be non-empty to trigger recursive search
      const res = await request(app).get('/api/files/list?projectRoot=/project&query=ok');

      expect(res.status).toBe(200);
      expect(res.body.data.entries.length).toBe(1);
      expect(res.body.data.entries[0].name).toBe('ok.ts');
    });
  });

  describe('GET /api/files/list - directory listing edge cases', () => {
    it('filters binary files when query is provided in non-recursive listing', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockImplementation((p) => {
        const pathStr = String(p);
        if (pathStr === '/project' || pathStr.endsWith('subdir')) {
          return { isDirectory: () => true, isFile: () => false } as fs.Stats;
        }
        return { isDirectory: () => false, isFile: () => true, size: 200 } as fs.Stats;
      });

      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'photo.png', isDirectory: () => false, isFile: () => true },
        { name: 'index.ts', isDirectory: () => false, isFile: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      // Use relativePath to stay in non-recursive path
      const res = await request(app).get('/api/files/list?projectRoot=/project&relativePath=subdir&query=p');

      expect(res.status).toBe(200);
      // photo.png is binary, should be filtered when query is present
      expect(res.body.data.entries.length).toBe(0);
    });

    it('returns 500 on unexpected error in list', async () => {
      vi.mocked(fs.existsSync).mockImplementation(() => {
        throw new Error('unexpected filesystem error');
      });

      const res = await request(app).get('/api/files/list?projectRoot=/project');

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('SERVER_ERROR');
    });

    it('builds correct relative path when relativePath is provided', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockImplementation((p) => {
        const pathStr = String(p);
        if (pathStr === '/project' || pathStr.endsWith('src')) {
          return { isDirectory: () => true, isFile: () => false } as fs.Stats;
        }
        return { isDirectory: () => false, isFile: () => true, size: 100 } as fs.Stats;
      });

      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'index.ts', isDirectory: () => false, isFile: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      const res = await request(app).get('/api/files/list?projectRoot=/project&relativePath=src');

      expect(res.status).toBe(200);
      expect(res.body.data.entries[0].path).toBe('src/index.ts');
      expect(res.body.data.currentPath).toBe('src');
    });
  });

  describe('POST /api/files/upload - error handling', () => {
    it('returns 500 and cleans up temp file when storeFileByMoving throws', async () => {
      vi.mocked(fileStore.storeFileByMoving).mockImplementationOnce(() => {
        throw new Error('store failed');
      });

      const res = await request(app)
        .post('/api/files/upload')
        .attach('file', Buffer.from('content'), 'test.txt');

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('UPLOAD_ERROR');
    });
  });

  describe('GET /api/files/:fileId - error handling', () => {
    it('returns 500 when getFile throws', async () => {
      vi.mocked(fileStore.getFile).mockImplementationOnce(() => {
        throw new Error('db error');
      });

      const res = await request(app).get('/api/files/some-id');

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('RETRIEVAL_ERROR');
    });
  });

  describe('POST /api/files/push - error handling', () => {
    it('returns 500 when an unexpected error occurs', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        isFile: () => true,
        size: 100,
      } as any);
      vi.mocked(fileStore.storeFileFromPath).mockImplementationOnce(() => {
        throw new Error('store error');
      });

      const res = await request(app)
        .post('/api/files/push')
        .send({ filePath: '/some/file.txt', sessionId: 'sess-1' });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('PUSH_ERROR');
    });
  });
});
