import { Router, type Request, type Response } from 'express';
import type { ApiResponse } from '@my-claudia/shared/core/api';
import type {
  GenerateTurnSummaryRequest,
  GenerateTurnSummaryResponse,
  TurnSummary,
} from '@my-claudia/shared/features/turn-summary';
import type { TurnSummaryService } from './service.js';

export function createTurnSummaryRoutes(service: TurnSummaryService): Router {
  const router = Router();

  // GET /api/sessions/:sessionId/turn-summaries — list cached summaries for a session
  router.get('/sessions/:sessionId/turn-summaries', (req: Request, res: Response) => {
    try {
      const summaries = service.listForSession(req.params.sessionId);
      res.json({ success: true, data: summaries } as ApiResponse<TurnSummary[]>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list turn summaries';
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message } });
    }
  });

  // POST /api/sessions/:sessionId/turn-summaries/:userMessageId/generate
  //   body: { model?, force? }
  //   returns: { summary, fromCache }
  router.post(
    '/sessions/:sessionId/turn-summaries/:userMessageId/generate',
    async (req: Request, res: Response) => {
      try {
        const { sessionId, userMessageId } = req.params;
        const { model, force } = (req.body ?? {}) as GenerateTurnSummaryRequest;
        const result = await service.generate(sessionId, userMessageId, { model, force });
        res.json({ success: true, data: result } as ApiResponse<GenerateTurnSummaryResponse>);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to generate turn summary';
        const code = message.includes('No messages') || message.includes('not a user message')
          ? 'NOT_FOUND'
          : message.includes('parse summary')
            ? 'GENERATION_FAILED'
            : 'INTERNAL_ERROR';
        const status = code === 'NOT_FOUND' ? 404 : 500;
        res.status(status).json({ success: false, error: { code, message } });
      }
    },
  );

  return router;
}
