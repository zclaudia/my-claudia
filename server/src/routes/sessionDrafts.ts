import { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import type { ApiResponse, SessionDraft } from '@my-claudia/shared';
import { SessionDraftRepository } from '../repositories/sessionDraft.js';

export function createSessionDraftRoutes(db: Database.Database): Router {
  const router = Router();
  const repo = new SessionDraftRepository(db);

  function sessionExists(sessionId: string): boolean {
    const row = db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId) as { 1: number } | undefined;
    return !!row;
  }

  function ensureSessionExists(req: Request, res: Response): boolean {
    if (sessionExists(req.params.id)) {
      return true;
    }

    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Session not found' },
    });
    return false;
  }

  // GET /api/sessions/:id/draft - Get active draft for session
  router.get('/:id/draft', (req: Request, res: Response) => {
    try {
      const draft = repo.findBySessionId(req.params.id);
      res.json({ success: true, data: draft } as ApiResponse<SessionDraft | null>);
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // PUT /api/sessions/:id/draft - Create or update draft content
  router.put('/:id/draft', (req: Request, res: Response) => {
    try {
      if (!ensureSessionExists(req, res)) {
        return;
      }

      const { content, deviceId } = req.body ?? {};
      if (typeof content !== 'string') {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'content is required' },
        });
        return;
      }

      const draft = repo.upsert(req.params.id, content, deviceId);
      res.json({ success: true, data: draft } as ApiResponse<SessionDraft>);
    } catch (error) {
      const msg = String(error);
      if (msg.includes('100KB')) {
        res.status(413).json({ success: false, error: msg });
      } else {
        res.status(500).json({ success: false, error: msg });
      }
    }
  });

  // POST /api/sessions/:id/draft/lock - Acquire edit lock
  router.post('/:id/draft/lock', (req: Request, res: Response) => {
    try {
      if (!ensureSessionExists(req, res)) {
        return;
      }

      const { deviceId, force } = req.body ?? {};
      if (!deviceId) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'deviceId is required' },
        });
        return;
      }

      if (force) {
        const draft = repo.forceLock(req.params.id, deviceId);
        res.json({ success: true, data: { locked: true, draft } });
      } else {
        const result = repo.acquireLock(req.params.id, deviceId);
        res.json({ success: true, data: { locked: result.success, draft: result.draft } });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // POST /api/sessions/:id/draft/unlock - Release edit lock
  router.post('/:id/draft/unlock', (req: Request, res: Response) => {
    try {
      if (!ensureSessionExists(req, res)) {
        return;
      }

      const { deviceId } = req.body ?? {};
      if (!deviceId) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'deviceId is required' },
        });
        return;
      }

      repo.releaseLock(req.params.id, deviceId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // POST /api/sessions/:id/draft/archive - Archive draft
  router.post('/:id/draft/archive', (_req: Request, res: Response) => {
    try {
      if (!ensureSessionExists(_req, res)) {
        return;
      }

      const draft = repo.archive(_req.params.id);
      if (!draft) {
        res.status(404).json({ success: false, error: 'No active draft found' });
        return;
      }
      res.json({ success: true, data: draft } as ApiResponse<SessionDraft>);
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // DELETE /api/sessions/:id/draft - Hard delete draft
  router.delete('/:id/draft', (req: Request, res: Response) => {
    try {
      if (!ensureSessionExists(req, res)) {
        return;
      }

      const deleted = repo.delete(req.params.id);
      if (!deleted) {
        res.status(404).json({ success: false, error: 'No draft found' });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  return router;
}
