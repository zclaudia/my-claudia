import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';

export interface StoredFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  data: string; // base64
  createdAt: number;
}

const STORAGE_DIR = './data/files';

class FileStore {
  private db: Database.Database;
  private storageDir: string;

  constructor(db: Database.Database, storageDir: string = STORAGE_DIR) {
    this.db = db;
    this.storageDir = storageDir;
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
  }

  storeFile(name: string, mimeType: string, data: string): string {
    const fileId = uuidv4();
    const size = Buffer.from(data, 'base64').length;
    const createdAt = Date.now();

    // Write binary to disk
    const filePath = path.join(this.storageDir, fileId);
    fs.writeFileSync(filePath, Buffer.from(data, 'base64'));

    // Insert metadata into DB
    this.db.prepare(
      'INSERT INTO files (id, name, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(fileId, name, mimeType, size, createdAt);

    console.log(`[FileStore] Stored file ${fileId} (${name}, ${size} bytes)`);
    return fileId;
  }

  getFile(fileId: string): StoredFile | null {
    const row = this.db.prepare(
      'SELECT id, name, mime_type, size, created_at FROM files WHERE id = ?'
    ).get(fileId) as { id: string; name: string; mime_type: string; size: number; created_at: number } | undefined;

    if (!row) {
      return null;
    }

    const filePath = path.join(this.storageDir, fileId);
    if (!fs.existsSync(filePath)) {
      // Metadata exists but file is missing on disk — clean up
      this.db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
      console.log(`[FileStore] File ${fileId} missing on disk, removed metadata`);
      return null;
    }

    const data = fs.readFileSync(filePath).toString('base64');

    return {
      id: row.id,
      name: row.name,
      mimeType: row.mime_type,
      size: row.size,
      data,
      createdAt: row.created_at,
    };
  }

  deleteFile(fileId: string): boolean {
    const changes = this.db.prepare('DELETE FROM files WHERE id = ?').run(fileId).changes;

    const filePath = path.join(this.storageDir, fileId);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.error(`[FileStore] Failed to delete file from disk:`, error);
    }

    if (changes > 0) {
      console.log(`[FileStore] Deleted file ${fileId}`);
    }
    return changes > 0;
  }

  cleanup(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    const cutoff = now - maxAge;

    const rows = this.db.prepare(
      'SELECT id FROM files WHERE created_at < ?'
    ).all(cutoff) as Array<{ id: string }>;

    for (const row of rows) {
      this.deleteFile(row.id);
    }

    if (rows.length > 0) {
      console.log(`[FileStore] Cleanup: deleted ${rows.length} old files`);
    }
  }

  getStats() {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as totalSize FROM files'
    ).get() as { count: number; totalSize: number };

    return {
      count: row.count,
      totalSize: row.totalSize,
      totalSizeMB: (row.totalSize / (1024 * 1024)).toFixed(2),
    };
  }
}

// Lazy singleton
let instance: FileStore | null = null;

export function initFileStore(db: Database.Database): void {
  instance = new FileStore(db);

  // Cleanup every hour
  setInterval(() => {
    instance?.cleanup();
  }, 60 * 60 * 1000);

  const stats = instance.getStats();
  console.log(`[FileStore] Initialized: ${stats.count} files, ${stats.totalSizeMB} MB`);
}

export function getFileStore(): FileStore {
  if (!instance) {
    throw new Error('FileStore not initialized — call initFileStore(db) first');
  }
  return instance;
}

// Backwards-compatible named export (calls getFileStore lazily)
// This allows existing `import { fileStore }` to keep working
export const fileStore = new Proxy({} as FileStore, {
  get(_target, prop) {
    return (getFileStore() as any)[prop];
  },
});
