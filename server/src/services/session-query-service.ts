import type Database from 'better-sqlite3';
import type { Session } from '@my-claudia/shared';
import { hasForegroundActiveRunForSession } from '../utils/run-state.js';

type ActiveRunsMap = Map<string, unknown>;

const SESSION_SELECT = `id, project_id as projectId, name, provider_id as providerId,
               sdk_session_id as sdkSessionId, type, parent_session_id as parentSessionId,
               working_directory as workingDirectory,
               archived_at as archivedAt,
               project_role as projectRole, task_id as taskId,
               plan_status as planStatus,
               last_run_status as lastRunStatus,
               CASE WHEN is_read_only = 1 THEN 1 ELSE NULL END as isReadOnly,
               sort_order as sortOrder,
               created_at as createdAt, updated_at as updatedAt`;

export interface SyncedSessionSummary {
  id: string;
  projectId: string;
  name?: string;
  providerId?: string;
  workingDirectory?: string;
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
  lastMessageOffset?: number;
}

export interface SessionSyncResult {
  sessions: SyncedSessionSummary[];
  timestamp: number;
  total: number;
}

export class SessionQueryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class SessionQueryService {
  constructor(
    private readonly db: Database.Database,
    private readonly activeRuns: ActiveRunsMap,
    private readonly now: () => number = () => Date.now(),
  ) {}

  listSessions(projectId?: string, includeArchived = false): Session[] {
    if (projectId && includeArchived) {
      return this.db.prepare(`
        SELECT ${SESSION_SELECT}
        FROM sessions
        WHERE project_id = ?
        ORDER BY sort_order ASC, updated_at DESC
      `).all(projectId) as Session[];
    }

    if (projectId) {
      return this.db.prepare(`
        SELECT ${SESSION_SELECT}
        FROM sessions
        WHERE project_id = ? AND archived_at IS NULL
        ORDER BY sort_order ASC, updated_at DESC
      `).all(projectId) as Session[];
    }

    if (includeArchived) {
      return this.db.prepare(`
        SELECT ${SESSION_SELECT}
        FROM sessions
        ORDER BY sort_order ASC, updated_at DESC
      `).all() as Session[];
    }

    return this.db.prepare(`
      SELECT ${SESSION_SELECT}
      FROM sessions
      WHERE archived_at IS NULL
      ORDER BY sort_order ASC, updated_at DESC
    `).all() as Session[];
  }

  listArchivedSessions(): Session[] {
    return this.db.prepare(`
      SELECT ${SESSION_SELECT}
      FROM sessions
      WHERE archived_at IS NOT NULL
      ORDER BY archived_at DESC
    `).all() as Session[];
  }

  syncSessions(since: string | undefined): SessionSyncResult {
    const sinceTimestamp = since ? parseInt(since, 10) : 0;
    if (isNaN(sinceTimestamp) || sinceTimestamp < 0) {
      throw new SessionQueryError(400, 'VALIDATION_ERROR', 'Invalid since parameter');
    }

    const sessions = this.db.prepare(`
      SELECT s.id, s.project_id as projectId, s.name, s.provider_id as providerId,
             s.sdk_session_id as sdkSessionId, s.type, s.parent_session_id as parentSessionId,
             s.working_directory as workingDirectory,
             s.archived_at as archivedAt,
             s.project_role as projectRole, s.task_id as taskId,
             s.plan_status as planStatus,
             CASE WHEN s.is_read_only = 1 THEN 1 ELSE NULL END as isReadOnly,
             s.created_at as createdAt, s.updated_at as updatedAt,
             (SELECT MAX(offset) FROM messages WHERE session_id = s.id) as lastMessageOffset
      FROM sessions s
      WHERE s.updated_at > ? AND s.archived_at IS NULL
      ORDER BY s.updated_at DESC
    `).all(sinceTimestamp) as (Session & { lastMessageOffset: number | null })[];

    const syncedSessions: SyncedSessionSummary[] = sessions.map((session) => ({
      id: session.id,
      projectId: session.projectId,
      name: session.name,
      providerId: session.providerId ?? undefined,
      workingDirectory: session.workingDirectory ?? undefined,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      isActive: hasForegroundActiveRunForSession(this.activeRuns as Map<string, any>, session.id),
      lastMessageOffset: session.lastMessageOffset ?? undefined,
    }));

    return {
      sessions: syncedSessions,
      timestamp: this.now(),
      total: syncedSessions.length,
    };
  }
}
