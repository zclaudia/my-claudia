// server/src/domains/openspec/routes/bootstrap-routes.ts
import { Router, type Request, type Response } from 'express';
import express from 'express';
import type { BootstrapService } from '../bootstrap-service.js';
import type { BootstrapReviewService } from '../bootstrap-review-service.js';
import { BootstrapScanRepository } from '../repositories/bootstrap-scan-repository.js';
import type { Database } from 'better-sqlite3';

export interface BootstrapRoutesDeps {
  db: Database;
  bootstrapService: BootstrapService;
  reviewService: BootstrapReviewService;
}

export function createBootstrapRoutes(deps: BootstrapRoutesDeps): Router {
  const router = Router();
  router.use(express.json());
  const scanRepo = new BootstrapScanRepository(deps.db);

  router.post('/bootstrap/scans', async (req: Request, res: Response) => {
    const body = req.body as { projectId?: string; mode?: 'initial' | 'rescan' };
    if (!body.projectId || !body.mode) {
      res.status(400).json({ error: 'projectId + mode required' });
      return;
    }
    if (body.mode !== 'initial' && body.mode !== 'rescan') {
      res.status(400).json({ error: "mode must be 'initial' or 'rescan'" });
      return;
    }
    try {
      const result = await deps.bootstrapService.start({
        projectId: body.projectId,
        mode: body.mode,
      });
      res.status(201).json(result);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  router.get('/bootstrap/scans', (req: Request, res: Response) => {
    const projectId = req.query.projectId as string | undefined;
    if (!projectId) {
      res.status(400).json({ error: 'projectId required' });
      return;
    }
    res.json({ scans: scanRepo.listByProject(projectId) });
  });

  router.get('/bootstrap/scans/:id', (req: Request, res: Response) => {
    const scan = scanRepo.findById(req.params.id);
    if (!scan) {
      res.status(404).json({ error: 'scan not found' });
      return;
    }
    res.json({ scan });
  });

  router.get('/bootstrap/scans/:id/items', (req: Request, res: Response) => {
    const filter = (req.query.status as string | undefined) ?? 'all';
    const items =
      filter === 'pending'
        ? deps.reviewService.listPending(req.params.id)
        : deps.reviewService.listAll(req.params.id);
    res.json({ items });
  });

  router.post('/bootstrap/items/:itemId/approve', (req: Request, res: Response) => {
    try {
      res.json({ item: deps.reviewService.approve(req.params.itemId) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  router.post('/bootstrap/items/:itemId/reject', (req: Request, res: Response) => {
    try {
      res.json({ item: deps.reviewService.reject(req.params.itemId) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  router.post('/bootstrap/scans/:id/finalize', async (req: Request, res: Response) => {
    try {
      const result = await deps.reviewService.finalize(req.params.id);
      if (!result) {
        res.status(409).json({ error: 'pending items remain; finalize aborted' });
        return;
      }
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  return router;
}
