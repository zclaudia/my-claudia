import { BaseRepository } from '../../repositories/base.js';
import type { Database } from 'better-sqlite3';
import { normalizeWorkflowDefinition } from '@my-claudia/shared/features/workflows';
import type { Workflow, WorkflowStatus, WorkflowDefinition } from '@my-claudia/shared/features/workflows';
import { v4 as uuidv4 } from 'uuid';

type WorkflowCreate = Omit<Workflow, 'id' | 'createdAt' | 'updatedAt'>;
type WorkflowUpdate = Partial<Omit<Workflow, 'id' | 'projectId' | 'createdAt'>>;

export class WorkflowRepository extends BaseRepository<Workflow, WorkflowCreate, WorkflowUpdate> {
  constructor(db: Database) {
    super(db, 'workflows');
  }

  mapRow(raw: unknown): Workflow {
    const row = raw as Record<string, unknown>;
    const parsedDefinition = JSON.parse((row.definition as string) || '{}');
    return {
      id: row.id as string,
      projectId: (row.project_id as string) ?? undefined,
      name: row.name as string,
      description: (row.description as string) || undefined,
      status: row.status as WorkflowStatus,
      definition: normalizeWorkflowDefinition(parsedDefinition) as WorkflowDefinition,
      templateId: (row.template_id as string) || undefined,
      sourcePluginId: (row.source_plugin_id as string) || undefined,
      sourceType: (row.source_type as Workflow['sourceType']) || undefined,
      authoringMode: (row.authoring_mode as Workflow['authoringMode']) || undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  createQuery(data: WorkflowCreate): { sql: string; params: unknown[] } {
    const id = uuidv4();
    const now = Date.now();
    return {
      sql: `INSERT INTO workflows (
        id, project_id, name, description, status, definition, template_id,
        source_plugin_id, source_type, authoring_mode,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        data.projectId ?? null,
        data.name,
        data.description ?? null,
        data.status ?? 'active',
        JSON.stringify(data.definition),
        data.templateId ?? null,
        data.sourcePluginId ?? null,
        data.sourceType ?? 'user',
        data.authoringMode ?? 'graph',
        now,
        now,
      ],
    };
  }

  updateQuery(id: string, data: WorkflowUpdate): { sql: string; params: unknown[] } {
    const now = Date.now();
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];

    if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name); }
    if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description); }
    if (data.status !== undefined) { sets.push('status = ?'); params.push(data.status); }
    if (data.definition !== undefined) { sets.push('definition = ?'); params.push(JSON.stringify(data.definition)); }
    if (data.templateId !== undefined) { sets.push('template_id = ?'); params.push(data.templateId); }
    if (data.sourcePluginId !== undefined) { sets.push('source_plugin_id = ?'); params.push(data.sourcePluginId); }
    if (data.sourceType !== undefined) { sets.push('source_type = ?'); params.push(data.sourceType); }
    if (data.authoringMode !== undefined) { sets.push('authoring_mode = ?'); params.push(data.authoringMode); }

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

  findAll(): Workflow[] {
    const rows = this.db.prepare('SELECT * FROM workflows ORDER BY created_at DESC').all();
    return rows.map(row => this.mapRow(row));
  }

  findGlobal(): Workflow[] {
    const rows = this.db.prepare('SELECT * FROM workflows WHERE project_id IS NULL ORDER BY created_at DESC').all();
    return rows.map(row => this.mapRow(row));
  }

  findGlobalByTemplate(templateId: string): Workflow | null {
    const row = this.db.prepare('SELECT * FROM workflows WHERE project_id IS NULL AND template_id = ?').get(templateId);
    return row ? this.mapRow(row) : null;
  }

  findAllActive(): Workflow[] {
    const rows = this.db.prepare("SELECT * FROM workflows WHERE status = 'active'").all();
    return rows.map(row => this.mapRow(row));
  }
}
