import { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { PROVIDER_TYPES } from '@my-claudia/shared';
import type { ProviderConfig, ApiResponse } from '@my-claudia/shared';
import { toolRegistry } from '../plugins/index.js';
import { ProviderRepository } from './repository.js';
import { mountCapabilityRoutes } from '../../routes/provider-capabilities.js';
import { mountCommandRoutes } from '../../routes/provider-commands.js';

const VALID_PROVIDER_TYPES = [...PROVIDER_TYPES] as ProviderConfig['type'][];

export function createProviderRoutes(db: Database.Database): Router {
  const router = Router();
  const repo = new ProviderRepository(db);

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
      const providerId = req.params.id;
      const existing = repo.findById(providerId);

      if (!existing) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Provider not found' },
        });
        return;
      }

      const hasColumn = (table: string, column: string): boolean => {
        const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        return columns.some((col) => col.name === column);
      };

      const deleteProviderTx = db.transaction(() => {
        db.prepare('UPDATE projects SET provider_id = NULL WHERE provider_id = ?').run(providerId);
        db.prepare('UPDATE sessions SET provider_id = NULL WHERE provider_id = ?').run(providerId);

        if (hasColumn('projects', 'review_provider_id')) {
          db.prepare('UPDATE projects SET review_provider_id = NULL WHERE review_provider_id = ?').run(providerId);
        }
        if (hasColumn('agent_config', 'provider_id')) {
          db.prepare('UPDATE agent_config SET provider_id = NULL WHERE provider_id = ?').run(providerId);
        }

        const result = db.prepare('DELETE FROM providers WHERE id = ?').run(providerId);
        if (result.changes === 0) {
          throw new Error('Provider not found');
        }

        if (existing.isDefault) {
          const replacement = db.prepare(`
            SELECT id FROM providers
            ORDER BY created_at ASC
            LIMIT 1
          `).get() as { id: string } | undefined;
          if (replacement) {
            repo.setDefault(replacement.id);
          }
        }
      });

      deleteProviderTx();

      res.json({ success: true } as ApiResponse<void>);
    } catch (error) {
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
      const pluginTools = toolRegistry.getDefinitionsBySource('plugin');
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
