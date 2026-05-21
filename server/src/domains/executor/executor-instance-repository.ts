import { BaseRepository } from '../../infrastructure/repositories/base.js';
import type { Database } from 'better-sqlite3';
import type {
  ExecutorInstance,
  ExecutorInstanceCreate,
  ExecutorInstanceUpdate,
  ExecutorStatus,
  ExecutorType,
} from '@my-claudia/shared/features/executor';
import { v4 as uuidv4 } from 'uuid';

interface Row {
  id: string;
  project_id: string;
  spec_change_id: string;
  type: string;
  underlying_id: string | null;
  status_summary: string;
  progress_json: string | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

export class ExecutorInstanceRepository extends BaseRepository<
  ExecutorInstance,
  ExecutorInstanceCreate,
  ExecutorInstanceUpdate
> {
  constructor(db: Database) {
    super(db, 'executor_instances');
  }

  mapRow(raw: unknown): ExecutorInstance {
    const r = raw as Row;
    return {
      id: r.id,
      projectId: r.project_id,
      specChangeId: r.spec_change_id,
      type: r.type as ExecutorType,
      underlyingId: r.underlying_id ?? undefined,
      statusSummary: r.status_summary as ExecutorStatus,
      progressJson: r.progress_json ?? undefined,
      startedAt: r.started_at ?? undefined,
      completedAt: r.completed_at ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  createQuery(data: ExecutorInstanceCreate): { sql: string; params: unknown[] } {
    const id = uuidv4();
    const now = Date.now();
    return {
      sql: `INSERT INTO executor_instances
              (id, project_id, spec_change_id, type, underlying_id, status_summary, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        data.projectId,
        data.specChangeId,
        data.type,
        data.underlyingId ?? null,
        'pending',
        now,
        now,
      ],
    };
  }

  updateQuery(id: string, data: ExecutorInstanceUpdate): { sql: string; params: unknown[] } {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (data.statusSummary !== undefined) {
      sets.push('status_summary = ?');
      params.push(data.statusSummary);
    }
    if (data.progressJson !== undefined) {
      sets.push('progress_json = ?');
      params.push(data.progressJson);
    }
    if (data.startedAt !== undefined) {
      sets.push('started_at = ?');
      params.push(data.startedAt);
    }
    if (data.completedAt !== undefined) {
      sets.push('completed_at = ?');
      params.push(data.completedAt);
    }
    // Always bump updated_at so callers can rely on it monotonically advancing
    // even when the update payload is otherwise empty.
    sets.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);
    return {
      sql: `UPDATE executor_instances SET ${sets.join(', ')} WHERE id = ?`,
      params,
    };
  }

  listBySpecChange(specChangeId: string): ExecutorInstance[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM executor_instances WHERE spec_change_id = ? ORDER BY created_at ASC`,
      )
      .all(specChangeId);
    return rows.map((r) => this.mapRow(r));
  }

  listByProjectAndStatus(projectId: string, status: ExecutorStatus): ExecutorInstance[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM executor_instances WHERE project_id = ? AND status_summary = ? ORDER BY updated_at DESC`,
      )
      .all(projectId, status);
    return rows.map((r) => this.mapRow(r));
  }
}
