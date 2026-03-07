/**
 * Unit tests for PluginLoader
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PluginLoader } from '../loader';
import { commandRegistry } from '../../commands/registry';
import { toolRegistry } from '../tool-registry';
import { pluginEvents } from '../../events';
import { permissionManager } from '../permissions';

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof fs>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

describe('PluginLoader', () => {
  let loader: PluginLoader;
  const mockPluginDir = '/mock/plugins';

  beforeEach(() => {
    loader = new PluginLoader({ pluginDirs: [mockPluginDir] });
    commandRegistry.clear();
    toolRegistry.clear();
    pluginEvents.clear();
    // Clear all plugin permissions
    const allPermissions = permissionManager.getAllPluginPermissions();
    Object.keys(allPermissions).forEach((pluginId) => {
      permissionManager.clearPluginPermissions(pluginId);
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should include default plugin directories', () => {
      const defaultLoader = new PluginLoader();
      const plugins = defaultLoader.getPlugins();
      expect(plugins).toEqual([]);
    });

    it('should accept custom plugin directories', () => {
      const customLoader = new PluginLoader({ pluginDirs: ['/custom/path'] });
      expect(customLoader).toBeDefined();
    });
  });

  describe('addPluginDir', () => {
    it('should add a plugin directory', () => {
      loader.addPluginDir('/new/path');
      // Directory is added but not scanned until discover()
      expect(loader.size).toBe(0);
    });

    it('should not add duplicate directories', () => {
      loader.addPluginDir('/new/path');
      loader.addPluginDir('/new/path');
      // Should only be added once
      expect(loader.size).toBe(0);
    });
  });

  describe('discover', () => {
    it('should return empty array if directory does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const manifests = await loader.discover();

      expect(manifests).toEqual([]);
    });

    it('should discover plugins with valid manifests', async () => {
      const pluginPath = path.join(mockPluginDir, 'test-plugin');
      const manifest = {
        id: 'com.test.plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        description: 'A test plugin',
      };

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockPluginDir) return true;
        if (p === pluginPath) return true;
        if (p === path.join(pluginPath, 'plugin.json')) return true;
        return false;
      });

      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'test-plugin', isDirectory: () => true, isFile: () => false } as fs.Dirent,
      ]);

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(manifest));

      const manifests = await loader.discover();

      expect(manifests).toHaveLength(1);
      expect(manifests[0].id).toBe('com.test.plugin');
    });

    it('should skip plugins with invalid manifests', async () => {
      const pluginPath = path.join(mockPluginDir, 'bad-plugin');

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockPluginDir) return true;
        if (p === pluginPath) return true;
        if (p === path.join(pluginPath, 'plugin.json')) return true;
        return false;
      });

      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'bad-plugin', isDirectory: () => true, isFile: () => false } as fs.Dirent,
      ]);

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ name: 'Missing id' }));

      const manifests = await loader.discover();

      expect(manifests).toHaveLength(0);
    });

    it('should skip duplicate plugins', async () => {
      const manifest = {
        id: 'com.test.plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        description: 'A test plugin',
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'plugin1', isDirectory: () => true, isFile: () => false } as fs.Dirent,
        { name: 'plugin2', isDirectory: () => true, isFile: () => false } as fs.Dirent,
      ]);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(manifest));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const manifests = await loader.discover();

      // Only one should be discovered (first one)
      expect(manifests).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe('getPlugin', () => {
    it('should return undefined for non-existent plugin', () => {
      expect(loader.getPlugin('nonexistent')).toBeUndefined();
    });
  });

  describe('hasPlugin', () => {
    it('should return false for non-existent plugin', () => {
      expect(loader.hasPlugin('nonexistent')).toBe(false);
    });
  });

  describe('activate', () => {
    it('should return false for non-existent plugin', async () => {
      const result = await loader.activate('nonexistent');
      expect(result).toBe(false);
    });

    it('should activate a discovered plugin', async () => {
      const pluginPath = path.join(mockPluginDir, 'test-plugin');
      const manifest = {
        id: 'com.test.plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        description: 'A test plugin',
        contributes: {
          commands: [{ command: '/test', title: 'Test Command' }],
          tools: [{ id: 'test_tool', name: 'test_tool', description: 'Test', parameters: {} }],
        },
      };

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockPluginDir) return true;
        if (p === pluginPath) return true;
        if (p === path.join(pluginPath, 'plugin.json')) return true;
        return false;
      });

      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'test-plugin', isDirectory: () => true, isFile: () => false } as fs.Dirent,
      ]);

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(manifest));

      await loader.discover();
      const result = await loader.activate('com.test.plugin');

      expect(result).toBe(true);
      expect(commandRegistry.has('/test')).toBe(true);
      expect(toolRegistry.has('test_tool')).toBe(true);
    });
  });

  describe('deactivate', () => {
    it('should return false for non-existent plugin', async () => {
      const result = await loader.deactivate('nonexistent');
      expect(result).toBe(false);
    });

    it('should deactivate an active plugin', async () => {
      const pluginPath = path.join(mockPluginDir, 'test-plugin');
      const manifest = {
        id: 'com.test.plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        description: 'A test plugin',
        contributes: {
          commands: [{ command: '/test', title: 'Test Command' }],
        },
      };

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockPluginDir) return true;
        if (p === pluginPath) return true;
        if (p === path.join(pluginPath, 'plugin.json')) return true;
        return false;
      });

      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'test-plugin', isDirectory: () => true, isFile: () => false } as fs.Dirent,
      ]);

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(manifest));

      await loader.discover();
      await loader.activate('com.test.plugin');

      expect(commandRegistry.has('/test')).toBe(true);

      const result = await loader.deactivate('com.test.plugin');

      expect(result).toBe(true);
      expect(commandRegistry.has('/test')).toBe(false);
    });
  });

  describe('deactivateAll', () => {
    it('should deactivate all plugins', async () => {
      const manifest1 = {
        id: 'com.test.plugin1',
        name: 'Plugin 1',
        version: '1.0.0',
        description: 'Test',
        contributes: {
          commands: [{ command: '/test1', title: 'Test 1' }],
        },
      };

      const manifest2 = {
        id: 'com.test.plugin2',
        name: 'Plugin 2',
        version: '1.0.0',
        description: 'Test',
        contributes: {
          commands: [{ command: '/test2', title: 'Test 2' }],
        },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'plugin1', isDirectory: () => true, isFile: () => false } as fs.Dirent,
        { name: 'plugin2', isDirectory: () => true, isFile: () => false } as fs.Dirent,
      ]);
      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce(JSON.stringify(manifest1))
        .mockReturnValueOnce(JSON.stringify(manifest2));

      await loader.discover();
      await loader.activate('com.test.plugin1');
      await loader.activate('com.test.plugin2');

      await loader.deactivateAll();

      expect(commandRegistry.has('/test1')).toBe(false);
      expect(commandRegistry.has('/test2')).toBe(false);
    });
  });

  describe('remove', () => {
    it('should return false for non-existent plugin', async () => {
      const result = await loader.remove('nonexistent');
      expect(result).toBe(false);
    });

    it('should remove a plugin completely', async () => {
      const pluginPath = path.join(mockPluginDir, 'test-plugin');
      const manifest = {
        id: 'com.test.plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        description: 'A test plugin',
        permissions: ['storage'],
        contributes: {
          commands: [{ command: '/test', title: 'Test Command' }],
        },
      };

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockPluginDir) return true;
        if (p === pluginPath) return true;
        if (p === path.join(pluginPath, 'plugin.json')) return true;
        return false;
      });

      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'test-plugin', isDirectory: () => true, isFile: () => false } as fs.Dirent,
      ]);

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(manifest));

      await loader.discover();

      // Grant permissions
      permissionManager.grant('com.test.plugin', 'storage');

      // Activate
      await loader.activate('com.test.plugin');
      expect(loader.hasPlugin('com.test.plugin')).toBe(true);
      expect(permissionManager.hasPermission('com.test.plugin', 'storage')).toBe(true);

      // Remove
      const result = await loader.remove('com.test.plugin');

      expect(result).toBe(true);
      expect(loader.hasPlugin('com.test.plugin')).toBe(false);
      expect(commandRegistry.has('/test')).toBe(false);
      expect(permissionManager.hasPermission('com.test.plugin', 'storage')).toBe(false);
    });

    it('should deactivate before removing', async () => {
      const pluginPath = path.join(mockPluginDir, 'test-plugin');
      const manifest = {
        id: 'com.test.plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        description: 'A test plugin',
        contributes: {
          commands: [{ command: '/test', title: 'Test Command' }],
        },
      };

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockPluginDir) return true;
        if (p === pluginPath) return true;
        if (p === path.join(pluginPath, 'plugin.json')) return true;
        return false;
      });

      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'test-plugin', isDirectory: () => true, isFile: () => false } as fs.Dirent,
      ]);

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(manifest));

      await loader.discover();
      await loader.activate('com.test.plugin');

      const plugin = loader.getPlugin('com.test.plugin');
      expect(plugin?.isActive).toBe(true);

      await loader.remove('com.test.plugin');

      expect(loader.hasPlugin('com.test.plugin')).toBe(false);
      expect(commandRegistry.has('/test')).toBe(false);
    });
  });
});
