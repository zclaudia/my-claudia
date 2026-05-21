// server/src/domains/openspec/routes/spec-change-routes.ts
import { Router, type Request, type Response } from 'express';
import express from 'express';
import type { SpecChangeService } from '../spec-change-service.js';
import { SpecChangeRepository } from '../../spec-change/spec-change-repository.js';
import type { Database } from 'better-sqlite3';

export interface SpecChangeRoutesDeps {
  db: Database;
  specChangeService: SpecChangeService;
}

export function createSpecChangeRoutes(deps: SpecChangeRoutesDeps): Router {
  const router = Router();
  router.use(express.json());
  const repo = new SpecChangeRepository(deps.db);

  router.get('/spec-changes', (req: Request, res: Response) => {
    const projectId = req.query.projectId as string | undefined;
    if (!projectId) { res.status(400).json({ error: 'projectId required' }); return; }
    res.json({ specChanges: repo.listByProject(projectId) });
  });

  router.get('/spec-changes/:id', (req: Request, res: Response) => {
    const sc = repo.findById(req.params.id);
    if (!sc) { res.status(404).json({ error: 'spec_change not found' }); return; }
    res.json({ specChange: sc });
  });

  const reader = (kind: 'proposal' | 'design' | 'tasks') => (req: Request, res: Response) => {
    try {
      const fn = kind === 'proposal' ? deps.specChangeService.readProposal
        : kind === 'design' ? deps.specChangeService.readDesign
        : deps.specChangeService.readTasks;
      res.type('text/markdown').send(fn.call(deps.specChangeService, req.params.id));
    } catch (e) {
      res.status(404).json({ error: (e as Error).message });
    }
  };
  router.get('/spec-changes/:id/proposal', reader('proposal'));
  router.get('/spec-changes/:id/design', reader('design'));
  router.get('/spec-changes/:id/tasks', reader('tasks'));

  router.get('/spec-changes/:id/delta/:capability', (req: Request, res: Response) => {
    try {
      res.type('text/markdown').send(deps.specChangeService.readDeltaSpec(req.params.id, req.params.capability));
    } catch (e) {
      res.status(404).json({ error: (e as Error).message });
    }
  });

  const writer = (kind: 'proposal' | 'design' | 'tasks') => (req: Request, res: Response) => {
    const content = (req.body as { content?: unknown }).content;
    if (typeof content !== 'string') { res.status(400).json({ error: 'content (string) required in body' }); return; }
    try {
      const fn = kind === 'proposal' ? deps.specChangeService.writeProposal
        : kind === 'design' ? deps.specChangeService.writeDesign
        : deps.specChangeService.writeTasks;
      res.json({ specChange: fn.call(deps.specChangeService, req.params.id, content) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  };
  router.put('/spec-changes/:id/proposal', writer('proposal'));
  router.put('/spec-changes/:id/design', writer('design'));
  router.put('/spec-changes/:id/tasks', writer('tasks'));

  router.put('/spec-changes/:id/delta/:capability', (req: Request, res: Response) => {
    const content = (req.body as { content?: unknown }).content;
    if (typeof content !== 'string') { res.status(400).json({ error: 'content (string) required in body' }); return; }
    try {
      res.json({ specChange: deps.specChangeService.writeDeltaSpec(req.params.id, req.params.capability, content) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  return router;
}
