import { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import type { ApiResponse } from '@my-claudia/shared/core/api';
import type { Message } from '@my-claudia/shared/core/message';
import type { Session } from '@my-claudia/shared/core/session';
import { SessionRepository } from './repository.js';
import { mountSearchRoutes } from './search-routes.js';
import { mountMessageRoutes } from './message-routes.js';
import { SessionLifecycleError, SessionLifecycleService } from './lifecycle-service.js';
import { SessionExportError, SessionExportService } from './export-service.js';
import { SessionQueryError, SessionQueryService } from './query-service.js';
import { buildSessionUpdatePatch, isSessionValidationError } from './model.js';
import type { SessionEventPublisherPort } from './session-event-port.js';
import { hasForegroundActiveRunForSession, findForegroundActiveRunIdForSession, hasAnyActiveRunForSession } from '../../utils/run-state.js';
import { sendApiError } from '../../interfaces/http/response.js';
import type { ActiveRun } from '../../application/conversation/transport/types.js';

type ActiveRunsMap = Map<string, ActiveRun>;

export function createSessionRoutes(
  db: Database.Database,
  activeRuns: ActiveRunsMap,
  sessionEvents?: SessionEventPublisherPort,
): Router {
  const router = Router();
  const repo = new SessionRepository(db);
  const lifecycleService = new SessionLifecycleService(db, {
    broadcastSessionEvent: (type, session) => {
      sessionEvents?.publishSessionEvent(type, session);
    },
  });
  const exportService = new SessionExportService(db);
  const queryService = new SessionQueryService(db, activeRuns);

  // Get all sessions (optionally filtered by project, excludes archived by default)
  router.get('/', (req: Request, res: Response) => {
    try {
      const { projectId, includeArchived } = req.query as { projectId?: string; includeArchived?: string };
      const sessions = queryService.listSessions(projectId, includeArchived === 'true');
      res.json({ success: true, data: sessions } as ApiResponse<Session[]>);
    } catch (error) {
      console.error('Error fetching sessions:', error);
      sendApiError(res, 500, 'DB_ERROR', 'Failed to fetch sessions');
    }
  });

  // Get archived sessions
  router.get('/archived', (req: Request, res: Response) => {
    try {
      const sessions = queryService.listArchivedSessions();
      res.json({ success: true, data: sessions } as ApiResponse<Session[]>);
    } catch (error) {
      console.error('Error fetching archived sessions:', error);
      sendApiError(res, 500, 'DB_ERROR', 'Failed to fetch archived sessions');
    }
  });

  // Archive sessions (single or batch)
  router.post('/archive', (req: Request, res: Response) => {
    try {
      const result = lifecycleService.archiveSessions(req.body?.sessionIds ?? []);
      res.json({ success: true, data: result } as ApiResponse<{ archived: number }>);
    } catch (error) {
      if (error instanceof SessionLifecycleError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      console.error('Error archiving sessions:', error);
      sendApiError(res, 500, 'DB_ERROR', 'Failed to archive sessions');
    }
  });

  // Restore archived sessions (single or batch)
  router.post('/restore', (req: Request, res: Response) => {
    try {
      const result = lifecycleService.restoreSessions(req.body?.sessionIds ?? []);
      res.json({ success: true, data: result } as ApiResponse<{ restored: number }>);
    } catch (error) {
      if (error instanceof SessionLifecycleError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      console.error('Error restoring sessions:', error);
      sendApiError(res, 500, 'DB_ERROR', 'Failed to restore sessions');
    }
  });

  // Sync sessions (for periodic client sync as fallback to WebSocket push)
  router.get('/sync', (req: Request, res: Response) => {
    try {
      const result = queryService.syncSessions(req.query.since as string | undefined);
      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof SessionQueryError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      console.error('Error syncing sessions:', error);
      sendApiError(res, 500, 'SYNC_ERROR', 'Failed to sync sessions');
    }
  });

  // Get lightweight run state for a single session (used by resend preflight guard).
  router.get('/:id/run-state', (req: Request, res: Response) => {
    try {
      const sessionId = req.params.id;
      const activeRunId = findForegroundActiveRunIdForSession(activeRuns, sessionId);
      const isRunning = hasAnyActiveRunForSession(activeRuns, sessionId);
      res.json({
        success: true,
        data: {
          sessionId,
          isRunning,
          activeRunId: activeRunId || undefined,
        },
      } as ApiResponse<{ sessionId: string; isRunning: boolean; activeRunId?: string }>);
    } catch (error) {
      console.error('Error fetching run state:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch run state' }
      });
    }
  });

  // Get single session
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const session = repo.findById(req.params.id);

      if (!session) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Session not found' }
        });
        return;
      }

      res.json({ success: true, data: session } as ApiResponse<Session>);
    } catch (error) {
      console.error('Error fetching session:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch session' }
      });
    }
  });

  // Create session
  router.post('/', (req: Request, res: Response) => {
    try {
      const session = lifecycleService.createSession(req.body ?? {});
      res.status(201).json({ success: true, data: session } as ApiResponse<Session>);
    } catch (error) {
      if (error instanceof SessionLifecycleError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      console.error('Error creating session:', error);
      sendApiError(res, 500, 'DB_ERROR', 'Failed to create session');
    }
  });

  // Update session
  router.put('/:id', (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      lifecycleService.updateSessionMetadata(req.params.id, buildSessionUpdatePatch(body));

      res.json({ success: true } as ApiResponse<void>);
    } catch (error) {
      if (error instanceof SessionLifecycleError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      if (isSessionValidationError(error)) {
        sendApiError(res, 400, 'VALIDATION_ERROR', error.message);
        return;
      }
      console.error('Error updating session:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to update session' }
      });
    }
  });

  // Update session working directory
  router.patch('/:id/working-directory', (req: Request, res: Response) => {
    try {
      const updatedSession = lifecycleService.updateWorkingDirectory(
        req.params.id,
        req.body?.workingDirectory,
      );
      res.json({ success: true, data: updatedSession } as ApiResponse<Session>);
    } catch (error) {
      if (error instanceof SessionLifecycleError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      console.error('Error updating working directory:', error);
      sendApiError(res, 500, 'DB_ERROR', 'Failed to update working directory');
    }
  });

  // Unlock a read-only session (clear isReadOnly, optionally reset planStatus)
  router.patch('/:id/unlock', (req: Request, res: Response) => {
    try {
      const updatedSession = lifecycleService.unlockSession(req.params.id);
      res.json({ success: true, data: updatedSession } as ApiResponse<Session>);
    } catch (error) {
      if (error instanceof SessionLifecycleError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      console.error('Error unlocking session:', error);
      sendApiError(res, 500, 'DB_ERROR', 'Failed to unlock session');
    }
  });

  // Reset underlying provider SDK session (clear sdk_session_id)
  // Next run will start a fresh provider-side session while keeping the same app session.
  router.post('/:id/reset-sdk-session', (req: Request, res: Response) => {
    try {
      const result = lifecycleService.resetSdkSession(req.params.id);
      res.json({ success: true, data: result } as ApiResponse<{ sessionId: string; reset: boolean }>);
    } catch (error) {
      if (error instanceof SessionLifecycleError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      console.error('Error resetting sdk session:', error);
      sendApiError(res, 500, 'DB_ERROR', 'Failed to reset sdk session');
    }
  });

  // Dismiss interrupted status (clear last_run_status after app restart)
  router.patch('/:id/dismiss-interrupted', (req: Request, res: Response) => {
    try {
      lifecycleService.dismissInterrupted(req.params.id);
      res.json({ success: true });
    } catch (error) {
      if (error instanceof SessionLifecycleError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      console.error('Error dismissing interrupted status:', error);
      sendApiError(res, 500, 'DB_ERROR', 'Failed to dismiss interrupted status');
    }
  });

  // Delete session
  router.delete('/:id', (req: Request, res: Response) => {
    const sessionId = req.params.id;

    try {
      lifecycleService.deleteSession(sessionId);
      console.log(`[Delete Session] Successfully deleted session ${sessionId}`);
      res.json({ success: true } as ApiResponse<void>);
    } catch (error) {
      if (error instanceof SessionLifecycleError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      console.error('Error deleting session:', error);

      // Log full error for debugging
      if (error && typeof error === 'object' && 'code' in error) {
        console.error('[Delete Session] SQLite error code:', (error as any).code);
      }

      sendApiError(res, 500, 'DB_ERROR', 'Failed to delete session');
    }
  });

  // Export session as Markdown
  router.get('/:id/export', (req: Request, res: Response) => {
    try {
      const result = exportService.exportSession(req.params.id);
      res.json({ success: true, data: result } as ApiResponse<{ markdown: string; sessionName: string }>);
    } catch (error) {
      if (error instanceof SessionExportError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      console.error('Error exporting session:', error);
      sendApiError(res, 500, 'DB_ERROR', 'Failed to export session');
    }
  });


  // Reorder sessions within a project
  router.post('/reorder', (req: Request, res: Response) => {
    try {
      const { projectId, orderedIds } = req.body as { projectId?: string; orderedIds?: string[] };
      lifecycleService.reorderSessions(projectId, orderedIds);
      res.json({ success: true } as ApiResponse<void>);
    } catch (error) {
      if (error instanceof SessionLifecycleError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      console.error('Error reordering sessions:', error);
      sendApiError(res, 500, 'DB_ERROR', 'Failed to reorder sessions');
    }
  });

  // Mount search routes (search messages, history, suggestions)
  mountSearchRoutes(router, db);

  // Mount message routes (get/create messages)
  mountMessageRoutes(router, db, activeRuns);

  return router;
}
