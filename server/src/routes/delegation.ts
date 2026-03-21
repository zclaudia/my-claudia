import { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { getDelegationConfig, saveDelegationConfig } from '../agent/delegation-evaluator.js';
import { DEFAULT_DELEGATION_CONFIG } from '@my-claudia/shared';

export function createDelegationRoutes(db: Database.Database): Router {
  const router = Router();

  // GET /api/delegation/config
  router.get('/config', (_req: Request, res: Response) => {
    try {
      const config = getDelegationConfig(db);
      res.json({ success: true, data: config });
    } catch (error) {
      console.error('Error fetching delegation config:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch delegation config' } });
    }
  });

  // PUT /api/delegation/config
  router.put('/config', (req: Request, res: Response) => {
    try {
      const current = getDelegationConfig(db);
      const updated = { ...current, ...req.body };
      // Validate
      if (typeof updated.enabled !== 'boolean') updated.enabled = DEFAULT_DELEGATION_CONFIG.enabled;
      if (typeof updated.confidenceThreshold !== 'number' || updated.confidenceThreshold < 0 || updated.confidenceThreshold > 1) {
        updated.confidenceThreshold = DEFAULT_DELEGATION_CONFIG.confidenceThreshold;
      }
      if (!Array.isArray(updated.allowedCategories)) updated.allowedCategories = DEFAULT_DELEGATION_CONFIG.allowedCategories;
      if (!Array.isArray(updated.neverDelegate)) updated.neverDelegate = DEFAULT_DELEGATION_CONFIG.neverDelegate;

      saveDelegationConfig(db, updated);
      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error updating delegation config:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update delegation config' } });
    }
  });

  return router;
}
