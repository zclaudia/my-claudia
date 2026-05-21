import { BaseRepository } from '../../../infrastructure/repositories/base.js';
import type { Database } from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

/**
 * Phase G4 Task 1 — bootstrap review item repository.
 *
 * Stores per-capability MODIFY / REMOVE operations deferred by a bootstrap
 * scan for explicit human approval. The `payload_json` shape varies by
 * `operation`:
 *   - 'modify': serialized ParsedRequirement
 *   - 'remove': { name: string }
 * Cascade delete from bootstrap_scans cleans these up automatically.
 */

export type BootstrapReviewOp = 'modify' | 'remove';
export type BootstrapReviewStatus = 'pending' | 'approved' | 'rejected';

export interface BootstrapReviewItem {
  id: string;
  scanId: string;
  capability: string;
  operation: BootstrapReviewOp;
  /** For 'modify': serialized ParsedRequirement. For 'remove': { name: string }. */
  payloadJson: string;
  status: BootstrapReviewStatus;
  createdAt: number;
  resolvedAt?: number;
}

export interface BootstrapReviewItemCreate {
  scanId: string;
  capability: string;
  operation: BootstrapReviewOp;
  payloadJson: string;
}

export interface BootstrapReviewItemUpdate {
  status?: BootstrapReviewStatus;
  resolvedAt?: number;
}

interface Row {
  id: string;
  scan_id: string;
  capability: string;
  operation: string;
  payload_json: string;
  status: string;
  created_at: number;
  resolved_at: number | null;
}

export class BootstrapReviewItemRepository extends BaseRepository<
  BootstrapReviewItem,
  BootstrapReviewItemCreate,
  BootstrapReviewItemUpdate
> {
  constructor(db: Database) {
    super(db, 'bootstrap_review_items');
  }

  mapRow(row: unknown): BootstrapReviewItem {
    const r = row as Row;
    return {
      id: r.id,
      scanId: r.scan_id,
      capability: r.capability,
      operation: r.operation as BootstrapReviewOp,
      payloadJson: r.payload_json,
      status: r.status as BootstrapReviewStatus,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at ?? undefined,
    };
  }

  createQuery(data: BootstrapReviewItemCreate): { sql: string; params: unknown[] } {
    const id = uuidv4();
    return {
      sql: `INSERT INTO bootstrap_review_items (id, scan_id, capability, operation, payload_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [id, data.scanId, data.capability, data.operation, data.payloadJson, 'pending', Date.now()],
    };
  }

  updateQuery(id: string, data: BootstrapReviewItemUpdate): { sql: string; params: unknown[] } {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (data.status !== undefined) {
      sets.push('status = ?');
      params.push(data.status);
    }
    if (data.resolvedAt !== undefined) {
      sets.push('resolved_at = ?');
      params.push(data.resolvedAt);
    }

    if (sets.length === 0) {
      return {
        sql: `UPDATE bootstrap_review_items SET id = id WHERE id = ?`,
        params: [id],
      };
    }

    params.push(id);
    return {
      sql: `UPDATE bootstrap_review_items SET ${sets.join(', ')} WHERE id = ?`,
      params,
    };
  }

  listByScan(scanId: string): BootstrapReviewItem[] {
    const rows = this.db
      .prepare(`SELECT * FROM bootstrap_review_items WHERE scan_id = ? ORDER BY created_at ASC`)
      .all(scanId);
    return rows.map((r) => this.mapRow(r));
  }

  listPendingByScan(scanId: string): BootstrapReviewItem[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM bootstrap_review_items WHERE scan_id = ? AND status = 'pending' ORDER BY created_at ASC`,
      )
      .all(scanId);
    return rows.map((r) => this.mapRow(r));
  }
}
