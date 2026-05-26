// server/src/domains/openspec/routes/bootstrap-routes.ts
import { Router, type Request, type Response } from 'express';
import express from 'express';
import type { ApiResponse } from '@my-claudia/shared/core/api';
import type { BootstrapService } from '../bootstrap-service.js';
import type { BootstrapReviewService } from '../bootstrap-review-service.js';
import { BootstrapScanRepository } from '../repositories/bootstrap-scan-repository.js';
import type { BootstrapCandidateRepository } from '../repositories/bootstrap-candidate-repository.js';
import type { Database } from 'better-sqlite3';

const ok = <T>(data: T): ApiResponse<T> => ({ success: true, data });
const err = (code: string, message: string): ApiResponse<never> => ({
  success: false,
  error: { code, message },
});

export interface BootstrapRoutesDeps {
  db: Database;
  bootstrapService: BootstrapService;
  reviewService: BootstrapReviewService;
  candidateRepo: BootstrapCandidateRepository;
  scanRepo: BootstrapScanRepository;
}

export function createBootstrapRoutes(deps: BootstrapRoutesDeps): Router {
  const router = Router();
  router.use(express.json());
  const scanRepo = deps.scanRepo ?? new BootstrapScanRepository(deps.db);
  const candidateRepo = deps.candidateRepo;

  router.post('/bootstrap/scans', async (req: Request, res: Response) => {
    const body = req.body as { projectId?: string; mode?: 'initial' | 'rescan' };
    if (!body.projectId || !body.mode) {
      res.status(400).json(err('VALIDATION', 'projectId + mode required'));
      return;
    }
    if (body.mode !== 'initial' && body.mode !== 'rescan') {
      res.status(400).json(err('VALIDATION', "mode must be 'initial' or 'rescan'"));
      return;
    }
    try {
      const result = await deps.bootstrapService.start({
        projectId: body.projectId,
        mode: body.mode,
      });
      if (body.mode === 'initial') {
        // Init mode: Phase 1 runs in the background. The picker UI loads
        // candidates via WebSocket / polling, so the response carries just
        // the scan handle — no exploreResult / summaries yet.
        res.status(201).json(ok({ scan: result.scan }));
      } else {
        // Rescan: single-phase, fully synchronous — return the full result.
        res.status(201).json(ok(result));
      }
    } catch (e) {
      res.status(400).json(err('OPENSPEC_ERROR', (e as Error).message));
    }
  });

  router.get('/bootstrap/scans', (req: Request, res: Response) => {
    const projectId = req.query.projectId as string | undefined;
    if (!projectId) {
      res.status(400).json(err('VALIDATION', 'projectId required'));
      return;
    }
    res.json(ok({ scans: scanRepo.listByProject(projectId) }));
  });

  router.get('/bootstrap/scans/:id', (req: Request, res: Response) => {
    const scan = scanRepo.findById(req.params.id);
    if (!scan) {
      res.status(404).json(err('NOT_FOUND', 'scan not found'));
      return;
    }
    res.json(ok({ scan }));
  });

  router.get('/bootstrap/scans/:id/items', (req: Request, res: Response) => {
    const filter = (req.query.status as string | undefined) ?? 'all';
    const items =
      filter === 'pending'
        ? deps.reviewService.listPending(req.params.id)
        : deps.reviewService.listAll(req.params.id);
    res.json(ok({ items }));
  });

  router.post('/bootstrap/items/:itemId/approve', (req: Request, res: Response) => {
    try {
      res.json(ok({ item: deps.reviewService.approve(req.params.itemId) }));
    } catch (e) {
      res.status(400).json(err('OPENSPEC_ERROR', (e as Error).message));
    }
  });

  router.post('/bootstrap/items/:itemId/reject', (req: Request, res: Response) => {
    try {
      res.json(ok({ item: deps.reviewService.reject(req.params.itemId) }));
    } catch (e) {
      res.status(400).json(err('OPENSPEC_ERROR', (e as Error).message));
    }
  });

  router.get('/bootstrap/scans/:id/candidates', (req: Request, res: Response) => {
    res.json(ok({ candidates: candidateRepo.listByScan(req.params.id) }));
  });

  router.post('/bootstrap/scans/:id/candidates', (req: Request, res: Response) => {
    const body = req.body as { name?: string; description?: string };
    if (!body.name || !body.description) {
      res.status(400).json(err('VALIDATION', 'name + description required'));
      return;
    }
    try {
      const candidate = deps.bootstrapService.addCandidate(req.params.id, {
        name: body.name,
        description: body.description,
      });
      res.status(201).json(ok({ candidate }));
    } catch (e) {
      res.status(400).json(err('OPENSPEC_ERROR', (e as Error).message));
    }
  });

  router.patch('/bootstrap/candidates/:id', (req: Request, res: Response) => {
    const patch = req.body as {
      title?: string;
      description?: string;
      selected?: boolean;
    };
    try {
      const candidate = deps.bootstrapService.patchCandidate(req.params.id, patch);
      res.json(ok({ candidate }));
    } catch (e) {
      res.status(400).json(err('OPENSPEC_ERROR', (e as Error).message));
    }
  });

  router.delete('/bootstrap/candidates/:id', (req: Request, res: Response) => {
    try {
      deps.bootstrapService.removeCandidate(req.params.id);
      res.json(ok({ ok: true }));
    } catch (e) {
      res.status(400).json(err('OPENSPEC_ERROR', (e as Error).message));
    }
  });

  router.post('/bootstrap/scans/:id/generate', async (req: Request, res: Response) => {
    try {
      await deps.bootstrapService.commitGeneration(req.params.id);
      const scan = scanRepo.findById(req.params.id);
      const candidates = candidateRepo.listByScan(req.params.id);
      res.json(ok({ scan, candidates }));
    } catch (e) {
      res.status(400).json(err('OPENSPEC_ERROR', (e as Error).message));
    }
  });

  router.post('/bootstrap/candidates/:id/approve', (req: Request, res: Response) => {
    try {
      const candidate = deps.bootstrapService.approveCandidate(req.params.id);
      res.json(ok({ candidate }));
    } catch (e) {
      res.status(400).json(err('OPENSPEC_ERROR', (e as Error).message));
    }
  });

  router.post('/bootstrap/candidates/:id/reject', (req: Request, res: Response) => {
    try {
      const candidate = deps.bootstrapService.rejectCandidate(req.params.id);
      res.json(ok({ candidate }));
    } catch (e) {
      res.status(400).json(err('OPENSPEC_ERROR', (e as Error).message));
    }
  });

  router.post('/bootstrap/candidates/:id/retry', async (req: Request, res: Response) => {
    try {
      const candidate = await deps.bootstrapService.retryCandidate(req.params.id);
      res.json(ok({ candidate }));
    } catch (e) {
      res.status(400).json(err('OPENSPEC_ERROR', (e as Error).message));
    }
  });

  router.post('/bootstrap/scans/:id/cancel', (req: Request, res: Response) => {
    try {
      const scan = deps.bootstrapService.cancelScan(req.params.id);
      res.json(ok({ scan }));
    } catch (e) {
      const message = (e as Error).message;
      const status = message.includes('not found') ? 404 : 400;
      res
        .status(status)
        .json(err(status === 404 ? 'NOT_FOUND' : 'OPENSPEC_ERROR', message));
    }
  });

  router.post('/bootstrap/scans/:id/finalize', async (req: Request, res: Response) => {
    try {
      const result = await deps.reviewService.finalize(req.params.id);
      if (!result) {
        res.status(409).json(err('CONFLICT', 'pending items remain; finalize aborted'));
        return;
      }
      res.json(ok(result));
    } catch (e) {
      res.status(400).json(err('OPENSPEC_ERROR', (e as Error).message));
    }
  });

  return router;
}
