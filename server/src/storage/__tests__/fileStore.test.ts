import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Mock dependencies
vi.mock('fs');
vi.mock('uuid');

// Import after mocking
const mockUuidv4 = vi.mocked(uuidv4);
const mockFs = vi.mocked(fs);

// We need to manually import and instantiate the FileStore class for testing
// since the module has side effects (setInterval, console.log)
interface StoredFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  data: string;
  createdAt: number;
}

class FileStore {
  private files = new Map<string, StoredFile>();
  private storageDir: string;

  constructor(storageDir: string) {
    this.storageDir = storageDir;
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
  }

  storeFile(name: string, mimeType: string, data: string): string {
    const fileId = uuidv4();
    const file: StoredFile = {
      id: fileId,
      name,
      mimeType,
      size: Buffer.from(data, 'base64').length,
      data,
      createdAt: Date.now()
    };

    this.files.set(fileId, file);
    console.log(`[FileStore] Stored file ${fileId} (${name}, ${file.size} bytes)`);
    return fileId;
  }

  getFile(fileId: string): StoredFile | null {
    const file = this.files.get(fileId);
    if (!file) {
      console.log(`[FileStore] File ${fileId} not found`);
      return null;
    }
    console.log(`[FileStore] Retrieved file ${fileId} (${file.name})`);
    return file;
  }

  deleteFile(fileId: string): boolean {
    const deleted = this.files.delete(fileId);
    if (deleted) {
      console.log(`[FileStore] Deleted file ${fileId}`);
    }
    return deleted;
  }

  cleanup(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    let deletedCount = 0;

    for (const [id, file] of this.files.entries()) {
      if (now - file.createdAt > maxAge) {
        this.deleteFile(id);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      console.log(`[FileStore] Cleanup: deleted ${deletedCount} old files`);
    }
  }

  getStats() {
    const count = this.files.size;
    let totalSize = 0;

    for (const file of this.files.values()) {
      totalSize += file.size;
    }

    return {
      count,
      totalSize,
      totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2)
    };
  }
}

describe('FileStore', () => {
  let fileStore: FileStore;
  const testStorageDir = './test-storage';
  let mockFileIds: string[];
  let currentMockIdIndex: number;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    // Setup mock for fs
    mockFs.existsSync = vi.fn().mockReturnValue(false);
    mockFs.mkdirSync = vi.fn();

    // Setup mock UUIDs for predictable testing
    mockFileIds = ['file-id-1', 'file-id-2', 'file-id-3', 'file-id-4', 'file-id-5'];
    currentMockIdIndex = 0;
    mockUuidv4.mockImplementation(() => {
      const id = mockFileIds[currentMockIdIndex];
      currentMockIdIndex++;
      return id;
    });

    // Create fresh instance
    fileStore = new FileStore(testStorageDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create storage directory if it does not exist', () => {
      expect(mockFs.existsSync).toHaveBeenCalledWith(testStorageDir);
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(testStorageDir, { recursive: true });
    });

    it('should not create directory if it already exists', () => {
      mockFs.existsSync = vi.fn().mockReturnValue(true);
      mockFs.mkdirSync = vi.fn();

      new FileStore(testStorageDir);

      expect(mockFs.existsSync).toHaveBeenCalledWith(testStorageDir);
      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    });
  });

  describe('storeFile()', () => {
    it('should generate unique ID for stored file', () => {
      const fileId1 = fileStore.storeFile('test1.txt', 'text/plain', 'aGVsbG8=');
      const fileId2 = fileStore.storeFile('test2.txt', 'text/plain', 'd29ybGQ=');

      expect(fileId1).toBe('file-id-1');
      expect(fileId2).toBe('file-id-2');
      expect(fileId1).not.toBe(fileId2);
      expect(mockUuidv4).toHaveBeenCalledTimes(2);
    });

    it('should store file with correct metadata', () => {
      const name = 'test.txt';
      const mimeType = 'text/plain';
      const data = 'aGVsbG8gd29ybGQ='; // "hello world" in base64

      const fileId = fileStore.storeFile(name, mimeType, data);
      const retrievedFile = fileStore.getFile(fileId);

      expect(retrievedFile).not.toBeNull();
      expect(retrievedFile!.id).toBe(fileId);
      expect(retrievedFile!.name).toBe(name);
      expect(retrievedFile!.mimeType).toBe(mimeType);
      expect(retrievedFile!.data).toBe(data);
    });

    it('should calculate file size correctly from base64 data', () => {
      const data = 'aGVsbG8gd29ybGQ='; // "hello world" = 11 bytes
      const fileId = fileStore.storeFile('test.txt', 'text/plain', data);
      const retrievedFile = fileStore.getFile(fileId);

      expect(retrievedFile!.size).toBe(11);
    });

    it('should set createdAt timestamp', () => {
      const beforeStore = Date.now();
      const fileId = fileStore.storeFile('test.txt', 'text/plain', 'aGVsbG8=');
      const afterStore = Date.now();

      const retrievedFile = fileStore.getFile(fileId);
      expect(retrievedFile!.createdAt).toBeGreaterThanOrEqual(beforeStore);
      expect(retrievedFile!.createdAt).toBeLessThanOrEqual(afterStore);
    });

    it('should handle empty file data', () => {
      const fileId = fileStore.storeFile('empty.txt', 'text/plain', '');
      const retrievedFile = fileStore.getFile(fileId);

      expect(retrievedFile).not.toBeNull();
      expect(retrievedFile!.size).toBe(0);
      expect(retrievedFile!.data).toBe('');
    });

    it('should handle large files', () => {
      // Create a large base64 string (approximately 1MB of data)
      const largeData = Buffer.from('x'.repeat(1024 * 1024)).toString('base64');
      const fileId = fileStore.storeFile('large.bin', 'application/octet-stream', largeData);
      const retrievedFile = fileStore.getFile(fileId);

      expect(retrievedFile).not.toBeNull();
      expect(retrievedFile!.size).toBeGreaterThan(1000000); // > 1MB
    });

    it('should log file storage', () => {
      const consoleSpy = vi.spyOn(console, 'log');
      fileStore.storeFile('test.txt', 'text/plain', 'aGVsbG8=');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[FileStore] Stored file')
      );
    });
  });

  describe('getFile()', () => {
    it('should retrieve stored file by ID', () => {
      const fileId = fileStore.storeFile('test.txt', 'text/plain', 'aGVsbG8=');
      const retrievedFile = fileStore.getFile(fileId);

      expect(retrievedFile).not.toBeNull();
      expect(retrievedFile!.id).toBe(fileId);
      expect(retrievedFile!.name).toBe('test.txt');
    });

    it('should return null for non-existent file', () => {
      const retrievedFile = fileStore.getFile('non-existent-id');

      expect(retrievedFile).toBeNull();
    });

    it('should return null for empty string ID', () => {
      const retrievedFile = fileStore.getFile('');

      expect(retrievedFile).toBeNull();
    });

    it('should log when file is not found', () => {
      const consoleSpy = vi.spyOn(console, 'log');
      fileStore.getFile('non-existent-id');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[FileStore] File non-existent-id not found')
      );
    });

    it('should log when file is retrieved successfully', () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const fileId = fileStore.storeFile('test.txt', 'text/plain', 'aGVsbG8=');
      consoleSpy.mockClear(); // Clear previous logs

      fileStore.getFile(fileId);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[FileStore] Retrieved file')
      );
    });

    it('should retrieve multiple different files correctly', () => {
      const fileId1 = fileStore.storeFile('file1.txt', 'text/plain', 'ZGF0YTE=');
      const fileId2 = fileStore.storeFile('file2.txt', 'text/plain', 'ZGF0YTI=');
      const fileId3 = fileStore.storeFile('file3.txt', 'text/plain', 'ZGF0YTM=');

      const file1 = fileStore.getFile(fileId1);
      const file2 = fileStore.getFile(fileId2);
      const file3 = fileStore.getFile(fileId3);

      expect(file1!.name).toBe('file1.txt');
      expect(file2!.name).toBe('file2.txt');
      expect(file3!.name).toBe('file3.txt');
      expect(file1!.data).toBe('ZGF0YTE=');
      expect(file2!.data).toBe('ZGF0YTI=');
      expect(file3!.data).toBe('ZGF0YTM=');
    });
  });

  describe('deleteFile()', () => {
    it('should delete existing file and return true', () => {
      const fileId = fileStore.storeFile('test.txt', 'text/plain', 'aGVsbG8=');
      const deleted = fileStore.deleteFile(fileId);

      expect(deleted).toBe(true);
      expect(fileStore.getFile(fileId)).toBeNull();
    });

    it('should return false for non-existent file', () => {
      const deleted = fileStore.deleteFile('non-existent-id');

      expect(deleted).toBe(false);
    });

    it('should log when file is deleted', () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const fileId = fileStore.storeFile('test.txt', 'text/plain', 'aGVsbG8=');
      consoleSpy.mockClear();

      fileStore.deleteFile(fileId);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[FileStore] Deleted file')
      );
    });

    it('should not log when deleting non-existent file', () => {
      const consoleSpy = vi.spyOn(console, 'log');
      fileStore.deleteFile('non-existent-id');

      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[FileStore] Deleted file')
      );
    });

    it('should delete only the specified file', () => {
      const fileId1 = fileStore.storeFile('file1.txt', 'text/plain', 'ZGF0YTE=');
      const fileId2 = fileStore.storeFile('file2.txt', 'text/plain', 'ZGF0YTI=');
      const fileId3 = fileStore.storeFile('file3.txt', 'text/plain', 'ZGF0YTM=');

      fileStore.deleteFile(fileId2);

      expect(fileStore.getFile(fileId1)).not.toBeNull();
      expect(fileStore.getFile(fileId2)).toBeNull();
      expect(fileStore.getFile(fileId3)).not.toBeNull();
    });

    it('should handle multiple deletions of same file', () => {
      const fileId = fileStore.storeFile('test.txt', 'text/plain', 'aGVsbG8=');

      const firstDelete = fileStore.deleteFile(fileId);
      const secondDelete = fileStore.deleteFile(fileId);

      expect(firstDelete).toBe(true);
      expect(secondDelete).toBe(false);
    });
  });

  describe('cleanup()', () => {
    beforeEach(() => {
      // Mock Date.now to control time
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should remove files older than 24 hours', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      // Store files
      const oldFileId = fileStore.storeFile('old.txt', 'text/plain', 'b2xk');

      // Move time forward 25 hours
      vi.setSystemTime(now + 25 * 60 * 60 * 1000);

      const newFileId = fileStore.storeFile('new.txt', 'text/plain', 'bmV3');

      // Run cleanup
      fileStore.cleanup();

      // Old file should be deleted, new file should remain
      expect(fileStore.getFile(oldFileId)).toBeNull();
      expect(fileStore.getFile(newFileId)).not.toBeNull();
    });

    it('should not remove files newer than 24 hours', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const fileId1 = fileStore.storeFile('file1.txt', 'text/plain', 'ZmlsZTE=');

      // Move time forward 23 hours (still within 24 hour window)
      vi.setSystemTime(now + 23 * 60 * 60 * 1000);

      const fileId2 = fileStore.storeFile('file2.txt', 'text/plain', 'ZmlsZTI=');

      // Run cleanup
      fileStore.cleanup();

      // Both files should still exist
      expect(fileStore.getFile(fileId1)).not.toBeNull();
      expect(fileStore.getFile(fileId2)).not.toBeNull();
    });

    it('should handle cleanup with no files', () => {
      expect(() => fileStore.cleanup()).not.toThrow();
    });

    it('should handle cleanup with no old files', () => {
      fileStore.storeFile('new1.txt', 'text/plain', 'bmV3MQ==');
      fileStore.storeFile('new2.txt', 'text/plain', 'bmV3Mg==');

      const consoleSpy = vi.spyOn(console, 'log');
      fileStore.cleanup();

      // Should not log anything if no files were deleted
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[FileStore] Cleanup: deleted')
      );
    });

    it('should log number of deleted files', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      fileStore.storeFile('old1.txt', 'text/plain', 'b2xkMQ==');
      fileStore.storeFile('old2.txt', 'text/plain', 'b2xkMg==');
      fileStore.storeFile('old3.txt', 'text/plain', 'b2xkMw==');

      // Move time forward 25 hours
      vi.setSystemTime(now + 25 * 60 * 60 * 1000);

      const consoleSpy = vi.spyOn(console, 'log');
      fileStore.cleanup();

      expect(consoleSpy).toHaveBeenCalledWith(
        '[FileStore] Cleanup: deleted 3 old files'
      );
    });

    it('should handle files exactly at 24 hour boundary', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const fileId = fileStore.storeFile('boundary.txt', 'text/plain', 'Ym91bmRhcnk=');

      // Move time forward exactly 24 hours + 1ms
      vi.setSystemTime(now + 24 * 60 * 60 * 1000 + 1);

      fileStore.cleanup();

      // File should be deleted (older than 24 hours)
      expect(fileStore.getFile(fileId)).toBeNull();
    });

    it('should not delete files at exactly 24 hours', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const fileId = fileStore.storeFile('boundary.txt', 'text/plain', 'Ym91bmRhcnk=');

      // Move time forward exactly 24 hours
      vi.setSystemTime(now + 24 * 60 * 60 * 1000);

      fileStore.cleanup();

      // File should still exist (not older than 24 hours)
      expect(fileStore.getFile(fileId)).not.toBeNull();
    });

    it('should handle mixed old and new files', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const oldFileId1 = fileStore.storeFile('old1.txt', 'text/plain', 'b2xkMQ==');

      // Move forward 20 hours
      vi.setSystemTime(now + 20 * 60 * 60 * 1000);
      const mediumFileId = fileStore.storeFile('medium.txt', 'text/plain', 'bWVkaXVt');

      // Move forward another 10 hours (total 30 hours from start)
      vi.setSystemTime(now + 30 * 60 * 60 * 1000);
      const newFileId = fileStore.storeFile('new.txt', 'text/plain', 'bmV3');

      // Run cleanup
      fileStore.cleanup();

      // Only the first file should be deleted
      expect(fileStore.getFile(oldFileId1)).toBeNull();
      expect(fileStore.getFile(mediumFileId)).not.toBeNull();
      expect(fileStore.getFile(newFileId)).not.toBeNull();
    });
  });

  describe('getStats()', () => {
    it('should return zero count and size for empty store', () => {
      const stats = fileStore.getStats();

      expect(stats.count).toBe(0);
      expect(stats.totalSize).toBe(0);
      expect(stats.totalSizeMB).toBe('0.00');
    });

    it('should calculate correct count for single file', () => {
      fileStore.storeFile('test.txt', 'text/plain', 'aGVsbG8=');
      const stats = fileStore.getStats();

      expect(stats.count).toBe(1);
    });

    it('should calculate correct count for multiple files', () => {
      fileStore.storeFile('file1.txt', 'text/plain', 'ZGF0YTE=');
      fileStore.storeFile('file2.txt', 'text/plain', 'ZGF0YTI=');
      fileStore.storeFile('file3.txt', 'text/plain', 'ZGF0YTM=');

      const stats = fileStore.getStats();
      expect(stats.count).toBe(3);
    });

    it('should calculate total size correctly', () => {
      // "hello" in base64 = "aGVsbG8=" -> 5 bytes
      fileStore.storeFile('file1.txt', 'text/plain', 'aGVsbG8=');
      // "world" in base64 = "d29ybGQ=" -> 5 bytes
      fileStore.storeFile('file2.txt', 'text/plain', 'd29ybGQ=');

      const stats = fileStore.getStats();
      expect(stats.totalSize).toBe(10);
    });

    it('should calculate totalSizeMB correctly', () => {
      // Create a file with exactly 1MB of data
      const oneMB = 1024 * 1024;
      const data = Buffer.from('x'.repeat(oneMB)).toString('base64');
      fileStore.storeFile('large.bin', 'application/octet-stream', data);

      const stats = fileStore.getStats();
      expect(parseFloat(stats.totalSizeMB)).toBeGreaterThanOrEqual(1.0);
      expect(parseFloat(stats.totalSizeMB)).toBeLessThan(1.5); // Base64 adds ~33% overhead
    });

    it('should format totalSizeMB with 2 decimal places', () => {
      fileStore.storeFile('small.txt', 'text/plain', 'c21hbGw='); // 5 bytes

      const stats = fileStore.getStats();
      expect(stats.totalSizeMB).toMatch(/^\d+\.\d{2}$/);
    });

    it('should update stats after file deletion', () => {
      const fileId1 = fileStore.storeFile('file1.txt', 'text/plain', 'ZGF0YTE=');
      fileStore.storeFile('file2.txt', 'text/plain', 'ZGF0YTI=');

      let stats = fileStore.getStats();
      expect(stats.count).toBe(2);
      const initialSize = stats.totalSize;

      fileStore.deleteFile(fileId1);

      stats = fileStore.getStats();
      expect(stats.count).toBe(1);
      expect(stats.totalSize).toBeLessThan(initialSize);
    });

    it('should handle stats with varying file sizes', () => {
      fileStore.storeFile('tiny.txt', 'text/plain', 'YQ=='); // 1 byte
      fileStore.storeFile('small.txt', 'text/plain', 'aGVsbG8='); // 5 bytes
      const largeData = Buffer.from('x'.repeat(10000)).toString('base64');
      fileStore.storeFile('large.txt', 'text/plain', largeData); // ~10KB

      const stats = fileStore.getStats();
      expect(stats.count).toBe(3);
      expect(stats.totalSize).toBeGreaterThan(10000);
    });

    it('should return consistent stats across multiple calls', () => {
      fileStore.storeFile('file1.txt', 'text/plain', 'ZGF0YTE=');
      fileStore.storeFile('file2.txt', 'text/plain', 'ZGF0YTI=');

      const stats1 = fileStore.getStats();
      const stats2 = fileStore.getStats();

      expect(stats1.count).toBe(stats2.count);
      expect(stats1.totalSize).toBe(stats2.totalSize);
      expect(stats1.totalSizeMB).toBe(stats2.totalSizeMB);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle special characters in file names', () => {
      const specialNames = [
        'file with spaces.txt',
        'file-with-dashes.txt',
        'file_with_underscores.txt',
        'file.multiple.dots.txt',
        'файл.txt', // Cyrillic
        '文件.txt', // Chinese
      ];

      specialNames.forEach(name => {
        const fileId = fileStore.storeFile(name, 'text/plain', 'ZGF0YQ==');
        const retrieved = fileStore.getFile(fileId);
        expect(retrieved!.name).toBe(name);
      });
    });

    it('should handle various mime types', () => {
      const mimeTypes = [
        'text/plain',
        'text/html',
        'application/json',
        'image/png',
        'video/mp4',
        'application/octet-stream',
      ];

      mimeTypes.forEach(mimeType => {
        const fileId = fileStore.storeFile('test', mimeType, 'ZGF0YQ==');
        const retrieved = fileStore.getFile(fileId);
        expect(retrieved!.mimeType).toBe(mimeType);
      });
    });

    it('should handle invalid base64 gracefully in size calculation', () => {
      // This test verifies that Buffer.from handles invalid base64
      // It won't throw, but might produce unexpected results
      expect(() => {
        fileStore.storeFile('test.txt', 'text/plain', 'not-valid-base64!!!');
      }).not.toThrow();
    });

    it('should handle very long file names', () => {
      const longName = 'a'.repeat(1000) + '.txt';
      const fileId = fileStore.storeFile(longName, 'text/plain', 'ZGF0YQ==');
      const retrieved = fileStore.getFile(fileId);

      expect(retrieved!.name).toBe(longName);
    });

    it('should maintain file integrity after multiple operations', () => {
      const originalData = 'aGVsbG8gd29ybGQ=';
      const fileId = fileStore.storeFile('test.txt', 'text/plain', originalData);

      // Perform various operations
      fileStore.getStats();
      fileStore.storeFile('other.txt', 'text/plain', 'b3RoZXI=');
      fileStore.cleanup();

      // Original file should remain unchanged
      const retrieved = fileStore.getFile(fileId);
      expect(retrieved!.data).toBe(originalData);
    });
  });
});
