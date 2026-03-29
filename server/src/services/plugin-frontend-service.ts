import * as fs from 'fs';
import * as path from 'path';
import { pluginLoader } from '../plugins/loader.js';

interface PluginFrontendDependencies {
  loader?: typeof pluginLoader;
  pathExists?: (targetPath: string) => boolean;
}

export class PluginFrontendError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class PluginFrontendService {
  private readonly loader: typeof pluginLoader;
  private readonly pathExists: (targetPath: string) => boolean;

  constructor(deps: PluginFrontendDependencies = {}) {
    this.loader = deps.loader ?? pluginLoader;
    this.pathExists = deps.pathExists ?? ((targetPath: string) => fs.existsSync(targetPath));
  }

  resolveFrontendFile(pluginId: string, requestedPath: string): string {
    if (!/^[\w.-]+$/.test(pluginId)) {
      throw new PluginFrontendError(400, 'Invalid plugin ID');
    }

    const instance = this.loader.getPlugin(pluginId);
    if (!instance) {
      throw new PluginFrontendError(404, 'Plugin not found');
    }

    const pluginDir = path.resolve(instance.path);
    const fullPath = path.resolve(path.join(pluginDir, requestedPath));

    if (!fullPath.startsWith(pluginDir + path.sep) && fullPath !== pluginDir) {
      throw new PluginFrontendError(403, 'Forbidden');
    }

    if (!this.pathExists(fullPath)) {
      throw new PluginFrontendError(404, 'File not found');
    }

    return fullPath;
  }
}
