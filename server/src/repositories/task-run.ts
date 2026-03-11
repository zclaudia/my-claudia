import { BaseRepository } from './base.js';
import type { Database } from 'better-sqlite3';
import type { TaskRun, TaskRunStatus, TaskSource } from '@my-claudia/shared';
import { v4 as uuidv4 } from 'uuid';

type TaskRunCreate = Omit<TaskRun, 'id' | 'createdAt'>;
type TaskRunUpdate = Partial<Omit<TaskRun, 'id' | 'taskId' | 'taskSource' | 'createdAt'>>;

export class TaskRunRepository extends BaseRepository<TaskRun, TaskRunCreate, TaskRunUpdate> {
  constructor(db: Database) {
    super(db, 'task_runs');
  }

  mapRow(row: any): TaskRun {
    return {
      id: row.id,
      taskId: row.task_id,
      taskSource: row.task_source as TaskSource,
      status: row.status as TaskRunStatus,
      startedAt: row.started_at,
      completedAt: row.completed_at || undefined,
      durationMs: row.duration_ms || undefined,
      result: row.result || undefined,
      error: row.error || undefined,
      createdAt: row.created_at,
    };
  }

  createQuery(data: TaskRunCreate): { sql: string; params: any[] } {
    const id = uuidv4();
    const now = Date.now();
    return {
      sql: `INSERT INTO task_runs (id, task_id, task_source, status, started_at, completed_at, duration_ms, result, error, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        data.taskId,
        data.taskSource,
        data.status,
        data.startedAt,
        data.completedAt ?? null,
        data.durationMs ?? null,
        data.result ?? null,
        data.error ?? null,
        now,
      ],
    };
  }

  updateQuery(id: string, data: TaskRunUpdate): { sql: string; params: any[] } {
    const sets: string[] = [];
    const params: any[] = [];

    if (data.status !== undefined) { sets.push('status = ?'); params.push(data.status); }
    if (data.completedAt !== undefined) { sets.push('completed_at = ?'); params.push(data.completedAt); }
    if (data.durationMs !== undefined) { sets.push('duration_ms = ?'); params.push(data.durationMs); }
    if (data.result !== undefined) { sets.push('result = ?'); params.push(data.result); }
    if (data.error !== undefined) { sets.push('error = ?'); params.push(data.error ?? null); }

    params.push(id);
    return {
      sql: `UPDATE task_runs SET ${sets.join(', ')} WHERE id = ?`,
      params,
    };
  }

  findByTaskId(taskId: string, limit: number = 50): TaskRun[] {
    const rows = this.db
      .prepare('SELECT * FROM task_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT ?')
      .all(taskId, limit);
    return rows.map((r) => this.mapRow(r));
  }

  pruneOldRuns(maxAgeDays: number = 7): number {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const result = this.db
      .prepare('DELETE FROM task_runs WHERE created_at < ?')
      .run(cutoff);
    return result.changes;
  }
}

export type { TaskRunCreate, TaskRunUpdate };
