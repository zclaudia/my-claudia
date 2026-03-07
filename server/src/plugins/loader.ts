/**
 * Plugin Loader - Discovers, loads, and manages plugins.
 *
 * This module handles the complete plugin lifecycle:
 * - Discovery: Scan plugin directories for manifests
 * - Validation: Validate manifest schema and permissions
 * - Loading: Load plugin modules
 * - Activation: Call plugin's activate() function
 * - Deactivation: Call plugin's deactivate() function and cleanup
 *
 * Usage:
 *   // Discover all plugins
 *   const manifests = await pluginLoader.discover();
 *
 *   // Activate a plugin
 *   await pluginLoader.activate('com.example.my-plugin');
 *
 *   // Deactivate a plugin
 *   await pluginLoader.deactivate('com.example.my-plugin');
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type {
  PluginManifest,
  PluginInstance,
  PluginValidationResult,
  validatePluginManifest,
} from '@my-claudia/shared';
import { checkPluginCompatibility } from '../utils/version.js';
import { pluginEvents } from '../events/index.js';
import { commandRegistry } from '../commands/registry.js';
import { toolRegistry } from './tool-registry.js';
import { permissionManager } from './permissions.js';
import type { Permission } from '@my-claudia/shared';
import { pluginStorageManager } from './storage.js';
import { createProviderAPI } from './provider-api.js';

// ============================================
// Types
// ============================================

export interface PluginLoaderOptions {
  /** Additional plugin directories to scan */
  pluginDirs?: string[];
  /** Whether to auto-activate plugins on load */
  autoActivate?: boolean;
}

// ============================================
// Plugin Loader
// ============================================

export class PluginLoader {
  private plugins = new Map<string, PluginInstance>();
  private pluginDirs: string[];
  private db: import('better-sqlite3').Database | null = null;

  constructor(options: PluginLoaderOptions = {}) {
    // Default plugin directories
    this.pluginDirs = [
      path.join(os.homedir(), '.claude', 'plugins'),
      path.join(os.homedir(), '.claudia', 'plugins'),
      ...(options.pluginDirs || []),
    ];
  }

  /**
   * Add a plugin directory to scan.
   */
  addPluginDir(dir: string): void {
    if (!this.pluginDirs.includes(dir)) {
      this.pluginDirs.push(dir);
    }
  }

  /**
   * Set the database instance for provider API access.
   */
  setDatabase(db: import('better-sqlite3').Database): void {
    this.db = db;
  }

  /**
   * Get all discovered plugins.
   */
  getPlugins(): PluginInstance[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get a specific plugin by ID.
   */
  getPlugin(pluginId: string): PluginInstance | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Check if a plugin is loaded.
   */
  hasPlugin(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  /**
   * Discover all plugins in plugin directories.
   */
  async discover(): Promise<PluginManifest[]> {
    const manifests: PluginManifest[] = [];

    for (const dir of this.pluginDirs) {
      if (!fs.existsSync(dir)) {
        continue;
      }

      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const pluginPath = path.join(dir, entry.name);
        const manifest = await this.loadManifest(pluginPath);

        if (manifest) {
          // Check if already discovered (from another directory)
          if (this.plugins.has(manifest.id)) {
            console.warn(
              `[PluginLoader] Plugin "${manifest.id}" already discovered, skipping duplicate at ${pluginPath}`
            );
            continue;
          }

          this.plugins.set(manifest.id, {
            manifest,
            path: pluginPath,
            isActive: false,
          });

          manifests.push(manifest);
        }
      }
    }

    return manifests;
  }

  /**
   * Load and validate a manifest from a plugin directory.
   */
  private async loadManifest(pluginPath: string): Promise<PluginManifest | null> {
    // Try different manifest file names
    const manifestNames = ['plugin.json', 'manifest.json', 'package.json'];
    let manifestPath: string | null = null;

    for (const name of manifestNames) {
      const tryPath = path.join(pluginPath, name);
      if (fs.existsSync(tryPath)) {
        manifestPath = tryPath;
        break;
      }
    }

    if (!manifestPath) {
      console.warn(`[PluginLoader] No manifest found in ${pluginPath}`);
      return null;
    }

    try {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      const rawManifest = JSON.parse(content);

      // Validate manifest
      const { valid, errors } = this.validateManifest(rawManifest);
      if (!valid) {
        console.error(`[PluginLoader] Invalid manifest in ${pluginPath}:`, errors);
        return null;
      }

      // For package.json, extract claudia field if present
      if (manifestPath.endsWith('package.json')) {
        const pkgManifest = rawManifest as Record<string, unknown>;
        if (pkgManifest.claudia) {
          return {
            ...pkgManifest.claudia,
            id: (pkgManifest.claudia as Record<string, unknown>).id || pkgManifest.name,
            name: (pkgManifest.claudia as Record<string, unknown>).name || pkgManifest.name,
            version: (pkgManifest.claudia as Record<string, unknown>).version || pkgManifest.version,
          } as PluginManifest;
        }
      }

      return rawManifest as PluginManifest;
    } catch (error) {
      console.error(
        `[PluginLoader] Error loading manifest from ${pluginPath}:`,
        error instanceof Error ? error.message : String(error)
      );
      return null;
    }
  }

  /**
   * Validate a plugin manifest.
   */
  private validateManifest(manifest: unknown): PluginValidationResult {
    // Basic validation (full validation is in shared package)
    const errors: string[] = [];

    if (!manifest || typeof manifest !== 'object') {
      return { valid: false, errors: ['Manifest must be an object'], warnings: [] };
    }

    const m = manifest as Record<string, unknown>;

    if (!m.id || typeof m.id !== 'string') {
      errors.push('Missing required field: id');
    }

    if (!m.name || typeof m.name !== 'string') {
      errors.push('Missing required field: name');
    }

    if (!m.version || typeof m.version !== 'string') {
      errors.push('Missing required field: version');
    }

    if (!m.description || typeof m.description !== 'string') {
      errors.push('Missing required field: description');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: [],
    };
  }

  /**
   * Check plugin compatibility with the current app version.
   */
  checkCompatibility(manifest: PluginManifest): { compatible: boolean; error?: string } {
    return checkPluginCompatibility(manifest.engines);
  }

  /**
   * Resolve plugin dependencies.
   * Returns an array of missing dependency plugin IDs.
   */
  resolveDependencies(manifest: PluginManifest): string[] {
    const dependencies = manifest.dependencies;
    if (!dependencies || Object.keys(dependencies).length === 0) {
      return [];
    }

    const missing: string[] = [];

    for (const [depId, _version] of Object.entries(dependencies)) {
      const depPlugin = this.plugins.get(depId);
      if (!depPlugin) {
        missing.push(depId);
      } else if (!depPlugin.isActive) {
        // Dependency exists but is not active
        missing.push(depId);
      }
    }

    return missing;
  }

  /**
   * Activate a plugin by ID.
   */
  async activate(pluginId: string): Promise<boolean> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      console.error(`[PluginLoader] Plugin not found: ${pluginId}`);
      return false;
    }

    if (instance.isActive) {
      console.warn(`[PluginLoader] Plugin already active: ${pluginId}`);
      return true;
    }

    try {
      // Check compatibility
      const compatibility = this.checkCompatibility(instance.manifest);
      if (!compatibility.compatible) {
        console.error(`[PluginLoader] Plugin ${pluginId} compatibility check failed: ${compatibility.error}`);
        instance.error = compatibility.error;
        return false;
      }

      // Check dependencies
      const missingDeps = this.resolveDependencies(instance.manifest);
      if (missingDeps.length > 0) {
        console.error(`[PluginLoader] Plugin ${pluginId} has missing dependencies: ${missingDeps.join(', ')}`);
        instance.error = `Missing dependencies: ${missingDeps.join(', ')}`;
        return false;
      }

      // Check/request permissions if plugin requires them
      const requiredPermissions = instance.manifest.permissions || [];
      if (requiredPermissions.length > 0) {
        const hasAll = permissionManager.hasAllPermissions(pluginId, requiredPermissions as Permission[]);
        if (!hasAll) {
          // Request permissions
          const granted = await permissionManager.request(
            pluginId,
            requiredPermissions as Permission[],
            instance.manifest
          );
          if (!granted) {
            console.warn(`[PluginLoader] Plugin ${pluginId} activation cancelled: permissions denied`);
            return false;
          }
        }
      }

      // Emit activation event
      await pluginEvents.emit('plugin.activated', { pluginId }, pluginId);

      // Load and register contributions
      await this.registerContributions(instance);

      // Load main module if specified
      if (instance.manifest.main) {
        await this.loadModule(instance);
      }

      instance.isActive = true;
      console.log(`[PluginLoader] Activated plugin: ${pluginId}`);
      return true;
    } catch (error) {
      instance.error = error instanceof Error ? error.message : String(error);
      console.error(`[PluginLoader] Failed to activate plugin ${pluginId}:`, instance.error);
      await pluginEvents.emit('plugin.error', { pluginId, error: instance.error }, pluginId);
      return false;
    }
  }

  /**
   * Deactivate a plugin by ID.
   */
  async deactivate(pluginId: string): Promise<boolean> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      console.error(`[PluginLoader] Plugin not found: ${pluginId}`);
      return false;
    }

    if (!instance.isActive) {
      return true;
    }

    try {
      // Call deactivate if module exports it
      if (instance.module && typeof (instance.module as any).deactivate === 'function') {
        await (instance.module as any).deactivate();
      }

      // Unregister all contributions
      this.unregisterContributions(pluginId);

      instance.isActive = false;
      instance.module = undefined;

      // Emit deactivation event
      await pluginEvents.emit('plugin.deactivated', { pluginId }, pluginId);

      console.log(`[PluginLoader] Deactivated plugin: ${pluginId}`);
      return true;
    } catch (error) {
      console.error(
        `[PluginLoader] Error deactivating plugin ${pluginId}:`,
        error instanceof Error ? error.message : String(error)
      );
      return false;
    }
  }

  /**
   * Register plugin contributions.
   */
  private async registerContributions(instance: PluginInstance): Promise<void> {
    const { manifest } = instance;
    const contributes = manifest.contributes;
    if (!contributes) return;

    // Register commands
    if (contributes.commands) {
      for (const cmd of contributes.commands) {
        commandRegistry.register({
          command: cmd.command,
          description: cmd.title,
          handler: async (args, context) => {
            // Default handler - plugins can override via module
            return {
              type: 'builtin',
              command: cmd.command,
              data: { args, category: cmd.category },
            };
          },
          source: 'plugin',
          pluginId: manifest.id,
        });
      }
    }

    // Register tools
    if (contributes.tools) {
      for (const tool of contributes.tools) {
        toolRegistry.register({
          id: tool.id,
          definition: {
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          },
          handler: async (args) => {
            // Default handler - plugins can override via module
            return JSON.stringify({ message: 'Tool not implemented', args });
          },
          source: 'plugin',
          pluginId: manifest.id,
          permissions: tool.permissions,
        });
      }
    }
  }

  /**
   * Unregister all contributions for a plugin.
   */
  private unregisterContributions(pluginId: string): void {
    // Clear commands
    commandRegistry.clearByPlugin(pluginId);

    // Clear tools
    toolRegistry.clearByPlugin(pluginId);

    // Clear event listeners
    pluginEvents.clearByPlugin(pluginId);
  }

  /**
   * Remove a plugin completely (deactivate and clear permissions).
   */
  async remove(pluginId: string): Promise<boolean> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      return false;
    }

    // Deactivate first
    if (instance.isActive) {
      await this.deactivate(pluginId);
    }

    // Clear permissions
    permissionManager.clearPluginPermissions(pluginId);

    // Remove from plugins map
    this.plugins.delete(pluginId);

    return true;
  }

  /**
   * Load a plugin's main module.
   */
  private async loadModule(instance: PluginInstance): Promise<void> {
    const { manifest } = instance;
    if (!manifest.main) return;

    const modulePath = path.join(instance.path, manifest.main);

    if (!fs.existsSync(modulePath)) {
      throw new Error(`Module not found: ${modulePath}`);
    }

    try {
      // Dynamic import
      const module = await import(modulePath);
      instance.module = module;

      // Call activate if exported
      if (typeof module.activate === 'function') {
        const context = this.createPluginContext(manifest.id);
        await module.activate(context);
      }
    } catch (error) {
      throw new Error(
        `Failed to load module: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Create a plugin context for the activate function.
   */
  private createPluginContext(pluginId: string): any {
    const instance = this.plugins.get(pluginId);
    const manifest = instance?.manifest;

    return {
      pluginId,
      version: manifest?.version || '0.0.0',
      extensionPath: instance?.path || '',

      storage: pluginStorageManager.getStorage(pluginId),

      events: {
        on: (event: string, handler: (data: any) => void | Promise<void>) => {
          return pluginEvents.on(event, handler, pluginId);
        },
        once: (event: string, handler: (data: any) => void | Promise<void>) => {
          pluginEvents.once(event, handler, pluginId);
        },
        emit: async (event: string, data: any = {}) => {
          await pluginEvents.emit(event, data, pluginId);
        },
      },

      log: {
        info: (message: string, ...args: unknown[]) => {
          console.log(`[${pluginId}] ${message}`, ...args);
        },
        warn: (message: string, ...args: unknown[]) => {
          console.warn(`[${pluginId}] ${message}`, ...args);
        },
        error: (message: string, ...args: unknown[]) => {
          console.error(`[${pluginId}] ${message}`, ...args);
        },
        debug: (message: string, ...args: unknown[]) => {
          console.debug(`[${pluginId}] ${message}`, ...args);
        },
      },

      commands: {
        registerCommand: (command: string, handler: any) => {
          commandRegistry.register({
            command,
            description: `Command from ${pluginId}`,
            handler,
            source: 'plugin',
            pluginId,
          });
        },
        unregisterCommand: (command: string) => {
          commandRegistry.unregister(command);
        },
      },

      tools: {
        registerTool: (tool: any) => {
          toolRegistry.register({
            id: tool.id,
            definition: {
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            },
            handler: tool.handler,
            source: 'plugin',
            pluginId,
            permissions: tool.permissions,
          });
        },
        unregisterTool: (toolId: string) => {
          toolRegistry.unregister(toolId);
        },
      },

      permissions: {
        hasPermission: (permission: Permission): boolean => {
          return permissionManager.hasPermission(pluginId, permission);
        },
        hasAllPermissions: (permissions: Permission[]): boolean => {
          return permissionManager.hasAllPermissions(pluginId, permissions);
        },
        requestPermission: async (permission: Permission): Promise<boolean> => {
          const manifest = instance?.manifest;
          if (!manifest) return false;
          return permissionManager.request(pluginId, [permission], manifest);
        },
        requestPermissions: async (permissions: Permission[]): Promise<boolean> => {
          const manifest = instance?.manifest;
          if (!manifest) return false;
          return permissionManager.request(pluginId, permissions, manifest);
        },
        getGrantedPermissions: (): Permission[] => {
          return permissionManager.getGrantedPermissions(pluginId);
        },
      },

      // Provider API (only if plugin has 'provider.call' permission)
      providers: this.db && permissionManager.hasPermission(pluginId, 'provider.call' as Permission)
        ? createProviderAPI(this.db, pluginId)
        : undefined,

      context: {
        getActiveProject: async () => null,
        getActiveSession: async () => null,
        getProjects: async () => [],
      },

      env: {
        isDesktop: true,
        isServer: true,
        appVersion: '0.1.0',
        platform: process.platform as 'darwin' | 'win32' | 'linux',
      },
    };
  }

  /**
   * Deactivate all plugins.
   */
  async deactivateAll(): Promise<void> {
    for (const [pluginId] of this.plugins) {
      await this.deactivate(pluginId);
    }
  }

  /**
   * Get the number of discovered plugins.
   */
  get size(): number {
    return this.plugins.size;
  }
}

// ============================================
// Singleton Export
// ============================================

export const pluginLoader = new PluginLoader();
