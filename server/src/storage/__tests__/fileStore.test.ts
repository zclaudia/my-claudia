import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => Buffer.from('test data')),
  unlinkSync: vi.fn(),
  statSync: vi.fn(() => ({ size: 100, isFile: () => true })),
  copyFileSync: vi.fn(),
  renameSync: vi.fn(),
  default: {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(() => Buffer.from('test data')),
    unlinkSync: vi.fn(),
    statSync: vi.fn(() => ({ size: 100, isFile: () => true })),
    copyFileSync: vi.fn(),
    renameSync: vi.fn(),
  },
}));

vi.mock('uuid', () => {
  let counter = 0;
  return {
    v4: vi.fn(() => `mock-uuid-${++counter}`),
  };
});

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

describe('fileStore', () => {
  let db: Database.Database;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createTestDb();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it('initFileStore and getFileStore work', async () => {
    vi.resetModules();
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const mod = await import('../fileStore.js');
    mod.initFileStore(db);
    const store = mod.getFileStore();
    expect(store).toBeDefined();
  });

  it('getFileStore throws before init', async () => {
    vi.resetModules();
    const mod = await import('../fileStore.js');
    expect(() => mod.getFileStore()).toThrow('FileStore not initialized');
  });

  it('creates storage dir if missing', async () => {
    vi.resetModules();
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const mod = await import('../fileStore.js');
    mod.initFileStore(db);
    expect(fs.mkdirSync).toHaveBeenCalled();
  });

  it('storeFile stores file and returns id', async () => {
    vi.resetModules();
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const mod = await import('../fileStore.js');
    mod.initFileStore(db);
    const store = mod.getFileStore();

    const data = Buffer.from('hello').toString('base64');
    const id = store.storeFile('test.txt', 'text/plain', data);
    expect(id).toBeDefined();
    expect(fs.writeFileSync).toHaveBeenCalled();

    const row = db.prepare('SELECT * FROM files WHERE id = ?').get(id) as any;
    expect(row.name).toBe('test.txt');
    expect(row.mime_type).toBe('text/plain');
  });

  it('getFile returns file with data', async () => {
    vi.resetModules();
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('test data'));
    const mod = await import('../fileStore.js');
    mod.initFileStore(db);
    const store = mod.getFileStore();

    db.prepare('INSERT INTO files (id, name, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?)').run('f1', 'test.txt', 'text/plain', 9, Date.now());

    const file = store.getFile('f1');
    expect(file).not.toBeNull();
    expect(file!.name).toBe('test.txt');
    expect(file!.data).toBe(Buffer.from('test data').toString('base64'));
  });

  it('getFile returns null for non-existent', async () => {
    vi.resetModules();
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const mod = await import('../fileStore.js');
    mod.initFileStore(db);
    expect(mod.getFileStore().getFile('nonexistent')).toBeNull();
  });

  it('getFile cleans up when file missing on disk', async () => {
    vi.resetModules();
    const fs = await import('fs');
    // First call for constructor, then false for file check
    let callCount = 0;
    vi.mocked(fs.existsSync).mockImplementation(() => {
      callCount++;
      return callCount <= 1; // true for constructor, false for file check
    });
    const mod = await import('../fileStore.js');
    mod.initFileStore(db);

    db.prepare('INSERT INTO files (id, name, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?)').run('f1', 'test.txt', 'text/plain', 9, Date.now());

    const result = mod.getFileStore().getFile('f1');
    expect(result).toBeNull();
    expect(db.prepare('SELECT * FROM files WHERE id = ?').get('f1')).toBeUndefined();
  });

  it('deleteFile removes file and metadata', async () => {
    vi.resetModules();
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const mod = await import('../fileStore.js');
    mod.initFileStore(db);

    db.prepare('INSERT INTO files (id, name, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?)').run('f1', 'test.txt', 'text/plain', 9, Date.now());

    expect(mod.getFileStore().deleteFile('f1')).toBe(true);
    expect(fs.unlinkSync).toHaveBeenCalled();
  });

  it('deleteFile returns false for non-existent', async () => {
    vi.resetModules();
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const mod = await import('../fileStore.js');
    mod.initFileStore(db);
    expect(mod.getFileStore().deleteFile('nonexistent')).toBe(false);
  });

  it('deleteFile handles disk error gracefully', async () => {
    vi.resetModules();
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.unlinkSync).mockImplementation(() => { throw new Error('EACCES'); });
    const mod = await import('../fileStore.js');
    mod.initFileStore(db);

    db.prepare('INSERT INTO files (id, name, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?)').run('f1', 'test.txt', 'text/plain', 9, Date.now());
    expect(() => mod.getFileStore().deleteFile('f1')).not.toThrow();
  });

  it('cleanup deletes old files', async () => {
    vi.resetModules();
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const mod = await import('../fileStore.js');
    mod.initFileStore(db);

    const oldTime = Date.now() - 8 * 24 * 60 * 60 * 1000;
    db.prepare('INSERT INTO files (id, name, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?)').run('old', 'old.txt', 'text/plain', 9, oldTime);

    mod.getFileStore().cleanup();
    expect(db.prepare('SELECT * FROM files WHERE id = ?').get('old')).toBeUndefined();
  });

  it('storeFileFromBuffer stores buffer', async () => {
    vi.resetModules();
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const mod = await import('../fileStore.js');
    mod.initFileStore(db);

    const id = mod.getFileStore().storeFileFromBuffer('test.bin', 'application/octet-stream', Buffer.from('data'));
    expect(id).toBeDefined();
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('storeFileByMoving renames file', async () => {
    vi.resetModules();
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ size: 42 } as any);
    const mod = await import('../fileStore.js');
    mod.initFileStore(db);

    const id = mod.getFileStore().storeFileByMoving('/tmp/upload', 'file.txt', 'text/plain');
    expect(id).toBeDefined();
    expect(fs.renameSync).toHaveBeenCalled();
  });

  it('storeFileByMoving falls back to copy on cross-device', async () => {
    vi.resetModules();
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ size: 42 } as any);
    vi.mocked(fs.renameSync).mockImplementation(() => { throw new Error('EXDEV'); });
    vi.mocked(fs.unlinkSync).mockImplementation(() => {}); // ensure unlinkSync works for source removal
    const mod = await import('../fileStore.js');
    mod.initFileStore(db);

    mod.getFileStore().storeFileByMoving('/tmp/upload', 'file.txt', 'text/plain');
    expect(fs.copyFileSync).toHaveBeenCalled();
    expect(fs.unlinkSync).toHaveBeenCalled();
  });

  it('storeFileFromPath copies file', async () => {
    vi.resetModules();
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ size: 55 } as any);
    const mod = await import('../fileStore.js');
    mod.initFileStore(db);

    const id = mod.getFileStore().storeFileFromPath('/src/file.txt', 'file.txt', 'text/plain');
    expect(id).toBeDefined();
    expect(fs.copyFileSync).toHaveBeenCalled();
  });

  it('getFilePath returns path when exists', async () => {
    vi.resetModules();
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const mod = await import('../fileStore.js');
    mod.initFileStore(db);

    expect(mod.getFileStore().getFilePath('f1')).toContain('f1');
  });

  it('getFilePath returns null when not exists', async () => {
    vi.resetModules();
    const fs = await import('fs');
    let callCount = 0;
    vi.mocked(fs.existsSync).mockImplementation(() => {
      callCount++;
      return callCount <= 1;
    });
    const mod = await import('../fileStore.js');
    mod.initFileStore(db);

    expect(mod.getFileStore().getFilePath('f1')).toBeNull();
  });

  it('getFileMetadata returns metadata', async () => {
    vi.resetModules();
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const mod = await import('../fileStore.js');
    mod.initFileStore(db);

    db.prepare('INSERT INTO files (id, name, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?)').run('f1', 'test.txt', 'text/plain', 9, 1000);

    const meta = mod.getFileStore().getFileMetadata('f1');
    expect(meta).toEqual({ id: 'f1', name: 'test.txt', mimeType: 'text/plain', size: 9, createdAt: 1000 });
  });

  it('getFileMetadata returns null for non-existent', async () => {
    vi.resetModules();
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const mod = await import('../fileStore.js');
    mod.initFileStore(db);
    expect(mod.getFileStore().getFileMetadata('nonexistent')).toBeNull();
  });

  it('getStats returns count and size', async () => {
    vi.resetModules();
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const mod = await import('../fileStore.js');
    mod.initFileStore(db);

    db.prepare('INSERT INTO files (id, name, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?)').run('f1', 'a.txt', 'text/plain', 100, Date.now());
    db.prepare('INSERT INTO files (id, name, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?)').run('f2', 'b.txt', 'text/plain', 200, Date.now());

    const stats = mod.getFileStore().getStats();
    expect(stats.count).toBe(2);
    expect(stats.totalSize).toBe(300);
    expect(stats.totalSizeMB).toBeDefined();
  });

  it('fileStore proxy delegates to getFileStore', async () => {
    vi.resetModules();
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const mod = await import('../fileStore.js');
    mod.initFileStore(db);

    // The proxy should forward method calls to the singleton
    expect(mod.fileStore.getStats()).toBeDefined();
  });
});
