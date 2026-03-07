/**
 * Unit tests for PermissionManager
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PermissionManager, type PermissionRequest } from '../permissions.js';
import type { Permission } from '@my-claudia/shared';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Mock os module
vi.mock('os', () => ({
  homedir: vi.fn(() => '/home/test'),
}));

// Mock pluginEvents
vi.mock('../../events/index.js', () => ({
  pluginEvents: {
    emit: vi.fn(() => Promise.resolve()),
  },
}));

describe('PermissionManager', () => {
  let manager: PermissionManager;
  const testStorePath = '/home/test/.claudia/test-permissions.json';

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new PermissionManager();
    manager.setStorePath(testStorePath);

    // Reset mocks
    (fs.existsSync as any).mockReturnValue(false);
    (fs.readFileSync as any).mockReturnValue('{}');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('permission checking', () => {
    it('should return false when no permissions granted', () => {
      expect(manager.hasPermission('test-plugin', 'storage')).toBe(false);
    });

    it('should return true when permission is granted', () => {
      manager.grant('test-plugin', 'storage');
      expect(manager.hasPermission('test-plugin', 'storage')).toBe(true);
    });

    it('should return false when permission is denied', () => {
      manager.grant('test-plugin', 'storage');
      manager.deny('test-plugin', 'storage');
      expect(manager.hasPermission('test-plugin', 'storage')).toBe(false);
    });

    it('should check all permissions with hasAllPermissions', () => {
      manager.grant('test-plugin', 'storage');
      manager.grant('test-plugin', 'fs.read');

      expect(manager.hasAllPermissions('test-plugin', ['storage', 'fs.read'])).toBe(true);
      expect(manager.hasAllPermissions('test-plugin', ['storage', 'network.fetch'])).toBe(false);
    });

    it('should check any permission with hasAnyPermission', () => {
      manager.grant('test-plugin', 'storage');

      expect(manager.hasAnyPermission('test-plugin', ['storage', 'network.fetch'])).toBe(true);
      expect(manager.hasAnyPermission('test-plugin', ['fs.read', 'network.fetch'])).toBe(false);
    });
  });

  describe('permission management', () => {
    it('should grant a permission', () => {
      manager.grant('test-plugin', 'storage');

      const granted = manager.getGrantedPermissions('test-plugin');
      expect(granted).toContain('storage');
    });

    it('should not duplicate permissions when granting twice', () => {
      manager.grant('test-plugin', 'storage');
      manager.grant('test-plugin', 'storage');

      const granted = manager.getGrantedPermissions('test-plugin');
      expect(granted.filter((p) => p === 'storage')).toHaveLength(1);
    });

    it('should revoke a permission', () => {
      manager.grant('test-plugin', 'storage');
      manager.revoke('test-plugin', 'storage');

      expect(manager.hasPermission('test-plugin', 'storage')).toBe(false);
    });

    it('should deny a permission', () => {
      manager.deny('test-plugin', 'storage');

      const denied = manager.getDeniedPermissions('test-plugin');
      expect(denied).toContain('storage');
    });

    it('should remove from granted when denying', () => {
      manager.grant('test-plugin', 'storage');
      manager.deny('test-plugin', 'storage');

      expect(manager.hasPermission('test-plugin', 'storage')).toBe(false);
      expect(manager.getDeniedPermissions('test-plugin')).toContain('storage');
    });

    it('should grant multiple permissions', () => {
      manager.grantAll('test-plugin', ['storage', 'fs.read', 'network.fetch']);

      expect(manager.hasAllPermissions('test-plugin', ['storage', 'fs.read', 'network.fetch'])).toBe(true);
    });

    it('should clear all permissions for a plugin', () => {
      manager.grant('test-plugin', 'storage');
      manager.grant('test-plugin', 'fs.read');
      manager.clearPluginPermissions('test-plugin');

      expect(manager.getGrantedPermissions('test-plugin')).toHaveLength(0);
    });
  });

  describe('permission state', () => {
    it('should return empty state for unknown plugin', () => {
      const state = manager.getPermissionState('unknown-plugin');
      expect(state).toEqual({ granted: [], denied: [] });
    });

    it('should return correct state', () => {
      manager.grant('test-plugin', 'storage');
      manager.grant('test-plugin', 'fs.read');
      manager.deny('test-plugin', 'shell.execute');

      const state = manager.getPermissionState('test-plugin');
      expect(state.granted).toContain('storage');
      expect(state.granted).toContain('fs.read');
      expect(state.denied).toContain('shell.execute');
    });
  });

  describe('permission requests', () => {
    it('should resolve immediately if permissions already granted', async () => {
      manager.grant('test-plugin', 'storage');

      const manifest = { id: 'test-plugin', name: 'Test', version: '1.0.0', description: 'Test' };
      const result = await manager.request('test-plugin', ['storage'], manifest);

      expect(result).toBe(true);
    });

    it('should return false if permission is permanently denied', async () => {
      manager.deny('test-plugin', 'shell.execute');

      const manifest = { id: 'test-plugin', name: 'Test', version: '1.0.0', description: 'Test' };
      const result = await manager.request('test-plugin', ['shell.execute'], manifest);

      expect(result).toBe(false);
    });

    it('should create pending request for new permissions', async () => {
      const manifest = { id: 'test-plugin', name: 'Test', version: '1.0.0', description: 'Test' };

      // Don't await - we'll respond manually
      const promise = manager.request('test-plugin', ['storage'], manifest);

      // Respond to the request
      manager.respondToRequest('test-plugin', true);

      const result = await promise;
      expect(result).toBe(true);
      expect(manager.hasPermission('test-plugin', 'storage')).toBe(true);
    });

    it('should deny request when responded with false', async () => {
      const manifest = { id: 'test-plugin', name: 'Test', version: '1.0.0', description: 'Test' };

      const promise = manager.request('test-plugin', ['storage'], manifest);
      manager.respondToRequest('test-plugin', false);

      const result = await promise;
      expect(result).toBe(false);
      expect(manager.hasPermission('test-plugin', 'storage')).toBe(false);
    });

    it('should deny permanently when specified', async () => {
      const manifest = { id: 'test-plugin', name: 'Test', version: '1.0.0', description: 'Test' };

      const promise = manager.request('test-plugin', ['storage'], manifest);
      manager.respondToRequest('test-plugin', false, true);

      await promise;
      expect(manager.getDeniedPermissions('test-plugin')).toContain('storage');
    });

    it('should register and notify request handlers', () => {
      const handler = vi.fn();
      manager.onRequest(handler);

      const manifest = { id: 'test-plugin', name: 'Test', version: '1.0.0', description: 'Test' };

      // Create request (don't await)
      const promise = manager.request('test-plugin', ['storage'], manifest);

      expect(handler).toHaveBeenCalled();
      const request = handler.mock.calls[0][0] as PermissionRequest;
      expect(request.pluginId).toBe('test-plugin');
      expect(request.permissions).toContain('storage');

      // Clean up
      manager.respondToRequest('test-plugin', true);
    });

    it('should unregister request handler', () => {
      const handler = vi.fn();
      const unregister = manager.onRequest(handler);
      unregister();

      const manifest = { id: 'test-plugin', name: 'Test', version: '1.0.0', description: 'Test' };
      const promise = manager.request('test-plugin', ['storage'], manifest);

      expect(handler).not.toHaveBeenCalled();

      // Clean up
      manager.respondToRequest('test-plugin', true);
    });
  });

  describe('utility methods', () => {
    it('should return permission level', () => {
      expect(manager.getPermissionLevel('storage')).toBe(1);
      expect(manager.getPermissionLevel('fs.read')).toBe(2);
      expect(manager.getPermissionLevel('fs.write')).toBe(3);
      expect(manager.getPermissionLevel('shell.execute')).toBe(4);
    });

    it('should sort permissions by risk', () => {
      const permissions: Permission[] = ['storage', 'shell.execute', 'fs.read', 'fs.write'];
      const sorted = manager.sortPermissionsByRisk(permissions);

      expect(sorted[0]).toBe('shell.execute'); // Level 4
      expect(sorted[1]).toBe('fs.write');      // Level 3
      expect(sorted[2]).toBe('fs.read');       // Level 2
      expect(sorted[3]).toBe('storage');       // Level 1
    });

    it('should get permission summary', () => {
      manager.grant('test-plugin', 'storage');
      manager.deny('test-plugin', 'shell.execute');

      const summary = manager.getPermissionSummary('test-plugin', [
        'storage',
        'fs.read',
        'shell.execute',
      ] as Permission[]);

      expect(summary.granted).toContain('storage');
      expect(summary.pending).toContain('fs.read');
      expect(summary.denied).toContain('shell.execute');
    });

    it('should check if safe to auto-grant', () => {
      expect(manager.isSafeToAutoGrant(['storage', 'session.read', 'project.read'] as Permission[])).toBe(true);
      expect(manager.isSafeToAutoGrant(['storage', 'shell.execute'] as Permission[])).toBe(false);
    });

    it('should get all plugin permissions', () => {
      manager.grant('plugin1', 'storage');
      manager.grant('plugin2', 'fs.read');

      const all = manager.getAllPluginPermissions();

      expect(all['plugin1'].granted).toContain('storage');
      expect(all['plugin2'].granted).toContain('fs.read');
    });
  });

  describe('persistence', () => {
    it('should save store when granting', () => {
      manager.grant('test-plugin', 'storage');

      expect(fs.writeFileSync).toHaveBeenCalled();
      const call = (fs.writeFileSync as any).mock.calls[0];
      expect(call[0]).toBe(testStorePath);
    });

    it('should save store when revoking', () => {
      manager.grant('test-plugin', 'storage');
      (fs.writeFileSync as any).mockClear();

      manager.revoke('test-plugin', 'storage');

      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should save store when denying', () => {
      manager.deny('test-plugin', 'storage');

      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });
});
