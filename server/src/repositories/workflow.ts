import { BaseRepository } from './base.js';
import type { Database } from 'better-sqlite3';
import type { Workflow, WorkflowStatus, WorkflowDefinition } from '@my-claudia/shared';
import { v4 as uuidv4 } from 'uuid';

type WorkflowCreate = Omit<Workflow, 'id' | 'createdAt' | 'updatedAt'>;
type WorkflowUpdate = Partial<Omit<Workflow, 'id' | 'projectId' | 'createdAt'>>;

export class WorkflowRepository extends BaseRepository<Workflow, WorkflowCreate, WorkflowUpdate> {
  constructor(db: Database) {
    super(db, 'workflows');
  }

  mapRow(row: any): Workflow {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description || undefined,
      status: row.status as WorkflowStatus,
      definition: JSON.parse(row.definition || '{}') as WorkflowDefinition,
      templateId: row.template_id || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  createQuery(data: WorkflowCreate): { sql: string; params: any[] } {
    const id = uuidv4();
    const now = Date.now();
    return {
      sql: `INSERT INTO workflows (
        id, project_id, name, description, status, definition, template_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        data.projectId,
        data.name,
        data.description ?? null,
        data.status ?? 'active',
        JSON.stringify(data.definition),
        data.templateId ?? null,
        now,
        now,
      ],
    };
  }

  updateQuery(id: string, data: WorkflowUpdate): { sql: string; params: any[] } {
    const now = Date.now();
    const sets: string[] = ['updated_at = ?'];
    const params: any[] = [now];

    if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name); }
    if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description); }
    if (data.status !== undefined) { sets.push('status = ?'); params.push(data.status); }
    if (data.definition !== undefined) { sets.push('definition = ?'); params.push(JSON.stringify(data.definition)); }
    if (data.templateId !== undefined) { sets.push('template_id = ?'); params.push(data.templateId); }

    params.push(id);
    return {
      sql: `UPDATE workflows SET ${sets.join(', ')} WHERE id = ?`,
      params,
    };
  }

  findByProject(projectId: string): Workflow[] {
    const rows = this.db.prepare('SELECT * FROM workflows WHERE project_id = ? ORDER BY created_at DESC').all(projectId);
    return rows.map(row => this.mapRow(row));
  }

  findByProjectAndTemplate(projectId: string, templateId: string): Workflow | null {
    const row = this.db.prepare('SELECT * FROM workflows WHERE project_id = ? AND template_id = ?').get(projectId, templateId);
    return row ? this.mapRow(row) : null;
  }

  findAllActive(): Workflow[] {
    const rows = this.db.prepare("SELECT * FROM workflows WHERE status = 'active'").all();
    return rows.map(row => this.mapRow(row));
  }
}
