import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import { PROVIDER_TYPES } from '@my-claudia/shared';
import type { ProviderConfig, ApiResponse } from '@my-claudia/shared';
import { toolRegistry } from '../plugins/tool-registry.js';
import { mountCapabilityRoutes } from './provider-capabilities.js';
import { mountCommandRoutes } from './provider-commands.js';

const VALID_PROVIDER_TYPES = [...PROVIDER_TYPES] as ProviderConfig['type'][];

// Database row type (different from ProviderConfig due to SQLite types)
interface ProviderRow {
  id: string;
  name: string;
  type: string;
  cliPath: string | null;
  env: string | null;
  isDefault: number;
  createdAt: number;
  updatedAt: number;
}

export function createProviderRoutes(db: Database.Database): Router {
  const router = Router();

  // Get all providers
  router.get('/', (_req: Request, res: Response) => {
    try {
      const providers = db.prepare(`
        SELECT id, name, type, cli_path as cliPath, env,
               is_default as isDefault, created_at as createdAt, updated_at as updatedAt
        FROM providers
        ORDER BY is_default DESC, name ASC
      `).all() as ProviderRow[];

      const result: ProviderConfig[] = providers.map(p => ({
        id: p.id,
        name: p.name,
        type: p.type as ProviderConfig['type'],
        cliPath: p.cliPath || undefined,
        env: p.env ? JSON.parse(p.env) : undefined,
        isDefault: p.isDefault === 1,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      }));

      res.json({ success: true, data: result } as ApiResponse<ProviderConfig[]>);
    } catch (error) {
      console.error('Error fetching providers:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch providers' }
      });
    }
  });

  // Get single provider
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const row = db.prepare(`
        SELECT id, name, type, cli_path as cliPath, env,
               is_default as isDefault, created_at as createdAt, updated_at as updatedAt
        FROM providers WHERE id = ?
      `).get(req.params.id) as ProviderRow | undefined;

      if (!row) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Provider not found' }
        });
        return;
      }

      const provider: ProviderConfig = {
        id: row.id,
        name: row.name,
        type: row.type as ProviderConfig['type'],
        cliPath: row.cliPath || undefined,
        env: row.env ? JSON.parse(row.env) : undefined,
        isDefault: row.isDefault === 1,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      };

      res.json({
        success: true,
        data: provider
      } as ApiResponse<ProviderConfig>);
    } catch (error) {
      console.error('Error fetching provider:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch provider' }
      });
    }
  });

  // Create provider
  router.post('/', (req: Request, res: Response) => {
    try {
      const { name, type = 'claude', cliPath, env, isDefault } = req.body;

      if (!name) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Name is required' }
        });
        return;
      }

      if (type && !VALID_PROVIDER_TYPES.includes(type as ProviderConfig['type'])) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: `Invalid provider type. Must be one of: ${VALID_PROVIDER_TYPES.join(', ')}` }
        });
        return;
      }

      const id = uuidv4();
      const now = Date.now();

      // If this provider is default, unset other defaults
      if (isDefault) {
        db.prepare('UPDATE providers SET is_default = 0').run();
      }

      db.prepare(`
        INSERT INTO providers (id, name, type, cli_path, env, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        name,
        type,
        cliPath || null,
        env ? JSON.stringify(env) : null,
        isDefault ? 1 : 0,
        now,
        now
      );

      const provider: ProviderConfig = {
        id,
        name,
        type,
        cliPath,
        env,
        isDefault: isDefault || false,
        createdAt: now,
        updatedAt: now
      };

      res.status(201).json({ success: true, data: provider } as ApiResponse<ProviderConfig>);
    } catch (error) {
      console.error('Error creating provider:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to create provider' }
      });
    }
  });

  // Update provider
  router.put('/:id', (req: Request, res: Response) => {
    try {
      const { name, type, cliPath, env, isDefault } = req.body;
      const now = Date.now();

      if (type && !VALID_PROVIDER_TYPES.includes(type as ProviderConfig['type'])) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: `Invalid provider type. Must be one of: ${VALID_PROVIDER_TYPES.join(', ')}` }
        });
        return;
      }

      // If this provider is becoming default, unset other defaults
      if (isDefault) {
        db.prepare('UPDATE providers SET is_default = 0 WHERE id != ?').run(req.params.id);
      }

      const result = db.prepare(`
        UPDATE providers
        SET name = COALESCE(?, name),
            type = COALESCE(?, type),
            cli_path = ?,
            env = ?,
            is_default = COALESCE(?, is_default),
            updated_at = ?
        WHERE id = ?
      `).run(
        name || null,
        type || null,
        cliPath !== undefined ? cliPath : null,
        env ? JSON.stringify(env) : null,
        isDefault !== undefined ? (isDefault ? 1 : 0) : null,
        now,
        req.params.id
      );

      if (result.changes === 0) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Provider not found' }
        });
        return;
      }

      res.json({ success: true } as ApiResponse<void>);
    } catch (error) {
      console.error('Error updating provider:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to update provider' }
      });
    }
  });

  // Delete provider
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const providerId = req.params.id;
      const existing = db.prepare('SELECT id, is_default as isDefault FROM providers WHERE id = ?')
        .get(providerId) as { id: string; isDefault: number } | undefined;

      if (!existing) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Provider not found' }
        });
        return;
      }

      const hasColumn = (table: string, column: string): boolean => {
        const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        return columns.some((col) => col.name === column);
      };

      const deleteProviderTx = db.transaction(() => {
        // Clear explicit references first to support older DB states.
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

        // Keep one default provider if any provider remains.
        if (existing.isDefault === 1) {
          const replacement = db.prepare(`
            SELECT id FROM providers
            ORDER BY created_at ASC
            LIMIT 1
          `).get() as { id: string } | undefined;
          if (replacement) {
            db.prepare('UPDATE providers SET is_default = 1 WHERE id = ?').run(replacement.id);
          }
        }
      });

      deleteProviderTx();

      res.json({ success: true } as ApiResponse<void>);
    } catch (error) {
      console.error('Error deleting provider:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to delete provider' }
      });
    }
  });


  // Mount command routes (get commands by provider ID and by type)
  mountCommandRoutes(router, db);

  // Set provider as default
  router.post('/:id/set-default', (req: Request, res: Response) => {
    try {
      // Verify provider exists
      const provider = db.prepare('SELECT id FROM providers WHERE id = ?').get(req.params.id);
      if (!provider) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Provider not found' }
        });
        return;
      }

      // Clear existing defaults
      db.prepare('UPDATE providers SET is_default = 0 WHERE is_default = 1').run();

      // Set new default
      const now = Date.now();
      db.prepare('UPDATE providers SET is_default = 1, updated_at = ? WHERE id = ?')
        .run(now, req.params.id);

      // Return updated provider
      const updated = db.prepare(`
        SELECT id, name, type, cli_path as cliPath, env,
               CASE WHEN is_default = 1 THEN 1 ELSE NULL END as isDefault,
               created_at as createdAt, updated_at as updatedAt
        FROM providers WHERE id = ?
      `).get(req.params.id) as ProviderRow | undefined;

      const mapped: ProviderConfig = {
        id: updated!.id,
        name: updated!.name,
        type: updated!.type as ProviderConfig['type'],
        cliPath: updated!.cliPath || undefined,
        env: updated!.env ? JSON.parse(updated!.env) : undefined,
        isDefault: !!updated!.isDefault,
        createdAt: updated!.createdAt,
        updatedAt: updated!.updatedAt,
      };

      res.json({ success: true, data: mapped } as ApiResponse<ProviderConfig>);
    } catch (error) {
      console.error('Error setting default provider:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to set default provider' }
      });
    }
  });

  // Mount capability routes (get capabilities by provider ID and by type)
  mountCapabilityRoutes(router, db);

  // Get plugin tools
  router.get('/plugin-tools', (_req: Request, res: Response) => {
    try {
      const pluginTools = toolRegistry.getDefinitionsBySource('plugin');
      res.json({ success: true, data: pluginTools });
    } catch (error) {
      console.error('Error fetching plugin tools:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch plugin tools' }
      });
    }
  });

  return router;
}
