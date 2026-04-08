import { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { PROVIDER_TYPES } from '@my-claudia/shared/core/provider';
import type { ProviderConfig } from '@my-claudia/shared/core/provider';
import type { ApiResponse } from '@my-claudia/shared/core/api';
import { ProviderRepository } from './repository.js';
import { ProviderDeletionService, ProviderNotFoundError } from './provider-deletion-service.js';
import { mountCapabilityRoutes } from '../../interfaces/http/provider-capabilities.js';
import { mountCommandRoutes } from '../../interfaces/http/provider-commands.js';

const VALID_PROVIDER_TYPES = [...PROVIDER_TYPES] as ProviderConfig['type'][];

interface ToolRegistryPort {
  getDefinitionsBySource(source: string): unknown[];
}

export function createProviderRoutes(db: Database.Database, toolRegistry?: ToolRegistryPort): Router {
  const router = Router();
  const repo = new ProviderRepository(db);
  const deletionService = new ProviderDeletionService(db);

  router.get('/', (_req: Request, res: Response) => {
    try {
      res.json({ success: true, data: repo.findAllOrdered() } as ApiResponse<ProviderConfig[]>);
    } catch (error) {
      console.error('Error fetching providers:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch providers' },
      });
    }
  });

  router.get('/:id', (req: Request, res: Response) => {
    try {
      const provider = repo.findById(req.params.id);

      if (!provider) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Provider not found' },
        });
        return;
      }

      res.json({
        success: true,
        data: provider,
      } as ApiResponse<ProviderConfig>);
    } catch (error) {
      console.error('Error fetching provider:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch provider' },
      });
    }
  });

  router.post('/', (req: Request, res: Response) => {
    try {
      const { name, type = 'claude', cliPath, env, isDefault } = req.body;

      if (!name) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Name is required' },
        });
        return;
      }

      if (type && !VALID_PROVIDER_TYPES.includes(type as ProviderConfig['type'])) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: `Invalid provider type. Must be one of: ${VALID_PROVIDER_TYPES.join(', ')}` },
        });
        return;
      }

      if (isDefault) {
        repo.clearAllDefaults();
      }

      const provider = repo.create({
        name,
        type,
        cliPath,
        env,
        isDefault: Boolean(isDefault),
      });

      res.status(201).json({ success: true, data: provider } as ApiResponse<ProviderConfig>);
    } catch (error) {
      console.error('Error creating provider:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to create provider' },
      });
    }
  });

  router.put('/:id', (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};

      if (body.type && !VALID_PROVIDER_TYPES.includes(body.type as ProviderConfig['type'])) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: `Invalid provider type. Must be one of: ${VALID_PROVIDER_TYPES.join(', ')}` },
        });
        return;
      }

      if (body.isDefault === true) {
        repo.clearDefaultsExcept(req.params.id);
      }

      const patch: Partial<ProviderConfig> = {};
      if (Object.prototype.hasOwnProperty.call(body, 'name')) patch.name = body.name ?? null;
      if (Object.prototype.hasOwnProperty.call(body, 'type')) patch.type = body.type ?? null;
      if (Object.prototype.hasOwnProperty.call(body, 'cliPath')) patch.cliPath = body.cliPath ?? null;
      if (Object.prototype.hasOwnProperty.call(body, 'env')) patch.env = body.env ?? null;
      if (Object.prototype.hasOwnProperty.call(body, 'isDefault')) patch.isDefault = Boolean(body.isDefault);

      try {
        repo.update(req.params.id, patch);
      } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
          res.status(404).json({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Provider not found' },
          });
          return;
        }
        throw error;
      }

      res.json({ success: true } as ApiResponse<void>);
    } catch (error) {
      console.error('Error updating provider:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to update provider' },
      });
    }
  });

  router.delete('/:id', (req: Request, res: Response) => {
    try {
      deletionService.deleteProvider(req.params.id);
      res.json({ success: true } as ApiResponse<void>);
    } catch (error) {
      if (error instanceof ProviderNotFoundError) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Provider not found' },
        });
        return;
      }
      console.error('Error deleting provider:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to delete provider' },
      });
    }
  });

  mountCommandRoutes(router, db);

  router.post('/:id/set-default', (req: Request, res: Response) => {
    try {
      if (!repo.findById(req.params.id)) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Provider not found' },
        });
        return;
      }

      res.json({ success: true, data: repo.setDefault(req.params.id) } as ApiResponse<ProviderConfig>);
    } catch (error) {
      console.error('Error setting default provider:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to set default provider' },
      });
    }
  });

  mountCapabilityRoutes(router, db);

  router.get('/plugin-tools', (_req: Request, res: Response) => {
    try {
      const pluginTools = toolRegistry?.getDefinitionsBySource('plugin') ?? [];
      res.json({ success: true, data: pluginTools });
    } catch (error) {
      console.error('Error fetching plugin tools:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch plugin tools' },
      });
    }
  });

  return router;
}
