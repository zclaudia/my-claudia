import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPluginRoutes } from '../plugins.js';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  default: { existsSync: vi.fn() },
}));

// Mock pluginLoader
vi.mock('../../plugins/loader.js', () => ({
  pluginLoader: {
    getPlugins: vi.fn(() => []),
    getPlugin: vi.fn(),
    hasPlugin: vi.fn(),
    activate: vi.fn(),
    deactivate: vi.fn(),
    discover: vi.fn(),
    remove: vi.fn(),
  },
}));

// Mock permissionManager
vi.mock('../../plugins/permissions.js', () => ({
  permissionManager: {
    getGrantedPermissions: vi.fn(() => []),
    grantAll: vi.fn(),
    revoke: vi.fn(),
  },
}));

// Mock toolRegistry
vi.mock('../../plugins/tool-registry.js', () => ({
  toolRegistry: {
    getByPlugin: vi.fn(() => []),
  },
}));

// Mock commandRegistry
vi.mock('../../commands/registry.js', () => ({
  commandRegistry: {
    getByPlugin: vi.fn(() => []),
  },
}));

import * as fs from 'fs';
import { pluginLoader } from '../../plugins/loader.js';
import { permissionManager } from '../../plugins/permissions.js';
import { toolRegistry } from '../../plugins/tool-registry.js';
import { commandRegistry } from '../../commands/registry.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/plugins', createPluginRoutes());
  return app;
}

describe('plugin routes', () => {
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  describe('GET /api/plugins', () => {
    it('returns empty list when no plugins', async () => {
      vi.mocked(pluginLoader.getPlugins).mockReturnValue([]);

      const res = await request(app).get('/api/plugins');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: [] });
    });

    it('returns plugin list with full details', async () => {
      vi.mocked(pluginLoader.getPlugins).mockReturnValue([
        {
          manifest: {
            id: 'test-plugin',
            name: 'Test Plugin',
            version: '1.0.0',
            description: 'A test plugin',
            author: 'Test Author',
            permissions: ['fs:read'],
          },
          isActive: true,
          error: undefined,
          pendingPermissions: [],
          path: '/plugins/test-plugin',
        },
      ] as any);
      vi.mocked(permissionManager.getGrantedPermissions).mockReturnValue(['fs:read'] as any);
      vi.mocked(toolRegistry.getByPlugin).mockReturnValue([
        { definition: { function: { name: 'tool1' } } },
      ] as any);
      vi.mocked(commandRegistry.getByPlugin).mockReturnValue([
        { command: '/test-cmd' },
      ] as any);

      const res = await request(app).get('/api/plugins');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      const plugin = res.body.data[0];
      expect(plugin.id).toBe('test-plugin');
      expect(plugin.name).toBe('Test Plugin');
      expect(plugin.version).toBe('1.0.0');
      expect(plugin.description).toBe('A test plugin');
      expect(plugin.author).toBe('Test Author');
      expect(plugin.status).toBe('active');
      expect(plugin.enabled).toBe(true);
      expect(plugin.permissions).toEqual(['fs:read']);
      expect(plugin.grantedPermissions).toEqual(['fs:read']);
      expect(plugin.tools).toEqual(['tool1']);
      expect(plugin.commands).toEqual(['/test-cmd']);
      expect(plugin.path).toBe('/plugins/test-plugin');
    });

    it('returns status "inactive" for inactive plugin without error', async () => {
      vi.mocked(pluginLoader.getPlugins).mockReturnValue([
        {
          manifest: { id: 'p1', name: 'P1', version: '1.0.0', description: '', author: '' },
          isActive: false,
          error: undefined,
          pendingPermissions: [],
          path: '/plugins/p1',
        },
      ] as any);

      const res = await request(app).get('/api/plugins');

      expect(res.body.data[0].status).toBe('inactive');
      expect(res.body.data[0].enabled).toBe(false);
    });

    it('returns status "error" for plugin with error', async () => {
      vi.mocked(pluginLoader.getPlugins).mockReturnValue([
        {
          manifest: { id: 'p1', name: 'P1', version: '1.0.0', description: '', author: '' },
          isActive: false,
          error: 'Failed to load',
          pendingPermissions: ['fs:write'],
          path: '/plugins/p1',
        },
      ] as any);

      const res = await request(app).get('/api/plugins');

      expect(res.body.data[0].status).toBe('error');
      expect(res.body.data[0].error).toBe('Failed to load');
      expect(res.body.data[0].pendingPermissions).toEqual(['fs:write']);
    });
  });

  describe('POST /api/plugins/:id/activate', () => {
    it('returns 404 when plugin not found', async () => {
      vi.mocked(pluginLoader.hasPlugin).mockReturnValue(false);

      const res = await request(app).post('/api/plugins/nonexistent/activate');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.message).toContain('nonexistent');
    });

    it('activates plugin successfully', async () => {
      vi.mocked(pluginLoader.hasPlugin).mockReturnValue(true);
      vi.mocked(pluginLoader.activate).mockResolvedValue(true);

      const res = await request(app).post('/api/plugins/test-plugin/activate');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { activated: true } });
      expect(pluginLoader.activate).toHaveBeenCalledWith('test-plugin');
    });

    it('returns 400 when activation fails', async () => {
      vi.mocked(pluginLoader.hasPlugin).mockReturnValue(true);
      vi.mocked(pluginLoader.activate).mockResolvedValue(false);
      vi.mocked(pluginLoader.getPlugin).mockReturnValue({ error: 'Missing dependency' } as any);

      const res = await request(app).post('/api/plugins/test-plugin/activate');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ACTIVATION_FAILED');
      expect(res.body.error.message).toBe('Missing dependency');
    });

    it('returns 400 with fallback message when activation fails and no error on plugin', async () => {
      vi.mocked(pluginLoader.hasPlugin).mockReturnValue(true);
      vi.mocked(pluginLoader.activate).mockResolvedValue(false);
      vi.mocked(pluginLoader.getPlugin).mockReturnValue({ error: undefined } as any);

      const res = await request(app).post('/api/plugins/test-plugin/activate');

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Activation failed');
    });

    it('returns 500 when activation throws', async () => {
      vi.mocked(pluginLoader.hasPlugin).mockReturnValue(true);
      vi.mocked(pluginLoader.activate).mockRejectedValue(new Error('Boom'));

      const res = await request(app).post('/api/plugins/test-plugin/activate');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.message).toBe('Boom');
    });

    it('returns 500 with stringified error for non-Error throws', async () => {
      vi.mocked(pluginLoader.hasPlugin).mockReturnValue(true);
      vi.mocked(pluginLoader.activate).mockRejectedValue('string error');

      const res = await request(app).post('/api/plugins/test-plugin/activate');

      expect(res.status).toBe(500);
      expect(res.body.error.message).toBe('string error');
    });
  });

  describe('POST /api/plugins/:id/deactivate', () => {
    it('returns 404 when plugin not found', async () => {
      vi.mocked(pluginLoader.hasPlugin).mockReturnValue(false);

      const res = await request(app).post('/api/plugins/nonexistent/deactivate');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('deactivates plugin successfully', async () => {
      vi.mocked(pluginLoader.hasPlugin).mockReturnValue(true);
      vi.mocked(pluginLoader.deactivate).mockResolvedValue(undefined);

      const res = await request(app).post('/api/plugins/test-plugin/deactivate');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { deactivated: true } });
      expect(pluginLoader.deactivate).toHaveBeenCalledWith('test-plugin');
    });

    it('returns 500 when deactivation throws', async () => {
      vi.mocked(pluginLoader.hasPlugin).mockReturnValue(true);
      vi.mocked(pluginLoader.deactivate).mockRejectedValue(new Error('Deactivation error'));

      const res = await request(app).post('/api/plugins/test-plugin/deactivate');

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.message).toBe('Deactivation error');
    });

    it('returns 500 with stringified error for non-Error throws', async () => {
      vi.mocked(pluginLoader.hasPlugin).mockReturnValue(true);
      vi.mocked(pluginLoader.deactivate).mockRejectedValue(42);

      const res = await request(app).post('/api/plugins/test-plugin/deactivate');

      expect(res.status).toBe(500);
      expect(res.body.error.message).toBe('42');
    });
  });

  describe('POST /api/plugins/:id/permissions/grant', () => {
    it('returns 400 when permissions not provided', async () => {
      const res = await request(app)
        .post('/api/plugins/test-plugin/permissions/grant')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('permissions array required');
    });

    it('returns 400 when permissions is not an array', async () => {
      const res = await request(app)
        .post('/api/plugins/test-plugin/permissions/grant')
        .send({ permissions: 'fs:read' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('grants permissions successfully', async () => {
      const perms = ['fs:read', 'net:fetch'];
      const res = await request(app)
        .post('/api/plugins/test-plugin/permissions/grant')
        .send({ permissions: perms });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { granted: perms } });
      expect(permissionManager.grantAll).toHaveBeenCalledWith('test-plugin', perms);
    });
  });

  describe('POST /api/plugins/:id/permissions/revoke', () => {
    it('returns 400 when permissions not provided', async () => {
      const res = await request(app)
        .post('/api/plugins/test-plugin/permissions/revoke')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when permissions is not an array', async () => {
      const res = await request(app)
        .post('/api/plugins/test-plugin/permissions/revoke')
        .send({ permissions: 123 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('revokes permissions successfully', async () => {
      const perms = ['fs:read', 'net:fetch'];
      const res = await request(app)
        .post('/api/plugins/test-plugin/permissions/revoke')
        .send({ permissions: perms });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { revoked: perms } });
      expect(permissionManager.revoke).toHaveBeenCalledTimes(2);
      expect(permissionManager.revoke).toHaveBeenCalledWith('test-plugin', 'fs:read');
      expect(permissionManager.revoke).toHaveBeenCalledWith('test-plugin', 'net:fetch');
    });
  });

  describe('POST /api/plugins/discover', () => {
    it('discovers plugins successfully', async () => {
      vi.mocked(pluginLoader.discover).mockResolvedValue([
        { id: 'plugin-a', name: 'Plugin A', version: '1.0.0' },
        { id: 'plugin-b', name: 'Plugin B', version: '2.0.0' },
      ] as any);

      const res = await request(app).post('/api/plugins/discover');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.discovered).toBe(2);
      expect(res.body.data.plugins).toEqual([
        { id: 'plugin-a', name: 'Plugin A', version: '1.0.0' },
        { id: 'plugin-b', name: 'Plugin B', version: '2.0.0' },
      ]);
    });

    it('returns empty list when no plugins discovered', async () => {
      vi.mocked(pluginLoader.discover).mockResolvedValue([]);

      const res = await request(app).post('/api/plugins/discover');

      expect(res.status).toBe(200);
      expect(res.body.data.discovered).toBe(0);
      expect(res.body.data.plugins).toEqual([]);
    });

    it('returns 500 when discover throws', async () => {
      vi.mocked(pluginLoader.discover).mockRejectedValue(new Error('Scan failed'));

      const res = await request(app).post('/api/plugins/discover');

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.message).toBe('Scan failed');
    });
  });

  describe('GET /api/plugins/styles/claudia-ui.css', () => {
    it('returns CSS with correct content-type', async () => {
      const res = await request(app).get('/api/plugins/styles/claudia-ui.css');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/css');
      expect(res.text).toContain(':root');
      expect(res.text).toContain('.dark');
      expect(res.text).toContain('--background');
      expect(res.text).toContain('--primary');
    });
  });

  describe('GET /api/plugins/styles/plugin-sdk.js', () => {
    it('returns JS with correct content-type', async () => {
      const res = await request(app).get('/api/plugins/styles/plugin-sdk.js');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/javascript');
      expect(res.text).toContain('ClaudiaSDK');
      expect(res.text).toContain('claudia:ready');
      expect(res.text).toContain('window.ClaudiaSDK');
    });
  });

  describe('GET /api/plugins/:id/frontend/*', () => {
    it('returns 400 for invalid plugin ID with special characters', async () => {
      // IDs with special chars like slashes or spaces fail the regex check
      // Express normalizes ../../ so we test with an ID containing invalid chars
      vi.mocked(pluginLoader.getPlugin).mockReturnValue({ path: '/plugins/bad' } as any);

      const res = await request(app).get('/api/plugins/bad%20plugin/frontend/index.html');

      expect(res.status).toBe(400);
    });

    it('returns 404 when plugin not found', async () => {
      vi.mocked(pluginLoader.getPlugin).mockReturnValue(undefined as any);

      const res = await request(app).get('/api/plugins/valid-plugin/frontend/index.html');

      expect(res.status).toBe(404);
    });

    it('returns 404 for path traversal attempt (Express normalizes before routing)', async () => {
      // Express normalizes .. sequences before routing, so traversal attempts
      // are caught by Express itself and result in 404 (no matching route).
      // The path traversal guard in the source is defense-in-depth.
      vi.mocked(pluginLoader.getPlugin).mockReturnValue({
        path: '/plugins/test-plugin',
      } as any);

      const res = await request(app).get('/api/plugins/test-plugin/frontend/../../etc/passwd');

      // Express normalizes the URL so the route doesn't even match /:id/frontend/*
      expect(res.status).toBe(404);
    });

    it('returns 404 when file does not exist', async () => {
      vi.mocked(pluginLoader.getPlugin).mockReturnValue({
        path: '/plugins/test-plugin',
      } as any);
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const res = await request(app).get('/api/plugins/test-plugin/frontend/missing.html');

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/plugins/:id', () => {
    it('returns 404 when plugin not found', async () => {
      vi.mocked(pluginLoader.hasPlugin).mockReturnValue(false);

      const res = await request(app).delete('/api/plugins/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('removes plugin successfully', async () => {
      vi.mocked(pluginLoader.hasPlugin).mockReturnValue(true);
      vi.mocked(pluginLoader.remove).mockResolvedValue(undefined);

      const res = await request(app).delete('/api/plugins/test-plugin');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { removed: true } });
      expect(pluginLoader.remove).toHaveBeenCalledWith('test-plugin');
    });

    it('returns 500 when remove throws', async () => {
      vi.mocked(pluginLoader.hasPlugin).mockReturnValue(true);
      vi.mocked(pluginLoader.remove).mockRejectedValue(new Error('Remove failed'));

      const res = await request(app).delete('/api/plugins/test-plugin');

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.message).toBe('Remove failed');
    });

    it('returns 500 with stringified error for non-Error throws', async () => {
      vi.mocked(pluginLoader.hasPlugin).mockReturnValue(true);
      vi.mocked(pluginLoader.remove).mockRejectedValue('oops');

      const res = await request(app).delete('/api/plugins/test-plugin');

      expect(res.status).toBe(500);
      expect(res.body.error.message).toBe('oops');
    });
  });
});
