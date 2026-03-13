import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  openSync: vi.fn(),
  readSync: vi.fn(),
  closeSync: vi.fn(),
  statSync: vi.fn(),
  readFileSync: vi.fn(),
  default: {
    openSync: vi.fn(),
    readSync: vi.fn(),
    closeSync: vi.fn(),
    statSync: vi.fn(),
    readFileSync: vi.fn(),
  },
}));

vi.mock('../../storage/fileStore.js', () => ({
  fileStore: {
    getFilePath: vi.fn(),
  },
}));

import * as fs from 'fs';
import { fileStore } from '../../storage/fileStore.js';
import { buildNonImageAttachmentNotes } from '../attachment-utils.js';

describe('attachment-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array for undefined attachments', () => {
    expect(buildNonImageAttachmentNotes(undefined)).toEqual([]);
  });

  it('returns empty array for empty attachments', () => {
    expect(buildNonImageAttachmentNotes([])).toEqual([]);
  });

  it('skips non-file attachments', () => {
    const attachments = [{ type: 'image', name: 'pic.png', fileId: 'f1', mimeType: 'image/png' }] as any;
    expect(buildNonImageAttachmentNotes(attachments)).toEqual([]);
  });

  it('reports missing file', () => {
    vi.mocked(fileStore.getFilePath).mockReturnValue(null);
    const attachments = [{ type: 'file', name: 'test.txt', fileId: 'f1', mimeType: 'text/plain' }] as any;
    const notes = buildNonImageAttachmentNotes(attachments);
    expect(notes[0]).toContain('missing');
    expect(notes[0]).toContain('test.txt');
  });

  it('handles text file with preview', () => {
    vi.mocked(fileStore.getFilePath).mockReturnValue('/tmp/f1');
    vi.mocked(fs.openSync).mockReturnValue(42 as any);
    vi.mocked(fs.readSync).mockImplementation((_fd, buf: any) => {
      // Write some text content (no null bytes, no control chars)
      const data = Buffer.from('hello world content');
      data.copy(buf);
      return data.length;
    });
    vi.mocked(fs.closeSync).mockImplementation(() => {});
    vi.mocked(fs.statSync).mockReturnValue({ size: 100 } as any);
    vi.mocked(fs.readFileSync).mockReturnValue('hello world content');

    const attachments = [{ type: 'file', name: 'readme.md', fileId: 'f1', mimeType: 'text/markdown' }] as any;
    const notes = buildNonImageAttachmentNotes(attachments);
    expect(notes.some(n => n.includes('text file'))).toBe(true);
    expect(notes.some(n => n.includes('Text preview'))).toBe(true);
  });

  it('handles binary file', () => {
    vi.mocked(fileStore.getFilePath).mockReturnValue('/tmp/f1');
    vi.mocked(fs.openSync).mockReturnValue(42 as any);
    vi.mocked(fs.readSync).mockImplementation((_fd, buf: any) => {
      // Write binary content (null bytes)
      buf[0] = 0;
      buf[1] = 0;
      buf[2] = 0;
      return 3;
    });
    vi.mocked(fs.closeSync).mockImplementation(() => {});

    const attachments = [{ type: 'file', name: 'app.bin', fileId: 'f1', mimeType: 'application/octet-stream' }] as any;
    const notes = buildNonImageAttachmentNotes(attachments);
    expect(notes.some(n => n.includes('binary artifact'))).toBe(true);
  });

  it('handles file open error as binary', () => {
    vi.mocked(fileStore.getFilePath).mockReturnValue('/tmp/f1');
    vi.mocked(fs.openSync).mockImplementation(() => { throw new Error('EACCES'); });

    const attachments = [{ type: 'file', name: 'locked.dat', fileId: 'f1', mimeType: 'application/dat' }] as any;
    const notes = buildNonImageAttachmentNotes(attachments);
    expect(notes.some(n => n.includes('binary artifact'))).toBe(true);
  });

  it('handles text file too large for preview', () => {
    vi.mocked(fileStore.getFilePath).mockReturnValue('/tmp/f1');
    vi.mocked(fs.openSync).mockReturnValue(42 as any);
    vi.mocked(fs.readSync).mockImplementation((_fd, buf: any) => {
      const data = Buffer.from('text content');
      data.copy(buf);
      return data.length;
    });
    vi.mocked(fs.closeSync).mockImplementation(() => {});
    vi.mocked(fs.statSync).mockReturnValue({ size: 100 * 1024 } as any); // 100KB

    const attachments = [{ type: 'file', name: 'big.txt', fileId: 'f1', mimeType: 'text/plain' }] as any;
    const notes = buildNonImageAttachmentNotes(attachments);
    expect(notes.some(n => n.includes('text file'))).toBe(true);
    expect(notes.some(n => n.includes('Text preview'))).toBe(false);
  });

  it('handles empty text file (no preview)', () => {
    vi.mocked(fileStore.getFilePath).mockReturnValue('/tmp/f1');
    vi.mocked(fs.openSync).mockReturnValue(42 as any);
    vi.mocked(fs.readSync).mockImplementation((_fd, buf: any) => {
      const data = Buffer.from('text');
      data.copy(buf);
      return data.length;
    });
    vi.mocked(fs.closeSync).mockImplementation(() => {});
    vi.mocked(fs.statSync).mockReturnValue({ size: 10 } as any);
    vi.mocked(fs.readFileSync).mockReturnValue('   \n  '); // whitespace only => trimmed to empty

    const attachments = [{ type: 'file', name: 'empty.txt', fileId: 'f1', mimeType: 'text/plain' }] as any;
    const notes = buildNonImageAttachmentNotes(attachments);
    expect(notes.some(n => n.includes('text file'))).toBe(true);
    expect(notes.some(n => n.includes('Text preview'))).toBe(false);
  });

  it('classifies by text mime type', () => {
    vi.mocked(fileStore.getFilePath).mockReturnValue('/tmp/f1');
    vi.mocked(fs.openSync).mockReturnValue(42 as any);
    // non-binary, non-null content
    vi.mocked(fs.readSync).mockImplementation((_fd, buf: any) => {
      const data = Buffer.from('{"key":"value"}');
      data.copy(buf);
      return data.length;
    });
    vi.mocked(fs.closeSync).mockImplementation(() => {});
    vi.mocked(fs.statSync).mockReturnValue({ size: 50 } as any);
    vi.mocked(fs.readFileSync).mockReturnValue('{"key":"value"}');

    const attachments = [{ type: 'file', name: 'data', fileId: 'f1', mimeType: 'application/json' }] as any;
    const notes = buildNonImageAttachmentNotes(attachments);
    expect(notes.some(n => n.includes('text file'))).toBe(true);
  });

  it('classifies by text extension', () => {
    vi.mocked(fileStore.getFilePath).mockReturnValue('/tmp/f1');
    vi.mocked(fs.openSync).mockReturnValue(42 as any);
    vi.mocked(fs.readSync).mockImplementation((_fd, buf: any) => {
      const data = Buffer.from('const x = 1;');
      data.copy(buf);
      return data.length;
    });
    vi.mocked(fs.closeSync).mockImplementation(() => {});
    vi.mocked(fs.statSync).mockReturnValue({ size: 20 } as any);
    vi.mocked(fs.readFileSync).mockReturnValue('const x = 1;');

    const attachments = [{ type: 'file', name: 'code.ts', fileId: 'f1', mimeType: 'application/unknown' }] as any;
    const notes = buildNonImageAttachmentNotes(attachments);
    expect(notes.some(n => n.includes('text file'))).toBe(true);
  });
});
