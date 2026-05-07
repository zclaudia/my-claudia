import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { AttachmentRepository } from '../repository.js';

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
    CREATE INDEX idx_attachments_owner ON attachments(owner_kind, owner_id);
  `);
  return db;
}

describe('AttachmentRepository', () => {
  let db: ReturnType<typeof createTestDb>;
  let repo: AttachmentRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new AttachmentRepository(db);
  });

  function add(overrides: Partial<Parameters<AttachmentRepository['create']>[0]> = {}) {
    return repo.create({
      ownerKind: 'local_issue',
      ownerId: 'issue-1',
      storageKey: 'ab/abc-123',
      name: 'test.png',
      mimeType: 'image/png',
      size: 100,
      kind: 'image',
      sortOrder: 0,
      ...overrides,
    });
  }

  it('creates and reads back an attachment', () => {
    const a = add({ name: 'photo.png' });
    expect(a.id).toBeDefined();
    expect(a.name).toBe('photo.png');
    expect(a.kind).toBe('image');
    const found = repo.findById(a.id);
    expect(found?.id).toBe(a.id);
  });

  it('lists attachments by owner ordered by sort_order then created_at', () => {
    const a1 = add({ ownerId: 'i-1', sortOrder: 2, name: 'a' });
    const a2 = add({ ownerId: 'i-1', sortOrder: 1, name: 'b' });
    const a3 = add({ ownerId: 'i-2', sortOrder: 0, name: 'c' });

    const list = repo.findByOwner('local_issue', 'i-1');
    expect(list.map((r) => r.id)).toEqual([a2.id, a1.id]);
    // a3 belongs to i-2, must not appear
    expect(list.map((r) => r.id)).not.toContain(a3.id);
  });

  it('counts attachments grouped by owner', () => {
    add({ ownerId: 'i-1' });
    add({ ownerId: 'i-1' });
    add({ ownerId: 'i-2' });
    const counts = repo.countByOwners('local_issue', ['i-1', 'i-2', 'i-3']);
    expect(counts.get('i-1')).toBe(2);
    expect(counts.get('i-2')).toBe(1);
    expect(counts.get('i-3')).toBeUndefined();
  });

  it('countByOwners with empty list returns empty map', () => {
    const counts = repo.countByOwners('local_issue', []);
    expect(counts.size).toBe(0);
  });

  it('updates name and sortOrder', () => {
    const a = add({ name: 'old.png', sortOrder: 0 });
    const updated = repo.update(a.id, { name: 'new.png', sortOrder: 5 });
    expect(updated.name).toBe('new.png');
    expect(updated.sortOrder).toBe(5);
  });

  it('update with empty patch is a no-op (returns same row)', () => {
    const a = add({ name: 'keep.png' });
    const result = repo.update(a.id, {});
    expect(result.id).toBe(a.id);
    expect(result.name).toBe('keep.png');
  });

  it('deleteByOwner removes all attachments and returns the deleted rows', () => {
    const a1 = add({ ownerId: 'i-1' });
    const a2 = add({ ownerId: 'i-1' });
    add({ ownerId: 'i-2' });

    const removed = repo.deleteByOwner('local_issue', 'i-1');
    expect(removed.map((r) => r.id).sort()).toEqual([a1.id, a2.id].sort());
    expect(repo.findByOwner('local_issue', 'i-1')).toHaveLength(0);
    expect(repo.findByOwner('local_issue', 'i-2')).toHaveLength(1);
  });

  it('delete removes a single row', () => {
    const a = add();
    expect(repo.delete(a.id)).toBe(true);
    expect(repo.findById(a.id)).toBeNull();
    expect(repo.delete(a.id)).toBe(false);
  });
});
