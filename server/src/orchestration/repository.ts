/**
 * OrchestratorTask repository — CRUD for orchestrator_tasks table.
 */

import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { OrchestratorTask, TaskStatus, TaskKind, TaskInitiator } from './types.js';
import type { BranchAction } from '@my-claudia/shared';

interface TaskRow {
  id: string;
  parent_task_id: string | null;
  root_task_id: string | null;
  project_id: string | null;
  session_id: string | null;
  branch_id: string | null;
  branch_action: string | null;
  context_reset: number | null;
  kind: string;
  context_template: string;
  status: string;
  task: string;
  external_id: string | null;
  initiator: string;
  schedule_type: string | null;
  schedule_config: string | null;
  depends_on: string | null;
  provider_id: string | null;
  retry_count: number;
  max_retries: number;
  result_summary: string | null;
  error_summary: string | null;
  response_text: string | null;
  tool_count: number | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  updated_at: number;
}

function rowToTask(row: TaskRow): OrchestratorTask {
  return {
    id: row.id,
    parentTaskId: row.parent_task_id,
    rootTaskId: row.root_task_id,
    projectId: row.project_id,
    sessionId: row.session_id,
    branchId: row.branch_id,
    branchAction: (row.branch_action ?? undefined) as BranchAction | undefined,
    contextReset: Boolean(row.context_reset),
    kind: row.kind as TaskKind,
    contextTemplate: row.context_template,
    status: row.status as TaskStatus,
    task: row.task,
    externalId: row.external_id,
    initiator: row.initiator as TaskInitiator,
    scheduleType: row.schedule_type ?? undefined,
    scheduleConfig: row.schedule_config ?? undefined,
    dependsOn: row.depends_on ? JSON.parse(row.depends_on) : undefined,
    providerId: row.provider_id ?? undefined,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    resultSummary: row.result_summary ?? undefined,
    errorSummary: row.error_summary ?? undefined,
    responseText: row.response_text ?? undefined,
    toolCount: row.tool_count ?? undefined,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    updatedAt: row.updated_at,
  };
}

export class TaskRepository {
  constructor(private db: Database.Database) {}

  create(task: Omit<OrchestratorTask, 'id' | 'createdAt' | 'updatedAt' | 'retryCount'> & { id?: string }): OrchestratorTask {
    const id = task.id || uuidv4();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO orchestrator_tasks (
        id, parent_task_id, root_task_id, project_id, session_id, branch_id, branch_action, context_reset,
        kind, context_template, status, task, external_id, initiator,
        schedule_type, schedule_config, depends_on, provider_id,
        retry_count, max_retries, result_summary, error_summary,
        response_text, tool_count,
        created_at, started_at, completed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, task.parentTaskId, task.rootTaskId, task.projectId, task.sessionId, task.branchId,
      task.branchAction ?? null, task.contextReset ? 1 : 0,
      task.kind, task.contextTemplate, task.status, task.task, task.externalId ?? null, task.initiator,
      task.scheduleType ?? null, task.scheduleConfig ?? null,
      task.dependsOn ? JSON.stringify(task.dependsOn) : null, task.providerId ?? null,
      0, task.maxRetries ?? 0, task.resultSummary ?? null, task.errorSummary ?? null,
      task.responseText ?? null, task.toolCount ?? null,
      now, task.startedAt ?? null, task.completedAt ?? null, now,
    );
    return this.findById(id)!;
  }

  findById(id: string): OrchestratorTask | undefined {
    const row = this.db.prepare('SELECT * FROM orchestrator_tasks WHERE id = ?').get(id) as TaskRow | undefined;
    return row ? rowToTask(row) : undefined;
  }

  findByStatus(...statuses: TaskStatus[]): OrchestratorTask[] {
    const placeholders = statuses.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT * FROM orchestrator_tasks WHERE status IN (${placeholders}) ORDER BY created_at ASC`
    ).all(...statuses) as TaskRow[];
    return rows.map(rowToTask);
  }

  findByParent(parentId: string | null): OrchestratorTask[] {
    const rows = parentId
      ? this.db.prepare('SELECT * FROM orchestrator_tasks WHERE parent_task_id = ? ORDER BY created_at ASC').all(parentId) as TaskRow[]
      : this.db.prepare('SELECT * FROM orchestrator_tasks WHERE parent_task_id IS NULL ORDER BY created_at ASC').all() as TaskRow[];
    return rows.map(rowToTask);
  }

  findByExternalId(kind: TaskKind, externalId: string): OrchestratorTask | undefined {
    const row = this.db.prepare(
      'SELECT * FROM orchestrator_tasks WHERE kind = ? AND external_id = ?'
    ).get(kind, externalId) as TaskRow | undefined;
    return row ? rowToTask(row) : undefined;
  }

  findByProject(projectId: string): OrchestratorTask[] {
    const rows = this.db.prepare(
      'SELECT * FROM orchestrator_tasks WHERE project_id = ? ORDER BY created_at DESC'
    ).all(projectId) as TaskRow[];
    return rows.map(rowToTask);
  }

  updateStatus(id: string, status: TaskStatus, extra?: {
    startedAt?: number;
    completedAt?: number;
    resultSummary?: string;
    errorSummary?: string;
    sessionId?: string;
    responseText?: string;
    toolCount?: number;
  }): void {
    const now = Date.now();
    const sets = ['status = ?', 'updated_at = ?'];
    const params: unknown[] = [status, now];

    if (extra?.startedAt !== undefined) { sets.push('started_at = ?'); params.push(extra.startedAt); }
    if (extra?.completedAt !== undefined) { sets.push('completed_at = ?'); params.push(extra.completedAt); }
    if (extra?.resultSummary !== undefined) { sets.push('result_summary = ?'); params.push(extra.resultSummary); }
    if (extra?.errorSummary !== undefined) { sets.push('error_summary = ?'); params.push(extra.errorSummary); }
    if (extra?.sessionId !== undefined) { sets.push('session_id = ?'); params.push(extra.sessionId); }
    if (extra?.responseText !== undefined) { sets.push('response_text = ?'); params.push(extra.responseText); }
    if (extra?.toolCount !== undefined) { sets.push('tool_count = ?'); params.push(extra.toolCount); }

    params.push(id);
    this.db.prepare(`UPDATE orchestrator_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  incrementRetry(id: string): void {
    this.db.prepare(
      'UPDATE orchestrator_tasks SET retry_count = retry_count + 1, updated_at = ? WHERE id = ?'
    ).run(Date.now(), id);
  }
}
