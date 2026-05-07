import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

/**
 * AttachmentStore — persistent disk-backed storage for business attachments.
 *
 * Key differences from FileStore (which is for transient session files):
 *   - No automatic cleanup. Lifecycle is owned by the consuming domain.
 *   - Two-level directory bucketing (`<id-prefix-2>/<id>`) to avoid huge
 *     single directories.
 *   - SHA-256 captured at store time (enables future deduplication).
 *
 * The store does not know about owners — that belongs to the attachments
 * domain (DB table). It only handles bytes ↔ disk.
 */

const DEFAULT_STORAGE_DIRNAME = 'attachments';

export interface StoredAttachmentMeta {
  storageKey: string; // relative path under storageDir, e.g. 'ab/abcdef...'
  size: number;
  sha256: string;
}

class AttachmentStore {
  constructor(private storageDir: string) {
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
  }

  /**
   * Store an attachment from a Buffer. Used by JSON/base64 upload path.
   */
  storeFromBuffer(buffer: Buffer): StoredAttachmentMeta {
    const id = uuidv4();
    const storageKey = this.makeStorageKey(id);
    const absPath = this.absolutePath(storageKey);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, buffer);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    console.log(`[AttachmentStore] Stored ${storageKey} (${buffer.length} bytes)`);
    return { storageKey, size: buffer.length, sha256 };
  }

  /**
   * Move a temp file (e.g. from multer disk storage) into the store.
   * Falls back to copy+delete on cross-device renames.
   */
  storeByMoving(sourcePath: string): StoredAttachmentMeta {
    const id = uuidv4();
    const storageKey = this.makeStorageKey(id);
    const absPath = this.absolutePath(storageKey);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });

    try {
      fs.renameSync(sourcePath, absPath);
    } catch {
      fs.copyFileSync(sourcePath, absPath);
      try {
        fs.unlinkSync(sourcePath);
      } catch (err) {
        console.error('[AttachmentStore] Failed to remove source after copy fallback:', err);
      }
    }

    const stat = fs.statSync(absPath);
    const sha256 = this.computeFileSha256(absPath);
    console.log(`[AttachmentStore] Stored ${storageKey} by moving (${stat.size} bytes)`);
    return { storageKey, size: stat.size, sha256 };
  }

  /**
   * Copy an existing local file into the store.
   */
  storeByCopying(sourcePath: string): StoredAttachmentMeta {
    const id = uuidv4();
    const storageKey = this.makeStorageKey(id);
    const absPath = this.absolutePath(storageKey);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.copyFileSync(sourcePath, absPath);

    const stat = fs.statSync(absPath);
    const sha256 = this.computeFileSha256(absPath);
    console.log(`[AttachmentStore] Stored ${storageKey} by copying (${stat.size} bytes)`);
    return { storageKey, size: stat.size, sha256 };
  }

  /**
   * Resolve a storage key to an absolute filesystem path. Returns null if
   * the file no longer exists on disk.
   */
  getPath(storageKey: string): string | null {
    if (!this.isSafeStorageKey(storageKey)) return null;
    const absPath = this.absolutePath(storageKey);
    return fs.existsSync(absPath) ? absPath : null;
  }

  /**
   * Remove file from disk. Returns true if removal happened, false if the
   * file did not exist.
   */
  delete(storageKey: string): boolean {
    if (!this.isSafeStorageKey(storageKey)) return false;
    const absPath = this.absolutePath(storageKey);
    try {
      if (fs.existsSync(absPath)) {
        fs.unlinkSync(absPath);
        return true;
      }
    } catch (err) {
      console.error(`[AttachmentStore] Failed to delete ${storageKey}:`, err);
    }
    return false;
  }

  getStorageDir(): string {
    return this.storageDir;
  }

  // ── internals ──────────────────────────────────────────────────────

  private makeStorageKey(id: string): string {
    // Two-level bucket: <first 2 chars of id>/<id>
    return `${id.slice(0, 2)}/${id}`;
  }

  private absolutePath(storageKey: string): string {
    return path.join(this.storageDir, storageKey);
  }

  private computeFileSha256(absPath: string): string {
    const hash = crypto.createHash('sha256');
    const buf = fs.readFileSync(absPath);
    hash.update(buf);
    return hash.digest('hex');
  }

  /**
   * Defensive guard — storage keys are always server-generated, but we still
   * reject anything that could escape storageDir.
   */
  private isSafeStorageKey(storageKey: string): boolean {
    if (!storageKey || storageKey.includes('..') || path.isAbsolute(storageKey)) {
      return false;
    }
    const resolved = path.resolve(this.storageDir, storageKey);
    return resolved.startsWith(path.resolve(this.storageDir) + path.sep);
  }
}

let instance: AttachmentStore | null = null;

export function initAttachmentStore(): void {
  const dataDir = process.env.MY_CLAUDIA_DATA_DIR
    ? path.resolve(process.env.MY_CLAUDIA_DATA_DIR)
    : path.join(os.homedir(), '.my-claudia');
  const storageDir = path.join(dataDir, DEFAULT_STORAGE_DIRNAME);
  instance = new AttachmentStore(storageDir);
  console.log(`[AttachmentStore] Initialized at ${storageDir}`);
}

export function getAttachmentStore(): AttachmentStore {
  if (!instance) {
    throw new Error('AttachmentStore not initialized — call initAttachmentStore() first');
  }
  return instance;
}

/**
 * Backwards-compatible-style proxy export — mirrors fileStore export pattern.
 * Lazily resolves to the singleton on every property access.
 */
export const attachmentStore = new Proxy({} as AttachmentStore, {
  get(_target, prop) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (getAttachmentStore() as any)[prop];
  },
});

export type { AttachmentStore };
