import type { Database } from 'better-sqlite3';
import type { SupervisionTask, TaskStatus, TaskResult } from '@my-claudia/shared/features/supervision';
import { v4 as uuidv4 } from 'uuid';

export class SupervisionTaskRepository {
  private schemaCache: {
    hasChangeId?: boolean;
    hasChangeTaskRef?: boolean;
    hasPhaseId?: boolean;
  } = {};

  constructor(private db: Database) {}

  private hasColumn(name: 'change_id' | 'change_task_ref' | 'phase_id'): boolean {
    const cacheKey =
      name === 'change_id' ? 'hasChangeId' :
      name === 'change_task_ref' ? 'hasChangeTaskRef' :
      'hasPhaseId';
    if (this.schemaCache[cacheKey] !== undefined) {
      return this.schemaCache[cacheKey]!;
    }
    const columns = this.db.prepare('PRAGMA table_info(supervision_tasks)').all() as Array<{ name: string }>;
    const exists = columns.some((column) => column.name === name);
    this.schemaCache[cacheKey] = exists;
    return exists;
  }

  mapRow(row: any): SupervisionTask {
    return {
      id: row.id,
      projectId: row.project_id,
      changeId: row.change_id,
      title: row.title,
      description: row.description,
      source: row.source,
      sessionId: row.session_id || undefined,
      status: row.status as TaskStatus,
      priority: row.priority,
      dependencies: row.dependencies ? JSON.parse(row.dependencies) : [],
      dependencyMode: row.dependency_mode || 'all',
      relevantDocIds: row.relevant_doc_ids ? JSON.parse(row.relevant_doc_ids) : undefined,
      taskSpecificContext: row.task_specific_context || undefined,
      scope: row.scope ? JSON.parse(row.scope) : undefined,
      acceptanceCriteria: row.acceptance_criteria ? JSON.parse(row.acceptance_criteria) : [],
      maxRetries: row.max_retries,
      attempt: row.attempt,
      result: row.result ? JSON.parse(row.result) : undefined,
      baseCommit: row.base_commit || undefined,
      createdAt: row.created_at,
      startedAt: row.started_at || undefined,
      completedAt: row.completed_at || undefined,
      scheduleCron: row.schedule_cron || undefined,
      scheduleNextRun: row.schedule_next_run || undefined,
      scheduleEnabled: row.schedule_enabled === 1,
      retryDelayMs: row.retry_delay_ms || undefined,
      changeTaskRef: row.change_task_ref || undefined,
      phaseId: row.phase_id || undefined,
    };
  }

  create(data: {
    projectId: string;
    changeId: string;
    title: string;
    description: string;
    source: 'user' | 'agent_discovered';
    status: TaskStatus;
    priority?: number;
    dependencies?: string[];
    dependencyMode?: 'all' | 'any';
    relevantDocIds?: string[];
    taskSpecificContext?: string;
    scope?: string[];
    acceptanceCriteria?: string[];
    maxRetries?: number;
    scheduleCron?: string;
    scheduleNextRun?: number;
    scheduleEnabled?: boolean;
    retryDelayMs?: number;
  }): SupervisionTask {
    const id = uuidv4();
    const now = Date.now();

    const columns = [
      'id', 'project_id', 'title', 'description', 'source', 'status', 'priority',
      'dependencies', 'dependency_mode', 'relevant_doc_ids', 'task_specific_context',
      'scope', 'acceptance_criteria', 'max_retries', 'attempt',
      'schedule_cron', 'schedule_next_run', 'schedule_enabled', 'retry_delay_ms',
      'created_at', 'updated_at',
    ];
    const params: unknown[] = [
      id,
      data.projectId,
      data.title,
      data.description,
      data.source,
      data.status,
      data.priority ?? 0,
      data.dependencies?.length ? JSON.stringify(data.dependencies) : null,
      data.dependencyMode ?? 'all',
      data.relevantDocIds?.length ? JSON.stringify(data.relevantDocIds) : null,
      data.taskSpecificContext ?? null,
      data.scope?.length ? JSON.stringify(data.scope) : null,
      data.acceptanceCriteria?.length ? JSON.stringify(data.acceptanceCriteria) : null,
      data.maxRetries ?? 2,
      1,
      data.scheduleCron ?? null,
      data.scheduleNextRun ?? null,
      data.scheduleEnabled ? 1 : 0,
      data.retryDelayMs ?? 5000,
      now,
      now,
    ];

    if (this.hasColumn('change_id')) {
      columns.splice(2, 0, 'change_id');
      params.splice(2, 0, data.changeId);
    }
    if (this.hasColumn('change_task_ref')) {
      columns.splice(columns.indexOf('schedule_cron'), 0, 'change_task_ref');
      params.splice(params.length - 6, 0, null);
    }
    if (this.hasColumn('phase_id')) {
      columns.splice(columns.indexOf('schedule_cron'), 0, 'phase_id');
      params.splice(params.length - 6, 0, null);
    }

    const placeholders = columns.map(() => '?').join(', ');
    this.db.prepare(`
      INSERT INTO supervision_tasks (${columns.join(', ')})
      VALUES (${placeholders})
    `).run(...params);

    return this.findById(id)!;
  }

  findById(id: string): SupervisionTask | undefined {
    const row = this.db.prepare('SELECT * FROM supervision_tasks WHERE id = ?').get(id);
    return row ? this.mapRow(row) : undefined;
  }

  findByProjectId(projectId: string): SupervisionTask[] {
    const rows = this.db.prepare(
      'SELECT * FROM supervision_tasks WHERE project_id = ? ORDER BY priority ASC, created_at ASC'
    ).all(projectId);
    return rows.map(r => this.mapRow(r));
  }

  findByChangeId(projectId: string, changeId: string): SupervisionTask[] {
    const hasChangeId = this.hasColumn('change_id');
    if (!hasChangeId) {
      return this.findByProjectId(projectId);
    }
    const rows = this.db.prepare(
      'SELECT * FROM supervision_tasks WHERE project_id = ? AND change_id = ? ORDER BY priority ASC, created_at ASC'
    ).all(projectId, changeId);
    return rows.map(r => this.mapRow(r));
  }

  findByStatus(projectId: string, ...statuses: TaskStatus[]): SupervisionTask[] {
    const placeholders = statuses.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT * FROM supervision_tasks WHERE project_id = ? AND status IN (${placeholders}) ORDER BY priority ASC, created_at ASC`
    ).all(projectId, ...statuses);
    return rows.map(r => this.mapRow(r));
  }

  updateStatus(id: string, status: TaskStatus, extra?: {
    result?: TaskResult;
    sessionId?: string;
    attempt?: number;
    baseCommit?: string;
  }): void {
    const updates = ['status = ?', 'updated_at = ?'];
    const params: any[] = [status, Date.now()];

    if (status === 'running') {
      updates.push('started_at = COALESCE(started_at, ?)');
      params.push(Date.now());
    }
    if (['completed', 'integrated', 'failed', 'cancelled'].includes(status)) {
      updates.push('completed_at = ?');
      params.push(Date.now());
    }
    if (extra?.result !== undefined) {
      updates.push('result = ?');
      params.push(JSON.stringify(extra.result));
    }
    if (extra?.sessionId !== undefined) {
      updates.push('session_id = ?');
      params.push(extra.sessionId);
    }
    if (extra?.attempt !== undefined) {
      updates.push('attempt = ?');
      params.push(extra.attempt);
    }
    if (extra?.baseCommit !== undefined) {
      updates.push('base_commit = ?');
      params.push(extra.baseCommit);
    }

    params.push(id);
    this.db.prepare(
      `UPDATE supervision_tasks SET ${updates.join(', ')} WHERE id = ?`
    ).run(...params);
  }

  update(id: string, data: Partial<Pick<SupervisionTask,
    'title' | 'description' | 'priority' | 'dependencies' | 'dependencyMode' |
    'acceptanceCriteria' | 'relevantDocIds' | 'scope' | 'taskSpecificContext' |
    'scheduleCron' | 'scheduleEnabled' | 'scheduleNextRun' | 'retryDelayMs' |
    'changeTaskRef' | 'phaseId'
  >>): SupervisionTask | undefined {
    const updates: string[] = [];
    const params: any[] = [];

    if (data.title !== undefined) { updates.push('title = ?'); params.push(data.title); }
    if (data.description !== undefined) { updates.push('description = ?'); params.push(data.description); }
    if (data.priority !== undefined) { updates.push('priority = ?'); params.push(data.priority); }
    if (data.dependencies !== undefined) { updates.push('dependencies = ?'); params.push(JSON.stringify(data.dependencies)); }
    if (data.dependencyMode !== undefined) { updates.push('dependency_mode = ?'); params.push(data.dependencyMode); }
    if (data.acceptanceCriteria !== undefined) { updates.push('acceptance_criteria = ?'); params.push(JSON.stringify(data.acceptanceCriteria)); }
    if (data.relevantDocIds !== undefined) { updates.push('relevant_doc_ids = ?'); params.push(JSON.stringify(data.relevantDocIds)); }
    if (data.scope !== undefined) { updates.push('scope = ?'); params.push(JSON.stringify(data.scope)); }
    if (data.taskSpecificContext !== undefined) { updates.push('task_specific_context = ?'); params.push(data.taskSpecificContext); }
    if (data.scheduleCron !== undefined) { updates.push('schedule_cron = ?'); params.push(data.scheduleCron); }
    if (data.scheduleEnabled !== undefined) { updates.push('schedule_enabled = ?'); params.push(data.scheduleEnabled ? 1 : 0); }
    if (data.scheduleNextRun !== undefined) { updates.push('schedule_next_run = ?'); params.push(data.scheduleNextRun); }
    if (data.retryDelayMs !== undefined) { updates.push('retry_delay_ms = ?'); params.push(data.retryDelayMs); }
    if (this.hasColumn('change_task_ref') && (data as Partial<SupervisionTask>).changeTaskRef !== undefined) { updates.push('change_task_ref = ?'); params.push((data as Partial<SupervisionTask>).changeTaskRef); }
    if (this.hasColumn('phase_id') && (data as Partial<SupervisionTask>).phaseId !== undefined) { updates.push('phase_id = ?'); params.push((data as Partial<SupervisionTask>).phaseId); }

    if (updates.length === 0) return this.findById(id);

    updates.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);

    this.db.prepare(
      `UPDATE supervision_tasks SET ${updates.join(', ')} WHERE id = ?`
    ).run(...params);

    return this.findById(id);
  }

  countByProject(projectId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM supervision_tasks WHERE project_id = ?'
    ).get(projectId) as { count: number };
    return row.count;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM supervision_tasks WHERE id = ?').run(id);
  }
}
