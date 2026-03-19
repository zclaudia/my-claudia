import type { Database } from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

export interface WorkflowSchedule {
  id: string;
  workflowId: string;
  triggerIndex: number;
  nextRun: number | null;
  enabled: boolean;
}

export class WorkflowScheduleRepository {
  constructor(private db: Database) {}

  private mapRow(row: any): WorkflowSchedule {
    return {
      id: row.id,
      workflowId: row.workflow_id,
      triggerIndex: row.trigger_index,
      nextRun: row.next_run || null,
      enabled: row.enabled === 1,
    };
  }

  findByWorkflow(workflowId: string): WorkflowSchedule | null {
    const row = this.db.prepare('SELECT * FROM workflow_schedules WHERE workflow_id = ?').get(workflowId);
    return row ? this.mapRow(row) : null;
  }

  findDue(now: number): WorkflowSchedule[] {
    const rows = this.db.prepare(
      'SELECT * FROM workflow_schedules WHERE enabled = 1 AND next_run IS NOT NULL AND next_run <= ?'
    ).all(now);
    return rows.map(row => this.mapRow(row));
  }

  upsert(workflowId: string, triggerIndex: number, nextRun: number | null, enabled: boolean): WorkflowSchedule {
    const existing = this.findByWorkflow(workflowId);
    if (existing) {
      this.db.prepare(
        'UPDATE workflow_schedules SET trigger_index = ?, next_run = ?, enabled = ? WHERE workflow_id = ?'
      ).run(triggerIndex, nextRun, enabled ? 1 : 0, workflowId);
      return { ...existing, triggerIndex, nextRun, enabled };
    }

    const id = uuidv4();
    this.db.prepare(
      'INSERT INTO workflow_schedules (id, workflow_id, trigger_index, next_run, enabled) VALUES (?, ?, ?, ?, ?)'
    ).run(id, workflowId, triggerIndex, nextRun, enabled ? 1 : 0);
    return { id, workflowId, triggerIndex, nextRun, enabled };
  }

  updateNextRun(workflowId: string, nextRun: number | null): void {
    this.db.prepare('UPDATE workflow_schedules SET next_run = ? WHERE workflow_id = ?').run(nextRun, workflowId);
  }

  deleteByWorkflow(workflowId: string): void {
    this.db.prepare('DELETE FROM workflow_schedules WHERE workflow_id = ?').run(workflowId);
  }
}
