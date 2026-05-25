import * as fs from 'fs';
import * as path from 'path';
import type Database from 'better-sqlite3';
import type { EventData } from '../../infrastructure/events/index.js';
import type { Session, SessionType } from '@my-claudia/shared/core/session';
import { pluginEvents } from '../../infrastructure/events/index.js';
import { SessionRepository } from './repository.js';
import {
  assertValidSessionState,
  buildUnlockedSessionState,
  isPlanningTaskSession,
  normalizeSessionCreateInput,
  normalizeSessionType,
  type SessionCreateInput,
  type SessionUpdatePatch,
} from './model.js';
import { assertPlanStatusTransition, isSessionArchived } from './plan-status-machine.js';
import type { EventDispatcher } from '../supervision/event-dispatcher.js';
import type { SessionDomainEvent } from './session-events.js';

type SessionEventType = 'created' | 'updated' | 'deleted';

function normalizeWorkingDirectoryForCompare(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = path.normalize(trimmed);
  return normalized.length > 1 ? normalized.replace(/[\\/]+$/, '') : normalized;
}

interface SessionLifecycleDependencies {
  now?: () => number;
  pathExists?: (path: string) => boolean;
  broadcastSessionEvent?: (type: SessionEventType, session: Session) => void;
  emitPluginEvent?: (event: string, payload?: EventData) => Promise<unknown>;
  eventDispatcher?: EventDispatcher<SessionDomainEvent>;
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
  private readonly domainEvents: EventDispatcher<SessionDomainEvent> | undefined;

  constructor(
    private readonly db: Database.Database,
    deps: SessionLifecycleDependencies = {},
  ) {
    this.repo = new SessionRepository(db);
    this.now = deps.now ?? (() => Date.now());
    this.pathExists = deps.pathExists ?? ((targetPath: string) => fs.existsSync(targetPath));
    this.broadcastSessionEvent = deps.broadcastSessionEvent ?? (() => {
      /* no-op — caller should inject a concrete broadcast function */
    });
    this.emitPluginEvent = deps.emitPluginEvent ?? ((event, payload) => pluginEvents.emit(event, payload));
    this.domainEvents = deps.eventDispatcher;
  }

  createSession(input: SessionCreateInput): Session {
    const normalizedInput = normalizeSessionCreateInput(input);
    if (!normalizedInput.projectId) {
      throw new SessionLifecycleError(400, 'VALIDATION_ERROR', 'Project ID is required');
    }

    const project = this.db.prepare('SELECT id FROM projects WHERE id = ?').get(normalizedInput.projectId);
    if (!project) {
      throw new SessionLifecycleError(400, 'VALIDATION_ERROR', 'Project not found');
    }

    if (normalizedInput.workingDirectory && !this.pathExists(normalizedInput.workingDirectory)) {
      throw new SessionLifecycleError(400, 'VALIDATION_ERROR', 'Working directory does not exist');
    }

    const sessionType: SessionType = normalizeSessionType(normalizedInput.type);
    assertValidSessionState({
      type: sessionType,
      parentSessionId: normalizedInput.parentSessionId ?? undefined,
      projectRole: undefined,
      planStatus: undefined,
    });

    const sortOrder = this.repo.findNextSortOrder(normalizedInput.projectId);
    const session = this.repo.create({
      projectId: normalizedInput.projectId,
      name: normalizedInput.name,
      providerId: normalizedInput.providerId ?? undefined,
      type: sessionType,
      parentSessionId: normalizedInput.parentSessionId ?? undefined,
      workingDirectory: normalizedInput.workingDirectory ?? undefined,
      sortOrder,
    });

    this.broadcastSessionEvent('created', session);
    this.emitPluginEvent('session.created', { sessionId: session.id, session }).catch(() => {});
    this.domainEvents?.dispatch({
      type: 'session.created',
      sessionId: session.id,
      projectId: session.projectId,
      timestamp: this.now(),
    });
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
        this.domainEvents?.dispatch({
          type: 'session.archived',
          sessionId: id,
          projectId: session.projectId,
          timestamp: this.now(),
        });
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
        this.domainEvents?.dispatch({
          type: 'session.restored',
          sessionId: id,
          projectId: session.projectId,
          timestamp: this.now(),
        });
      }
      this.emitPluginEvent('session.restored', { sessionId: id }).catch(() => {});
    }

    return { restored: sessionIds.length };
  }

  updateSessionMetadata(sessionId: string, patch: SessionUpdatePatch): Session {
    const existing = this.repo.findById(sessionId);
    if (!existing) {
      throw new SessionLifecycleError(404, 'NOT_FOUND', 'Session not found');
    }

    if (isSessionArchived(existing)) {
      throw new SessionLifecycleError(409, 'ARCHIVED', 'Cannot update metadata of an archived session');
    }

    const repoPatch = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    ) as Partial<Omit<Session, 'id' | 'createdAt' | 'updatedAt'>>;
    this.repo.update(sessionId, repoPatch);
    const updatedSession = this.repo.findById(sessionId);
    if (!updatedSession) {
      throw new SessionLifecycleError(404, 'NOT_FOUND', 'Session not found');
    }

    this.publishUpdatedSession(updatedSession);
    this.domainEvents?.dispatch({
      type: 'session.metadata_updated',
      sessionId: updatedSession.id,
      projectId: updatedSession.projectId,
      timestamp: this.now(),
      fields: Object.keys(patch).filter(k => (patch as Record<string, unknown>)[k] !== undefined),
    });
    return updatedSession;
  }

  updateWorkingDirectory(sessionId: string, workingDirectory: string | null | undefined): Session {
    const existing = this.repo.findById(sessionId);
    if (!existing) {
      throw new SessionLifecycleError(404, 'NOT_FOUND', 'Session not found');
    }

    if (isPlanningTaskSession(existing)) {
      throw new SessionLifecycleError(409, 'LOCKED', 'Worktree is locked during Supervisor planning mode');
    }

    if (workingDirectory && !this.pathExists(workingDirectory)) {
      throw new SessionLifecycleError(400, 'VALIDATION_ERROR', 'Working directory does not exist');
    }

    const previousWorkingDirectory = normalizeWorkingDirectoryForCompare(existing.workingDirectory);
    const nextWorkingDirectory = normalizeWorkingDirectoryForCompare(workingDirectory);
    const patch = {
      workingDirectory: workingDirectory ?? null,
    } as Partial<Omit<Session, 'id' | 'createdAt' | 'updatedAt'>>;

    if (previousWorkingDirectory !== nextWorkingDirectory && existing.sdkSessionId) {
      patch.sdkSessionId = null;
    }

    this.repo.update(sessionId, patch);
    const updatedSession = this.repo.findById(sessionId);
    if (!updatedSession) {
      throw new SessionLifecycleError(404, 'NOT_FOUND', 'Session not found');
    }

    this.publishUpdatedSession(updatedSession);
    return updatedSession;
  }

  unlockSession(sessionId: string): Session {
    const existing = this.repo.findById(sessionId);
    if (!existing) {
      throw new SessionLifecycleError(404, 'NOT_FOUND', 'Session not found');
    }

    const unlockedState = buildUnlockedSessionState(existing);
    assertValidSessionState(unlockedState);

    const previousPlanStatus = existing.planStatus ?? null;
    const nextPlanStatus = unlockedState.planStatus ?? null;
    assertPlanStatusTransition(previousPlanStatus, nextPlanStatus);

    this.repo.update(sessionId, {
      isReadOnly: false,
      planStatus: unlockedState.planStatus,
    });

    const updatedSession = this.repo.findById(sessionId);
    if (!updatedSession) {
      throw new SessionLifecycleError(404, 'NOT_FOUND', 'Session not found');
    }

    this.publishUpdatedSession(updatedSession);
    this.domainEvents?.dispatch({
      type: 'session.unlocked',
      sessionId,
      projectId: updatedSession.projectId,
      timestamp: this.now(),
    });
    if (previousPlanStatus !== nextPlanStatus) {
      this.domainEvents?.dispatch({
        type: 'session.plan_status_changed',
        sessionId,
        projectId: updatedSession.projectId,
        timestamp: this.now(),
        from: previousPlanStatus,
        to: nextPlanStatus,
      });
    }
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
      this.publishUpdatedSession(updatedSession);
    }

    return { sessionId, reset: true };
  }

  dismissInterrupted(sessionId: string): void {
    const existing = this.repo.findById(sessionId);
    if (!existing) {
      throw new SessionLifecycleError(404, 'NOT_FOUND', 'Session not found');
    }

    this.repo.update(sessionId, { lastRunStatus: null });
    const updatedSession = this.repo.findById(sessionId);
    if (updatedSession) {
      this.publishUpdatedSession(updatedSession);
    }
  }

  deleteSession(sessionId: string): void {
    const session = this.repo.findById(sessionId);
    if (!session) {
      throw new SessionLifecycleError(404, 'NOT_FOUND', 'Session not found');
    }

    if (session.isReadOnly) {
      throw new SessionLifecycleError(409, 'LOCKED', 'Cannot delete a read-only session with active task execution');
    }

    const result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    if (result.changes === 0) {
      throw new SessionLifecycleError(404, 'NOT_FOUND', 'Session not found');
    }

    this.broadcastSessionEvent('deleted', session);
    this.emitPluginEvent('session.deleted', { sessionId, session }).catch(() => {});
    this.domainEvents?.dispatch({
      type: 'session.deleted',
      sessionId,
      projectId: session.projectId,
      timestamp: this.now(),
    });
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

  private publishUpdatedSession(session: Session): void {
    this.broadcastSessionEvent('updated', session);
    this.emitPluginEvent('session.updated', {
      sessionId: session.id,
      session,
    }).catch(() => {});
  }
}
