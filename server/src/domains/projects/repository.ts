import { BaseRepository } from '../../infrastructure/repositories/base.js';
import type { Database } from 'better-sqlite3';
import type { Project } from '@my-claudia/shared/core/project';
import { v4 as uuidv4 } from 'uuid';

export class ProjectRepository extends BaseRepository<
  Project,
  Omit<Project, 'id' | 'createdAt' | 'updatedAt'>,
  Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>>
> {
  constructor(db: Database) {
    super(db, 'projects');
  }

  mapRow(row: any): Project {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      providerId: row.provider_id || undefined,
      rootPath: row.root_path || undefined,
      systemPrompt: row.system_prompt || undefined,
      permissionPolicy: row.permission_policy ? JSON.parse(row.permission_policy) : undefined,
      agentPermissionOverride: row.agent_permission_override ? JSON.parse(row.agent_permission_override) : undefined,
      isInternal: row.is_internal === 1,
      reviewProviderId: row.review_provider_id || undefined,
      sortOrder: row.sort_order ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      agent: row.agent ? JSON.parse(row.agent) : undefined,
      contextSyncStatus: row.context_sync_status === 'error' ? 'error' : undefined,
    };
  }

  createQuery(data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): { sql: string; params: any[] } {
    const id = uuidv4();
    const now = Date.now();

    return {
      sql: `
        INSERT INTO projects (
          id, name, type, provider_id, root_path, system_prompt,
          permission_policy, agent_permission_override, agent, context_sync_status,
          review_provider_id, sort_order, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      params: [
        id,
        data.name,
        data.type || 'code',
        data.providerId || null,
        data.rootPath || null,
        data.systemPrompt || null,
        data.permissionPolicy ? JSON.stringify(data.permissionPolicy) : null,
        data.agentPermissionOverride ? JSON.stringify(data.agentPermissionOverride) : null,
        data.agent ? JSON.stringify(data.agent) : null,
        data.contextSyncStatus || 'synced',
        data.reviewProviderId || null,
        data.sortOrder ?? null,
        now,
        now,
      ],
    };
  }

  updateQuery(id: string, data: Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>>): { sql: string; params: any[] } {
    const updates: string[] = [];
    const params: any[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      params.push(data.name);
    }
    if (data.type !== undefined) {
      updates.push('type = ?');
      params.push(data.type);
    }
    if (data.providerId !== undefined) {
      updates.push('provider_id = ?');
      params.push(data.providerId);
    }
    if (data.rootPath !== undefined) {
      updates.push('root_path = ?');
      params.push(data.rootPath);
    }
    if (data.systemPrompt !== undefined) {
      updates.push('system_prompt = ?');
      params.push(data.systemPrompt);
    }
    if (data.permissionPolicy !== undefined) {
      updates.push('permission_policy = ?');
      params.push(data.permissionPolicy ? JSON.stringify(data.permissionPolicy) : null);
    }
    if (data.agentPermissionOverride !== undefined) {
      updates.push('agent_permission_override = ?');
      params.push(data.agentPermissionOverride ? JSON.stringify(data.agentPermissionOverride) : null);
    }
    if (data.agent !== undefined) {
      updates.push('agent = ?');
      params.push(data.agent ? JSON.stringify(data.agent) : null);
    }
    if (data.contextSyncStatus !== undefined) {
      updates.push('context_sync_status = ?');
      params.push(data.contextSyncStatus || 'synced');
    }
    if (data.reviewProviderId !== undefined) {
      updates.push('review_provider_id = ?');
      params.push(data.reviewProviderId || null);
    }
    if (data.sortOrder !== undefined) {
      updates.push('sort_order = ?');
      params.push(data.sortOrder ?? null);
    }

    updates.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);

    return {
      sql: `UPDATE projects SET ${updates.join(', ')} WHERE id = ?`,
      params,
    };
  }

  findAllOrdered(): Project[] {
    const rows = this.db.prepare(`
      SELECT * FROM projects
      ORDER BY sort_order ASC, updated_at DESC
    `).all();
    return rows.map((row) => this.mapRow(row));
  }

  findNextSortOrder(): number {
    const row = this.db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 as sortOrder FROM projects'
    ).get() as { sortOrder: number };
    return row.sortOrder;
  }
}
