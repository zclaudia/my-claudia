import type { Database } from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

export interface ChangeSyncRunRecord {
  id: string;
  changeId: string;
  status: 'pending' | 'applied';
  summary: string;
  createdAt: number;
  appliedAt?: number;
}

export class ChangeSyncRunRepository {
  constructor(private db: Database) {}

  private hasTable(): boolean {
    const row = this.db
      .prepare("SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = 'change_sync_runs'")
      .get() as { ok?: number } | undefined;
    return Boolean(row?.ok);
  }

  private mapRow(row: any): ChangeSyncRunRecord {
    return {
      id: row.id,
      changeId: row.change_id,
      status: row.status,
      summary: row.summary,
      createdAt: row.created_at,
      appliedAt: row.applied_at || undefined,
    };
  }

  create(changeId: string, summary: string): ChangeSyncRunRecord | undefined {
    if (!this.hasTable()) return undefined;
    const id = uuidv4();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO change_sync_runs
      (id, change_id, status, summary, created_at)
      VALUES (?, ?, 'pending', ?, ?)
    `).run(id, changeId, summary, now);
    return this.findLatest(changeId);
  }

  markApplied(changeId: string): ChangeSyncRunRecord | undefined {
    if (!this.hasTable()) return undefined;
    const pending = this.db.prepare(`
      SELECT id FROM change_sync_runs
      WHERE change_id = ? AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(changeId) as { id: string } | undefined;
    if (!pending) {
      return this.findLatest(changeId);
    }
    const now = Date.now();
    this.db.prepare(`
      UPDATE change_sync_runs
      SET status = 'applied', applied_at = ?
      WHERE id = ?
    `).run(now, pending.id);
    return this.findLatest(changeId);
  }

  findLatest(changeId: string): ChangeSyncRunRecord | undefined {
    if (!this.hasTable()) return undefined;
    const row = this.db.prepare(`
      SELECT * FROM change_sync_runs
      WHERE change_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(changeId);
    return row ? this.mapRow(row) : undefined;
  }
}
