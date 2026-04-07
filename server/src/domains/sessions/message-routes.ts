import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { ApiResponse } from '@my-claudia/shared/core/api';
import type { Message, MessageMetadata, MessageRole } from '@my-claudia/shared/core/message';
import { extractAndIndexMetadata } from '../../storage/metadata-extractor.js';
import { findForegroundActiveRunIdForSession } from '../../utils/run-state.js';
import { parsePersistedMessageMetadata } from '../../utils/persisted-message.js';
import { SessionMessageRepository } from './message-repository.js';
/** Minimal shape — avoids depending on application/conversation types */
type ActiveRunsMap = Map<string, { sessionId?: string; completed?: boolean; sessionType?: string }>;

export function mountMessageRoutes(router: Router, db: Database.Database, activeRuns: ActiveRunsMap): void {
  const repo = new SessionMessageRepository(db);

  router.get('/:id/messages', (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const before = req.query.before ? parseInt(req.query.before as string) : undefined;
      const after = req.query.after ? parseInt(req.query.after as string) : undefined;
      const afterOffset = req.query.afterOffset ? parseInt(req.query.afterOffset as string) : undefined;
      const aroundMessageId = req.query.aroundMessageId as string | undefined;

      let messages;
      try {
        messages = repo.listBySession(req.params.id, {
          limit,
          before,
          after,
          afterOffset,
          aroundMessageId,
        });
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('message not found:')) {
          res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Message not found in session' } });
          return;
        }
        throw error;
      }

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

      const result = trimmed.map((message) => ({
        ...message,
        metadata: parsePersistedMessageMetadata<MessageMetadata>(message.metadata),
      }));

      const total = repo.countBySession(req.params.id);
      const hasMore = wasTrimmed
        || (before || after || afterOffset != null || aroundMessageId ? messages.length === limit : total > limit);

      const oldestTimestamp = result.length > 0 ? result[0].createdAt : undefined;
      const newestTimestamp = result.length > 0 ? result[result.length - 1].createdAt : undefined;
      const maxOffset = result.reduce((max: number | undefined, message: any) =>
        message.offset != null ? Math.max(max ?? 0, message.offset) : max, undefined);

      const activeRunId = findForegroundActiveRunIdForSession(activeRuns, req.params.id);
      const activeRun = activeRunId ? { runId: activeRunId } : null;

      res.json({
        success: true,
        data: {
          messages: result,
          pagination: {
            total,
            hasMore,
            oldestTimestamp,
            newestTimestamp,
            maxOffset,
          },
          activeRun,
        },
      });
    } catch (error) {
      console.error('Error fetching messages:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch messages' },
      });
    }
  });

  router.post('/:id/messages', (req: Request, res: Response) => {
    try {
      const { role, content, metadata } = req.body as {
        role?: MessageRole;
        content?: string;
        metadata?: MessageMetadata;
      };

      if (!role || !content) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Role and content are required' },
        });
        return;
      }

      if (role !== 'user' && role !== 'assistant' && role !== 'system') {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid message role' },
        });
        return;
      }

      if (!repo.sessionExists(req.params.id)) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Session not found' },
        });
        return;
      }

      const id = uuidv4();
      const now = Date.now();

      const storedMessage = repo.create({
        id,
        sessionId: req.params.id,
        role,
        content,
        metadata,
        createdAt: now,
      });

      if (metadata) {
        const messageRowid = repo.findRowIdById(id);
        if (messageRowid != null) {
          extractAndIndexMetadata(
            db,
            id,
            messageRowid,
            req.params.id,
            metadata as Parameters<typeof extractAndIndexMetadata>[4],
            now,
          );
        }
      }

      repo.updateSessionTimestamp(req.params.id, now);

      const message: Message = {
        id: storedMessage.id,
        sessionId: storedMessage.sessionId,
        role: storedMessage.role,
        content: storedMessage.content,
        metadata,
        createdAt: storedMessage.createdAt,
      };

      res.status(201).json({ success: true, data: message } as ApiResponse<Message>);
    } catch (error) {
      console.error('Error creating message:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to create message' },
      });
    }
  });
}
