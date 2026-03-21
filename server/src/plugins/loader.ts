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
import { workerHost } from './worker-host.js';
import { workflowStepRegistry } from './workflow-step-registry.js';
import { pluginScheduler } from './scheduler.js';

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
  private pluginAPIs = new Map<string, unknown>();
  private broadcastFn: ((msg: any) => void) | null = null;
  private skillContentCache = new Map<string, { content: string; mtime: number }>();
  agentTriggerService?: import('../domains/agent-triggers/service.js').AgentTriggerService;

  constructor(options: PluginLoaderOptions = {}) {
    // Default plugin directory: $MY_CLAUDIA_DATA_DIR/plugins (same base as database).
    // Dev builds (via Tauri appDataDir + '-dev/') automatically get an isolated path.
    const dataDir = process.env.MY_CLAUDIA_DATA_DIR
      ? path.resolve(process.env.MY_CLAUDIA_DATA_DIR)
      : path.join(os.homedir(), '.my-claudia');
    this.pluginDirs = [
      path.join(dataDir, 'plugins'),
      ...(options.pluginDirs || []),
    ];
  }

  /**
   * Add a plugin directory to scan (runtime only, not persisted).
   */
  addPluginDir(dir: string): void {
    if (!this.pluginDirs.includes(dir)) {
      this.pluginDirs.push(dir);
    }
  }

  /**
   * Get the effective list of plugin directories (default + user-configured).
   */
  getPluginDirs(): string[] {
    return [...this.pluginDirs, ...this.getExtraDirsFromDb()];
  }

  /**
   * Get user-configured extra plugin directories from the database.
   */
  getExtraDirsFromDb(): string[] {
    if (!this.db) return [];
    try {
      const row = this.db.prepare(
        `SELECT value FROM app_config WHERE key = 'plugin_extra_dirs'`
      ).get() as { value: string } | undefined;
      if (!row) return [];
      const dirs = JSON.parse(row.value);
      return Array.isArray(dirs) ? dirs : [];
    } catch {
      return [];
    }
  }

  /**
   * Save user-configured extra plugin directories to the database.
   */
  saveExtraDirs(dirs: string[]): void {
    if (!this.db) return;
    this.db.prepare(`
      INSERT INTO app_config (key, value) VALUES ('plugin_extra_dirs', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(JSON.stringify(dirs));
  }

  /**
   * Set the database instance for provider API access.
   */
  setDatabase(db: import('better-sqlite3').Database): void {
    this.db = db;
  }

  /**
   * Set the broadcast function for sending messages to connected frontends.
   */
  setBroadcast(fn: (msg: any) => void): void {
    this.broadcastFn = fn;
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
   * Supports nested directories: if a subdirectory has no manifest file,
   * it is treated as a category folder and scanned recursively.
   */
  async discover(): Promise<PluginManifest[]> {
    const manifests: PluginManifest[] = [];

    for (const dir of this.getPluginDirs()) {
      await this.scanDirectory(dir, manifests);
    }

    return manifests;
  }

  /**
   * Recursively scan a directory for plugins.
   * A directory with a manifest is treated as a plugin.
   * A directory without a manifest is treated as a category folder
   * and its subdirectories are scanned recursively.
   */
  private async scanDirectory(dir: string, manifests: PluginManifest[]): Promise<void> {
    if (!fs.existsSync(dir)) {
      return;
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
      } else {
        // No manifest found — treat as category folder and recurse
        await this.scanDirectory(pluginPath, manifests);
      }
    }
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
        await pluginEvents.emit('plugin.error', { pluginId, error: instance.error }, pluginId);
        return false;
      }

      // Check dependencies
      const missingDeps = this.resolveDependencies(instance.manifest);
      if (missingDeps.length > 0) {
        console.error(`[PluginLoader] Plugin ${pluginId} has missing dependencies: ${missingDeps.join(', ')}`);
        instance.error = `Missing dependencies: ${missingDeps.join(', ')}`;
        await pluginEvents.emit('plugin.error', { pluginId, error: instance.error }, pluginId);
        return false;
      }

      // Note: Permission checks are deferred to tool/command invocation time.
      // Requesting permissions here would block activation if no UI is connected
      // (e.g. during server startup before any WebSocket client connects).
      // Permissions are enforced lazily via checkPermissions() when plugin
      // tools or commands are actually invoked.
      const requiredPermissions = instance.manifest.permissions || [];
      if (requiredPermissions.length > 0) {
        const hasAll = permissionManager.hasAllPermissions(pluginId, requiredPermissions as Permission[]);
        if (!hasAll) {
          console.log(`[PluginLoader] Plugin ${pluginId} needs permissions: ${requiredPermissions.join(', ')} (will request on use)`);
          instance.pendingPermissions = requiredPermissions as Permission[];
        }
      }

      // Load and register contributions
      await this.registerContributions(instance);

      // Load main module if specified
      try {
        if (instance.manifest.main) {
          await this.loadModule(instance);
        }
      } catch (moduleError) {
        // Rollback: clean up registered contributions on module load failure
        this.unregisterContributions(pluginId);
        throw moduleError;
      }

      instance.isActive = true;
      console.log(`[PluginLoader] Activated plugin: ${pluginId}`);

      // Emit activation event AFTER isActive is set, so broadcastPluginState() sees correct state
      await pluginEvents.emit('plugin.activated', { pluginId }, pluginId);

      return true;
    } catch (error) {
      instance.error = error instanceof Error ? error.message : String(error);
      console.error(`[PluginLoader] Failed to activate plugin ${pluginId}:`, instance.error);
      await pluginEvents.emit('plugin.error', { pluginId, error: instance.error }, pluginId);
      return false;
    }
  }

  /**
   * Check and request pending permissions for a plugin.
   * Called lazily when a plugin's tool or command is first invoked.
   * Returns true if all permissions are granted, false if denied.
   */
  async checkPermissions(pluginId: string): Promise<boolean> {
    const instance = this.plugins.get(pluginId);
    if (!instance || !instance.pendingPermissions || instance.pendingPermissions.length === 0) {
      return true;
    }

    // Check if permissions were granted since activation
    const hasAll = permissionManager.hasAllPermissions(pluginId, instance.pendingPermissions as Permission[]);
    if (hasAll) {
      instance.pendingPermissions = undefined;
      return true;
    }

    // Request permissions now (UI should be available at this point)
    const granted = await permissionManager.request(
      pluginId,
      instance.pendingPermissions as Permission[],
      instance.manifest
    );
    if (granted) {
      instance.pendingPermissions = undefined;
      return true;
    }

    console.warn(`[PluginLoader] Plugin ${pluginId} permissions denied at use time`);
    return false;
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
      // Stop Worker if running in worker mode
      if (workerHost.hasWorker(pluginId)) {
        await workerHost.stopPlugin(pluginId);
      } else if (instance.module && typeof (instance.module as any).deactivate === 'function') {
        // Call deactivate if module exports it (main thread mode)
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

    // Register commands (normalize: ensure / prefix)
    if (contributes.commands) {
      for (const cmd of contributes.commands) {
        const normalized = cmd.command.startsWith('/') ? cmd.command : `/${cmd.command}`;
        commandRegistry.register({
          command: normalized,
          description: cmd.title,
          handler: async (args, context) => {
            // Default handler - plugins can override via registerCommand()
            return {
              type: 'builtin',
              command: normalized,
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

    // Register workflow steps
    if (contributes.workflowSteps) {
      for (const step of contributes.workflowSteps) {
        const fullType = `${manifest.id}/${step.id}`;
        workflowStepRegistry.register({
          type: fullType,
          name: step.name,
          description: step.description,
          category: step.category ?? 'Plugins',
          icon: step.icon,
          configSchema: step.configSchema,
          handler: async () => ({
            status: 'failed' as const,
            output: {},
            error: 'Step handler not implemented',
          }),
          pluginId: manifest.id,
        });
      }
      this.broadcastFn?.({ type: 'workflow_step_types_changed' });
    }

    // Register plugin-contributed skills
    if (contributes.skills) {
      const pluginInfo = this.plugins.get(manifest.id);
      if (pluginInfo) {
        for (const skill of contributes.skills) {
          const skillDir = path.resolve(pluginInfo.path, path.dirname(skill.path));
          const skillMdPath = path.resolve(pluginInfo.path, skill.path);
          // Validate path stays within plugin directory (prevent path traversal)
          const resolvedPluginDir = path.resolve(pluginInfo.path);
          if (!skillMdPath.startsWith(resolvedPluginDir + path.sep) && skillMdPath !== resolvedPluginDir) {
            console.warn(`[PluginLoader] Skill path escapes plugin directory: ${skill.path} in plugin "${manifest.id}"`);
            continue;
          }
          if (fs.existsSync(skillMdPath)) {
            try {
              // Verify real path at load time (reject symlinks pointing outside plugin dir)
              const realSkillPath = fs.realpathSync(skillMdPath);
              if (!realSkillPath.startsWith(resolvedPluginDir + path.sep)) {
                console.warn(`[PluginLoader] Skill symlink escapes plugin directory: ${skillMdPath} → ${realSkillPath}`);
                continue;
              }
              const content = fs.readFileSync(realSkillPath, 'utf-8');
              const mtime = fs.statSync(realSkillPath).mtimeMs;
              // Extract name from first heading or filename
              const nameMatch = content.replace(/^---[\s\S]*?---\s*\n?/, '').match(/^#\s*(.+)/m);
              const skillId = `${manifest.id}_${path.basename(skillDir)}`;
              const skillName = nameMatch?.[1] || path.basename(skillDir);

              // Cache skill content with mtime for cache invalidation
              this.skillContentCache.set(skillMdPath, { content, mtime });

              // Capture pluginDir for handler-time re-validation
              const boundPluginDir = resolvedPluginDir;
              toolRegistry.register({
                id: `skill__${skillId}`,
                definition: {
                  type: 'function',
                  function: {
                    name: `skill__${skillId}`,
                    description: `[Skill] ${skillName} (from plugin: ${manifest.name})`,
                    parameters: { type: 'object', properties: {} },
                  },
                },
                source: 'skill',
                handler: async () => {
                  // Check cache and revalidate with mtime
                  const cached = this.skillContentCache.get(skillMdPath);
                  // Re-verify realpath on every read to prevent TOCTOU symlink swap
                  const currentRealPath = fs.realpathSync(skillMdPath);
                  if (!currentRealPath.startsWith(boundPluginDir + path.sep)) {
                    return '[Error] Skill file path has been tampered with';
                  }
                  const currentMtime = fs.statSync(currentRealPath).mtimeMs;
                  if (cached && cached.mtime === currentMtime) {
                    return cached.content;
                  }
                  const freshContent = fs.readFileSync(currentRealPath, 'utf-8');
                  this.skillContentCache.set(skillMdPath, { content: freshContent, mtime: currentMtime });
                  return freshContent;
                },
              });
              console.log(`[PluginLoader] Registered skill "${skillId}" from plugin "${manifest.id}"`);
            } catch (err) {
              console.warn(`[PluginLoader] Failed to load skill from ${skillMdPath}:`, err);
            }
          }
        }
      }
    }

    // Register plugin-contributed agent triggers
    if (contributes.agentTriggers && this.agentTriggerService) {
      for (const triggerContrib of contributes.agentTriggers) {
        try {
          this.agentTriggerService.registerPluginTrigger(manifest.id, triggerContrib);
          console.log(`[PluginLoader] Registered agent trigger "${triggerContrib.name}" from plugin "${manifest.id}"`);
        } catch (err) {
          console.warn(`[PluginLoader] Failed to register agent trigger from ${manifest.id}:`, err);
        }
      }
    }

    // Broadcast panel registrations to connected frontends
    if (contributes.panels) {
      for (const panel of contributes.panels) {
        const iframeUrl = panel.frontend
          ? `/api/plugins/${manifest.id}/frontend/${panel.frontend}`
          : undefined;
        this.broadcastFn?.({
          type: 'plugin_panel_registered',
          panelId: panel.id,
          pluginId: manifest.id,
          label: panel.label,
          icon: panel.icon,
          iframeUrl,
          order: panel.order,
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

    // Clear workflow steps
    if (workflowStepRegistry.getByPlugin(pluginId).length > 0) {
      workflowStepRegistry.clearByPlugin(pluginId);
      this.broadcastFn?.({ type: 'workflow_step_types_changed' });
    }

    // Clear event listeners
    pluginEvents.clearByPlugin(pluginId);

    // Clear plugin-contributed agent triggers
    this.agentTriggerService?.unregisterPluginTriggers(pluginId);

    // Clear scheduled tasks
    pluginScheduler.clearByPlugin(pluginId);

    // Notify frontend to unregister panels
    this.broadcastFn?.({ type: 'plugin_panel_unregistered', pluginId });
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

    // Clear exported plugin APIs
    this.pluginAPIs.delete(pluginId);

    // Remove from plugins map
    this.plugins.delete(pluginId);

    return true;
  }

  /**
   * Reload a plugin: deactivate → clear module cache → re-read manifest → activate.
   * This enables hot-reload when plugin files on disk have been updated.
   */
  async reload(pluginId: string): Promise<boolean> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      console.error(`[PluginLoader] Plugin not found: ${pluginId}`);
      return false;
    }

    const pluginPath = instance.path;
    const wasActive = instance.isActive;
    console.log(`[PluginLoader] Reloading plugin: ${pluginId} from ${pluginPath}`);

    // 1. Deactivate (unregisters contributions, calls deactivate(), stops worker)
    if (wasActive) {
      await this.deactivate(pluginId);
    }

    // 2. Bust Node.js module cache for plugin files.
    //    ESM: import() caches by URL, so we append ?t=<timestamp> in loadModule.
    //    CJS: clear require.cache entries under the plugin directory.
    try {
      const { createRequire } = await import('module');
      const cjsRequire = createRequire(import.meta.url);
      for (const key of Object.keys(cjsRequire.cache)) {
        if (key.startsWith(pluginPath)) {
          delete cjsRequire.cache[key];
        }
      }
    } catch {
      // CJS cache not available — ESM cache busting via ?t= query is sufficient
    }

    // 3. Re-read manifest from disk (it may have changed)
    const manifest = await this.loadManifest(pluginPath);
    if (!manifest) {
      console.error(`[PluginLoader] Failed to load manifest after reload: ${pluginPath}`);
      return false;
    }

    // 4. Update the instance with fresh manifest
    this.plugins.set(pluginId, {
      manifest,
      path: pluginPath,
      isActive: false,
      error: undefined,
      module: undefined,
    });

    // 5. Re-activate if it was previously active
    if (wasActive) {
      return this.activate(pluginId);
    }

    console.log(`[PluginLoader] Plugin ${pluginId} reloaded (not re-activated — was inactive)`);
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

    // Worker isolation mode
    if (manifest.executionMode === 'worker') {
      workerHost.setDatabase(this.db!);
      if (this.broadcastFn) workerHost.setBroadcast(this.broadcastFn);
      await workerHost.startPlugin(manifest.id, modulePath);
      return;
    }

    try {
      // Dynamic import (main thread)
      // Append cache-busting query param so re-imports after reload get fresh code.
      // Node.js ESM loader caches by full URL including query string.
      const moduleUrl = `${modulePath}?t=${Date.now()}`;
      const module = await import(moduleUrl);
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
          const normalized = command.startsWith('/') ? command : `/${command}`;
          // Preserve description from manifest contributes if already registered
          const existing = commandRegistry.get(normalized);
          const description = (existing?.pluginId === pluginId && existing.description)
            ? existing.description
            : `Command from ${pluginId}`;
          commandRegistry.register({
            command: normalized,
            description,
            handler,
            source: 'plugin',
            pluginId,
          });
        },
        unregisterCommand: (command: string) => {
          const normalized = command.startsWith('/') ? command : `/${command}`;
          commandRegistry.unregister(normalized);
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

      workflowSteps: {
        registerWorkflowStep: (stepId: string, handler: any) => {
          const fullType = `${pluginId}/${stepId}`;
          const existing = workflowStepRegistry.get(fullType);
          if (existing) {
            workflowStepRegistry.register({ ...existing, handler });
          } else {
            workflowStepRegistry.register({
              type: fullType,
              name: stepId,
              description: `Workflow step from ${pluginId}`,
              category: 'Plugins',
              handler,
              pluginId,
            });
          }
          this.broadcastFn?.({ type: 'workflow_step_types_changed' });
        },
        unregisterWorkflowStep: (stepId: string) => {
          workflowStepRegistry.unregister(`${pluginId}/${stepId}`);
          this.broadcastFn?.({ type: 'workflow_step_types_changed' });
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

      // File System API (requires fs.read / fs.write permissions)
      fs: (() => {
        const hasRead = permissionManager.hasPermission(pluginId, 'fs.read' as Permission);
        const hasWrite = permissionManager.hasPermission(pluginId, 'fs.write' as Permission);
        if (!hasRead && !hasWrite) return undefined;
        return {
          readFile: async (filePath: string): Promise<string> => {
            if (!permissionManager.hasPermission(pluginId, 'fs.read' as Permission))
              throw new Error('Permission denied: fs.read');
            return fs.promises.readFile(filePath, 'utf-8');
          },
          writeFile: async (filePath: string, content: string): Promise<void> => {
            if (!permissionManager.hasPermission(pluginId, 'fs.write' as Permission))
              throw new Error('Permission denied: fs.write');
            await fs.promises.writeFile(filePath, content, 'utf-8');
          },
          exists: async (filePath: string): Promise<boolean> => {
            return fs.existsSync(filePath);
          },
          readdir: async (dirPath: string): Promise<string[]> => {
            if (!permissionManager.hasPermission(pluginId, 'fs.read' as Permission))
              throw new Error('Permission denied: fs.read');
            return fs.promises.readdir(dirPath);
          },
          mkdir: async (dirPath: string): Promise<void> => {
            if (!permissionManager.hasPermission(pluginId, 'fs.write' as Permission))
              throw new Error('Permission denied: fs.write');
            await fs.promises.mkdir(dirPath, { recursive: true });
          },
          unlink: async (filePath: string): Promise<void> => {
            if (!permissionManager.hasPermission(pluginId, 'fs.write' as Permission))
              throw new Error('Permission denied: fs.write');
            await fs.promises.unlink(filePath);
          },
        };
      })(),

      // Network API (requires network.fetch permission)
      network: permissionManager.hasPermission(pluginId, 'network.fetch' as Permission)
        ? {
            fetch: async (url: string, options?: Record<string, unknown>): Promise<{ ok: boolean; status: number; body: string }> => {
              if (!permissionManager.hasPermission(pluginId, 'network.fetch' as Permission))
                throw new Error('Permission denied: network.fetch');
              const response = await globalThis.fetch(url, options as RequestInit);
              const body = await response.text();
              return { ok: response.ok, status: response.status, body };
            },
          }
        : undefined,

      // Shell API (requires shell.execute permission)
      shell: permissionManager.hasPermission(pluginId, 'shell.execute' as Permission)
        ? {
            execute: async (command: string, args?: string[], options?: { cwd?: string }): Promise<{ stdout: string; stderr: string; code: number }> => {
              if (!permissionManager.hasPermission(pluginId, 'shell.execute' as Permission))
                throw new Error('Permission denied: shell.execute');
              const { execFile } = await import('child_process');
              return new Promise((resolve) => {
                execFile(command, args || [], { cwd: options?.cwd }, (error, stdout, stderr) => {
                  resolve({
                    stdout: stdout || '',
                    stderr: stderr || '',
                    code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
                  });
                });
              });
            },
          }
        : undefined,

      // Notification API (requires notification permission)
      notification: permissionManager.hasPermission(pluginId, 'notification' as Permission)
        ? {
            show: async (title: string, body: string): Promise<void> => {
              if (!permissionManager.hasPermission(pluginId, 'notification' as Permission))
                throw new Error('Permission denied: notification');
              pluginEvents.emit('plugin.notification', { pluginId, title, body }).catch(() => {});
              this.broadcastFn?.({ type: 'plugin_notification', pluginId, title, body });
            },
          }
        : undefined,

      // Scheduler API (requires timer permission)
      scheduler: permissionManager.hasPermission(pluginId, 'timer' as Permission)
        ? {
            register: (
              task: { id: string; name: string; intervalMs: number; immediate?: boolean },
              handler: () => Promise<void> | void,
            ) => {
              return pluginScheduler.register(
                pluginId,
                task.id,
                task.name,
                task.intervalMs,
                handler,
                task.immediate !== false,
              );
            },
            unregister: (taskId: string) => {
              pluginScheduler.unregister(`plugin:${pluginId}/${taskId}`);
            },
            trigger: async (taskId: string) => {
              await pluginScheduler.trigger(`plugin:${pluginId}/${taskId}`);
            },
          }
        : undefined,

      // Clipboard API (requires clipboard.read / clipboard.write permissions)
      clipboard: (() => {
        const hasRead = permissionManager.hasPermission(pluginId, 'clipboard.read' as Permission);
        const hasWrite = permissionManager.hasPermission(pluginId, 'clipboard.write' as Permission);
        if (!hasRead && !hasWrite) return undefined;
        return {
          read: async (): Promise<string> => {
            throw new Error('Clipboard read requires desktop environment');
          },
          write: async (_text: string): Promise<void> => {
            throw new Error('Clipboard write requires desktop environment');
          },
        };
      })(),

      // Session API (requires session.read permission)
      session: permissionManager.hasPermission(pluginId, 'session.read' as Permission) && this.db
        ? {
            getActive: async () => null,
            getById: async (id: string) => {
              return this.db!.prepare(
                'SELECT id, project_id as projectId, name, created_at as createdAt, updated_at as updatedAt FROM sessions WHERE id = ?'
              ).get(id) || null;
            },
            list: async () => {
              return this.db!.prepare(
                'SELECT id, project_id as projectId, name, created_at as createdAt, updated_at as updatedAt FROM sessions WHERE archived_at IS NULL ORDER BY updated_at DESC LIMIT 50'
              ).all();
            },
          }
        : undefined,

      // Project API (requires project.read permission)
      project: permissionManager.hasPermission(pluginId, 'project.read' as Permission) && this.db
        ? {
            getActive: async () => null,
            getById: async (id: string) => {
              return this.db!.prepare(
                'SELECT id, name, root_path as path FROM projects WHERE id = ?'
              ).get(id) || null;
            },
            list: async () => {
              return this.db!.prepare(
                'SELECT id, name, root_path as path FROM projects ORDER BY updated_at DESC LIMIT 50'
              ).all();
            },
          }
        : undefined,

      // Provider API (requires provider.call permission)
      providers: this.db && permissionManager.hasPermission(pluginId, 'provider.call' as Permission)
        ? createProviderAPI(this.db, pluginId)
        : undefined,

      // UI API
      ui: {
        components: { Button: null, Input: null, Card: null, Badge: null },
        showPanel: (panelId: string) => {
          this.broadcastFn?.({ type: 'plugin_show_panel', pluginId, panelId });
        },
        showNotification: (message: string) => {
          this.broadcastFn?.({ type: 'plugin_notification', pluginId, title: pluginId, body: message });
        },
      },

      // Plugin inter-communication
      exports: <T>(api: T): void => {
        this.pluginAPIs.set(pluginId, api);
      },
      getPluginAPI: <T>(targetPluginId: string): T | undefined => {
        return this.pluginAPIs.get(targetPluginId) as T | undefined;
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
