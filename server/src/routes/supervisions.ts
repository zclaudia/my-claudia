import { Router, Request, Response } from 'express';
import type { ApiResponse, Supervision, SupervisionLog, SupervisionPlan, Message } from '@my-claudia/shared';
import { SupervisorService } from '../services/supervisor-service.js';

export function createSupervisionRoutes(supervisorService: SupervisorService): Router {
  const router = Router();

  // POST /api/supervisions — Create a new supervision
  router.post('/', (req: Request, res: Response) => {
    try {
      const { sessionId, goal, subtasks, maxIterations, cooldownSeconds } = req.body;

      if (!sessionId || !goal) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'sessionId and goal are required' }
        } as ApiResponse<never>);
        return;
      }

      const supervision = supervisorService.create(sessionId, goal, {
        subtasks,
        maxIterations,
        cooldownSeconds,
      });

      res.json({ success: true, data: supervision } as ApiResponse<Supervision>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create supervision';
      const status = message.includes('already has an active') ? 409 : 500;
      res.status(status).json({
        success: false,
        error: { code: status === 409 ? 'CONFLICT' : 'DB_ERROR', message }
      } as ApiResponse<never>);
    }
  });

  // GET /api/supervisions — List all supervisions
  router.get('/', (_req: Request, res: Response) => {
    try {
      const supervisions = supervisorService.listAll();
      res.json({ success: true, data: supervisions } as ApiResponse<Supervision[]>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to list supervisions' }
      } as ApiResponse<never>);
    }
  });

  // POST /api/supervisions/plan/start — Start AI-assisted goal planning
  // Fixed route: must come before /:id
  router.post('/plan/start', (req: Request, res: Response) => {
    try {
      const { sessionId, hint } = req.body;

      if (!sessionId || !hint) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'sessionId and hint are required' }
        } as ApiResponse<never>);
        return;
      }

      const result = supervisorService.startPlanning(sessionId, hint);
      res.json({
        success: true,
        data: result
      } as ApiResponse<{ supervision: Supervision; planSessionId: string }>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start planning';
      const status = message.includes('already has an active') ? 409 : 500;
      res.status(status).json({
        success: false,
        error: { code: status === 409 ? 'CONFLICT' : 'INTERNAL_ERROR', message }
      } as ApiResponse<never>);
    }
  });

  // POST /api/supervisions/plan/:id/respond — Send user response in planning conversation
  router.post('/plan/:id/respond', (req: Request, res: Response) => {
    try {
      const { message } = req.body;

      if (!message) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'message is required' }
        } as ApiResponse<never>);
        return;
      }

      supervisorService.respondToPlanning(req.params.id, message);
      res.json({ success: true, data: null } as ApiResponse<null>);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to respond';
      const status = msg.includes('not in planning') ? 400 : 500;
      res.status(status).json({
        success: false,
        error: { code: status === 400 ? 'INVALID_STATE' : 'INTERNAL_ERROR', message: msg }
      } as ApiResponse<never>);
    }
  });

  // POST /api/supervisions/plan/:id/approve — Approve the plan and start execution
  router.post('/plan/:id/approve', (req: Request, res: Response) => {
    try {
      const { goal, subtasks, acceptanceCriteria, maxIterations, cooldownSeconds } = req.body;

      if (!goal || !subtasks) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'goal and subtasks are required' }
        } as ApiResponse<never>);
        return;
      }

      const supervision = supervisorService.approvePlan(req.params.id, {
        goal,
        subtasks,
        acceptanceCriteria,
        maxIterations,
        cooldownSeconds,
      });
      res.json({ success: true, data: supervision } as ApiResponse<Supervision>);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to approve plan';
      const status = msg.includes('not in planning') ? 400 : 500;
      res.status(status).json({
        success: false,
        error: { code: status === 400 ? 'INVALID_STATE' : 'INTERNAL_ERROR', message: msg }
      } as ApiResponse<never>);
    }
  });

  // GET /api/supervisions/plan/:id/conversation — Get planning conversation
  router.get('/plan/:id/conversation', (req: Request, res: Response) => {
    try {
      const messages = supervisorService.getPlanConversation(req.params.id);
      res.json({ success: true, data: messages } as ApiResponse<Message[]>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to get planning conversation' }
      } as ApiResponse<never>);
    }
  });

  // POST /api/supervisions/plan/:id/cancel — Cancel planning
  router.post('/plan/:id/cancel', (req: Request, res: Response) => {
    try {
      const supervision = supervisorService.cancelPlanning(req.params.id);
      res.json({ success: true, data: supervision } as ApiResponse<Supervision>);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to cancel planning';
      const status = msg.includes('not in planning') ? 400 : 500;
      res.status(status).json({
        success: false,
        error: { code: status === 400 ? 'INVALID_STATE' : 'INTERNAL_ERROR', message: msg }
      } as ApiResponse<never>);
    }
  });

  // GET /api/supervisions/session/:sid — Get supervision by session ID
  // Fixed route: must come before /:id
  router.get('/session/:sid', (req: Request, res: Response) => {
    try {
      const supervision = supervisorService.getActiveBySessionId(req.params.sid);
      res.json({ success: true, data: supervision } as ApiResponse<Supervision | null>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to get supervision' }
      } as ApiResponse<never>);
    }
  });

  // GET /api/supervisions/:id — Get supervision by ID
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const supervision = supervisorService.getSupervision(req.params.id);
      if (!supervision) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Supervision not found' }
        } as ApiResponse<never>);
        return;
      }
      res.json({ success: true, data: supervision } as ApiResponse<Supervision>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to get supervision' }
      } as ApiResponse<never>);
    }
  });

  // GET /api/supervisions/:id/logs — Get supervision logs
  router.get('/:id/logs', (req: Request, res: Response) => {
    try {
      const logs = supervisorService.getLogsBySupervisionId(req.params.id);
      res.json({ success: true, data: logs } as ApiResponse<SupervisionLog[]>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to get supervision logs' }
      } as ApiResponse<never>);
    }
  });

  // PUT /api/supervisions/:id — Update supervision settings
  router.put('/:id', (req: Request, res: Response) => {
    try {
      const { maxIterations, cooldownSeconds, goal } = req.body;
      const supervision = supervisorService.update(req.params.id, {
        maxIterations,
        cooldownSeconds,
        goal,
      });
      res.json({ success: true, data: supervision } as ApiResponse<Supervision>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to update supervision' }
      } as ApiResponse<never>);
    }
  });

  // POST /api/supervisions/:id/pause — Pause supervision
  router.post('/:id/pause', (req: Request, res: Response) => {
    try {
      const supervision = supervisorService.pause(req.params.id, 'user');
      res.json({ success: true, data: supervision } as ApiResponse<Supervision>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to pause supervision' }
      } as ApiResponse<never>);
    }
  });

  // POST /api/supervisions/:id/resume — Resume supervision
  router.post('/:id/resume', (req: Request, res: Response) => {
    try {
      const { maxIterations } = req.body || {};
      const supervision = supervisorService.resume(req.params.id, {
        maxIterations,
      });
      res.json({ success: true, data: supervision } as ApiResponse<Supervision>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to resume supervision';
      const status = message.includes('not paused') ? 400 : 500;
      res.status(status).json({
        success: false,
        error: { code: status === 400 ? 'INVALID_STATE' : 'DB_ERROR', message }
      } as ApiResponse<never>);
    }
  });

  // POST /api/supervisions/:id/cancel — Cancel supervision
  router.post('/:id/cancel', (req: Request, res: Response) => {
    try {
      const supervision = supervisorService.cancel(req.params.id);
      res.json({ success: true, data: supervision } as ApiResponse<Supervision>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to cancel supervision' }
      } as ApiResponse<never>);
    }
  });

  return router;
}
