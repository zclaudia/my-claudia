import { Router, Request, Response } from 'express';
import type { ApiResponse } from '@my-claudia/shared/core/api';
import type { LocalIssue } from '@my-claudia/shared/features/local-issue';
import type { LocalIssueService } from './service.js';

export function createLocalIssueRoutes(service: LocalIssueService): Router {
  const router = Router();

  // GET /api/projects/:projectId/local-issues
  router.get('/projects/:projectId/local-issues', (req: Request, res: Response) => {
    try {
      const issues = service.getRepo().findByProjectId(req.params.projectId);
      res.json({ success: true, data: issues } as ApiResponse<LocalIssue[]>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list issues';
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message } });
    }
  });

  // POST /api/projects/:projectId/local-issues
  router.post('/projects/:projectId/local-issues', (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { title, description, priority, labels } = req.body;

      if (!title) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'title is required' },
        });
        return;
      }

      const issue = service.createIssue(projectId, { title, description, priority, labels });
      res.status(201).json({ success: true, data: issue } as ApiResponse<LocalIssue>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create issue';
      res.status(500).json({ success: false, error: { code: 'CREATE_ERROR', message } });
    }
  });

  // PATCH /api/local-issues/:issueId
  router.patch('/local-issues/:issueId', (req: Request, res: Response) => {
    try {
      const { issueId } = req.params;
      const { title, description, priority, labels, status } = req.body;
      const issue = service.updateIssue(issueId, { title, description, priority, labels, status });
      res.json({ success: true, data: issue } as ApiResponse<LocalIssue>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update issue';
      const status = message.includes('not found') ? 404 : 500;
      res.status(status).json({ success: false, error: { code: 'UPDATE_ERROR', message } });
    }
  });

  // POST /api/local-issues/:issueId/close
  router.post('/local-issues/:issueId/close', (req: Request, res: Response) => {
    try {
      const issue = service.closeIssue(req.params.issueId);
      res.json({ success: true, data: issue } as ApiResponse<LocalIssue>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to close issue';
      const status = message.includes('not found') ? 404 : 500;
      res.status(status).json({ success: false, error: { code: 'CLOSE_ERROR', message } });
    }
  });

  // POST /api/local-issues/:issueId/reopen
  router.post('/local-issues/:issueId/reopen', (req: Request, res: Response) => {
    try {
      const issue = service.reopenIssue(req.params.issueId);
      res.json({ success: true, data: issue } as ApiResponse<LocalIssue>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reopen issue';
      const status = message.includes('not found') ? 404 : 500;
      res.status(status).json({ success: false, error: { code: 'REOPEN_ERROR', message } });
    }
  });

  // DELETE /api/local-issues/:issueId
  router.delete('/local-issues/:issueId', (req: Request, res: Response) => {
    try {
      const result = service.deleteIssue(req.params.issueId);
      if (!result) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Issue not found' },
        });
        return;
      }
      res.json({ success: true, data: null } as ApiResponse<null>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete issue';
      res.status(500).json({ success: false, error: { code: 'DELETE_ERROR', message } });
    }
  });

  return router;
}
