import { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { getDelegationConfig, saveDelegationConfig } from '../application/conversation/agent/delegation-evaluator.js';
import { DEFAULT_DELEGATION_CONFIG } from '@my-claudia/shared/features/delegation';
import { validateCliJobProviderId } from '../providers/cli-jobs/provider-validation.js';

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
      // Only pick known fields to prevent prototype pollution
      const body = req.body ?? {};
      const updated = {
        ...current,
        ...(body.enabled !== undefined && { enabled: body.enabled }),
        ...(body.confidenceThreshold !== undefined && { confidenceThreshold: body.confidenceThreshold }),
        ...(body.maxAutoApprovalsPerMinute !== undefined && { maxAutoApprovalsPerMinute: body.maxAutoApprovalsPerMinute }),
        ...(body.allowedCategories !== undefined && { allowedCategories: body.allowedCategories }),
        ...(body.neverDelegate !== undefined && { neverDelegate: body.neverDelegate }),
        ...(body.analysisProviderId !== undefined && { analysisProviderId: body.analysisProviderId }),
      };
      // Validate
      if (typeof updated.enabled !== 'boolean') updated.enabled = DEFAULT_DELEGATION_CONFIG.enabled;
      if (typeof updated.confidenceThreshold !== 'number' || updated.confidenceThreshold < 0 || updated.confidenceThreshold > 1) {
        updated.confidenceThreshold = DEFAULT_DELEGATION_CONFIG.confidenceThreshold;
      }
      if (!Number.isInteger(updated.maxAutoApprovalsPerMinute) || updated.maxAutoApprovalsPerMinute < 1) {
        updated.maxAutoApprovalsPerMinute = DEFAULT_DELEGATION_CONFIG.maxAutoApprovalsPerMinute;
      }
      if (!Array.isArray(updated.allowedCategories)) updated.allowedCategories = DEFAULT_DELEGATION_CONFIG.allowedCategories;
      if (!Array.isArray(updated.neverDelegate)) updated.neverDelegate = DEFAULT_DELEGATION_CONFIG.neverDelegate;
      if (updated.analysisProviderId !== undefined && typeof updated.analysisProviderId !== 'string') {
        updated.analysisProviderId = DEFAULT_DELEGATION_CONFIG.analysisProviderId;
      }
      if (typeof updated.analysisProviderId === 'string' && updated.analysisProviderId.trim() === '') {
        updated.analysisProviderId = undefined;
      }
      const providerValidationError = validateCliJobProviderId(db, updated.analysisProviderId);
      if (providerValidationError) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: providerValidationError },
        });
        return;
      }

      saveDelegationConfig(db, updated);
      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error updating delegation config:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update delegation config' } });
    }
  });

  return router;
}
