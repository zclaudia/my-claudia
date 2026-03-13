import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { Session, Message, ApiResponse } from '@my-claudia/shared';
import { saveSearchHistory, getSearchHistory, clearSearchHistory, getSearchSuggestions } from '../storage/search-history.js';
import { extractAndIndexMetadata } from '../storage/metadata-extractor.js';
import { getGatewayClient } from '../gateway-instance.js';
import { hasForegroundActiveRunForSession, findForegroundActiveRunIdForSession, hasAnyActiveRunForSession } from '../utils/run-state.js';
import { pluginEvents } from '../events/index.js';

type ActiveRunsMap = Map<string, any>;

function buildSearchPreview(content: string): string {
  // Remove internal reasoning blocks and normalize whitespace for compact previews.
  const withoutThinkBlocks = content
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/<\/?think>/gi, ' ');
  const normalized = withoutThinkBlocks.replace(/\s+/g, ' ').trim();
  return normalized || 'No preview text';
}

// Standard SELECT fields for session queries (keeps supervision v2 fields in sync)
const SESSION_SELECT = `id, project_id as projectId, name, provider_id as providerId,
               sdk_session_id as sdkSessionId, type, parent_session_id as parentSessionId,
               working_directory as workingDirectory,
               archived_at as archivedAt,
               project_role as projectRole, task_id as taskId,
               plan_status as planStatus,
               last_run_status as lastRunStatus,
               CASE WHEN is_read_only = 1 THEN 1 ELSE NULL END as isReadOnly,
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
        ORDER BY updated_at DESC
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
      const fs = require('fs');

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

      const sessionType = type === 'background' ? 'background' : 'regular';

      const id = uuidv4();
      const now = Date.now();

      db.prepare(`
        INSERT INTO sessions (id, project_id, name, provider_id, type, parent_session_id, working_directory, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, projectId, name || null, providerId || null, sessionType, parentSessionId || null, workingDirectory || null, now, now);

      const session: Session = {
        id,
        projectId,
        name,
        providerId,
        type: sessionType,
        parentSessionId: parentSessionId || undefined,
        workingDirectory: workingDirectory || undefined,
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
      const fs = require('fs');

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

      const result = db.prepare(`
        UPDATE sessions
        SET is_read_only = 0, plan_status = 'planning', updated_at = ?
        WHERE id = ?
      `).run(now, id);

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

  // Search messages across sessions using FTS5
  router.get('/search/messages', (req: Request, res: Response) => {
    try {
      const q = req.query.q as string;
      const projectId = req.query.projectId as string | undefined;
      const role = req.query.role as string | undefined;
      const sessionIds = req.query.sessionIds as string | undefined;
      const startDate = req.query.startDate ? parseInt(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? parseInt(req.query.endDate as string) : undefined;
      const sort = (req.query.sort as string) || 'relevance';
      const scope = (req.query.scope as string) || 'messages'; // 'messages', 'files', 'tool_calls', 'all'
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

      if (!q || q.trim().length === 0) {
        res.json({ success: true, data: { results: [] } });
        return;
      }

      const safeQuery = q.replace(/"/g, '""');
      let results: Array<{
        id: string; sessionId: string; role: string; content: string; createdAt: number; sessionName: string | null; resultType?: string;
      }> = [];

      // Helper function to build session filter conditions
      const buildSessionFilters = (prefix: string): { conditions: string[]; params: (string | number)[] } => {
        const conditions: string[] = [];
        const params: (string | number)[] = [];

        if (projectId) {
          conditions.push(`${prefix}.project_id = ?`);
          params.push(projectId);
        }

        if (sessionIds) {
          const ids = sessionIds.split(',').filter(id => id.trim());
          if (ids.length > 0) {
            const placeholders = ids.map(() => '?').join(',');
            conditions.push(`${prefix}.session_id IN (${placeholders})`);
            params.push(...ids);
          }
        }

        if (startDate) {
          conditions.push(`${prefix}.created_at >= ?`);
          params.push(startDate);
        }
        if (endDate) {
          conditions.push(`${prefix}.created_at <= ?`);
          params.push(endDate);
        }

        return { conditions, params };
      };

      // Search messages
      if (scope === 'messages' || scope === 'all') {
        const conditions: string[] = ['messages_fts MATCH ?'];
        const params: (string | number)[] = [`"${safeQuery}"`];

        if (role && (role === 'user' || role === 'assistant')) {
          conditions.push('m.role = ?');
          params.push(role);
        }

        const sessionFilters = buildSessionFilters('m');
        conditions.push(...sessionFilters.conditions.map(c => c.replace('m.session_id', 's.id').replace('m.project_id', 's.project_id').replace('m.created_at', 'm.created_at')));
        params.push(...sessionFilters.params);

        let orderBy = 'ORDER BY rank';
        if (sort === 'newest') {
          orderBy = 'ORDER BY m.created_at DESC';
        } else if (sort === 'oldest') {
          orderBy = 'ORDER BY m.created_at ASC';
        } else if (sort === 'session') {
          orderBy = 'ORDER BY m.session_id, m.created_at DESC';
        }

        const sql = `
          SELECT m.id, m.session_id as sessionId, m.role, m.content, m.created_at as createdAt,
                 s.name as sessionName, 'message' as resultType
          FROM messages_fts f
          JOIN messages m ON m.rowid = f.rowid
          JOIN sessions s ON m.session_id = s.id
          WHERE ${conditions.join(' AND ')}
          ${orderBy}
          LIMIT ? OFFSET ?
        `;
        params.push(limit, offset);

        results = db.prepare(sql).all(...params) as typeof results;
      }

      // Search files
      if (scope === 'files' || scope === 'all') {
        const params: (string | number)[] = [`"${safeQuery}"`];
        const sessionFilters = buildSessionFilters('fr');
        const conditions = sessionFilters.conditions.map(c => c.replace('fr.session_id', 's.id').replace('fr.project_id', 's.project_id').replace('fr.created_at', 'fr.created_at'));
        params.push(...sessionFilters.params);

        let orderBy = scope === 'files' ? 'ORDER BY rank' : '';
        if (sort === 'newest') {
          orderBy = 'ORDER BY fr.created_at DESC';
        } else if (sort === 'oldest') {
          orderBy = 'ORDER BY fr.created_at ASC';
        }

        const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';
        const sql = `
          SELECT fr.message_id as id, fr.session_id as sessionId, '' as role,
                 fr.file_path || ' (' || fr.source_type || ')' as content,
                 fr.created_at as createdAt, s.name as sessionName, 'file' as resultType
          FROM files_fts f
          JOIN file_references fr ON fr.id = f.rowid
          JOIN sessions s ON fr.session_id = s.id
          WHERE files_fts MATCH ? ${whereClause}
          ${orderBy}
          LIMIT ? OFFSET ?
        `;
        params.push(limit, offset);

        const fileResults = db.prepare(sql).all(...params) as typeof results;
        results = scope === 'all' ? [...results, ...fileResults] : fileResults;
      }

      // Search tool calls
      if (scope === 'tool_calls' || scope === 'all') {
        const params: (string | number)[] = [`"${safeQuery}"`];
        const sessionFilters = buildSessionFilters('tc');
        const conditions = sessionFilters.conditions.map(c => c.replace('tc.session_id', 's.id').replace('tc.project_id', 's.project_id').replace('tc.created_at', 'tc.created_at'));
        params.push(...sessionFilters.params);

        let orderBy = scope === 'tool_calls' ? 'ORDER BY rank' : '';
        if (sort === 'newest') {
          orderBy = 'ORDER BY tc.created_at DESC';
        } else if (sort === 'oldest') {
          orderBy = 'ORDER BY tc.created_at ASC';
        }

        const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';
        const sql = `
          SELECT tc.message_id as id, tc.session_id as sessionId, '' as role,
                 tc.tool_name || ': ' || COALESCE(SUBSTR(tc.tool_input, 1, 100), '') as content,
                 tc.created_at as createdAt, s.name as sessionName, 'tool_call' as resultType
          FROM tool_calls_fts f
          JOIN tool_call_records tc ON tc.id = f.rowid
          JOIN sessions s ON tc.session_id = s.id
          WHERE tool_calls_fts MATCH ? ${whereClause}
          ${orderBy}
          LIMIT ? OFFSET ?
        `;
        params.push(limit, offset);

        const toolResults = db.prepare(sql).all(...params) as typeof results;
        results = scope === 'all' ? [...results, ...toolResults] : toolResults;
      }

      // If scope is 'all', sort the combined results
      if (scope === 'all') {
        if (sort === 'newest') {
          results.sort((a, b) => b.createdAt - a.createdAt);
        } else if (sort === 'oldest') {
          results.sort((a, b) => a.createdAt - b.createdAt);
        }
        results = results.slice(0, limit);
      }

      const truncated = results.map(r => ({
        ...r,
        content: (() => {
          const preview = buildSearchPreview(r.content);
          return preview.length > 200 ? preview.substring(0, 200) + '...' : preview;
        })(),
      }));

      // Save search history
      try {
        saveSearchHistory(db, q.trim(), results.length);
      } catch (err) {
        console.error('Error saving search history:', err);
        // Don't fail the request if history saving fails
      }

      res.json({ success: true, data: { results: truncated } });
    } catch (error) {
      console.error('Error searching messages:', error);
      res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed to search messages' } });
    }
  });

  // Get search history
  router.get('/search/history', (req: Request, res: Response) => {
    try {
      const userId = (req.query.userId as string) || 'default';
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

      const history = getSearchHistory(db, userId, limit);

      res.json({ success: true, data: { history } });
    } catch (error) {
      console.error('Error fetching search history:', error);
      res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed to fetch search history' } });
    }
  });

  // Clear search history
  router.delete('/search/history', (req: Request, res: Response) => {
    try {
      const userId = (req.query.userId as string) || 'default';

      clearSearchHistory(db, userId);

      res.json({ success: true, data: { cleared: true } });
    } catch (error) {
      console.error('Error clearing search history:', error);
      res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed to clear search history' } });
    }
  });

  // Get search suggestions
  router.get('/search/suggestions', (req: Request, res: Response) => {
    try {
      const prefix = (req.query.prefix as string) || '';
      const userId = (req.query.userId as string) || 'default';
      const limit = Math.min(parseInt(req.query.limit as string) || 5, 10);

      const suggestions = getSearchSuggestions(db, prefix, userId, limit);

      res.json({ success: true, data: { suggestions } });
    } catch (error) {
      console.error('Error fetching search suggestions:', error);
      res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed to fetch search suggestions' } });
    }
  });

  // Get messages for a session (with pagination support)
  // Query params:
  //   - limit: number of messages to fetch (default: 50)
  //   - before: cursor - fetch messages before this timestamp (for loading older messages)
  //   - after: cursor - fetch messages after this timestamp (for loading newer messages)
  router.get('/:id/messages', (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const before = req.query.before ? parseInt(req.query.before as string) : undefined;
      const after = req.query.after ? parseInt(req.query.after as string) : undefined;
      const afterOffset = req.query.afterOffset ? parseInt(req.query.afterOffset as string) : undefined;

      let query: string;
      let params: (string | number)[];

      if (afterOffset != null) {
        // Load messages after a specific offset (for gap-fill)
        query = `
          SELECT id, session_id as sessionId, role, content, metadata, created_at as createdAt, offset
          FROM messages
          WHERE session_id = ? AND offset > ?
          ORDER BY offset ASC
          LIMIT ?
        `;
        params = [req.params.id, afterOffset, limit];
      } else if (before) {
        // Load older messages (before cursor) - for scrolling up
        query = `
          SELECT id, session_id as sessionId, role, content, metadata, created_at as createdAt, offset
          FROM messages
          WHERE session_id = ? AND created_at < ?
          ORDER BY created_at DESC
          LIMIT ?
        `;
        params = [req.params.id, before, limit];
      } else if (after) {
        // Load newer messages (after cursor) - for scrolling down or new messages
        query = `
          SELECT id, session_id as sessionId, role, content, metadata, created_at as createdAt, offset
          FROM messages
          WHERE session_id = ? AND created_at > ?
          ORDER BY created_at ASC
          LIMIT ?
        `;
        params = [req.params.id, after, limit];
      } else {
        // Initial load - get the most recent messages
        query = `
          SELECT id, session_id as sessionId, role, content, metadata, created_at as createdAt, offset
          FROM messages
          WHERE session_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `;
        params = [req.params.id, limit];
      }

      const messages = db.prepare(query).all(...params) as Array<Message & { metadata: string }>;

      // Size-aware trimming: fit response within WebSocket proxy limits.
      // Do this BEFORE reversing so we trim from the correct end.
      //
      // For initial/before: query is DESC (newest first at index 0).
      //   We keep newest messages, drop oldest (high index) → slice(0, keepCount)
      // For after: query is ASC (oldest first at index 0).
      //   We keep oldest messages, drop newest (high index) → slice(0, keepCount)
      // Both cases: iterate from index 0 and stop when budget exceeded.
      const MAX_RESPONSE_SIZE = 512 * 1024; // 512KB soft limit per response
      let cumSize = 0;
      let keepCount = messages.length;

      for (let i = 0; i < messages.length; i++) {
        const rawSize = (messages[i].content?.length || 0) + (messages[i].metadata?.length || 0);
        cumSize += rawSize;
        // Always keep at least 1 message
        if (i > 0 && cumSize > MAX_RESPONSE_SIZE) {
          keepCount = i;
          break;
        }
      }

      const trimmed = messages.slice(0, keepCount);
      const wasTrimmed = keepCount < messages.length;

      // For initial load and "before" queries, we fetched DESC, so reverse to get chronological order
      // afterOffset uses ASC order like "after", so no reversal needed
      if (!after && afterOffset == null) {
        trimmed.reverse();
      }

      const result = trimmed.map(m => ({
        ...m,
        metadata: m.metadata ? JSON.parse(m.metadata) : undefined
      }));

      // Get total count for this session
      const countResult = db.prepare(`
        SELECT COUNT(*) as total FROM messages WHERE session_id = ?
      `).get(req.params.id) as { total: number };

      // hasMore is true if we trimmed OR if there are more messages beyond the limit
      const hasMore = wasTrimmed
        || (before || after || afterOffset != null ? messages.length === limit : countResult.total > limit);

      // Cursor timestamps (result is now in chronological order: oldest first)
      const oldestTimestamp = result.length > 0 ? result[0].createdAt : undefined;
      const newestTimestamp = result.length > 0 ? result[result.length - 1].createdAt : undefined;

      // Max offset across returned messages (for gap detection)
      const maxOffset = result.reduce((max: number | undefined, m: any) =>
        m.offset != null ? Math.max(max ?? 0, m.offset) : max, undefined);

      // Check if this session has an active run (for restoring loading state on reconnect)
      const activeRunId = findForegroundActiveRunIdForSession(activeRuns, req.params.id);
      const activeRun = activeRunId ? { runId: activeRunId } : null;

      res.json({
        success: true,
        data: {
          messages: result,
          pagination: {
            total: countResult.total,
            hasMore,
            oldestTimestamp,
            newestTimestamp,
            maxOffset,
          },
          activeRun,
        }
      });
    } catch (error) {
      console.error('Error fetching messages:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch messages' }
      });
    }
  });

  // Add message to session
  router.post('/:id/messages', (req: Request, res: Response) => {
    try {
      const { role, content, metadata } = req.body;

      if (!role || !content) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Role and content are required' }
        });
        return;
      }

      // Verify session exists
      const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(req.params.id);
      if (!session) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Session not found' }
        });
        return;
      }

      const id = uuidv4();
      const now = Date.now();

      const insertResult = db.prepare(`
        INSERT INTO messages (id, session_id, role, content, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, req.params.id, role, content, metadata ? JSON.stringify(metadata) : null, now);

      // Extract and index metadata for extended search
      if (metadata) {
        const messageRowid = insertResult.lastInsertRowid as number;
        extractAndIndexMetadata(db, id, messageRowid, req.params.id, metadata, now);
      }

      // Update session updated_at
      db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, req.params.id);

      const message: Message = {
        id,
        sessionId: req.params.id,
        role,
        content,
        metadata,
        createdAt: now
      };

      res.status(201).json({ success: true, data: message } as ApiResponse<Message>);
    } catch (error) {
      console.error('Error creating message:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to create message' }
      });
    }
  });

  return router;
}
