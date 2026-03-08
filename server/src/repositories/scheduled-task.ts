import { BaseRepository } from './base.js';
import type { Database } from 'better-sqlite3';
import type {
  ScheduledTask,
  ScheduleType,
  ScheduledActionType,
  ScheduledTaskStatus,
} from '@my-claudia/shared';
import { v4 as uuidv4 } from 'uuid';

type ScheduledTaskCreate = Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'runCount' | 'status'>;
type ScheduledTaskUpdate = Partial<Omit<ScheduledTask, 'id' | 'createdAt'>>;

export class ScheduledTaskRepository extends BaseRepository<ScheduledTask, ScheduledTaskCreate, ScheduledTaskUpdate> {
  constructor(db: Database) {
    super(db, 'scheduled_tasks');
  }

  mapRow(row: any): ScheduledTask {
    return {
      id: row.id,
      projectId: row.project_id || undefined,
      name: row.name,
      description: row.description || undefined,
      enabled: row.enabled === 1,
      scheduleType: row.schedule_type as ScheduleType,
      scheduleCron: row.schedule_cron || undefined,
      scheduleIntervalMinutes: row.schedule_interval_minutes || undefined,
      scheduleOnceAt: row.schedule_once_at || undefined,
      nextRun: row.next_run || undefined,
      actionType: row.action_type as ScheduledActionType,
      actionConfig: JSON.parse(row.action_config || '{}'),
      status: row.status as ScheduledTaskStatus,
      lastRunAt: row.last_run_at || undefined,
      lastRunResult: row.last_run_result || undefined,
      lastError: row.last_error || undefined,
      runCount: row.run_count,
      templateId: row.template_id || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  createQuery(data: ScheduledTaskCreate): { sql: string; params: any[] } {
    const id = uuidv4();
    const now = Date.now();
    return {
      sql: `INSERT INTO scheduled_tasks (
        id, project_id, name, description, enabled,
        schedule_type, schedule_cron, schedule_interval_minutes, schedule_once_at, next_run,
        action_type, action_config,
        status, run_count, template_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', 0, ?, ?, ?)`,
      params: [
        id,
        data.projectId ?? null,
        data.name,
        data.description ?? null,
        data.enabled ? 1 : 0,
        data.scheduleType,
        data.scheduleCron ?? null,
        data.scheduleIntervalMinutes ?? null,
        data.scheduleOnceAt ?? null,
        data.nextRun ?? null,
        data.actionType,
        JSON.stringify(data.actionConfig),
        data.templateId ?? null,
        now,
        now,
      ],
    };
  }

  updateQuery(id: string, data: ScheduledTaskUpdate): { sql: string; params: any[] } {
    const now = Date.now();
    const sets: string[] = ['updated_at = ?'];
    const params: any[] = [now];

    if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name); }
    if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description); }
    if (data.enabled !== undefined) { sets.push('enabled = ?'); params.push(data.enabled ? 1 : 0); }
    if (data.scheduleCron !== undefined) { sets.push('schedule_cron = ?'); params.push(data.scheduleCron); }
    if (data.scheduleIntervalMinutes !== undefined) { sets.push('schedule_interval_minutes = ?'); params.push(data.scheduleIntervalMinutes); }
    if (data.scheduleOnceAt !== undefined) { sets.push('schedule_once_at = ?'); params.push(data.scheduleOnceAt); }
    if (data.nextRun !== undefined) { sets.push('next_run = ?'); params.push(data.nextRun); }
    if (data.actionConfig !== undefined) { sets.push('action_config = ?'); params.push(JSON.stringify(data.actionConfig)); }
    if (data.status !== undefined) { sets.push('status = ?'); params.push(data.status); }
    if (data.lastRunAt !== undefined) { sets.push('last_run_at = ?'); params.push(data.lastRunAt); }
    if (data.lastRunResult !== undefined) { sets.push('last_run_result = ?'); params.push(data.lastRunResult); }
    if (data.lastError !== undefined) { sets.push('last_error = ?'); params.push(data.lastError ?? null); }
    if (data.runCount !== undefined) { sets.push('run_count = ?'); params.push(data.runCount); }

    params.push(id);
    return {
      sql: `UPDATE scheduled_tasks SET ${sets.join(', ')} WHERE id = ?`,
      params,
    };
  }

  findByProjectId(projectId: string): ScheduledTask[] {
    const rows = this.db
      .prepare('SELECT * FROM scheduled_tasks WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId);
    return rows.map((r) => this.mapRow(r));
  }

  findGlobalTasks(): ScheduledTask[] {
    const rows = this.db
      .prepare('SELECT * FROM scheduled_tasks WHERE project_id IS NULL ORDER BY created_at DESC')
      .all();
    return rows.map((r) => this.mapRow(r));
  }

  findDueTasks(now: number): ScheduledTask[] {
    const rows = this.db
      .prepare("SELECT * FROM scheduled_tasks WHERE enabled = 1 AND status != 'running' AND next_run <= ? ORDER BY next_run ASC")
      .all(now);
    return rows.map((r) => this.mapRow(r));
  }

  findByTemplateId(projectId: string | null, templateId: string): ScheduledTask | null {
    const row = projectId
      ? this.db.prepare('SELECT * FROM scheduled_tasks WHERE project_id = ? AND template_id = ? LIMIT 1').get(projectId, templateId)
      : this.db.prepare('SELECT * FROM scheduled_tasks WHERE project_id IS NULL AND template_id = ? LIMIT 1').get(templateId);
    return row ? this.mapRow(row) : null;
  }
}

export type { ScheduledTaskCreate, ScheduledTaskUpdate };
