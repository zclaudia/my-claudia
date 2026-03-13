import type { Database } from 'better-sqlite3';
import type { SessionDraft } from '@my-claudia/shared';
import { v4 as uuidv4 } from 'uuid';

const LOCK_EXPIRY_MS = 60_000; // 60 seconds
const MAX_CONTENT_SIZE = 100 * 1024; // 100KB

export class SessionDraftRepository {
  constructor(private db: Database) {}

  private mapRow(row: any): SessionDraft {
    return {
      id: row.id,
      sessionId: row.session_id,
      content: row.content,
      editingBy: row.editing_by || undefined,
      editingAt: row.editing_at || undefined,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at || undefined,
    };
  }

  private findAnyBySessionId(sessionId: string): SessionDraft | null {
    const row = this.db.prepare(`
      SELECT * FROM session_drafts
      WHERE session_id = ?
    `).get(sessionId);
    return row ? this.mapRow(row) : null;
  }

  /**
   * Find active (non-archived) draft by session ID
   */
  findBySessionId(sessionId: string): SessionDraft | null {
    const row = this.db.prepare(`
      SELECT * FROM session_drafts
      WHERE session_id = ? AND archived_at IS NULL
    `).get(sessionId);
    return row ? this.mapRow(row) : null;
  }

  /**
   * Check if an active draft exists for a session
   */
  exists(sessionId: string): boolean {
    const row = this.db.prepare(`
      SELECT 1 FROM session_drafts
      WHERE session_id = ? AND archived_at IS NULL
    `).get(sessionId) as any;
    return !!row;
  }

  /**
   * Create or update draft content. Also renews the edit lock.
   */
  upsert(sessionId: string, content: string, deviceId?: string): SessionDraft {
    if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_SIZE) {
      throw new Error('Draft content exceeds maximum size of 100KB');
    }

    const now = Date.now();
    const existing = this.findBySessionId(sessionId);

    if (existing) {
      this.db.prepare(`
        UPDATE session_drafts
        SET content = ?, editing_by = ?, editing_at = ?, updated_at = ?
        WHERE id = ?
      `).run(content, deviceId || existing.editingBy || null, deviceId ? now : existing.editingAt || null, now, existing.id);
      return this.findBySessionId(sessionId)!;
    } else {
      const archived = this.findAnyBySessionId(sessionId);
      if (archived) {
        this.db.prepare(`
          UPDATE session_drafts
          SET content = ?, editing_by = ?, editing_at = ?, updated_at = ?, archived_at = NULL
          WHERE id = ?
        `).run(content, deviceId || null, deviceId ? now : null, now, archived.id);
        return this.findBySessionId(sessionId)!;
      }

      const id = uuidv4();
      this.db.prepare(`
        INSERT INTO session_drafts (id, session_id, content, editing_by, editing_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, sessionId, content, deviceId || null, deviceId ? now : null, now);
      return this.mapRow(this.db.prepare('SELECT * FROM session_drafts WHERE id = ?').get(id));
    }
  }

  /**
   * Try to acquire edit lock. Returns success status and current draft.
   * Lock expires after 60s to prevent dead locks from disconnected devices.
   */
  acquireLock(sessionId: string, deviceId: string): { success: boolean; draft: SessionDraft | null } {
    const now = Date.now();
    const draft = this.findBySessionId(sessionId);

    if (!draft) {
      // No draft exists yet - create an empty one with lock
      const newDraft = this.upsert(sessionId, '', deviceId);
      return { success: true, draft: newDraft };
    }

    // Check if lock is held by another device and not expired
    if (draft.editingBy && draft.editingBy !== deviceId) {
      const lockAge = now - (draft.editingAt || 0);
      if (lockAge < LOCK_EXPIRY_MS) {
        // Lock is held by another device and not expired
        return { success: false, draft };
      }
    }

    // Lock is free, expired, or held by same device - acquire it
    this.db.prepare(`
      UPDATE session_drafts SET editing_by = ?, editing_at = ? WHERE id = ?
    `).run(deviceId, now, draft.id);

    return { success: true, draft: this.findBySessionId(sessionId) };
  }

  /**
   * Force acquire lock regardless of current lock state
   */
  forceLock(sessionId: string, deviceId: string): SessionDraft | null {
    const now = Date.now();
    const draft = this.findBySessionId(sessionId);

    if (!draft) {
      return this.upsert(sessionId, '', deviceId);
    }

    this.db.prepare(`
      UPDATE session_drafts SET editing_by = ?, editing_at = ? WHERE id = ?
    `).run(deviceId, now, draft.id);

    return this.findBySessionId(sessionId);
  }

  /**
   * Release edit lock
   */
  releaseLock(sessionId: string, deviceId: string): void {
    const draft = this.findBySessionId(sessionId);
    if (draft && draft.editingBy === deviceId) {
      this.db.prepare(`
        UPDATE session_drafts SET editing_by = NULL, editing_at = NULL WHERE id = ?
      `).run(draft.id);
    }
  }

  /**
   * Archive draft (soft delete) and release lock
   */
  archive(sessionId: string): SessionDraft | null {
    const draft = this.findBySessionId(sessionId);
    if (!draft) return null;

    const now = Date.now();
    this.db.prepare(`
      UPDATE session_drafts
      SET archived_at = ?, editing_by = NULL, editing_at = NULL, updated_at = ?
      WHERE id = ?
    `).run(now, now, draft.id);

    return this.mapRow(this.db.prepare('SELECT * FROM session_drafts WHERE id = ?').get(draft.id));
  }

  /**
   * Hard delete draft
   */
  delete(sessionId: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM session_drafts WHERE session_id = ?
    `).run(sessionId);
    return result.changes > 0;
  }
}
