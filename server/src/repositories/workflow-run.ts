import { BaseRepository } from './base.js';
import type { Database } from 'better-sqlite3';
import type { WorkflowRun, WorkflowRunStatus, WorkflowRunTriggerSource } from '@my-claudia/shared';
import { v4 as uuidv4 } from 'uuid';

type WorkflowRunCreate = Omit<WorkflowRun, 'id' | 'completedAt' | 'error'>;
type WorkflowRunUpdate = Partial<Omit<WorkflowRun, 'id' | 'workflowId' | 'projectId' | 'startedAt'>>;

export class WorkflowRunRepository extends BaseRepository<WorkflowRun, WorkflowRunCreate, WorkflowRunUpdate> {
  constructor(db: Database) {
    super(db, 'workflow_runs');
  }

  mapRow(row: any): WorkflowRun {
    return {
      id: row.id,
      workflowId: row.workflow_id,
      projectId: row.project_id,
      status: row.status as WorkflowRunStatus,
      triggerSource: row.trigger_source as WorkflowRunTriggerSource,
      triggerDetail: row.trigger_detail || undefined,
      currentStepId: row.current_step_id || undefined,
      startedAt: row.started_at,
      completedAt: row.completed_at || undefined,
      error: row.error || undefined,
    };
  }

  createQuery(data: WorkflowRunCreate): { sql: string; params: any[] } {
    const id = uuidv4();
    return {
      sql: `INSERT INTO workflow_runs (
        id, workflow_id, project_id, status, trigger_source, trigger_detail,
        current_step_id, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        data.workflowId,
        data.projectId,
        data.status,
        data.triggerSource,
        data.triggerDetail ?? null,
        data.currentStepId ?? null,
        data.startedAt,
      ],
    };
  }

  updateQuery(id: string, data: WorkflowRunUpdate): { sql: string; params: any[] } {
    const sets: string[] = [];
    const params: any[] = [];

    if (data.status !== undefined) { sets.push('status = ?'); params.push(data.status); }
    if (data.triggerDetail !== undefined) { sets.push('trigger_detail = ?'); params.push(data.triggerDetail); }
    if (data.currentStepId !== undefined) { sets.push('current_step_id = ?'); params.push(data.currentStepId); }
    if (data.completedAt !== undefined) { sets.push('completed_at = ?'); params.push(data.completedAt); }
    if (data.error !== undefined) { sets.push('error = ?'); params.push(data.error); }

    if (sets.length === 0) {
      return { sql: `SELECT 1 FROM workflow_runs WHERE id = ?`, params: [id] };
    }

    params.push(id);
    return {
      sql: `UPDATE workflow_runs SET ${sets.join(', ')} WHERE id = ?`,
      params,
    };
  }

  findByWorkflow(workflowId: string, limit = 20): WorkflowRun[] {
    const rows = this.db.prepare(
      'SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ?'
    ).all(workflowId, limit);
    return rows.map(row => this.mapRow(row));
  }

  findActiveByWorkflow(workflowId: string): WorkflowRun | null {
    const row = this.db.prepare(
      "SELECT * FROM workflow_runs WHERE workflow_id = ? AND status IN ('pending', 'running') LIMIT 1"
    ).get(workflowId);
    return row ? this.mapRow(row) : null;
  }

  findByProject(projectId: string, limit = 50): WorkflowRun[] {
    const rows = this.db.prepare(
      'SELECT * FROM workflow_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?'
    ).all(projectId, limit);
    return rows.map(row => this.mapRow(row));
  }
}
