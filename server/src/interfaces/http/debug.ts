import { Router, type Request, type Response } from 'express';
import type { ApiResponse } from '@my-claudia/shared/core/api';
import { getCrashLogFilePath, readCrashReports } from '../../utils/crash-log.js';
import type { ProcessSupervisor, ManagedProcessRecord } from '../../infrastructure/services/process-supervisor.js';

export function createDebugRoutes(processSupervisor?: ProcessSupervisor): Router {
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

  router.get('/processes', (_req: Request, res: Response) => {
    if (!processSupervisor) {
      res.json({
        success: true,
        data: [],
      } satisfies ApiResponse<ManagedProcessRecord[]>);
      return;
    }

    res.json({
      success: true,
      data: processSupervisor.listProcesses(),
    } satisfies ApiResponse<ManagedProcessRecord[]>);
  });

  router.get('/processes/:processId', (req: Request, res: Response) => {
    if (!processSupervisor) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Process supervisor unavailable' },
      } satisfies ApiResponse<never>);
      return;
    }

    const record = processSupervisor.getProcess(req.params.processId);
    if (!record) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Managed process not found' },
      } satisfies ApiResponse<never>);
      return;
    }

    res.json({
      success: true,
      data: record,
    } satisfies ApiResponse<ManagedProcessRecord>);
  });

  return router;
}
