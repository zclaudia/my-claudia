import * as fs from 'fs';
import type Database from 'better-sqlite3';
import type { EventData } from '../../events/index.js';
import type { Session, SessionType } from '@my-claudia/shared';
import { getGatewayClient } from '../gateway/gateway-instance.js';
import { pluginEvents } from '../../events/index.js';
import { SessionRepository } from './repository.js';

type SessionEventType = 'created' | 'updated' | 'deleted';

interface SessionLifecycleDependencies {
  now?: () => number;
  pathExists?: (path: string) => boolean;
  broadcastSessionEvent?: (type: SessionEventType, session: Session) => void;
  emitPluginEvent?: (event: string, payload?: EventData) => Promise<unknown>;
}

interface CreateSessionInput {
  projectId?: string;
  name?: string;
  providerId?: string | null;
  type?: SessionType;
  parentSessionId?: string | null;
  workingDirectory?: string | null;
}

export class SessionLifecycleError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class SessionLifecycleService {
  private readonly repo: SessionRepository;
  private readonly now: () => number;
  private readonly pathExists: (path: string) => boolean;
  private readonly broadcastSessionEvent: (type: SessionEventType, session: Session) => void;
  private readonly emitPluginEvent: (event: string, payload?: EventData) => Promise<unknown>;

  constructor(
    private readonly db: Database.Database,
    deps: SessionLifecycleDependencies = {},
  ) {
    this.repo = new SessionRepository(db);
    this.now = deps.now ?? (() => Date.now());
    this.pathExists = deps.pathExists ?? ((targetPath: string) => fs.existsSync(targetPath));
    this.broadcastSessionEvent = deps.broadcastSessionEvent ?? ((type, session) => {
      const gatewayClient = getGatewayClient();
      gatewayClient?.commands.backendData.broadcastSessionEvent(type, session);
    });
    this.emitPluginEvent = deps.emitPluginEvent ?? ((event, payload) => pluginEvents.emit(event, payload));
  }

  createSession(input: CreateSessionInput): Session {
    if (!input.projectId) {
      throw new SessionLifecycleError(400, 'VALIDATION_ERROR', 'Project ID is required');
    }

    const project = this.db.prepare('SELECT id FROM projects WHERE id = ?').get(input.projectId);
    if (!project) {
      throw new SessionLifecycleError(400, 'VALIDATION_ERROR', 'Project not found');
    }

    if (input.workingDirectory && !this.pathExists(input.workingDirectory)) {
      throw new SessionLifecycleError(400, 'VALIDATION_ERROR', 'Working directory does not exist');
    }

    const validTypes = ['regular', 'background', 'agent'] as const;
    const sessionType: SessionType = input.type && validTypes.includes(input.type)
      ? input.type
      : 'regular';

    const sortOrder = this.repo.findNextSortOrder(input.projectId);
    const session = this.repo.create({
      projectId: input.projectId,
      name: input.name,
      providerId: input.providerId ?? undefined,
      type: sessionType,
      parentSessionId: input.parentSessionId ?? undefined,
      workingDirectory: input.workingDirectory ?? undefined,
      sortOrder,
    });

    this.broadcastSessionEvent('created', session);
    this.emitPluginEvent('session.created', { sessionId: session.id, session }).catch(() => {});
    return session;
  }

  archiveSessions(sessionIds: string[]): { archived: number } {
    this.assertSessionIds(sessionIds);

    const now = this.now();
    const stmt = this.db.prepare('UPDATE sessions SET archived_at = ?, updated_at = ? WHERE id = ?');
    this.db.transaction(() => {
      for (const id of sessionIds) {
        stmt.run(now, now, id);
      }
    })();

    for (const id of sessionIds) {
      const session = this.repo.findById(id);
      if (session) {
        this.broadcastSessionEvent('updated', session);
      }
      this.emitPluginEvent('session.archived', { sessionId: id }).catch(() => {});
    }

    return { archived: sessionIds.length };
  }

  restoreSessions(sessionIds: string[]): { restored: number } {
    this.assertSessionIds(sessionIds);

    const now = this.now();
    const stmt = this.db.prepare('UPDATE sessions SET archived_at = NULL, updated_at = ? WHERE id = ?');
    this.db.transaction(() => {
      for (const id of sessionIds) {
        stmt.run(now, id);
      }
    })();

    for (const id of sessionIds) {
      const session = this.repo.findById(id);
      if (session) {
        this.broadcastSessionEvent('updated', session);
      }
      this.emitPluginEvent('session.restored', { sessionId: id }).catch(() => {});
    }

    return { restored: sessionIds.length };
  }

  updateWorkingDirectory(sessionId: string, workingDirectory: string | null | undefined): Session {
    const lockRow = this.db.prepare(`
      SELECT project_role, plan_status
      FROM sessions
      WHERE id = ?
    `).get(sessionId) as { project_role: string | null; plan_status: string | null } | undefined;

    if (!lockRow) {
      throw new SessionLifecycleError(404, 'NOT_FOUND', 'Session not found');
    }

    const isPlanningTaskSession = lockRow.project_role === 'task' && lockRow.plan_status === 'planning';
    if (isPlanningTaskSession) {
      throw new SessionLifecycleError(409, 'LOCKED', 'Worktree is locked during Supervisor planning mode');
    }

    if (workingDirectory && !this.pathExists(workingDirectory)) {
      throw new SessionLifecycleError(400, 'VALIDATION_ERROR', 'Working directory does not exist');
    }

    this.repo.update(
      sessionId,
      { workingDirectory: workingDirectory ?? null } as Partial<Omit<Session, 'id' | 'createdAt' | 'updatedAt'>>,
    );
    const updatedSession = this.repo.findById(sessionId);
    if (!updatedSession) {
      throw new SessionLifecycleError(404, 'NOT_FOUND', 'Session not found');
    }

    this.broadcastSessionEvent('updated', updatedSession);
    return updatedSession;
  }

  unlockSession(sessionId: string): Session {
    const existing = this.repo.findById(sessionId);
    if (!existing) {
      throw new SessionLifecycleError(404, 'NOT_FOUND', 'Session not found');
    }

    this.repo.update(sessionId, {
      isReadOnly: false,
      planStatus: existing.projectRole === 'task' ? 'planning' : null,
    });

    const updatedSession = this.repo.findById(sessionId);
    if (!updatedSession) {
      throw new SessionLifecycleError(404, 'NOT_FOUND', 'Session not found');
    }

    this.broadcastSessionEvent('updated', updatedSession);
    return updatedSession;
  }

  resetSdkSession(sessionId: string): { sessionId: string; reset: boolean } {
    const existing = this.repo.findById(sessionId);
    if (!existing) {
      throw new SessionLifecycleError(404, 'NOT_FOUND', 'Session not found');
    }

    this.repo.update(
      sessionId,
      ({ sdkSessionId: null } as unknown) as Partial<Omit<Session, 'id' | 'createdAt' | 'updatedAt'>>,
    );
    const updatedSession = this.repo.findById(sessionId);
    if (updatedSession) {
      this.broadcastSessionEvent('updated', updatedSession);
    }
    this.emitPluginEvent('session.updated', { sessionId, session: updatedSession }).catch(() => {});

    return { sessionId, reset: true };
  }

  dismissInterrupted(sessionId: string): void {
    const existing = this.repo.findById(sessionId);
    if (!existing) {
      throw new SessionLifecycleError(404, 'NOT_FOUND', 'Session not found');
    }

    this.repo.update(sessionId, { lastRunStatus: null });
  }

  deleteSession(sessionId: string): void {
    const session = this.repo.findById(sessionId);
    if (!session) {
      throw new SessionLifecycleError(404, 'NOT_FOUND', 'Session not found');
    }

    const result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    if (result.changes === 0) {
      throw new SessionLifecycleError(404, 'NOT_FOUND', 'Session not found');
    }

    this.broadcastSessionEvent('deleted', session);
    this.emitPluginEvent('session.deleted', { sessionId, session }).catch(() => {});
  }

  reorderSessions(projectId: string | undefined, orderedIds: string[] | undefined): void {
    if (!projectId || !Array.isArray(orderedIds) || orderedIds.length === 0) {
      throw new SessionLifecycleError(400, 'BAD_REQUEST', 'projectId and orderedIds are required');
    }

    const update = this.db.prepare('UPDATE sessions SET sort_order = ? WHERE id = ? AND project_id = ?');
    this.db.transaction(() => {
      for (let i = 0; i < orderedIds.length; i++) {
        update.run(i, orderedIds[i], projectId);
      }
    })();
  }

  private assertSessionIds(sessionIds: string[]): void {
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
      throw new SessionLifecycleError(400, 'VALIDATION_ERROR', 'sessionIds array is required');
    }
  }
}
