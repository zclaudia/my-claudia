import { BaseRepository } from './base.js';
import type { Database } from 'better-sqlite3';
import type { Session } from '@my-claudia/shared';
import { v4 as uuidv4 } from 'uuid';

/**
 * Repository for Session entity
 *
 * Handles all database operations for sessions, including:
 * - Field mapping between snake_case (DB) and camelCase (TypeScript)
 * - Foreign key relationships with projects and providers
 * - Timestamp management
 */
export class SessionRepository extends BaseRepository<
  Session,
  Omit<Session, 'id' | 'createdAt' | 'updatedAt'>,
  Partial<Omit<Session, 'id' | 'createdAt' | 'updatedAt'>>
> {
  constructor(db: Database) {
    super(db, 'sessions');
  }

  /**
   * Map database row (snake_case) to Session entity (camelCase)
   */
  mapRow(row: any): Session {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      providerId: row.provider_id,
      sdkSessionId: row.sdk_session_id,
      type: row.type || 'regular',
      parentSessionId: row.parent_session_id || undefined,
      workingDirectory: row.working_directory || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at || undefined,
      // Supervision v2
      projectRole: row.project_role || undefined,
      taskId: row.task_id || undefined,
      planStatus: row.plan_status || undefined,
      isReadOnly: row.is_read_only === 1 ? true : undefined,
    };
  }

  /**
   * Generate INSERT query for new session
   */
  createQuery(data: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>): { sql: string; params: any[] } {
    const id = uuidv4();
    const now = Date.now();

    return {
      sql: `
        INSERT INTO sessions (id, project_id, name, provider_id, sdk_session_id, type, parent_session_id, working_directory, project_role, task_id, plan_status, is_read_only, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      params: [
        id,
        data.projectId,
        data.name || null,
        data.providerId || null,
        data.sdkSessionId || null,
        data.type || 'regular',
        data.parentSessionId || null,
        data.workingDirectory || null,
        data.projectRole || null,
        data.taskId || null,
        data.planStatus || null,
        data.isReadOnly ? 1 : 0,
        now,
        now
      ]
    };
  }

  /**
   * Generate UPDATE query for existing session
   */
  updateQuery(id: string, data: Partial<Omit<Session, 'id' | 'createdAt' | 'updatedAt'>>): { sql: string; params: any[] } {
    const updates: string[] = [];
    const params: any[] = [];

    // Build dynamic UPDATE query based on provided fields
    if (data.projectId !== undefined) {
      updates.push('project_id = ?');
      params.push(data.projectId);
    }
    if (data.name !== undefined) {
      updates.push('name = ?');
      params.push(data.name);
    }
    if (data.providerId !== undefined) {
      updates.push('provider_id = ?');
      params.push(data.providerId);
    }
    if (data.sdkSessionId !== undefined) {
      updates.push('sdk_session_id = ?');
      params.push(data.sdkSessionId);
    }
    if (data.type !== undefined) {
      updates.push('type = ?');
      params.push(data.type);
    }
    if (data.parentSessionId !== undefined) {
      updates.push('parent_session_id = ?');
      params.push(data.parentSessionId);
    }
    if (data.workingDirectory !== undefined) {
      updates.push('working_directory = ?');
      params.push(data.workingDirectory || null);
    }
    if (data.archivedAt !== undefined) {
      updates.push('archived_at = ?');
      params.push(data.archivedAt || null);
    }
    // Supervision v2
    if (data.projectRole !== undefined) {
      updates.push('project_role = ?');
      params.push(data.projectRole || null);
    }
    if (data.taskId !== undefined) {
      updates.push('task_id = ?');
      params.push(data.taskId || null);
    }
    if (data.planStatus !== undefined) {
      updates.push('plan_status = ?');
      params.push(data.planStatus || null);
    }
    if (data.isReadOnly !== undefined) {
      updates.push('is_read_only = ?');
      params.push(data.isReadOnly ? 1 : 0);
    }

    // Always update timestamp
    updates.push('updated_at = ?');
    params.push(Date.now());

    // Add ID as last parameter
    params.push(id);

    return {
      sql: `UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`,
      params
    };
  }

  /**
   * Find all sessions for a specific project
   */
  findByProjectId(projectId: string): Session[] {
    const rows = this.db.prepare(`
      SELECT * FROM sessions
      WHERE project_id = ?
      ORDER BY updated_at DESC
    `).all(projectId);
    return rows.map(row => this.mapRow(row));
  }

  /**
   * Find sessions by project role (e.g. 'checkpoint', 'review', 'task', 'main')
   */
  findByProjectRole(projectId: string, role: string): Session[] {
    const rows = this.db.prepare(`
      SELECT * FROM sessions
      WHERE project_id = ? AND project_role = ?
      ORDER BY created_at DESC
    `).all(projectId, role);
    return rows.map(row => this.mapRow(row));
  }

  /**
   * Find session by SDK session ID
   */
  findBySdkSessionId(sdkSessionId: string): Session | null {
    const row = this.db.prepare(`
      SELECT * FROM sessions
      WHERE sdk_session_id = ?
    `).get(sdkSessionId);
    return row ? this.mapRow(row) : null;
  }
}
