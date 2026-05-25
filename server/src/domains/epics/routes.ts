// server/src/domains/epics/routes.ts
//
// REST surface for Epic CRUD. Lifecycle: 3-state (open/closed/cancelled),
// status changes go through `transitionStatus` for legal-transition checks.

import { Router, type Request, type Response } from 'express';
import express from 'express';
import type { ApiResponse } from '@my-claudia/shared/core/api';
import type { EpicStatus } from '@my-claudia/shared/features/epic';
import type { EpicService } from './service.js';

const ok = <T>(data: T): ApiResponse<T> => ({ success: true, data });
const err = (code: string, message: string): ApiResponse<never> => ({
  success: false,
  error: { code, message },
});

export interface EpicRoutesDeps {
  service: EpicService;
}

export function createEpicRoutes(deps: EpicRoutesDeps): Router {
  const router = Router();
  router.use(express.json());

  router.post('/', (req: Request, res: Response) => {
    const body = req.body as { projectId?: string; title?: string; description?: string; labels?: string[] };
    if (!body.projectId || !body.title) {
      res.status(400).json(err('VALIDATION', 'projectId + title required'));
      return;
    }
    try {
      const epic = deps.service.createEpic({
        projectId: body.projectId,
        title: body.title,
        description: body.description,
        labels: body.labels,
      });
      res.status(201).json(ok({ epic }));
    } catch (e) {
      res.status(400).json(err('EPIC_ERROR', (e as Error).message));
    }
  });

  router.get('/', (req: Request, res: Response) => {
    const projectId = req.query.projectId as string | undefined;
    if (!projectId) {
      res.status(400).json(err('VALIDATION', 'projectId required'));
      return;
    }
    res.json(ok({ epics: deps.service.listEpics(projectId) }));
  });

  router.get('/:id', (req: Request, res: Response) => {
    const epic = deps.service.getEpic(req.params.id);
    if (!epic) {
      res.status(404).json(err('NOT_FOUND', 'epic not found'));
      return;
    }
    res.json(ok({ epic }));
  });

  router.patch('/:id', (req: Request, res: Response) => {
    const body = req.body as { title?: string; description?: string; labels?: string[] };
    try {
      const epic = deps.service.updateEpic(req.params.id, body);
      res.json(ok({ epic }));
    } catch (e) {
      res.status(400).json(err('EPIC_ERROR', (e as Error).message));
    }
  });

  router.patch('/:id/status', (req: Request, res: Response) => {
    const body = req.body as { status?: EpicStatus };
    if (!body.status) {
      res.status(400).json(err('VALIDATION', 'status required'));
      return;
    }
    try {
      res.json(ok({ epic: deps.service.transitionStatus(req.params.id, body.status) }));
    } catch (e) {
      res.status(400).json(err('EPIC_ERROR', (e as Error).message));
    }
  });

  router.delete('/:id', (req: Request, res: Response) => {
    const removed = deps.service.deleteEpic(req.params.id);
    if (!removed) {
      res.status(404).json(err('NOT_FOUND', 'epic not found'));
      return;
    }
    res.json(ok(null));
  });

  return router;
}
