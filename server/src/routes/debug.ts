import { Router, type Request, type Response } from 'express';
import type { ApiResponse } from '@my-claudia/shared';
import { getCrashLogFilePath, readCrashReports } from '../utils/crash-log.js';

export function createDebugRoutes(): Router {
  const router = Router();

  router.get('/crashes', (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: {
        reports: readCrashReports(20),
        filePath: getCrashLogFilePath(),
      },
    } satisfies ApiResponse<{ reports: ReturnType<typeof readCrashReports>; filePath: string }>);
  });

  return router;
}
