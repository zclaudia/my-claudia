/**
 * System Task & Task Run History API Routes
 */

import { Router, Request, Response } from 'express';
import type { ApiResponse, SystemTaskInfo, TaskRun } from '@my-claudia/shared';
import { systemTaskRegistry } from '../services/system-task-registry.js';
import type { TaskRunRepository } from '../repositories/task-run.js';

export function createSystemTaskRoutes(taskRunRepo: TaskRunRepository): Router {
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

  // GET /api/task-runs?taskId=X&limit=50 — run history for any task
  router.get('/task-runs', (req: Request, res: Response) => {
    try {
      const taskId = req.query.taskId as string;
      if (!taskId) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'taskId query parameter is required' },
        });
        return;
      }
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const runs = taskRunRepo.findByTaskId(taskId, limit);
      res.json({ success: true, data: runs } as ApiResponse<TaskRun[]>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  return router;
}
