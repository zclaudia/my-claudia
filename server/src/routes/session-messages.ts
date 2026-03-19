import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { Message, ApiResponse } from '@my-claudia/shared';
import { extractAndIndexMetadata } from '../storage/metadata-extractor.js';
import { findForegroundActiveRunIdForSession } from '../utils/run-state.js';

type ActiveRunsMap = Map<string, any>;

export function mountMessageRoutes(router: Router, db: Database.Database, activeRuns: ActiveRunsMap): void {
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
      const aroundMessageId = req.query.aroundMessageId as string | undefined;

      let query: string;
      let params: (string | number)[];

      if (aroundMessageId) {
        const target = db.prepare(`
          SELECT offset
          FROM messages
          WHERE session_id = ? AND id = ?
        `).get(req.params.id, aroundMessageId) as { offset: number } | undefined;

        if (!target) {
          res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Message not found in session' } });
          return;
        }

        const beforeCount = Math.floor((limit - 1) / 2);
        const afterCount = limit - beforeCount - 1;
        const minOffset = Math.max(1, target.offset - beforeCount);
        const maxOffset = target.offset + afterCount;

        query = `
          SELECT id, session_id as sessionId, role, content, metadata, created_at as createdAt, offset
          FROM messages
          WHERE session_id = ? AND offset BETWEEN ? AND ?
          ORDER BY offset ASC
        `;
        params = [req.params.id, minOffset, maxOffset];
      } else if (afterOffset != null) {
        query = `
          SELECT id, session_id as sessionId, role, content, metadata, created_at as createdAt, offset
          FROM messages
          WHERE session_id = ? AND offset > ?
          ORDER BY offset ASC
          LIMIT ?
        `;
        params = [req.params.id, afterOffset, limit];
      } else if (before) {
        query = `
          SELECT id, session_id as sessionId, role, content, metadata, created_at as createdAt, offset
          FROM messages
          WHERE session_id = ? AND created_at < ?
          ORDER BY created_at DESC
          LIMIT ?
        `;
        params = [req.params.id, before, limit];
      } else if (after) {
        query = `
          SELECT id, session_id as sessionId, role, content, metadata, created_at as createdAt, offset
          FROM messages
          WHERE session_id = ? AND created_at > ?
          ORDER BY created_at ASC
          LIMIT ?
        `;
        params = [req.params.id, after, limit];
      } else {
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
      const MAX_RESPONSE_SIZE = 512 * 1024;
      let cumSize = 0;
      let keepCount = messages.length;

      for (let i = 0; i < messages.length; i++) {
        const rawSize = (messages[i].content?.length || 0) + (messages[i].metadata?.length || 0);
        cumSize += rawSize;
        if (i > 0 && cumSize > MAX_RESPONSE_SIZE) {
          keepCount = i;
          break;
        }
      }

      const trimmed = messages.slice(0, keepCount);
      const wasTrimmed = keepCount < messages.length;

      if (!after && afterOffset == null && !aroundMessageId) {
        trimmed.reverse();
      }

      const result = trimmed.map(m => ({
        ...m,
        metadata: m.metadata ? JSON.parse(m.metadata) : undefined
      }));

      const countResult = db.prepare(`
        SELECT COUNT(*) as total FROM messages WHERE session_id = ?
      `).get(req.params.id) as { total: number };

      const hasMore = wasTrimmed
        || (before || after || afterOffset != null || aroundMessageId ? messages.length === limit : countResult.total > limit);

      const oldestTimestamp = result.length > 0 ? result[0].createdAt : undefined;
      const newestTimestamp = result.length > 0 ? result[result.length - 1].createdAt : undefined;

      const maxOffset = result.reduce((max: number | undefined, m: any) =>
        m.offset != null ? Math.max(max ?? 0, m.offset) : max, undefined);

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

      if (metadata) {
        const messageRowid = insertResult.lastInsertRowid as number;
        extractAndIndexMetadata(db, id, messageRowid, req.params.id, metadata, now);
      }

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
}
