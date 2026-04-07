import type { Permission } from '@my-claudia/shared/plugin-types';
import { pluginLoader } from './loader.js';
import { permissionManager } from './permissions.js';
import { toolRegistry } from './tool-registry.js';
import { commandRegistry } from '../../commands/registry.js';

interface PluginManifestSummary {
  id: string;
  name: string;
  version: string;
}

interface PluginManagementDependencies {
  loader?: typeof pluginLoader;
  permissions?: typeof permissionManager;
  tools?: typeof toolRegistry;
  commands?: typeof commandRegistry;
}

export class PluginManagementError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class PluginManagementService {
  private readonly loader: typeof pluginLoader;
  private readonly permissions: typeof permissionManager;
  private readonly tools: typeof toolRegistry;
  private readonly commands: typeof commandRegistry;

  constructor(deps: PluginManagementDependencies = {}) {
    this.loader = deps.loader ?? pluginLoader;
    this.permissions = deps.permissions ?? permissionManager;
    this.tools = deps.tools ?? toolRegistry;
    this.commands = deps.commands ?? commandRegistry;
  }

  listPlugins() {
    return this.loader.getPlugins().map((plugin) => ({
      id: plugin.manifest.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      description: plugin.manifest.description,
      author: plugin.manifest.author,
      status: plugin.isActive ? 'active' : plugin.error ? 'error' : 'inactive',
      enabled: plugin.isActive,
      error: plugin.error,
      permissions: plugin.manifest.permissions || [],
      grantedPermissions: this.permissions.getGrantedPermissions(plugin.manifest.id),
      pendingPermissions: plugin.pendingPermissions || [],
      tools: this.tools.getByPlugin(plugin.manifest.id).map((tool) => tool.definition.function.name),
      commands: this.commands.getByPlugin(plugin.manifest.id).map((command) => command.command),
      path: plugin.path,
    }));
  }

  async activatePlugin(id: string): Promise<{ activated: true }> {
    this.assertPluginExists(id);
    const result = await this.loader.activate(id);
    if (!result) {
      const plugin = this.loader.getPlugin(id);
      throw new PluginManagementError(400, 'ACTIVATION_FAILED', plugin?.error || 'Activation failed');
    }
    return { activated: true };
  }

  async deactivatePlugin(id: string): Promise<{ deactivated: true }> {
    this.assertPluginExists(id);
    await this.loader.deactivate(id);
    return { deactivated: true };
  }

  async reloadPlugin(id: string): Promise<{ reloaded: true }> {
    this.assertPluginExists(id);
    const result = await this.loader.reload(id);
    if (!result) {
      const plugin = this.loader.getPlugin(id);
      throw new PluginManagementError(400, 'RELOAD_FAILED', plugin?.error || 'Reload failed');
    }
    return { reloaded: true };
  }

  grantPermissions(id: string, permissions: unknown): { granted: Permission[] } {
    const validated = this.validatePermissions(permissions);
    this.permissions.grantAll(id, validated);
    return { granted: validated };
  }

  revokePermissions(id: string, permissions: unknown): { revoked: Permission[] } {
    const validated = this.validatePermissions(permissions);
    for (const permission of validated) {
      this.permissions.revoke(id, permission);
    }
    return { revoked: validated };
  }

  getPluginDirs(): { dirs: string[]; extraDirs: string[] } {
    return {
      dirs: this.loader.getPluginDirs(),
      extraDirs: this.loader.getExtraDirsFromDb(),
    };
  }

  updatePluginDirs(dirs: unknown): { dirs: string[] } {
    if (!Array.isArray(dirs) || !dirs.every((dir) => typeof dir === 'string')) {
      throw new PluginManagementError(400, 'INVALID_INPUT', 'dirs must be an array of strings');
    }

    const normalized = [...new Set(dirs.map((dir) => dir.trim()).filter(Boolean))];
    this.loader.saveExtraDirs(normalized);
    this.autoActivateDiscoveredPlugins().catch(() => {});

    return { dirs: this.loader.getPluginDirs() };
  }

  async discoverPlugins(): Promise<{ discovered: number; plugins: PluginManifestSummary[] }> {
    const manifests = await this.autoActivateDiscoveredPlugins();
    return {
      discovered: manifests.length,
      plugins: manifests.map((manifest) => ({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
      })),
    };
  }

  async removePlugin(id: string): Promise<{ removed: true }> {
    this.assertPluginExists(id);
    await this.loader.remove(id);
    return { removed: true };
  }

  private async autoActivateDiscoveredPlugins() {
    const manifests = await this.loader.discover();
    for (const manifest of manifests) {
      const plugin = this.loader.getPlugin(manifest.id);
      if (plugin && !plugin.isActive) {
        this.loader.activate(manifest.id).catch(() => {});
      }
    }
    return manifests;
  }

  private assertPluginExists(id: string): void {
    if (!this.loader.hasPlugin(id)) {
      throw new PluginManagementError(404, 'NOT_FOUND', `Plugin not found: ${id}`);
    }
  }

  private validatePermissions(permissions: unknown): Permission[] {
    if (!Array.isArray(permissions)) {
      throw new PluginManagementError(400, 'VALIDATION_ERROR', 'permissions array required');
    }
    return permissions as Permission[];
  }
}
