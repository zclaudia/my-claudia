import { Router, Request, Response } from 'express';
import type { ApiResponse, LocalPR } from '@my-claudia/shared';
import type { LocalPRService } from '../services/local-pr-service.js';
import { ProjectRepository } from '../repositories/project.js';
import type { Database } from 'better-sqlite3';

export function createLocalPRRoutes(localPRService: LocalPRService, db: Database): Router {
  const router = Router();
  const projectRepo = new ProjectRepository(db);

  // GET /api/projects/:projectId/local-prs
  router.get('/projects/:projectId/local-prs', (req: Request, res: Response) => {
    try {
      const prs = localPRService.getRepo().findByProjectId(req.params.projectId);
      res.json({ success: true, data: prs } as ApiResponse<LocalPR[]>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list local PRs';
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message } });
    }
  });

  // POST /api/projects/:projectId/local-prs  — create PR
  router.post('/projects/:projectId/local-prs', async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { worktreePath, title, description } = req.body;

      if (!worktreePath) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'worktreePath is required' },
        });
        return;
      }

      const pr = await localPRService.createPR(projectId, worktreePath, { title, description });
      res.status(201).json({ success: true, data: pr } as ApiResponse<LocalPR>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create local PR';
      const status = message.includes('already exists') || message.includes('No new commits') ? 400 : 500;
      res.status(status).json({ success: false, error: { code: 'CREATE_ERROR', message } });
    }
  });

  // GET /api/local-prs/:prId
  router.get('/local-prs/:prId', (req: Request, res: Response) => {
    try {
      const pr = localPRService.getRepo().findById(req.params.prId);
      if (!pr) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Local PR not found' },
        });
        return;
      }
      res.json({ success: true, data: pr } as ApiResponse<LocalPR>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get local PR';
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message } });
    }
  });

  // POST /api/local-prs/:prId/close
  router.post('/local-prs/:prId/close', (req: Request, res: Response) => {
    try {
      const pr = localPRService.getRepo().findById(req.params.prId);
      if (!pr) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Local PR not found' } });
        return;
      }
      const updated = localPRService.getRepo().update(pr.id, { status: 'closed' });
      res.json({ success: true, data: updated } as ApiResponse<LocalPR>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to close local PR';
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message } });
    }
  });

  // POST /api/local-prs/:prId/retry-review
  router.post('/local-prs/:prId/retry-review', async (req: Request, res: Response) => {
    try {
      const pr = localPRService.getRepo().findById(req.params.prId);
      if (!pr) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Local PR not found' } });
        return;
      }
      // Reset to open so the scheduler picks it up
      localPRService.getRepo().update(pr.id, { status: 'open' });
      res.json({ success: true, data: localPRService.getRepo().findById(pr.id) } as ApiResponse<LocalPR>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to retry review';
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message } });
    }
  });

  // POST /api/local-prs/:prId/merge — manually trigger merge
  router.post('/local-prs/:prId/merge', async (req: Request, res: Response) => {
    try {
      const pr = localPRService.getRepo().findById(req.params.prId);
      if (!pr) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Local PR not found' } });
        return;
      }
      // Force approve then merge
      localPRService.getRepo().update(pr.id, { status: 'approved' });
      localPRService.mergePR(pr.id).catch((err) =>
        console.error(`[LocalPRRoutes] Manual merge error for PR ${pr.id}:`, err),
      );
      res.json({ success: true, data: localPRService.getRepo().findById(pr.id) } as ApiResponse<LocalPR>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to trigger merge';
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message } });
    }
  });

  // PATCH /api/projects/:projectId/review-provider — set review provider
  router.patch('/projects/:projectId/review-provider', (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { providerId } = req.body;

      if (!providerId) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'providerId is required' },
        });
        return;
      }

      const updated = projectRepo.update(projectId, { reviewProviderId: providerId });
      res.json({ success: true, data: updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to set review provider';
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message } });
    }
  });

  return router;
}
