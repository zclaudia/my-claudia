import { Router, type Request, type Response } from 'express';
import express from 'express';
import type { Database } from 'better-sqlite3';
import type { ApiResponse } from '@my-claudia/shared/core/api';
import { ExecutorInstanceRepository } from './executor-instance-repository.js';
import type { ExecutorService } from '../issue-orchestration/executor-service.js';
import type { ExecutorType } from '@my-claudia/shared/features/executor';

const ok = <T>(data: T): ApiResponse<T> => ({ success: true, data });
const err = (code: string, message: string): ApiResponse<never> => ({
  success: false,
  error: { code, message },
});

export interface ExecutorRoutesDeps {
  db: Database;
  executorService: ExecutorService;
}

export function createExecutorRoutes(deps: ExecutorRoutesDeps): Router {
  const router = Router();
  router.use(express.json());
  const repo = new ExecutorInstanceRepository(deps.db);

  router.get('/executor-instances', (req: Request, res: Response) => {
    const specChangeId = req.query.specChangeId as string | undefined;
    if (!specChangeId) {
      res.status(400).json(err('VALIDATION', 'specChangeId required'));
      return;
    }
    res.json(ok({ executorInstances: repo.listBySpecChange(specChangeId) }));
  });

  router.get('/executor-instances/:id', (req: Request, res: Response) => {
    const inst = repo.findById(req.params.id);
    if (!inst) {
      res.status(404).json(err('NOT_FOUND', 'executor_instance not found'));
      return;
    }
    res.json(ok({ executorInstance: inst }));
  });

  router.post('/executor-instances', (req: Request, res: Response) => {
    const body = req.body as {
      projectId?: string;
      specChangeId?: string;
      type?: ExecutorType;
      underlyingId?: string;
    };
    if (!body.projectId || !body.specChangeId || !body.type) {
      res.status(400).json(err('VALIDATION', 'projectId, specChangeId, type required'));
      return;
    }
    try {
      const created = repo.create({
        projectId: body.projectId,
        specChangeId: body.specChangeId,
        type: body.type,
        underlyingId: body.underlyingId,
      });
      res.status(201).json(ok({ executorInstance: created }));
    } catch (e) {
      res.status(400).json(err('OPENSPEC_ERROR', (e as Error).message));
    }
  });

  const op =
    (action: (id: string) => Promise<void>) =>
    async (req: Request, res: Response) => {
      try {
        await action(req.params.id);
        const inst = repo.findById(req.params.id);
        res.json(ok({ executorInstance: inst }));
      } catch (e) {
        res.status(400).json(err('OPENSPEC_ERROR', (e as Error).message));
      }
    };
  router.post('/executor-instances/:id/start', op((id) => deps.executorService.start(id)));
  router.post('/executor-instances/:id/pause', op((id) => deps.executorService.pause(id)));
  router.post('/executor-instances/:id/resume', op((id) => deps.executorService.resume(id)));
  router.post('/executor-instances/:id/cancel', op((id) => deps.executorService.cancel(id)));
  router.post(
    '/executor-instances/:id/mark-completed',
    op((id) => deps.executorService.markCompleted(id)),
  );
  router.post('/executor-instances/:id/refresh', op((id) => deps.executorService.refresh(id)));

  router.get('/legacy-classic-change-ids', (req: Request, res: Response) => {
    const projectId = req.query.projectId as string | undefined;
    if (!projectId) {
      res.status(400).json(err('VALIDATION', 'projectId required'));
      return;
    }
    const rows = deps.db
      .prepare(
        `SELECT pc.id FROM project_changes pc
         WHERE pc.project_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM executor_instances ei
             WHERE ei.underlying_id = pc.id AND ei.type = 'classic'
           )`,
      )
      .all(projectId) as { id: string }[];
    res.json(ok({ legacyIds: rows.map((r) => r.id) }));
  });

  router.get('/legacy-meta-workflow-run-ids', (req: Request, res: Response) => {
    const projectId = req.query.projectId as string | undefined;
    if (!projectId) {
      res.status(400).json(err('VALIDATION', 'projectId required'));
      return;
    }
    const rows = deps.db
      .prepare(
        `SELECT mr.id FROM meta_workflow_runs mr
         WHERE mr.project_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM executor_instances ei
             WHERE ei.underlying_id = mr.id AND ei.type = 'meta-workflow'
           )`,
      )
      .all(projectId) as { id: string }[];
    res.json(ok({ legacyIds: rows.map((r) => r.id) }));
  });

  return router;
}
