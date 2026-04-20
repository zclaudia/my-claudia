import type { Database } from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type {
  DesignGateDecision,
  ExecutionGateDecision,
  GateType,
} from '@my-claudia/shared/features/supervision';

export interface ChangeGateReviewRecord {
  id: string;
  changeId: string;
  gateType: GateType;
  status: 'pending' | 'approved' | 'revision_requested';
  decision?: DesignGateDecision | ExecutionGateDecision;
  notes?: string;
  reviewerUserId?: string;
  createdAt: number;
  resolvedAt?: number;
}

export class ChangeGateReviewRepository {
  constructor(private db: Database) {}

  private hasTable(): boolean {
    const row = this.db
      .prepare("SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = 'change_gate_reviews'")
      .get() as { ok?: number } | undefined;
    return Boolean(row?.ok);
  }

  private mapRow(row: any): ChangeGateReviewRecord {
    return {
      id: row.id,
      changeId: row.change_id,
      gateType: row.gate_type,
      status: row.status,
      decision: row.decision || undefined,
      notes: row.notes || undefined,
      reviewerUserId: row.reviewer_user_id || undefined,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at || undefined,
    };
  }

  request(changeId: string, gateType: GateType, notes?: string): ChangeGateReviewRecord | undefined {
    if (!this.hasTable()) return undefined;
    const now = Date.now();
    const id = uuidv4();
    this.db.prepare(`
      INSERT INTO change_gate_reviews
      (id, change_id, gate_type, status, notes, created_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(id, changeId, gateType, notes ?? null, now);
    return this.findById(id);
  }

  resolve(
    changeId: string,
    gateType: GateType,
    status: 'approved' | 'revision_requested',
    decision: DesignGateDecision | ExecutionGateDecision,
    notes?: string,
  ): ChangeGateReviewRecord | undefined {
    if (!this.hasTable()) return undefined;
    const pending = this.db.prepare(`
      SELECT id FROM change_gate_reviews
      WHERE change_id = ? AND gate_type = ? AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(changeId, gateType) as { id: string } | undefined;
    const id = pending?.id ?? uuidv4();
    const now = Date.now();
    if (pending) {
      this.db.prepare(`
        UPDATE change_gate_reviews
        SET status = ?, decision = ?, notes = ?, resolved_at = ?
        WHERE id = ?
      `).run(status, decision, notes ?? null, now, id);
    } else {
      this.db.prepare(`
        INSERT INTO change_gate_reviews
        (id, change_id, gate_type, status, decision, notes, created_at, resolved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, changeId, gateType, status, decision, notes ?? null, now, now);
    }
    return this.findById(id);
  }

  findById(id: string): ChangeGateReviewRecord | undefined {
    if (!this.hasTable()) return undefined;
    const row = this.db.prepare('SELECT * FROM change_gate_reviews WHERE id = ?').get(id);
    return row ? this.mapRow(row) : undefined;
  }
}
