import { BaseRepository } from '../../../infrastructure/repositories/base.js';
import type { Database } from 'better-sqlite3';
import type {
  MetaWorkflowRun,
  MetaWorkflowRunStatus,
  MetaWorkflowConfig,
} from '@my-claudia/shared/features/meta-workflow';
import { v4 as uuidv4 } from 'uuid';

type Create = Omit<MetaWorkflowRun, 'id' | 'completedAt'>;
type Update = Partial<Omit<MetaWorkflowRun, 'id' | 'projectId' | 'createdAt'>>;

export class MetaWorkflowRunRepository extends BaseRepository<MetaWorkflowRun, Create, Update> {
  constructor(db: Database) {
    super(db, 'meta_workflow_runs');
  }

  mapRow(raw: unknown): MetaWorkflowRun {
    const row = raw as Record<string, unknown>;
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      title: row.title as string,
      description: (row.description as string) || undefined,
      status: row.status as MetaWorkflowRunStatus,
      requirementsPath: (row.requirements_path as string) || undefined,
      phasesJson: (row.phases_json as string) || undefined,
      smokePathRunId: (row.smoke_path_run_id as string) || undefined,
      rejectCount: row.reject_count as number,
      defaultProviderId: (row.default_provider_id as string) || undefined,
      config: row.config ? (JSON.parse(row.config as string) as MetaWorkflowConfig) : undefined,
      worktreeId: (row.worktree_id as string) || undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      completedAt: (row.completed_at as number) || undefined,
    };
  }

  createQuery(data: Create): { sql: string; params: unknown[] } {
    const id = uuidv4();
    return {
      sql: `INSERT INTO meta_workflow_runs (
        id, project_id, title, description, status,
        requirements_path, phases_json, smoke_path_run_id,
        reject_count, default_provider_id, config, worktree_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id, data.projectId, data.title, data.description ?? null, data.status,
        data.requirementsPath ?? null, data.phasesJson ?? null, data.smokePathRunId ?? null,
        data.rejectCount, data.defaultProviderId ?? null,
        data.config ? JSON.stringify(data.config) : null,
        data.worktreeId ?? null,
        data.createdAt, data.updatedAt,
      ],
    };
  }

  updateQuery(id: string, data: Update): { sql: string; params: unknown[] } {
    const sets: string[] = [];
    const params: unknown[] = [];

    const map: Array<[keyof Update, string, (v: unknown) => unknown]> = [
      ['title', 'title', (v) => v],
      ['description', 'description', (v) => v ?? null],
      ['status', 'status', (v) => v],
      ['requirementsPath', 'requirements_path', (v) => v ?? null],
      ['phasesJson', 'phases_json', (v) => v ?? null],
      ['smokePathRunId', 'smoke_path_run_id', (v) => v ?? null],
      ['rejectCount', 'reject_count', (v) => v],
      ['defaultProviderId', 'default_provider_id', (v) => v ?? null],
      ['config', 'config', (v) => (v ? JSON.stringify(v) : null)],
      ['worktreeId', 'worktree_id', (v) => v ?? null],
      ['updatedAt', 'updated_at', (v) => v],
      ['completedAt', 'completed_at', (v) => v ?? null],
    ];

    for (const [key, col, transform] of map) {
      if (data[key] !== undefined) {
        sets.push(`${col} = ?`);
        params.push(transform(data[key]));
      }
    }

    if (sets.length === 0) {
      return { sql: `SELECT 1 FROM meta_workflow_runs WHERE id = ?`, params: [id] };
    }
    params.push(id);
    return {
      sql: `UPDATE meta_workflow_runs SET ${sets.join(', ')} WHERE id = ?`,
      params,
    };
  }

  findByProject(projectId: string, limit = 50): MetaWorkflowRun[] {
    const rows = this.db.prepare(
      `SELECT * FROM meta_workflow_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
    ).all(projectId, limit);
    return rows.map((r) => this.mapRow(r));
  }
}
