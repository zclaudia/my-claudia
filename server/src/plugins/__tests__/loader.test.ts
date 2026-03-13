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
import { workerHost } from '../worker-host';
import { workflowStepRegistry } from '../workflow-step-registry';
import { checkPluginCompatibility } from '../../utils/version.js';

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof fs>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    promises: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      readdir: vi.fn(),
      mkdir: vi.fn(),
      unlink: vi.fn(),
    },
  };
});

// Mock version check
vi.mock('../../utils/version.js', () => ({
  checkPluginCompatibility: vi.fn(() => ({ compatible: true })),
}));

// Mock worker host
vi.mock('../worker-host', () => ({
  workerHost: {
    hasWorker: vi.fn(() => false),
    stopPlugin: vi.fn(() => Promise.resolve()),
    startPlugin: vi.fn(() => Promise.resolve()),
    setDatabase: vi.fn(),
    setBroadcast: vi.fn(),
  },
}));

// Mock provider-api
vi.mock('../provider-api.js', () => ({
  createProviderAPI: vi.fn(() => ({})),
}));

// Mock storage
vi.mock('../storage.js', () => ({
  pluginStorageManager: {
    getStorage: vi.fn(() => ({})),
  },
}));

// Helper to create a valid manifest
function makeManifest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'com.test.plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    ...overrides,
  };
}

// Helper to set up fs mocks for a single plugin
function setupSinglePlugin(
  pluginDir: string,
  dirName: string,
  manifest: Record<string, unknown>,
  manifestFileName = 'plugin.json'
) {
  const pluginPath = path.join(pluginDir, dirName);

  vi.mocked(fs.existsSync).mockImplementation((p) => {
    if (p === pluginDir) return true;
    if (p === pluginPath) return true;
    if (p === path.join(pluginPath, manifestFileName)) return true;
    return false;
  });

  vi.mocked(fs.readdirSync).mockReturnValue([
    { name: dirName, isDirectory: () => true, isFile: () => false } as fs.Dirent,
  ]);

  vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(manifest));
}

describe('PluginLoader', () => {
  let loader: PluginLoader;
  const mockPluginDir = '/mock/plugins';

  beforeEach(() => {
    loader = new PluginLoader({ pluginDirs: [mockPluginDir] });
    commandRegistry.clear();
    toolRegistry.clear();
    pluginEvents.clear();
    workflowStepRegistry.clear();
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

  // ==================================================
  // constructor
  // ==================================================
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

  // ==================================================
  // addPluginDir
  // ==================================================
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

  // ==================================================
  // setDatabase / setBroadcast
  // ==================================================
  describe('setDatabase', () => {
    it('should set the database instance', () => {
      const mockDb = {} as any;
      loader.setDatabase(mockDb);
      // No error thrown, db is set internally
      expect(loader).toBeDefined();
    });
  });

  describe('setBroadcast', () => {
    it('should set the broadcast function', () => {
      const mockBroadcast = vi.fn();
      loader.setBroadcast(mockBroadcast);
      expect(loader).toBeDefined();
    });
  });

  // ==================================================
  // discover
  // ==================================================
  describe('discover', () => {
    it('should return empty array if directory does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const manifests = await loader.discover();

      expect(manifests).toEqual([]);
    });

    it('should discover plugins with valid manifests', async () => {
      const manifest = makeManifest();
      setupSinglePlugin(mockPluginDir, 'test-plugin', manifest);

      const manifests = await loader.discover();

      expect(manifests).toHaveLength(1);
      expect(manifests[0].id).toBe('com.test.plugin');
    });

    it('should skip non-directory entries', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'somefile.txt', isDirectory: () => false, isFile: () => true } as fs.Dirent,
      ]);

      const manifests = await loader.discover();
      expect(manifests).toHaveLength(0);
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
      const manifest = makeManifest();

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

    it('should skip directories with no manifest file', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockPluginDir) return true;
        // No manifest file exists
        return false;
      });

      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'no-manifest', isDirectory: () => true, isFile: () => false } as fs.Dirent,
      ]);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manifests = await loader.discover();
      expect(manifests).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('No manifest found')
      );
      warnSpy.mockRestore();
    });

    it('should handle JSON parse errors in manifest', async () => {
      const pluginPath = path.join(mockPluginDir, 'bad-json');

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockPluginDir) return true;
        if (p === path.join(pluginPath, 'plugin.json')) return true;
        return false;
      });

      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'bad-json', isDirectory: () => true, isFile: () => false } as fs.Dirent,
      ]);

      vi.mocked(fs.readFileSync).mockReturnValue('not valid json {{');

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const manifests = await loader.discover();
      expect(manifests).toHaveLength(0);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error loading manifest'),
        expect.any(String)
      );
      errorSpy.mockRestore();
    });

    it('should discover plugins from manifest.json', async () => {
      const pluginPath = path.join(mockPluginDir, 'alt-manifest');
      const manifest = makeManifest({ id: 'com.alt.manifest' });

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockPluginDir) return true;
        // plugin.json does NOT exist
        if (p === path.join(pluginPath, 'plugin.json')) return false;
        // manifest.json exists
        if (p === path.join(pluginPath, 'manifest.json')) return true;
        return false;
      });

      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'alt-manifest', isDirectory: () => true, isFile: () => false } as fs.Dirent,
      ]);

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(manifest));

      const manifests = await loader.discover();
      expect(manifests).toHaveLength(1);
      expect(manifests[0].id).toBe('com.alt.manifest');
    });

    it('should handle package.json with claudia field', async () => {
      const pluginPath = path.join(mockPluginDir, 'npm-plugin');
      const pkgJson = {
        id: 'placeholder',
        name: 'npm-plugin-pkg',
        version: '2.0.0',
        description: 'Package plugin',
        claudia: {
          id: 'com.npm.plugin',
          name: 'NPM Plugin',
          version: '1.0.0',
          description: 'From claudia field',
        },
      };

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockPluginDir) return true;
        if (p === path.join(pluginPath, 'plugin.json')) return false;
        if (p === path.join(pluginPath, 'manifest.json')) return false;
        if (p === path.join(pluginPath, 'package.json')) return true;
        return false;
      });

      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'npm-plugin', isDirectory: () => true, isFile: () => false } as fs.Dirent,
      ]);

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(pkgJson));

      const manifests = await loader.discover();
      expect(manifests).toHaveLength(1);
      expect(manifests[0].id).toBe('com.npm.plugin');
      expect(manifests[0].name).toBe('NPM Plugin');
    });

    it('should handle package.json with claudia field missing id/name/version (falls back to package fields)', async () => {
      const pluginPath = path.join(mockPluginDir, 'npm-plugin2');
      const pkgJson = {
        id: 'pkg-id',
        name: 'npm-pkg-name',
        version: '3.0.0',
        description: 'Package plugin 2',
        claudia: {
          description: 'From claudia field only',
        },
      };

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockPluginDir) return true;
        if (p === path.join(pluginPath, 'plugin.json')) return false;
        if (p === path.join(pluginPath, 'manifest.json')) return false;
        if (p === path.join(pluginPath, 'package.json')) return true;
        return false;
      });

      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'npm-plugin2', isDirectory: () => true, isFile: () => false } as fs.Dirent,
      ]);

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(pkgJson));

      const manifests = await loader.discover();
      expect(manifests).toHaveLength(1);
      // Falls back to package.json name/version
      expect(manifests[0].id).toBe('npm-pkg-name');
      expect(manifests[0].name).toBe('npm-pkg-name');
      expect(manifests[0].version).toBe('3.0.0');
    });
  });

  // ==================================================
  // getPlugin / hasPlugin / getPlugins / size
  // ==================================================
  describe('getPlugin', () => {
    it('should return undefined for non-existent plugin', () => {
      expect(loader.getPlugin('nonexistent')).toBeUndefined();
    });

    it('should return the plugin instance after discover', async () => {
      setupSinglePlugin(mockPluginDir, 'test-plugin', makeManifest());
      await loader.discover();
      const plugin = loader.getPlugin('com.test.plugin');
      expect(plugin).toBeDefined();
      expect(plugin!.manifest.id).toBe('com.test.plugin');
      expect(plugin!.isActive).toBe(false);
    });
  });

  describe('hasPlugin', () => {
    it('should return false for non-existent plugin', () => {
      expect(loader.hasPlugin('nonexistent')).toBe(false);
    });

    it('should return true after discover', async () => {
      setupSinglePlugin(mockPluginDir, 'test-plugin', makeManifest());
      await loader.discover();
      expect(loader.hasPlugin('com.test.plugin')).toBe(true);
    });
  });

  describe('getPlugins', () => {
    it('should return all discovered plugins', async () => {
      // Use a loader with only a single plugin dir to avoid default dirs
      const singleDirLoader = new PluginLoader({ pluginDirs: [] });
      singleDirLoader.addPluginDir(mockPluginDir);

      const m1 = makeManifest({ id: 'com.test.p1', name: 'P1' });
      const m2 = makeManifest({ id: 'com.test.p2', name: 'P2' });

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === mockPluginDir || String(p).endsWith('plugin.json');
      });
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'p1', isDirectory: () => true, isFile: () => false } as fs.Dirent,
        { name: 'p2', isDirectory: () => true, isFile: () => false } as fs.Dirent,
      ]);
      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce(JSON.stringify(m1))
        .mockReturnValueOnce(JSON.stringify(m2));

      await singleDirLoader.discover();
      const plugins = singleDirLoader.getPlugins();
      expect(plugins).toHaveLength(2);
    });
  });

  describe('size', () => {
    it('should return 0 initially', () => {
      expect(loader.size).toBe(0);
    });

    it('should reflect discovered plugins count', async () => {
      setupSinglePlugin(mockPluginDir, 'test-plugin', makeManifest());
      await loader.discover();
      expect(loader.size).toBe(1);
    });
  });

  // ==================================================
  // validateManifest (tested indirectly through discover)
  // ==================================================
  describe('validateManifest (indirect)', () => {
    it('should reject null manifest', async () => {
      const pluginPath = path.join(mockPluginDir, 'null-plugin');
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockPluginDir) return true;
        if (p === path.join(pluginPath, 'plugin.json')) return true;
        return false;
      });
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'null-plugin', isDirectory: () => true, isFile: () => false } as fs.Dirent,
      ]);
      vi.mocked(fs.readFileSync).mockReturnValue('null');

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const manifests = await loader.discover();
      expect(manifests).toHaveLength(0);
      errorSpy.mockRestore();
    });

    it('should reject manifest missing description', async () => {
      const pluginPath = path.join(mockPluginDir, 'no-desc');
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockPluginDir) return true;
        if (p === path.join(pluginPath, 'plugin.json')) return true;
        return false;
      });
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'no-desc', isDirectory: () => true, isFile: () => false } as fs.Dirent,
      ]);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ id: 'x', name: 'X', version: '1.0.0' })
      );

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const manifests = await loader.discover();
      expect(manifests).toHaveLength(0);
      errorSpy.mockRestore();
    });

    it('should reject manifest missing version', async () => {
      const pluginPath = path.join(mockPluginDir, 'no-ver');
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockPluginDir) return true;
        if (p === path.join(pluginPath, 'plugin.json')) return true;
        return false;
      });
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'no-ver', isDirectory: () => true, isFile: () => false } as fs.Dirent,
      ]);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ id: 'x', name: 'X', description: 'Desc' })
      );

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const manifests = await loader.discover();
      expect(manifests).toHaveLength(0);
      errorSpy.mockRestore();
    });

    it('should reject manifest with non-string id', async () => {
      const pluginPath = path.join(mockPluginDir, 'bad-id');
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockPluginDir) return true;
        if (p === path.join(pluginPath, 'plugin.json')) return true;
        return false;
      });
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'bad-id', isDirectory: () => true, isFile: () => false } as fs.Dirent,
      ]);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ id: 123, name: 'X', version: '1.0.0', description: 'D' })
      );

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const manifests = await loader.discover();
      expect(manifests).toHaveLength(0);
      errorSpy.mockRestore();
    });
  });

  // ==================================================
  // checkCompatibility
  // ==================================================
  describe('checkCompatibility', () => {
    it('should delegate to checkPluginCompatibility', () => {
      const manifest = makeManifest({ engines: { claudia: '>=0.1.0' } }) as any;
      loader.checkCompatibility(manifest);
      expect(checkPluginCompatibility).toHaveBeenCalledWith({ claudia: '>=0.1.0' });
    });
  });

  // ==================================================
  // resolveDependencies
  // ==================================================
  describe('resolveDependencies', () => {
    it('should return empty array if no dependencies', () => {
      const manifest = makeManifest() as any;
      const missing = loader.resolveDependencies(manifest);
      expect(missing).toEqual([]);
    });

    it('should return empty array for empty dependencies object', () => {
      const manifest = makeManifest({ dependencies: {} }) as any;
      const missing = loader.resolveDependencies(manifest);
      expect(missing).toEqual([]);
    });

    it('should report missing dependencies', () => {
      const manifest = makeManifest({
        dependencies: { 'com.dep.one': '^1.0.0', 'com.dep.two': '^2.0.0' },
      }) as any;
      const missing = loader.resolveDependencies(manifest);
      expect(missing).toEqual(['com.dep.one', 'com.dep.two']);
    });

    it('should report inactive dependencies as missing', async () => {
      // Discover a plugin but do not activate it
      setupSinglePlugin(mockPluginDir, 'dep-plugin', makeManifest({ id: 'com.dep.one' }));
      await loader.discover();

      const manifest = makeManifest({
        dependencies: { 'com.dep.one': '^1.0.0' },
      }) as any;
      const missing = loader.resolveDependencies(manifest);
      // Discovered but not active => still missing
      expect(missing).toEqual(['com.dep.one']);
    });

    it('should not report active dependencies', async () => {
      setupSinglePlugin(mockPluginDir, 'dep-plugin', makeManifest({ id: 'com.dep.one' }));
      await loader.discover();
      await loader.activate('com.dep.one');

      const manifest = makeManifest({
        dependencies: { 'com.dep.one': '^1.0.0' },
      }) as any;
      const missing = loader.resolveDependencies(manifest);
      expect(missing).toEqual([]);
    });
  });

  // ==================================================
  // activate
  // ==================================================
  describe('activate', () => {
    it('should return false for non-existent plugin', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await loader.activate('nonexistent');
      expect(result).toBe(false);
      errorSpy.mockRestore();
    });

    it('should return true if plugin is already active', async () => {
      setupSinglePlugin(mockPluginDir, 'test-plugin', makeManifest());
      await loader.discover();
      await loader.activate('com.test.plugin');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await loader.activate('com.test.plugin');
      expect(result).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('already active')
      );
      warnSpy.mockRestore();
    });

    it('should activate a discovered plugin and register commands and tools', async () => {
      const manifest = makeManifest({
        contributes: {
          commands: [{ command: '/test', title: 'Test Command' }],
          tools: [{ id: 'test_tool', name: 'test_tool', description: 'Test', parameters: {} }],
        },
      });

      setupSinglePlugin(mockPluginDir, 'test-plugin', manifest);

      await loader.discover();
      const result = await loader.activate('com.test.plugin');

      expect(result).toBe(true);
      expect(commandRegistry.has('/test')).toBe(true);
      expect(toolRegistry.has('test_tool')).toBe(true);
    });

    it('should fail activation when compatibility check fails', async () => {
      vi.mocked(checkPluginCompatibility).mockReturnValueOnce({
        compatible: false,
        error: 'Incompatible version',
      });

      setupSinglePlugin(mockPluginDir, 'test-plugin', makeManifest());
      await loader.discover();

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await loader.activate('com.test.plugin');
      expect(result).toBe(false);

      const plugin = loader.getPlugin('com.test.plugin');
      expect(plugin!.error).toBe('Incompatible version');
      errorSpy.mockRestore();
    });

    it('should fail activation when dependencies are missing', async () => {
      const manifest = makeManifest({
        dependencies: { 'com.missing.dep': '^1.0.0' },
      });

      setupSinglePlugin(mockPluginDir, 'test-plugin', manifest);
      await loader.discover();

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await loader.activate('com.test.plugin');
      expect(result).toBe(false);

      const plugin = loader.getPlugin('com.test.plugin');
      expect(plugin!.error).toContain('Missing dependencies');
      errorSpy.mockRestore();
    });

    it('should set pendingPermissions when permissions are needed but not granted', async () => {
      const manifest = makeManifest({
        permissions: ['storage', 'fs.read'],
      });

      setupSinglePlugin(mockPluginDir, 'test-plugin', manifest);
      await loader.discover();

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await loader.activate('com.test.plugin');
      expect(result).toBe(true);

      const plugin = loader.getPlugin('com.test.plugin');
      expect(plugin!.pendingPermissions).toEqual(['storage', 'fs.read']);
      logSpy.mockRestore();
    });

    it('should not set pendingPermissions when all permissions are already granted', async () => {
      const manifest = makeManifest({
        permissions: ['storage'],
      });

      setupSinglePlugin(mockPluginDir, 'test-plugin', manifest);
      await loader.discover();

      permissionManager.grant('com.test.plugin', 'storage');

      const result = await loader.activate('com.test.plugin');
      expect(result).toBe(true);

      const plugin = loader.getPlugin('com.test.plugin');
      expect(plugin!.pendingPermissions).toBeUndefined();
    });

    it('should emit plugin.activated event', async () => {
      setupSinglePlugin(mockPluginDir, 'test-plugin', makeManifest());
      await loader.discover();

      const emitSpy = vi.spyOn(pluginEvents, 'emit');
      await loader.activate('com.test.plugin');
      expect(emitSpy).toHaveBeenCalledWith(
        'plugin.activated',
        { pluginId: 'com.test.plugin' },
        'com.test.plugin'
      );
    });

    it('should register workflow steps from contributes', async () => {
      const manifest = makeManifest({
        contributes: {
          workflowSteps: [
            {
              id: 'my-step',
              name: 'My Step',
              description: 'A workflow step',
              category: 'Testing',
              icon: 'test-icon',
              configSchema: { type: 'object' },
            },
          ],
        },
      });

      const broadcastFn = vi.fn();
      loader.setBroadcast(broadcastFn);

      setupSinglePlugin(mockPluginDir, 'test-plugin', manifest);
      await loader.discover();
      await loader.activate('com.test.plugin');

      expect(workflowStepRegistry.has('com.test.plugin/my-step')).toBe(true);
      expect(broadcastFn).toHaveBeenCalledWith({ type: 'workflow_step_types_changed' });
    });

    it('should broadcast panel registrations from contributes', async () => {
      const manifest = makeManifest({
        contributes: {
          panels: [
            {
              id: 'panel-1',
              label: 'Test Panel',
              icon: 'test',
              frontend: 'index.html',
              order: 5,
            },
          ],
        },
      });

      const broadcastFn = vi.fn();
      loader.setBroadcast(broadcastFn);

      setupSinglePlugin(mockPluginDir, 'test-plugin', manifest);
      await loader.discover();
      await loader.activate('com.test.plugin');

      expect(broadcastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'plugin_panel_registered',
          panelId: 'panel-1',
          pluginId: 'com.test.plugin',
          label: 'Test Panel',
          icon: 'test',
          iframeUrl: '/api/plugins/com.test.plugin/frontend/index.html',
          order: 5,
        })
      );
    });

    it('should broadcast panel without iframeUrl when no frontend specified', async () => {
      const manifest = makeManifest({
        contributes: {
          panels: [{ id: 'panel-no-frontend', label: 'No Frontend Panel' }],
        },
      });

      const broadcastFn = vi.fn();
      loader.setBroadcast(broadcastFn);

      setupSinglePlugin(mockPluginDir, 'test-plugin', manifest);
      await loader.discover();
      await loader.activate('com.test.plugin');

      expect(broadcastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'plugin_panel_registered',
          panelId: 'panel-no-frontend',
          iframeUrl: undefined,
        })
      );
    });

    it('should activate with no contributes at all', async () => {
      setupSinglePlugin(mockPluginDir, 'test-plugin', makeManifest());
      await loader.discover();
      const result = await loader.activate('com.test.plugin');
      expect(result).toBe(true);
    });

    it('should load module in worker mode', async () => {
      const manifest = makeManifest({
        main: 'index.js',
        executionMode: 'worker',
      });

      const pluginPath = path.join(mockPluginDir, 'worker-plugin');
      const modulePath = path.join(pluginPath, 'index.js');

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockPluginDir) return true;
        if (p === path.join(pluginPath, 'plugin.json')) return true;
        if (p === modulePath) return true;
        return false;
      });
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'worker-plugin', isDirectory: () => true, isFile: () => false } as fs.Dirent,
      ]);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(manifest));

      const mockDb = {} as any;
      loader.setDatabase(mockDb);

      await loader.discover();
      const result = await loader.activate('com.test.plugin');
      expect(result).toBe(true);
      expect(workerHost.startPlugin).toHaveBeenCalledWith('com.test.plugin', modulePath);
      expect(workerHost.setDatabase).toHaveBeenCalledWith(mockDb);
    });

    it('should fail and set error when module file not found', async () => {
      const manifest = makeManifest({ main: 'missing.js' });

      setupSinglePlugin(mockPluginDir, 'test-plugin', manifest);
      // Override existsSync so module path returns false
      const pluginPath = path.join(mockPluginDir, 'test-plugin');
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockPluginDir) return true;
        if (p === path.join(pluginPath, 'plugin.json')) return true;
        if (p === path.join(pluginPath, 'missing.js')) return false;
        return false;
      });

      await loader.discover();

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await loader.activate('com.test.plugin');
      expect(result).toBe(false);

      const plugin = loader.getPlugin('com.test.plugin');
      expect(plugin!.error).toContain('Module not found');
      errorSpy.mockRestore();
    });

    it('should rollback contributions on module load failure', async () => {
      const manifest = makeManifest({
        main: 'index.js',
        contributes: {
          commands: [{ command: '/rollback-test', title: 'Rollback Test' }],
          tools: [{ id: 'rollback_tool', name: 'rollback_tool', description: 'Test', parameters: {} }],
        },
      });

      const pluginPath = path.join(mockPluginDir, 'test-plugin');

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockPluginDir) return true;
        if (p === path.join(pluginPath, 'plugin.json')) return true;
        // Module exists but will fail on import
        if (p === path.join(pluginPath, 'index.js')) return false;
        return false;
      });
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'test-plugin', isDirectory: () => true, isFile: () => false } as fs.Dirent,
      ]);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(manifest));

      await loader.discover();

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await loader.activate('com.test.plugin');
      expect(result).toBe(false);

      // Contributions should be rolled back
      expect(commandRegistry.has('/rollback-test')).toBe(false);
      expect(toolRegistry.has('rollback_tool')).toBe(false);
      errorSpy.mockRestore();
    });
  });

  // ==================================================
  // checkPermissions
  // ==================================================
  describe('checkPermissions', () => {
    it('should return true for non-existent plugin', async () => {
      const result = await loader.checkPermissions('nonexistent');
      expect(result).toBe(true);
    });

    it('should return true if no pending permissions', async () => {
      setupSinglePlugin(mockPluginDir, 'test-plugin', makeManifest());
      await loader.discover();
      await loader.activate('com.test.plugin');

      const result = await loader.checkPermissions('com.test.plugin');
      expect(result).toBe(true);
    });

    it('should clear pendingPermissions and return true if permissions were granted since activation', async () => {
      const manifest = makeManifest({ permissions: ['storage'] });
      setupSinglePlugin(mockPluginDir, 'test-plugin', manifest);
      await loader.discover();

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await loader.activate('com.test.plugin');
      logSpy.mockRestore();

      const plugin = loader.getPlugin('com.test.plugin');
      expect(plugin!.pendingPermissions).toEqual(['storage']);

      // Now grant the permission
      permissionManager.grant('com.test.plugin', 'storage');

      const result = await loader.checkPermissions('com.test.plugin');
      expect(result).toBe(true);
      expect(plugin!.pendingPermissions).toBeUndefined();
    });

    it('should request permissions and return true if granted', async () => {
      const manifest = makeManifest({ permissions: ['storage'] });
      setupSinglePlugin(mockPluginDir, 'test-plugin', manifest);
      await loader.discover();

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await loader.activate('com.test.plugin');
      logSpy.mockRestore();

      // Mock request to return true
      const requestSpy = vi.spyOn(permissionManager, 'request').mockResolvedValueOnce(true);

      const result = await loader.checkPermissions('com.test.plugin');
      expect(result).toBe(true);
      expect(requestSpy).toHaveBeenCalled();

      const plugin = loader.getPlugin('com.test.plugin');
      expect(plugin!.pendingPermissions).toBeUndefined();
    });

    it('should return false if permission request is denied', async () => {
      const manifest = makeManifest({ permissions: ['storage'] });
      setupSinglePlugin(mockPluginDir, 'test-plugin', manifest);
      await loader.discover();

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await loader.activate('com.test.plugin');
      logSpy.mockRestore();

      // Mock request to return false
      vi.spyOn(permissionManager, 'request').mockResolvedValueOnce(false);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await loader.checkPermissions('com.test.plugin');
      expect(result).toBe(false);
      warnSpy.mockRestore();
    });
  });

  // ==================================================
  // deactivate
  // ==================================================
  describe('deactivate', () => {
    it('should return false for non-existent plugin', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await loader.deactivate('nonexistent');
      expect(result).toBe(false);
      errorSpy.mockRestore();
    });

    it('should return true if plugin is already inactive', async () => {
      setupSinglePlugin(mockPluginDir, 'test-plugin', makeManifest());
      await loader.discover();

      // Plugin is discovered but not active
      const result = await loader.deactivate('com.test.plugin');
      expect(result).toBe(true);
    });

    it('should deactivate an active plugin and unregister contributions', async () => {
      const manifest = makeManifest({
        contributes: {
          commands: [{ command: '/test', title: 'Test Command' }],
        },
      });

      setupSinglePlugin(mockPluginDir, 'test-plugin', manifest);

      await loader.discover();
      await loader.activate('com.test.plugin');

      expect(commandRegistry.has('/test')).toBe(true);

      const result = await loader.deactivate('com.test.plugin');

      expect(result).toBe(true);
      expect(commandRegistry.has('/test')).toBe(false);

      const plugin = loader.getPlugin('com.test.plugin');
      expect(plugin!.isActive).toBe(false);
    });

    it('should stop worker if plugin runs in worker mode', async () => {
      setupSinglePlugin(mockPluginDir, 'test-plugin', makeManifest());
      await loader.discover();
      await loader.activate('com.test.plugin');

      vi.mocked(workerHost.hasWorker).mockReturnValue(true);

      const result = await loader.deactivate('com.test.plugin');
      expect(result).toBe(true);
      expect(workerHost.stopPlugin).toHaveBeenCalledWith('com.test.plugin');
    });

    it('should call module deactivate() if it exists and not in worker mode', async () => {
      setupSinglePlugin(mockPluginDir, 'test-plugin', makeManifest());
      await loader.discover();
      await loader.activate('com.test.plugin');

      // Manually set module with deactivate function
      const deactivateFn = vi.fn();
      const plugin = loader.getPlugin('com.test.plugin');
      plugin!.module = { deactivate: deactivateFn };

      vi.mocked(workerHost.hasWorker).mockReturnValue(false);

      await loader.deactivate('com.test.plugin');
      expect(deactivateFn).toHaveBeenCalled();
    });

    it('should emit plugin.deactivated event', async () => {
      setupSinglePlugin(mockPluginDir, 'test-plugin', makeManifest());
      await loader.discover();
      await loader.activate('com.test.plugin');

      const emitSpy = vi.spyOn(pluginEvents, 'emit');
      await loader.deactivate('com.test.plugin');
      expect(emitSpy).toHaveBeenCalledWith(
        'plugin.deactivated',
        { pluginId: 'com.test.plugin' },
        'com.test.plugin'
      );
    });

    it('should return false if deactivate throws an error', async () => {
      setupSinglePlugin(mockPluginDir, 'test-plugin', makeManifest());
      await loader.discover();
      await loader.activate('com.test.plugin');

      // Manually set module with throwing deactivate
      const plugin = loader.getPlugin('com.test.plugin');
      plugin!.module = {
        deactivate: () => {
          throw new Error('Deactivate failed');
        },
      };
      vi.mocked(workerHost.hasWorker).mockReturnValue(false);

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await loader.deactivate('com.test.plugin');
      expect(result).toBe(false);
      errorSpy.mockRestore();
    });

    it('should broadcast workflow_step_types_changed when workflow steps exist', async () => {
      const manifest = makeManifest({
        contributes: {
          workflowSteps: [
            { id: 'step1', name: 'Step 1', description: 'A step' },
          ],
        },
      });

      const broadcastFn = vi.fn();
      loader.setBroadcast(broadcastFn);

      setupSinglePlugin(mockPluginDir, 'test-plugin', manifest);
      await loader.discover();
      await loader.activate('com.test.plugin');
      broadcastFn.mockClear();

      await loader.deactivate('com.test.plugin');

      expect(broadcastFn).toHaveBeenCalledWith({ type: 'workflow_step_types_changed' });
      expect(broadcastFn).toHaveBeenCalledWith({
        type: 'plugin_panel_unregistered',
        pluginId: 'com.test.plugin',
      });
    });

    it('should clear module on deactivation', async () => {
      setupSinglePlugin(mockPluginDir, 'test-plugin', makeManifest());
      await loader.discover();
      await loader.activate('com.test.plugin');

      const plugin = loader.getPlugin('com.test.plugin');
      plugin!.module = { someExport: true };

      await loader.deactivate('com.test.plugin');
      expect(plugin!.module).toBeUndefined();
    });
  });

  // ==================================================
  // deactivateAll
  // ==================================================
  describe('deactivateAll', () => {
    it('should deactivate all plugins', async () => {
      const manifest1 = makeManifest({
        id: 'com.test.plugin1',
        name: 'Plugin 1',
        contributes: {
          commands: [{ command: '/test1', title: 'Test 1' }],
        },
      });

      const manifest2 = makeManifest({
        id: 'com.test.plugin2',
        name: 'Plugin 2',
        contributes: {
          commands: [{ command: '/test2', title: 'Test 2' }],
        },
      });

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

  // ==================================================
  // remove
  // ==================================================
  describe('remove', () => {
    it('should return false for non-existent plugin', async () => {
      const result = await loader.remove('nonexistent');
      expect(result).toBe(false);
    });

    it('should remove a plugin completely', async () => {
      const manifest = makeManifest({
        permissions: ['storage'],
        contributes: {
          commands: [{ command: '/test', title: 'Test Command' }],
        },
      });

      setupSinglePlugin(mockPluginDir, 'test-plugin', manifest);

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

    it('should remove inactive plugin without deactivating', async () => {
      setupSinglePlugin(mockPluginDir, 'test-plugin', makeManifest());
      await loader.discover();

      // Do not activate
      const result = await loader.remove('com.test.plugin');
      expect(result).toBe(true);
      expect(loader.hasPlugin('com.test.plugin')).toBe(false);
    });

    it('should deactivate before removing', async () => {
      const manifest = makeManifest({
        contributes: {
          commands: [{ command: '/test', title: 'Test Command' }],
        },
      });

      setupSinglePlugin(mockPluginDir, 'test-plugin', manifest);

      await loader.discover();
      await loader.activate('com.test.plugin');

      const plugin = loader.getPlugin('com.test.plugin');
      expect(plugin?.isActive).toBe(true);

      await loader.remove('com.test.plugin');

      expect(loader.hasPlugin('com.test.plugin')).toBe(false);
      expect(commandRegistry.has('/test')).toBe(false);
    });

    it('should clear plugin APIs on remove', async () => {
      setupSinglePlugin(mockPluginDir, 'test-plugin', makeManifest());
      await loader.discover();
      await loader.activate('com.test.plugin');

      const result = await loader.remove('com.test.plugin');
      expect(result).toBe(true);
      expect(loader.size).toBe(0);
    });
  });

  // ==================================================
  // unregisterContributions (tested indirectly)
  // ==================================================
  describe('unregisterContributions (indirect)', () => {
    it('should broadcast plugin_panel_unregistered on deactivation', async () => {
      setupSinglePlugin(mockPluginDir, 'test-plugin', makeManifest());

      const broadcastFn = vi.fn();
      loader.setBroadcast(broadcastFn);

      await loader.discover();
      await loader.activate('com.test.plugin');
      broadcastFn.mockClear();

      await loader.deactivate('com.test.plugin');

      expect(broadcastFn).toHaveBeenCalledWith({
        type: 'plugin_panel_unregistered',
        pluginId: 'com.test.plugin',
      });
    });

    it('should clear plugin events on deactivation', async () => {
      setupSinglePlugin(mockPluginDir, 'test-plugin', makeManifest());
      await loader.discover();
      await loader.activate('com.test.plugin');

      const clearSpy = vi.spyOn(pluginEvents, 'clearByPlugin');
      await loader.deactivate('com.test.plugin');
      expect(clearSpy).toHaveBeenCalledWith('com.test.plugin');
    });
  });
});
