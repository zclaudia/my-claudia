import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { Session, Message, ApiResponse } from '@my-claudia/shared';
import { getGatewayClient } from '../gateway-instance.js';
import { hasForegroundActiveRunForSession, findForegroundActiveRunIdForSession, hasAnyActiveRunForSession } from '../utils/run-state.js';
import { pluginEvents } from '../events/index.js';
import { mountSearchRoutes } from './session-search.js';
import { mountMessageRoutes } from './session-messages.js';
import * as fs from 'fs';

type ActiveRunsMap = Map<string, any>;

// Standard SELECT fields for session queries
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

export function createSessionRoutes(db: Database.Database, activeRuns: ActiveRunsMap): Router {
  const router = Router();

  // Get all sessions (optionally filtered by project, excludes archived by default)
  router.get('/', (req: Request, res: Response) => {
    try {
      const { projectId, includeArchived } = req.query;

      const conditions: string[] = [];
      const params: string[] = [];

      if (projectId) {
        conditions.push('project_id = ?');
        params.push(projectId as string);
      }

      if (includeArchived !== 'true') {
        conditions.push('archived_at IS NULL');
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const sessions = db.prepare(`
        SELECT ${SESSION_SELECT}
        FROM sessions
        ${where}
        ORDER BY sort_order ASC, updated_at DESC
      `).all(...params) as Session[];

      res.json({ success: true, data: sessions } as ApiResponse<Session[]>);
    } catch (error) {
      console.error('Error fetching sessions:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch sessions' }
      });
    }
  });

  // Get archived sessions
  router.get('/archived', (req: Request, res: Response) => {
    try {
      const sessions = db.prepare(`
        SELECT ${SESSION_SELECT}
        FROM sessions
        WHERE archived_at IS NOT NULL
        ORDER BY archived_at DESC
      `).all() as Session[];

      res.json({ success: true, data: sessions } as ApiResponse<Session[]>);
    } catch (error) {
      console.error('Error fetching archived sessions:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch archived sessions' }
      });
    }
  });

  // Archive sessions (single or batch)
  router.post('/archive', (req: Request, res: Response) => {
    try {
      const { sessionIds } = req.body;

      if (!sessionIds || !Array.isArray(sessionIds) || sessionIds.length === 0) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'sessionIds array is required' }
        });
        return;
      }

      const now = Date.now();
      const stmt = db.prepare('UPDATE sessions SET archived_at = ?, updated_at = ? WHERE id = ?');
      const transaction = db.transaction(() => {
        for (const id of sessionIds) {
          stmt.run(now, now, id);
        }
      });
      transaction();

      // Broadcast archive events
      const gatewayClient = getGatewayClient();
      if (gatewayClient) {
        for (const id of sessionIds) {
          const session = db.prepare(`
            SELECT ${SESSION_SELECT}
            FROM sessions WHERE id = ?
          `).get(id) as Session | undefined;
          if (session) {
            gatewayClient.broadcastSessionEvent('updated', session);
          }
        }
      }

      for (const id of sessionIds) {
        pluginEvents.emit('session.archived', { sessionId: id }).catch(() => {});
      }

      res.json({ success: true, data: { archived: sessionIds.length } } as ApiResponse<{ archived: number }>);
    } catch (error) {
      console.error('Error archiving sessions:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to archive sessions' }
      });
    }
  });

  // Restore archived sessions (single or batch)
  router.post('/restore', (req: Request, res: Response) => {
    try {
      const { sessionIds } = req.body;

      if (!sessionIds || !Array.isArray(sessionIds) || sessionIds.length === 0) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'sessionIds array is required' }
        });
        return;
      }

      const now = Date.now();
      const stmt = db.prepare('UPDATE sessions SET archived_at = NULL, updated_at = ? WHERE id = ?');
      const transaction = db.transaction(() => {
        for (const id of sessionIds) {
          stmt.run(now, id);
        }
      });
      transaction();

      // Broadcast restore events
      const gatewayClient = getGatewayClient();
      if (gatewayClient) {
        for (const id of sessionIds) {
          const session = db.prepare(`
            SELECT ${SESSION_SELECT}
            FROM sessions WHERE id = ?
          `).get(id) as Session | undefined;
          if (session) {
            gatewayClient.broadcastSessionEvent('updated', session);
          }
        }
      }

      for (const id of sessionIds) {
        pluginEvents.emit('session.restored', { sessionId: id }).catch(() => {});
      }

      res.json({ success: true, data: { restored: sessionIds.length } } as ApiResponse<{ restored: number }>);
    } catch (error) {
      console.error('Error restoring sessions:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to restore sessions' }
      });
    }
  });

  // Sync sessions (for periodic client sync as fallback to WebSocket push)
  router.get('/sync', (req: Request, res: Response) => {
    try {
      const { since } = req.query;
      const sinceTimestamp = since ? parseInt(since as string, 10) : 0;

      if (isNaN(sinceTimestamp) || sinceTimestamp < 0) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid since parameter' }
        });
        return;
      }

      // Get all non-archived sessions updated after the given timestamp, with lastMessageOffset
      const sessions = db.prepare(`
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

      // Attach isActive status based on activeRuns
      const sessionsWithStatus = sessions.map(session => ({
        id: session.id,
        projectId: session.projectId,
        name: session.name,
        providerId: session.providerId,
        workingDirectory: session.workingDirectory,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        isActive: hasForegroundActiveRunForSession(activeRuns, session.id),
        lastMessageOffset: session.lastMessageOffset ?? undefined,
      }));

      // Return sessions with current server timestamp
      res.json({
        success: true,
        data: {
          sessions: sessionsWithStatus,
          timestamp: Date.now(),  // Client uses this for next sync
          total: sessionsWithStatus.length
        }
      });
    } catch (error) {
      console.error('Error syncing sessions:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SYNC_ERROR', message: 'Failed to sync sessions' }
      });
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
      const session = db.prepare(`
        SELECT ${SESSION_SELECT}
        FROM sessions WHERE id = ?
      `).get(req.params.id) as Session | undefined;

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
      const { projectId, name, providerId, type, parentSessionId, workingDirectory } = req.body;

      if (!projectId) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Project ID is required' }
        });
        return;
      }

      // Verify project exists
      const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
      if (!project) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Project not found' }
        });
        return;
      }

      if (workingDirectory && !fs.existsSync(workingDirectory)) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Working directory does not exist' }
        });
        return;
      }

      const validTypes = ['regular', 'background', 'agent'] as const;
      const sessionType = validTypes.includes(type as any) ? type : 'regular';

      const id = uuidv4();
      const now = Date.now();
      const { sortOrder } = db.prepare(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 as sortOrder FROM sessions WHERE project_id = ?'
      ).get(projectId) as { sortOrder: number };

      db.prepare(`
        INSERT INTO sessions (id, project_id, name, provider_id, type, parent_session_id, working_directory, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, projectId, name || null, providerId || null, sessionType, parentSessionId || null, workingDirectory || null, sortOrder, now, now);

      const session: Session = {
        id,
        projectId,
        name,
        providerId,
        type: sessionType,
        parentSessionId: parentSessionId || undefined,
        workingDirectory: workingDirectory || undefined,
        sortOrder,
        createdAt: now,
        updatedAt: now
      };

      // Broadcast session created event to subscribed clients
      const gatewayClient = getGatewayClient();
      if (gatewayClient) {
        gatewayClient.broadcastSessionEvent('created', session);
      }

      pluginEvents.emit('session.created', { sessionId: id, session }).catch(() => {});

      res.status(201).json({ success: true, data: session } as ApiResponse<Session>);
    } catch (error) {
      console.error('Error creating session:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to create session' }
      });
    }
  });

  // Update session
  router.put('/:id', (req: Request, res: Response) => {
    try {
      const { name, providerId, sdkSessionId } = req.body;
      const now = Date.now();

      const result = db.prepare(`
        UPDATE sessions
        SET name = COALESCE(?, name),
            provider_id = COALESCE(?, provider_id),
            sdk_session_id = COALESCE(?, sdk_session_id),
            updated_at = ?
        WHERE id = ?
      `).run(name || null, providerId || null, sdkSessionId || null, now, req.params.id);

      if (result.changes === 0) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Session not found' }
        });
        return;
      }

      // Broadcast session updated event to subscribed clients
      const gatewayClient = getGatewayClient();
      if (gatewayClient) {
        // Fetch updated session to broadcast
        const updatedSession = db.prepare(`
          SELECT ${SESSION_SELECT}
          FROM sessions WHERE id = ?
        `).get(req.params.id) as Session | undefined;

        if (updatedSession) {
          gatewayClient.broadcastSessionEvent('updated', updatedSession);
        }
      }

      res.json({ success: true } as ApiResponse<void>);
    } catch (error) {
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
      const { id } = req.params;
      const { workingDirectory } = req.body;

      const lockRow = db.prepare(`
        SELECT project_role, plan_status
        FROM sessions
        WHERE id = ?
      `).get(id) as { project_role: string | null; plan_status: string | null } | undefined;

      if (!lockRow) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Session not found' }
        });
        return;
      }

      const isPlanningTaskSession = lockRow.project_role === 'task' && lockRow.plan_status === 'planning';
      if (isPlanningTaskSession) {
        res.status(409).json({
          success: false,
          error: { code: 'LOCKED', message: 'Worktree is locked during Supervisor planning mode' }
        });
        return;
      }

      // Validate path exists if provided
      if (workingDirectory && !fs.existsSync(workingDirectory)) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Working directory does not exist' }
        });
        return;
      }

      const now = Date.now();
      const result = db.prepare(`
        UPDATE sessions
        SET working_directory = ?, updated_at = ?
        WHERE id = ?
      `).run(workingDirectory || null, now, id);

      if (result.changes === 0) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Session not found' }
        });
        return;
      }

      // Fetch updated session to return
      const updatedSession = db.prepare(`
        SELECT ${SESSION_SELECT}
        FROM sessions WHERE id = ?
      `).get(id) as Session | undefined;

      // Broadcast session updated event
      const gatewayClient = getGatewayClient();
      if (gatewayClient && updatedSession) {
        gatewayClient.broadcastSessionEvent('updated', updatedSession);
      }

      res.json({ success: true, data: updatedSession } as ApiResponse<Session>);
    } catch (error) {
      console.error('Error updating working directory:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to update working directory' }
      });
    }
  });

  // Unlock a read-only session (clear isReadOnly, optionally reset planStatus)
  router.patch('/:id/unlock', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const now = Date.now();

      const existing = db.prepare(`
        SELECT ${SESSION_SELECT}
        FROM sessions
        WHERE id = ?
      `).get(id) as Session | undefined;

      if (!existing) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Session not found' }
        });
        return;
      }

      db.prepare(`
        UPDATE sessions
        SET is_read_only = 0, plan_status = ?, updated_at = ?
        WHERE id = ?
      `).run(existing.projectRole === 'task' ? 'planning' : null, now, id);

      const updatedSession = db.prepare(`
        SELECT ${SESSION_SELECT}
        FROM sessions WHERE id = ?
      `).get(id) as Session | undefined;

      const gatewayClient = getGatewayClient();
      if (gatewayClient && updatedSession) {
        gatewayClient.broadcastSessionEvent('updated', updatedSession);
      }

      res.json({ success: true, data: updatedSession } as ApiResponse<Session>);
    } catch (error) {
      console.error('Error unlocking session:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to unlock session' }
      });
    }
  });

  // Reset underlying provider SDK session (clear sdk_session_id)
  // Next run will start a fresh provider-side session while keeping the same app session.
  router.post('/:id/reset-sdk-session', (req: Request, res: Response) => {
    try {
      const now = Date.now();
      const result = db.prepare(`
        UPDATE sessions
        SET sdk_session_id = NULL,
            updated_at = ?
        WHERE id = ?
      `).run(now, req.params.id);

      if (result.changes === 0) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Session not found' }
        });
        return;
      }

      const updatedSession = db.prepare(`
        SELECT ${SESSION_SELECT}
        FROM sessions WHERE id = ?
      `).get(req.params.id) as Session | undefined;

      const gatewayClient = getGatewayClient();
      if (gatewayClient && updatedSession) {
        gatewayClient.broadcastSessionEvent('updated', updatedSession);
      }

      pluginEvents.emit('session.updated', { sessionId: req.params.id, session: updatedSession }).catch(() => {});

      res.json({ success: true, data: { sessionId: req.params.id, reset: true } } as ApiResponse<{ sessionId: string; reset: boolean }>);
    } catch (error) {
      console.error('Error resetting sdk session:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to reset sdk session' }
      });
    }
  });

  // Dismiss interrupted status (clear last_run_status after app restart)
  router.patch('/:id/dismiss-interrupted', (req: Request, res: Response) => {
    try {
      const result = db.prepare(
        'UPDATE sessions SET last_run_status = NULL, updated_at = ? WHERE id = ?'
      ).run(Date.now(), req.params.id);

      if (result.changes === 0) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error dismissing interrupted status:', error);
      res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed to dismiss interrupted status' } });
    }
  });

  // Delete session
  router.delete('/:id', (req: Request, res: Response) => {
    const sessionId = req.params.id;

    try {
      // Fetch full session before deleting (for broadcasting)
      const session = db.prepare(`
        SELECT ${SESSION_SELECT}
        FROM sessions WHERE id = ?
      `).get(sessionId) as Session | undefined;

      if (!session) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Session not found' }
        });
        return;
      }

      const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);

      if (result.changes === 0) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Session not found' }
        });
        return;
      }

      // Broadcast session deleted event to subscribed clients
      const gatewayClient = getGatewayClient();
      if (gatewayClient) {
        gatewayClient.broadcastSessionEvent('deleted', session);
      }

      pluginEvents.emit('session.deleted', { sessionId, session }).catch(() => {});

      console.log(`[Delete Session] Successfully deleted session ${sessionId}`);
      res.json({ success: true } as ApiResponse<void>);
    } catch (error) {
      console.error('Error deleting session:', error);

      // Log full error for debugging
      if (error && typeof error === 'object' && 'code' in error) {
        console.error('[Delete Session] SQLite error code:', (error as any).code);
      }

      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to delete session' }
      });
    }
  });

  // Export session as Markdown
  router.get('/:id/export', (req: Request, res: Response) => {
    try {
      const session = db.prepare(`
        SELECT id, project_id as projectId, name, created_at as createdAt
        FROM sessions WHERE id = ?
      `).get(req.params.id) as { id: string; projectId: string; name?: string; createdAt: number } | undefined;

      if (!session) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Session not found' }
        });
        return;
      }

      const messages = db.prepare(`
        SELECT role, content, metadata, created_at as createdAt
        FROM messages WHERE session_id = ? ORDER BY created_at ASC
      `).all(req.params.id) as Array<{ role: string; content: string; metadata: string | null; createdAt: number }>;

      const lines: string[] = [];
      const sessionName = session.name || 'Untitled Session';
      lines.push(`# ${sessionName}`);
      lines.push(`Created: ${new Date(session.createdAt).toLocaleString()}`);
      lines.push('', '---', '');

      for (const msg of messages) {
        const roleLabel = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
        const time = new Date(msg.createdAt).toLocaleTimeString();
        lines.push(`## ${roleLabel} *(${time})*`, '', msg.content, '');

        if (msg.metadata) {
          try {
            const meta = JSON.parse(msg.metadata);
            if (meta.toolCalls?.length > 0) {
              lines.push('**Tool Calls:**');
              for (const tc of meta.toolCalls) {
                const status = tc.isError ? 'error' : 'ok';
                const inp = tc.input && typeof tc.input === 'object'
                  ? ((tc.input as Record<string, unknown>).file_path || (tc.input as Record<string, unknown>).command || (tc.input as Record<string, unknown>).pattern || '')
                  : '';
                lines.push(`- **${tc.name}** \`${inp}\` → ${status}`);
              }
              lines.push('');
            }
            if (meta.usage) {
              lines.push(`*Tokens: ${(meta.usage.inputTokens || 0).toLocaleString()} in / ${(meta.usage.outputTokens || 0).toLocaleString()} out*`, '');
            }
          } catch { /* ignore */ }
        }
        lines.push('---', '');
      }

      res.json({ success: true, data: { markdown: lines.join('\n'), sessionName } } as ApiResponse<{ markdown: string; sessionName: string }>);
    } catch (error) {
      console.error('Error exporting session:', error);
      res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed to export session' } });
    }
  });


  // Reorder sessions within a project
  router.post('/reorder', (req: Request, res: Response) => {
    try {
      const { projectId, orderedIds } = req.body as { projectId?: string; orderedIds?: string[] };
      if (!projectId || !Array.isArray(orderedIds) || orderedIds.length === 0) {
        res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'projectId and orderedIds are required' } });
        return;
      }

      const update = db.prepare('UPDATE sessions SET sort_order = ? WHERE id = ? AND project_id = ?');
      db.transaction(() => {
        for (let i = 0; i < orderedIds.length; i++) {
          update.run(i, orderedIds[i], projectId);
        }
      })();

      res.json({ success: true } as ApiResponse<void>);
    } catch (error) {
      console.error('Error reordering sessions:', error);
      res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed to reorder sessions' } });
    }
  });

  // Mount search routes (search messages, history, suggestions)
  mountSearchRoutes(router, db);

  // Mount message routes (get/create messages)
  mountMessageRoutes(router, db, activeRuns);

  return router;
}
