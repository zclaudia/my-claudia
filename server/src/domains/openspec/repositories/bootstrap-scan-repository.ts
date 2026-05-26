import { BaseRepository } from '../../../infrastructure/repositories/base.js';
import type { Database } from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

/**
 * Phase G4 Task 1 — bootstrap scan repository.
 *
 * One row per AI-driven explore-and-merge pass. ADDED capabilities are
 * auto-applied within the scan; MODIFY / REMOVE operations are deferred to
 * BootstrapReviewItemRepository and counted against pending_count until they
 * are resolved by BootstrapReviewService.
 */

export type BootstrapScanStatus =
  | 'running'
  | 'awaiting_review'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface BootstrapScan {
  id: string;
  projectId: string;
  status: BootstrapScanStatus;
  startedAt: number;
  finishedAt?: number;
  appliedCount: number;
  pendingCount: number;
  errorMessage?: string;
  initPhase?: 'discovering' | 'picking' | 'generating' | 'reviewing';
}

export interface BootstrapScanCreate {
  projectId: string;
}

export interface BootstrapScanUpdate {
  status?: BootstrapScanStatus;
  finishedAt?: number;
  appliedCount?: number;
  pendingCount?: number;
  errorMessage?: string;
  initPhase?: 'discovering' | 'picking' | 'generating' | 'reviewing';
}

interface Row {
  id: string;
  project_id: string;
  status: string;
  started_at: number;
  finished_at: number | null;
  applied_count: number;
  pending_count: number;
  error_message: string | null;
  init_phase: string | null;
}

export class BootstrapScanRepository extends BaseRepository<
  BootstrapScan,
  BootstrapScanCreate,
  BootstrapScanUpdate
> {
  constructor(db: Database) {
    super(db, 'bootstrap_scans');
  }

  mapRow(row: unknown): BootstrapScan {
    const r = row as Row;
    return {
      id: r.id,
      projectId: r.project_id,
      status: r.status as BootstrapScanStatus,
      startedAt: r.started_at,
      finishedAt: r.finished_at ?? undefined,
      appliedCount: r.applied_count,
      pendingCount: r.pending_count,
      errorMessage: r.error_message ?? undefined,
      initPhase: (r.init_phase ?? undefined) as BootstrapScan['initPhase'],
    };
  }

  createQuery(data: BootstrapScanCreate): { sql: string; params: unknown[] } {
    const id = uuidv4();
    const now = Date.now();
    return {
      sql: `INSERT INTO bootstrap_scans (id, project_id, status, started_at, applied_count, pending_count) VALUES (?, ?, ?, ?, ?, ?)`,
      params: [id, data.projectId, 'running', now, 0, 0],
    };
  }

  updateQuery(id: string, data: BootstrapScanUpdate): { sql: string; params: unknown[] } {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (data.status !== undefined) {
      sets.push('status = ?');
      params.push(data.status);
    }
    if (data.finishedAt !== undefined) {
      sets.push('finished_at = ?');
      params.push(data.finishedAt);
    }
    if (data.appliedCount !== undefined) {
      sets.push('applied_count = ?');
      params.push(data.appliedCount);
    }
    if (data.pendingCount !== undefined) {
      sets.push('pending_count = ?');
      params.push(data.pendingCount);
    }
    if (data.errorMessage !== undefined) {
      sets.push('error_message = ?');
      params.push(data.errorMessage);
    }
    if (data.initPhase !== undefined) {
      sets.push('init_phase = ?');
      params.push(data.initPhase);
    }

    if (sets.length === 0) {
      // No-op update — return a query that affects the matching row so
      // BaseRepository.update doesn't treat it as "not found".
      return {
        sql: `UPDATE bootstrap_scans SET id = id WHERE id = ?`,
        params: [id],
      };
    }

    params.push(id);
    return {
      sql: `UPDATE bootstrap_scans SET ${sets.join(', ')} WHERE id = ?`,
      params,
    };
  }

  findActiveByProject(projectId: string): BootstrapScan | null {
    const row = this.db
      .prepare(
        `SELECT * FROM bootstrap_scans WHERE project_id = ? AND status IN ('running','awaiting_review') ORDER BY started_at DESC LIMIT 1`,
      )
      .get(projectId);
    return row ? this.mapRow(row) : null;
  }

  listByProject(projectId: string): BootstrapScan[] {
    const rows = this.db
      .prepare(`SELECT * FROM bootstrap_scans WHERE project_id = ? ORDER BY started_at DESC`)
      .all(projectId);
    return rows.map((r) => this.mapRow(r));
  }
}
