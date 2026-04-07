import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import { FileBrowseError, FileBrowseService } from '../file-browse-service.js';

vi.mock('fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('fs')>();
  return {
    ...original,
    existsSync: vi.fn(),
    statSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    openSync: vi.fn(),
    readSync: vi.fn(),
    closeSync: vi.fn(),
  };
});

describe('FileBrowseService', () => {
  const service = new FileBrowseService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists directory entries with directories first', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockImplementation((target) => {
      if (typeof target === 'string' && (target === '/project' || target.endsWith('src'))) {
        return { isDirectory: () => true, isFile: () => false } as fs.Stats;
      }
      return { isDirectory: () => false, isFile: () => true, size: 123 } as fs.Stats;
    });
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: 'index.ts', isDirectory: () => false, isFile: () => true },
      { name: 'src', isDirectory: () => true, isFile: () => false },
    ] as unknown as ReturnType<typeof fs.readdirSync>);

    const result = service.listDirectory('/project', '', '', '50');

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].name).toBe('src');
    expect(result.entries[1].name).toBe('index.ts');
  });

  it('throws validation error for unsafe path traversal', () => {
    expect(() => service.listDirectory('/project', '../../../etc', '', '50')).toThrowError(FileBrowseError);
    try {
      service.listDirectory('/project', '../../../etc', '', '50');
    } catch (error) {
      expect(error).toBeInstanceOf(FileBrowseError);
      expect((error as FileBrowseError).code).toBe('FORBIDDEN');
    }
  });

  it('reads text file content', () => {
    const fileContent = 'export const hello = "world";';
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => false,
      size: fileContent.length,
    } as fs.Stats);
    vi.mocked(fs.readFileSync).mockReturnValue(fileContent as never);
    vi.mocked(fs.readSync).mockImplementation((_fd, buf: Buffer) => {
      const bytes = Buffer.from(fileContent);
      bytes.copy(buf, 0, 0, Math.min(bytes.length, buf.length));
      return bytes.length;
    });

    const result = service.readFileContent('/project', 'index.ts');

    expect(result.content).toBe(fileContent);
    expect(result.path).toBe('index.ts');
  });

  it('rejects binary files', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => false,
      size: 4,
    } as fs.Stats);
    vi.mocked(fs.readSync).mockImplementation((_fd, buf: Buffer) => {
      buf[0] = 0;
      return 1;
    });

    expect(() => service.readFileContent('/project', 'image.dat')).toThrowError(FileBrowseError);
    try {
      service.readFileContent('/project', 'image.dat');
    } catch (error) {
      expect((error as FileBrowseError).code).toBe('BINARY_FILE');
    }
  });
});
