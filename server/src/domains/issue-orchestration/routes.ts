// server/src/domains/issue-orchestration/routes.ts
import { Router, type Request, type Response } from 'express';
import express from 'express';
import type { ApiResponse } from '@my-claudia/shared/core/api';
import type { IssueLifecycle } from './issue-lifecycle.js';
import type { AnonymousIssueService } from './anonymous-issue-service.js';
import type { LocalIssueStatus, LocalIssueType } from '@my-claudia/shared/features/local-issue';

const ok = <T>(data: T): ApiResponse<T> => ({ success: true, data });
const err = (code: string, message: string): ApiResponse<never> => ({
  success: false,
  error: { code, message },
});

export interface IssueRoutesDeps {
  lifecycle: IssueLifecycle;
  anonymousService: AnonymousIssueService;
}

export function createIssueRoutes(deps: IssueRoutesDeps): Router {
  const router = Router();
  router.use(express.json());

  router.post('/sub', (req: Request, res: Response) => {
    const body = req.body as {
      projectId?: string; epicId?: string; type?: LocalIssueType; title?: string;
      slug?: string; description?: string; priority?: string; labels?: string[]; isAnonymous?: boolean;
    };
    if (!body.projectId || !body.type || !body.title) {
      res.status(400).json(err('VALIDATION', 'projectId + type + title required')); return;
    }
    try {
      const out = deps.lifecycle.createSubIssue({
        projectId: body.projectId,
        type: body.type,
        title: body.title,
        epicId: body.epicId,
        slug: body.slug,
        description: body.description,
        priority: body.priority as never,
        labels: body.labels,
        isAnonymous: body.isAnonymous,
      });
      res.status(201).json(ok(out));
    } catch (e) { res.status(400).json(err('OPENSPEC_ERROR', (e as Error).message)); }
  });

  router.post('/anonymous', (req: Request, res: Response) => {
    const body = req.body as { projectId?: string; title?: string };
    if (!body.projectId || !body.title) { res.status(400).json(err('VALIDATION', 'projectId + title required')); return; }
    try {
      const out = deps.anonymousService.createAnonymous({ projectId: body.projectId, title: body.title });
      res.status(201).json(ok(out));
    } catch (e) { res.status(400).json(err('OPENSPEC_ERROR', (e as Error).message)); }
  });

  router.get('/', (req: Request, res: Response) => {
    const projectId = req.query.projectId as string | undefined;
    if (!projectId) { res.status(400).json(err('VALIDATION', 'projectId required')); return; }
    res.json(ok({ issues: deps.lifecycle.listByProject(projectId) }));
  });

  router.get('/:id', (req: Request, res: Response) => {
    const issue = deps.lifecycle.getIssue(req.params.id);
    if (!issue) { res.status(404).json(err('NOT_FOUND', 'issue not found')); return; }
    res.json(ok({ issue }));
  });

  router.get('/:id/sub-issues', (req: Request, res: Response) => {
    res.json(ok({ subIssues: deps.lifecycle.listIssuesByEpic(req.params.id) }));
  });

  router.patch('/:id/status', (req: Request, res: Response) => {
    const body = req.body as { status?: LocalIssueStatus };
    if (!body.status) { res.status(400).json(err('VALIDATION', 'status required')); return; }
    try {
      res.json(ok({ issue: deps.lifecycle.transitionStatus(req.params.id, body.status) }));
    } catch (e) { res.status(400).json(err('OPENSPEC_ERROR', (e as Error).message)); }
  });

  router.post('/:id/close-and-archive', async (req: Request, res: Response) => {
    try {
      const out = await deps.lifecycle.closeSubIssueAndArchive(req.params.id);
      res.json(ok(out));
    } catch (e) { res.status(400).json(err('OPENSPEC_ERROR', (e as Error).message)); }
  });

  return router;
}
