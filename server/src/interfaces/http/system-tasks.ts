/**
 * System Task API Routes
 */

import { Router, Request, Response } from 'express';
import type { ApiResponse } from '@my-claudia/shared/core/api';
import type { SystemTaskInfo } from '@my-claudia/shared/features/system-tasks';
import { systemTaskRegistry } from '../../services/system-task-registry.js';

export function createSystemTaskRoutes(): Router {
  const router = Router();

  // GET /api/system-tasks — list all registered system tasks
  router.get('/system-tasks', (_req: Request, res: Response) => {
    try {
      const tasks = systemTaskRegistry.getAll();
      res.json({ success: true, data: tasks } as ApiResponse<SystemTaskInfo[]>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  return router;
}
