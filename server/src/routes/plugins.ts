/**
 * Plugin Management API Routes
 *
 * Provides HTTP endpoints for managing plugins: listing, activating,
 * deactivating, and managing permissions.
 */

import { Router, Request, Response } from 'express';
import { pluginLoader } from '../plugins/loader.js';
import { permissionManager } from '../plugins/permissions.js';
import { toolRegistry } from '../plugins/tool-registry.js';
import { commandRegistry } from '../commands/registry.js';
import type { Permission } from '@my-claudia/shared';

export function createPluginRoutes(): Router {
  const router = Router();

  /**
   * GET /api/plugins
   * List all discovered plugins with their status and permissions.
   */
  router.get('/', (_req: Request, res: Response) => {
    const plugins = pluginLoader.getPlugins().map(p => ({
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description,
      author: p.manifest.author,
      status: p.isActive ? 'active' : p.error ? 'error' : 'inactive',
      enabled: p.isActive,
      error: p.error,
      permissions: p.manifest.permissions || [],
      grantedPermissions: permissionManager.getGrantedPermissions(p.manifest.id),
      pendingPermissions: p.pendingPermissions || [],
      tools: toolRegistry.getByPlugin(p.manifest.id).map(t => t.definition.function.name),
      commands: commandRegistry.getByPlugin(p.manifest.id).map(c => c.command),
      path: p.path,
    }));
    res.json({ success: true, data: plugins });
  });

  /**
   * POST /api/plugins/:id/activate
   * Activate a plugin by ID.
   */
  router.post('/:id/activate', async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!pluginLoader.hasPlugin(id)) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Plugin not found: ${id}` } });
      return;
    }

    try {
      const result = await pluginLoader.activate(id);
      if (result) {
        res.json({ success: true, data: { activated: true } });
      } else {
        const plugin = pluginLoader.getPlugin(id);
        res.status(400).json({
          success: false,
          error: { code: 'ACTIVATION_FAILED', message: plugin?.error || 'Activation failed' },
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  /**
   * POST /api/plugins/:id/deactivate
   * Deactivate a plugin by ID.
   */
  router.post('/:id/deactivate', async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!pluginLoader.hasPlugin(id)) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Plugin not found: ${id}` } });
      return;
    }

    try {
      await pluginLoader.deactivate(id);
      res.json({ success: true, data: { deactivated: true } });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  /**
   * POST /api/plugins/:id/permissions/grant
   * Grant permissions to a plugin.
   */
  router.post('/:id/permissions/grant', (req: Request, res: Response) => {
    const { id } = req.params;
    const { permissions } = req.body;

    if (!permissions || !Array.isArray(permissions)) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'permissions array required' } });
      return;
    }

    permissionManager.grantAll(id, permissions as Permission[]);
    res.json({ success: true, data: { granted: permissions } });
  });

  /**
   * POST /api/plugins/:id/permissions/revoke
   * Revoke permissions from a plugin.
   */
  router.post('/:id/permissions/revoke', (req: Request, res: Response) => {
    const { id } = req.params;
    const { permissions } = req.body;

    if (!permissions || !Array.isArray(permissions)) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'permissions array required' } });
      return;
    }

    for (const perm of permissions) {
      permissionManager.revoke(id, perm as Permission);
    }
    res.json({ success: true, data: { revoked: permissions } });
  });

  return router;
}
