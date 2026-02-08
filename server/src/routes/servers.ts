import { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import type { BackendServer, ApiResponse } from '@my-claudia/shared';

export function createServerRoutes(db: Database.Database): Router {
  const router = Router();

  // Get all servers
  router.get('/', (_req: Request, res: Response) => {
    try {
      const servers = db.prepare(`
        SELECT id, name, address, connection_mode as connectionMode,
               api_key as apiKey, client_id as clientId,
               is_default as isDefault, requires_auth as requiresAuth,
               created_at as createdAt, updated_at as updatedAt, last_connected as lastConnected
        FROM servers
        ORDER BY is_default DESC, updated_at DESC
      `).all() as Array<Omit<BackendServer, 'isDefault' | 'requiresAuth'> & { isDefault: number; requiresAuth: number }>;

      const result: BackendServer[] = servers.map(s => ({
        ...s,
        isDefault: s.isDefault === 1,
        requiresAuth: s.requiresAuth === 1
      }));

      res.json({ success: true, data: result } as ApiResponse<BackendServer[]>);
    } catch (error) {
      console.error('Error fetching servers:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch servers' }
      });
    }
  });

  // Get single server
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const server = db.prepare(`
        SELECT id, name, address, connection_mode as connectionMode,
               api_key as apiKey, client_id as clientId,
               is_default as isDefault, requires_auth as requiresAuth,
               created_at as createdAt, updated_at as updatedAt, last_connected as lastConnected
        FROM servers WHERE id = ?
      `).get(req.params.id) as (Omit<BackendServer, 'isDefault' | 'requiresAuth'> & { isDefault: number; requiresAuth: number }) | undefined;

      if (!server) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Server not found' }
        });
        return;
      }

      res.json({
        success: true,
        data: {
          ...server,
          isDefault: server.isDefault === 1,
          requiresAuth: server.requiresAuth === 1
        }
      } as ApiResponse<BackendServer>);
    } catch (error) {
      console.error('Error fetching server:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch server' }
      });
    }
  });

  // Create server
  router.post('/', (req: Request, res: Response) => {
    try {
      const { name, address, clientId, isDefault } = req.body;

      if (!name || !address) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Name and address are required' }
        });
        return;
      }

      const id = `server_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const now = Date.now();

      // If this server is set as default, unset other defaults
      if (isDefault) {
        db.prepare('UPDATE servers SET is_default = 0').run();
      }

      db.prepare(`
        INSERT INTO servers (
          id, name, address, connection_mode,
          api_key, client_id, is_default, requires_auth,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        name,
        address,
        'direct',
        null,  // api_key (deprecated)
        clientId || null,
        isDefault ? 1 : 0,
        0,  // requires_auth (deprecated)
        now,
        now
      );

      const server: BackendServer = {
        id,
        name,
        address,
        clientId,
        isDefault: isDefault || false,
        createdAt: now
      };

      res.status(201).json({ success: true, data: server } as ApiResponse<BackendServer>);
    } catch (error) {
      console.error('Error creating server:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to create server' }
      });
    }
  });

  // Update server
  router.put('/:id', (req: Request, res: Response) => {
    try {
      const { name, address, clientId, isDefault, lastConnected } = req.body;
      const now = Date.now();

      // If this server is set as default, unset other defaults
      if (isDefault) {
        db.prepare('UPDATE servers SET is_default = 0 WHERE id != ?').run(req.params.id);
      }

      // Build dynamic update query
      const updates: string[] = [];
      const values: any[] = [];

      if (name !== undefined) { updates.push('name = ?'); values.push(name); }
      if (address !== undefined) { updates.push('address = ?'); values.push(address); }
      if (clientId !== undefined) { updates.push('client_id = ?'); values.push(clientId || null); }
      if (isDefault !== undefined) { updates.push('is_default = ?'); values.push(isDefault ? 1 : 0); }
      if (lastConnected !== undefined) { updates.push('last_connected = ?'); values.push(lastConnected); }

      updates.push('updated_at = ?');
      values.push(now);
      values.push(req.params.id);

      const result = db.prepare(`
        UPDATE servers
        SET ${updates.join(', ')}
        WHERE id = ?
      `).run(...values);

      if (result.changes === 0) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Server not found' }
        });
        return;
      }

      res.json({ success: true } as ApiResponse<void>);
    } catch (error) {
      console.error('Error updating server:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to update server' }
      });
    }
  });

  // Delete server
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      // Don't allow deleting the default local server
      if (req.params.id === 'local') {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Cannot delete the default local server' }
        });
        return;
      }

      const result = db.prepare('DELETE FROM servers WHERE id = ?').run(req.params.id);

      if (result.changes === 0) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Server not found' }
        });
        return;
      }

      res.json({ success: true } as ApiResponse<void>);
    } catch (error) {
      console.error('Error deleting server:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to delete server' }
      });
    }
  });

  return router;
}
