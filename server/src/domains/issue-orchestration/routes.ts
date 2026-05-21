// server/src/domains/issue-orchestration/routes.ts
import { Router, type Request, type Response } from 'express';
import express from 'express';
import type { IssueLifecycle } from './issue-lifecycle.js';
import type { AnonymousIssueService } from './anonymous-issue-service.js';
import type { LocalIssueStatus, LocalIssueType } from '@my-claudia/shared/features/local-issue';

export interface IssueRoutesDeps {
  lifecycle: IssueLifecycle;
  anonymousService: AnonymousIssueService;
}

export function createIssueRoutes(deps: IssueRoutesDeps): Router {
  const router = Router();
  router.use(express.json());

  router.post('/features', (req: Request, res: Response) => {
    const body = req.body as { projectId?: string; title?: string; description?: string; priority?: string; labels?: string[] };
    if (!body.projectId || !body.title) { res.status(400).json({ error: 'projectId + title required' }); return; }
    try {
      const issue = deps.lifecycle.createParent({
        projectId: body.projectId, title: body.title,
        description: body.description,
        priority: body.priority as never,
        labels: body.labels,
      });
      res.status(201).json({ issue });
    } catch (e) { res.status(400).json({ error: (e as Error).message }); }
  });

  router.post('/sub', (req: Request, res: Response) => {
    const body = req.body as {
      projectId?: string; parentIssueId?: string; type?: LocalIssueType; title?: string;
      slug?: string; description?: string; priority?: string; labels?: string[]; isAnonymous?: boolean;
    };
    if (!body.projectId || !body.type || !body.title) {
      res.status(400).json({ error: 'projectId + type + title required' }); return;
    }
    if (body.type === 'feature') { res.status(400).json({ error: 'sub-issue cannot be type=feature' }); return; }
    try {
      const out = deps.lifecycle.createSubIssue({
        projectId: body.projectId,
        type: body.type as Exclude<LocalIssueType, 'feature'>,
        title: body.title,
        parentIssueId: body.parentIssueId,
        slug: body.slug,
        description: body.description,
        priority: body.priority as never,
        labels: body.labels,
        isAnonymous: body.isAnonymous,
      });
      res.status(201).json(out);
    } catch (e) { res.status(400).json({ error: (e as Error).message }); }
  });

  router.post('/anonymous', (req: Request, res: Response) => {
    const body = req.body as { projectId?: string; title?: string };
    if (!body.projectId || !body.title) { res.status(400).json({ error: 'projectId + title required' }); return; }
    try {
      const out = deps.anonymousService.createAnonymous({ projectId: body.projectId, title: body.title });
      res.status(201).json(out);
    } catch (e) { res.status(400).json({ error: (e as Error).message }); }
  });

  router.get('/:id', (req: Request, res: Response) => {
    const issue = deps.lifecycle.getIssue(req.params.id);
    if (!issue) { res.status(404).json({ error: 'issue not found' }); return; }
    res.json({ issue });
  });

  router.get('/:id/sub-issues', (req: Request, res: Response) => {
    res.json({ subIssues: deps.lifecycle.listSubIssues(req.params.id) });
  });

  router.patch('/:id/status', (req: Request, res: Response) => {
    const body = req.body as { status?: LocalIssueStatus };
    if (!body.status) { res.status(400).json({ error: 'status required' }); return; }
    try {
      res.json({ issue: deps.lifecycle.transitionStatus(req.params.id, body.status) });
    } catch (e) { res.status(400).json({ error: (e as Error).message }); }
  });

  router.post('/:id/close-and-archive', async (req: Request, res: Response) => {
    try {
      const out = await deps.lifecycle.closeSubIssueAndArchive(req.params.id);
      res.json(out);
    } catch (e) { res.status(400).json({ error: (e as Error).message }); }
  });

  return router;
}
