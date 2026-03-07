import { BaseRepository } from './base.js';
import type { Database } from 'better-sqlite3';
import type { Project } from '@my-claudia/shared';
import { v4 as uuidv4 } from 'uuid';

/**
 * Repository for Project entity
 *
 * Handles all database operations for projects, including:
 * - Field mapping between snake_case (DB) and camelCase (TypeScript)
 * - JSON serialization for permission_policy
 * - Timestamp management
 */
export class ProjectRepository extends BaseRepository<
  Project,
  Omit<Project, 'id' | 'createdAt' | 'updatedAt'>,
  Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>>
> {
  constructor(db: Database) {
    super(db, 'projects');
  }

  /**
   * Map database row (snake_case) to Project entity (camelCase)
   */
  mapRow(row: any): Project {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      providerId: row.provider_id,
      rootPath: row.root_path,
      systemPrompt: row.system_prompt,
      permissionPolicy: row.permission_policy ? JSON.parse(row.permission_policy) : undefined,
      isInternal: row.is_internal === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      // Supervision v2
      agent: row.agent ? JSON.parse(row.agent) : undefined,
      contextSyncStatus: row.context_sync_status === 'error' ? 'error' : undefined,
    };
  }

  /**
   * Generate INSERT query for new project
   */
  createQuery(data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): { sql: string; params: any[] } {
    const id = uuidv4();
    const now = Date.now();

    return {
      sql: `
        INSERT INTO projects (id, name, type, provider_id, root_path, system_prompt, permission_policy, agent, context_sync_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      params: [
        id,
        data.name,
        data.type || 'code',
        data.providerId || null,
        data.rootPath || null,
        data.systemPrompt || null,
        data.permissionPolicy ? JSON.stringify(data.permissionPolicy) : null,
        data.agent ? JSON.stringify(data.agent) : null,
        data.contextSyncStatus || 'synced',
        now,
        now
      ]
    };
  }

  /**
   * Generate UPDATE query for existing project
   */
  updateQuery(id: string, data: Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>>): { sql: string; params: any[] } {
    const updates: string[] = [];
    const params: any[] = [];

    // Build dynamic UPDATE query based on provided fields
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
    // Supervision v2
    if (data.agent !== undefined) {
      updates.push('agent = ?');
      params.push(data.agent ? JSON.stringify(data.agent) : null);
    }
    if (data.contextSyncStatus !== undefined) {
      updates.push('context_sync_status = ?');
      params.push(data.contextSyncStatus || 'synced');
    }

    // Always update timestamp
    updates.push('updated_at = ?');
    params.push(Date.now());

    // Add ID as last parameter
    params.push(id);

    return {
      sql: `UPDATE projects SET ${updates.join(', ')} WHERE id = ?`,
      params
    };
  }
}
