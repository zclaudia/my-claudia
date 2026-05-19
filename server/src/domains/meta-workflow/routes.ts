// server/src/domains/meta-workflow/routes.ts
import { Router, type Request, type Response } from 'express';
import type { MetaWorkflowService } from './service.js';

export function createMetaWorkflowRoutes(service: MetaWorkflowService): Router {
  const router = Router();

  router.get('/runs', (req: Request, res: Response) => {
    const projectId = req.query.projectId as string | undefined;
    if (!projectId) {
      res.status(400).json({ error: 'projectId query param required' });
      return;
    }
    res.json({ runs: service.listRuns(projectId) });
  });

  router.get('/runs/:runId', (req: Request, res: Response) => {
    const run = service.getRun(req.params.runId);
    if (!run) {
      res.status(404).json({ error: 'run not found' });
      return;
    }
    res.json({ run });
  });

  router.get('/runs/:runId/phases', (req: Request, res: Response) => {
    res.json({ phases: service.listPhases(req.params.runId) });
  });

  router.get('/reuse-pool', (req: Request, res: Response) => {
    const phaseType = (req.query.phaseType as string | undefined) || undefined;
    const search = (req.query.search as string | undefined) || undefined;
    res.json({ items: service.listReusePool({ phaseType, search }) });
  });

  router.post('/runs/:runId/promote-item', (req: Request, res: Response) => {
    const body = req.body as {
      itemId?: string;
      newTags?: string[];
      newName?: string;
      newDescription?: string;
    };
    if (!body.itemId || !Array.isArray(body.newTags)) {
      res.status(400).json({ error: 'itemId and newTags required' });
      return;
    }
    try {
      const promoted = service.promotePoolItem(body.itemId, {
        newTags: body.newTags,
        newName: body.newName,
        newDescription: body.newDescription,
      });
      res.json({ item: promoted });
    } catch (e) {
      res.status(404).json({ error: (e as Error).message });
    }
  });

  return router;
}
