import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { AttachmentService } from '../service.js';
import type { AttachmentStore } from '../../../infrastructure/storage/attachmentStore.js';

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY,
      owner_kind TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'file',
      sha256 TEXT,
      width INTEGER,
      height INTEGER,
      created_by TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

function makeFakeStore(): AttachmentStore & { __deleted: string[] } {
  let counter = 0;
  const deleted: string[] = [];
  const fake: Record<string, unknown> = {
    storeFromBuffer: vi.fn((buffer: Buffer) => ({
      storageKey: `fa/fake-${++counter}`,
      size: buffer.length,
      sha256: 'sha-' + counter,
    })),
    storeByMoving: vi.fn(() => ({
      storageKey: `fa/moved-${++counter}`,
      size: 42,
      sha256: 'sha-moved-' + counter,
    })),
    storeByCopying: vi.fn(),
    getPath: vi.fn(() => null),
    delete: vi.fn((key: string) => {
      deleted.push(key);
      return true;
    }),
    getStorageDir: () => '/tmp/fake-attachments',
    __deleted: deleted,
  };
  return fake as AttachmentStore & { __deleted: string[] };
}

describe('AttachmentService', () => {
  let db: ReturnType<typeof createTestDb>;
  let store: ReturnType<typeof makeFakeStore>;
  let broadcast: ReturnType<typeof vi.fn>;
  let service: AttachmentService;

  beforeEach(() => {
    db = createTestDb();
    store = makeFakeStore();
    broadcast = vi.fn();
    service = new AttachmentService(db, broadcast, store);
  });

  it('addFromBuffer persists, derives kind from mime, and broadcasts', () => {
    const att = service.addFromBuffer({
      ownerKind: 'local_issue',
      ownerId: 'issue-1',
      buffer: Buffer.from('PNGDATA'),
      name: 'shot.png',
      mimeType: 'image/png',
    });

    expect(att.id).toBeDefined();
    expect(att.kind).toBe('image');
    expect(att.size).toBe(7);
    expect(att.sha256).toBe('sha-1');
    expect(store.storeFromBuffer).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'attachment_added',
        ownerKind: 'local_issue',
        ownerId: 'issue-1',
        attachment: expect.objectContaining({ id: att.id }),
      }),
    );
  });

  it('addFromTempFile moves file into store and persists', () => {
    const att = service.addFromTempFile({
      ownerKind: 'local_pr',
      ownerId: 'pr-1',
      tempPath: '/tmp/xxx',
      name: 'log.txt',
      mimeType: 'text/plain',
    });
    expect(store.storeByMoving).toHaveBeenCalledWith('/tmp/xxx');
    expect(att.kind).toBe('document');
  });

  it('list returns attachments for owner only', () => {
    service.addFromBuffer({
      ownerKind: 'local_issue',
      ownerId: 'i-1',
      buffer: Buffer.from('a'),
      name: 'a.png',
      mimeType: 'image/png',
    });
    service.addFromBuffer({
      ownerKind: 'local_issue',
      ownerId: 'i-2',
      buffer: Buffer.from('b'),
      name: 'b.png',
      mimeType: 'image/png',
    });

    expect(service.list('local_issue', 'i-1')).toHaveLength(1);
    expect(service.list('local_issue', 'i-2')).toHaveLength(1);
    expect(service.list('local_issue', 'i-3')).toHaveLength(0);
  });

  it('remove deletes DB row, removes file, and broadcasts', () => {
    const att = service.addFromBuffer({
      ownerKind: 'local_issue',
      ownerId: 'i-1',
      buffer: Buffer.from('x'),
      name: 'x.png',
      mimeType: 'image/png',
    });
    broadcast.mockClear();

    const result = service.remove(att.id);
    expect(result).toEqual({ ownerKind: 'local_issue', ownerId: 'i-1' });
    expect(store.delete).toHaveBeenCalledTimes(1);
    expect(service.list('local_issue', 'i-1')).toHaveLength(0);
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'attachment_removed', attachmentId: att.id }),
    );
  });

  it('remove returns null when attachment is missing', () => {
    expect(service.remove('does-not-exist')).toBeNull();
    expect(store.delete).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('deleteByOwner removes all rows and broadcasts each', () => {
    service.addFromBuffer({
      ownerKind: 'local_issue',
      ownerId: 'i-1',
      buffer: Buffer.from('a'),
      name: 'a.png',
      mimeType: 'image/png',
    });
    service.addFromBuffer({
      ownerKind: 'local_issue',
      ownerId: 'i-1',
      buffer: Buffer.from('b'),
      name: 'b.png',
      mimeType: 'image/png',
    });
    service.addFromBuffer({
      ownerKind: 'local_issue',
      ownerId: 'i-2',
      buffer: Buffer.from('c'),
      name: 'c.png',
      mimeType: 'image/png',
    });
    broadcast.mockClear();

    const removed = service.deleteByOwner('local_issue', 'i-1');
    expect(removed).toBe(2);
    expect(store.delete).toHaveBeenCalledTimes(2);
    expect(broadcast).toHaveBeenCalledTimes(2);
    expect(service.list('local_issue', 'i-1')).toHaveLength(0);
    expect(service.list('local_issue', 'i-2')).toHaveLength(1);
  });

  it('countByOwners exposes repository counts', () => {
    service.addFromBuffer({
      ownerKind: 'local_issue',
      ownerId: 'i-1',
      buffer: Buffer.from('a'),
      name: 'a.png',
      mimeType: 'image/png',
    });
    service.addFromBuffer({
      ownerKind: 'local_issue',
      ownerId: 'i-1',
      buffer: Buffer.from('b'),
      name: 'b.png',
      mimeType: 'image/png',
    });

    const counts = service.countByOwners('local_issue', ['i-1', 'i-9']);
    expect(counts.get('i-1')).toBe(2);
    expect(counts.get('i-9')).toBeUndefined();
  });
});
