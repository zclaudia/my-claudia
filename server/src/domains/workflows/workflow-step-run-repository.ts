import { BaseRepository } from '../../repositories/base.js';
import type { Database } from 'better-sqlite3';
import type { WorkflowStepRun, WorkflowStepRunStatus, WorkflowStepType } from '@my-claudia/shared';
import { v4 as uuidv4 } from 'uuid';

type StepRunCreate = Omit<WorkflowStepRun, 'id' | 'input' | 'output' | 'error' | 'startedAt' | 'completedAt'>;
type StepRunUpdate = Partial<Omit<WorkflowStepRun, 'id' | 'runId' | 'stepId' | 'stepType'>>;

export class WorkflowStepRunRepository extends BaseRepository<WorkflowStepRun, StepRunCreate, StepRunUpdate> {
  constructor(db: Database) {
    super(db, 'workflow_step_runs');
  }

  mapRow(raw: unknown): WorkflowStepRun {
    const row = raw as Record<string, unknown>;
    return {
      id: row.id as string,
      runId: row.run_id as string,
      stepId: row.step_id as string,
      stepType: row.step_type as WorkflowStepType,
      status: row.status as WorkflowStepRunStatus,
      input: row.input ? JSON.parse(row.input as string) : undefined,
      output: row.output ? JSON.parse(row.output as string) : undefined,
      error: (row.error as string) || undefined,
      attempt: row.attempt as number,
      sessionId: (row.session_id as string) || undefined,
      startedAt: (row.started_at as number) || undefined,
      completedAt: (row.completed_at as number) || undefined,
    };
  }

  createQuery(data: StepRunCreate): { sql: string; params: unknown[] } {
    const id = uuidv4();
    return {
      sql: `INSERT INTO workflow_step_runs (
        id, run_id, step_id, step_type, status, attempt, session_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        data.runId,
        data.stepId,
        data.stepType,
        data.status,
        data.attempt ?? 1,
        data.sessionId ?? null,
      ],
    };
  }

  updateQuery(id: string, data: StepRunUpdate): { sql: string; params: unknown[] } {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (data.status !== undefined) { sets.push('status = ?'); params.push(data.status); }
    if (data.input !== undefined) { sets.push('input = ?'); params.push(JSON.stringify(data.input)); }
    if (data.output !== undefined) { sets.push('output = ?'); params.push(JSON.stringify(data.output)); }
    if (data.error !== undefined) { sets.push('error = ?'); params.push(data.error); }
    if (data.attempt !== undefined) { sets.push('attempt = ?'); params.push(data.attempt); }
    if (data.sessionId !== undefined) { sets.push('session_id = ?'); params.push(data.sessionId); }
    if (data.startedAt !== undefined) { sets.push('started_at = ?'); params.push(data.startedAt); }
    if (data.completedAt !== undefined) { sets.push('completed_at = ?'); params.push(data.completedAt); }

    if (sets.length === 0) {
      return { sql: `SELECT 1 FROM workflow_step_runs WHERE id = ?`, params: [id] };
    }

    params.push(id);
    return {
      sql: `UPDATE workflow_step_runs SET ${sets.join(', ')} WHERE id = ?`,
      params,
    };
  }

  findByRun(runId: string): WorkflowStepRun[] {
    const rows = this.db.prepare(
      'SELECT * FROM workflow_step_runs WHERE run_id = ? ORDER BY rowid ASC'
    ).all(runId);
    return rows.map(row => this.mapRow(row));
  }

  findByRunAndStep(runId: string, stepId: string): WorkflowStepRun | null {
    const row = this.db.prepare(
      'SELECT * FROM workflow_step_runs WHERE run_id = ? AND step_id = ?'
    ).get(runId, stepId);
    return row ? this.mapRow(row) : null;
  }
}
