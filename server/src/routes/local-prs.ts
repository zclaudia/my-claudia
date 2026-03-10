import { Router, Request, Response } from 'express';
import type { ApiResponse, LocalPR, WorktreeConfig } from '@my-claudia/shared';
import type { LocalPRService } from '../services/local-pr-service.js';
import { ProjectRepository } from '../repositories/project.js';
import { WorktreeConfigRepository } from '../repositories/worktree-config.js';
import type { Database } from 'better-sqlite3';

export function createLocalPRRoutes(localPRService: LocalPRService, db: Database): Router {
  const router = Router();
  const projectRepo = new ProjectRepository(db);
  const wtConfigRepo = new WorktreeConfigRepository(db);

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
      const { worktreePath, title, description, baseBranch, autoReview } = req.body;

      if (!worktreePath) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'worktreePath is required' },
        });
        return;
      }

      const pr = await localPRService.createPR(projectId, worktreePath, { title, description, baseBranch, autoReview });
      res.status(201).json({ success: true, data: pr } as ApiResponse<LocalPR>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create local PR';
      const status = message.includes('already exists') || message.includes('No new commits') ? 400 : 500;
      res.status(status).json({ success: false, error: { code: 'CREATE_ERROR', message } });
    }
  });

  // GET /api/projects/:projectId/local-prs/precheck?worktreePath=...
  router.get('/projects/:projectId/local-prs/precheck', async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const worktreePath = (req.query.worktreePath as string | undefined) || '';
      if (!worktreePath) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'worktreePath is required' },
        });
        return;
      }

      const result = await localPRService.checkCreatePreconditions(projectId, worktreePath);
      res.json({ success: true, data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to validate PR creation';
      res.status(500).json({ success: false, error: { code: 'PRECHECK_ERROR', message } });
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
      localPRService.archiveRelatedSessions(pr);
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

  // POST /api/local-prs/:prId/review — manually trigger AI review
  router.post('/local-prs/:prId/review', async (req: Request, res: Response) => {
    try {
      const pr = localPRService.getRepo().findById(req.params.prId);
      if (!pr) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Local PR not found' } });
        return;
      }
      if (pr.status !== 'open' && pr.status !== 'review_failed') {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_STATE', message: `Cannot review PR in status '${pr.status}'` },
        });
        return;
      }
      // Reset to open if review_failed, then start
      if (pr.status === 'review_failed') {
        localPRService.getRepo().update(pr.id, { status: 'open' });
      }
      const { providerId } = req.body;
      await localPRService.startReview(pr.id, providerId || undefined);
      res.json({ success: true, data: localPRService.getRepo().findById(pr.id) } as ApiResponse<LocalPR>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start review';
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
      await localPRService.mergePR(pr.id);
      res.json({ success: true, data: localPRService.getRepo().findById(pr.id) } as ApiResponse<LocalPR>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to trigger merge';
      const status =
        message.includes('Cannot merge PR in status') ? 400
          : message.includes('Main worktree is dirty') ? 409
            : 500;
      res.status(status).json({ success: false, error: { code: 'INTERNAL_ERROR', message } });
    }
  });

  // POST /api/local-prs/:prId/cancel-merge — force-cancel a stuck merge
  router.post('/local-prs/:prId/cancel-merge', async (req: Request, res: Response) => {
    try {
      const pr = localPRService.getRepo().findById(req.params.prId);
      if (!pr) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Local PR not found' } });
        return;
      }
      await localPRService.cancelMerge(pr.id);
      res.json({ success: true, data: localPRService.getRepo().findById(pr.id) } as ApiResponse<LocalPR>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to cancel merge';
      const status = message.includes('Cannot cancel merge in status') ? 400 : 500;
      res.status(status).json({ success: false, error: { code: 'INTERNAL_ERROR', message } });
    }
  });

  // POST /api/local-prs/:prId/cancel-queue — cancel a queued PR
  router.post('/local-prs/:prId/cancel-queue', async (req: Request, res: Response) => {
    try {
      const pr = localPRService.getRepo().findById(req.params.prId);
      if (!pr) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Local PR not found' } });
        return;
      }
      if (pr.executionState !== 'queued') {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_STATE', message: `PR is not queued (current state: ${pr.executionState})` },
        });
        return;
      }
      localPRService.getRepo().update(pr.id, {
        executionState: 'idle',
        pendingAction: 'none',
        statusMessage: 'Queue cancelled by user.',
      });
      res.json({ success: true, data: localPRService.getRepo().findById(pr.id) } as ApiResponse<LocalPR>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to cancel queue';
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message } });
    }
  });

  // POST /api/local-prs/:prId/retry — retry a failed PR
  router.post('/local-prs/:prId/retry', async (req: Request, res: Response) => {
    try {
      const pr = localPRService.getRepo().findById(req.params.prId);
      if (!pr) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Local PR not found' } });
        return;
      }
      if (pr.executionState !== 'failed') {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_STATE', message: `PR is not failed (current state: ${pr.executionState})` },
        });
        return;
      }
      // Reset to queued so the scheduler picks it up
      localPRService.getRepo().update(pr.id, {
        executionState: 'queued',
        executionError: undefined,
      });
      res.json({ success: true, data: localPRService.getRepo().findById(pr.id) } as ApiResponse<LocalPR>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to retry';
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message } });
    }
  });

  // POST /api/local-prs/:prId/resolve-conflict — manually trigger AI conflict resolver
  router.post('/local-prs/:prId/resolve-conflict', async (req: Request, res: Response) => {
    try {
      const pr = localPRService.getRepo().findById(req.params.prId);
      if (!pr) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Local PR not found' } });
        return;
      }
      await localPRService.triggerConflictResolution(pr.id);
      res.json({ success: true, data: localPRService.getRepo().findById(pr.id) } as ApiResponse<LocalPR>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to trigger conflict resolution';
      const status =
        message.includes('Cannot resolve conflict in status') ? 400
          : message.includes('No provider available') ? 400
            : 500;
      res.status(status).json({ success: false, error: { code: 'INTERNAL_ERROR', message } });
    }
  });

  // POST /api/local-prs/:prId/reopen — reopen a closed PR
  router.post('/local-prs/:prId/reopen', async (req: Request, res: Response) => {
    try {
      const pr = localPRService.getRepo().findById(req.params.prId);
      if (!pr) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Local PR not found' } });
        return;
      }
      await localPRService.reopenPR(pr.id);
      res.json({ success: true, data: localPRService.getRepo().findById(pr.id) } as ApiResponse<LocalPR>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reopen PR';
      const status = message.includes('Cannot reopen PR in status') ? 400 : 500;
      res.status(status).json({ success: false, error: { code: 'INTERNAL_ERROR', message } });
    }
  });

  // POST /api/local-prs/:prId/revert-merge — rollback a merged PR
  router.post('/local-prs/:prId/revert-merge', async (req: Request, res: Response) => {
    try {
      const pr = localPRService.getRepo().findById(req.params.prId);
      if (!pr) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Local PR not found' } });
        return;
      }
      await localPRService.revertMergedPR(pr.id);
      res.json({ success: true, data: localPRService.getRepo().findById(pr.id) } as ApiResponse<LocalPR>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to revert merged PR';
      const status =
        message.includes('Cannot revert PR in status') ? 400
          : message.includes('Main worktree is dirty') ? 409
            : 500;
      res.status(status).json({ success: false, error: { code: 'INTERNAL_ERROR', message } });
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

  // GET /api/projects/:projectId/worktree-configs
  router.get('/projects/:projectId/worktree-configs', (req: Request, res: Response) => {
    try {
      const configs = wtConfigRepo.findByProjectId(req.params.projectId);
      res.json({ success: true, data: configs } as ApiResponse<WorktreeConfig[]>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list worktree configs';
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message } });
    }
  });

  // PUT /api/projects/:projectId/worktree-configs — upsert a worktree config
  router.put('/projects/:projectId/worktree-configs', (req: Request, res: Response) => {
    try {
      const { worktreePath, autoCreatePR, autoReview } = req.body;
      if (!worktreePath) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'worktreePath is required' },
        });
        return;
      }
      const config = wtConfigRepo.upsert({
        projectId: req.params.projectId,
        worktreePath,
        autoCreatePR: autoCreatePR ?? false,
        autoReview: autoReview ?? false,
      });
      res.json({ success: true, data: config } as ApiResponse<WorktreeConfig>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update worktree config';
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message } });
    }
  });

  return router;
}
