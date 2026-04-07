/**
 * Plugin Storage - Persistent key-value store for plugins.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const MAX_STORAGE_BYTES = 5 * 1024 * 1024;

export interface StorageAPI {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
}

export class PluginStorage implements StorageAPI {
  private storagePath: string;
  private cache = new Map<string, unknown>();
  private loaded = false;

  constructor(private pluginId: string) {
    this.storagePath = path.join(
      os.homedir(),
      '.claudia',
      'plugin-storage',
      `${pluginId}.json`
    );
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(this.storagePath)) {
        const content = fs.readFileSync(this.storagePath, 'utf-8');
        const data = JSON.parse(content);
        if (data && typeof data === 'object') {
          this.cache = new Map(Object.entries(data));
        }
      }
      this.loaded = true;
    } catch (error) {
      console.error(`[PluginStorage] Failed to load storage for ${this.pluginId}:`, error);
      this.cache = new Map();
    }
  }

  private async persist(): Promise<void> {
    try {
      const data = Object.fromEntries(this.cache);
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error(`[PluginStorage] Failed to persist storage for ${this.pluginId}:`, error);
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    await this.ensureLoaded();
    return this.cache.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.ensureLoaded();
    this.cache.set(key, value);

    const data = JSON.stringify(Object.fromEntries(this.cache));
    if (Buffer.byteLength(data, 'utf-8') > MAX_STORAGE_BYTES) {
      this.cache.delete(key);
      throw new Error(`Storage limit exceeded for plugin ${this.pluginId} (max ${MAX_STORAGE_BYTES / 1024 / 1024}MB)`);
    }

    await this.persist();
  }

  async delete(key: string): Promise<void> {
    await this.ensureLoaded();
    this.cache.delete(key);
    await this.persist();
  }

  async clear(): Promise<void> {
    this.cache.clear();
    await this.persist();
  }

  async keys(): Promise<string[]> {
    await this.ensureLoaded();
    return Array.from(this.cache.keys());
  }

  getCache(): Map<string, unknown> {
    return new Map(this.cache);
  }
}

export class PluginStorageManager {
  private storages = new Map<string, PluginStorage>();

  getStorage(pluginId: string): StorageAPI {
    if (!this.storages.has(pluginId)) {
      this.storages.set(pluginId, new PluginStorage(pluginId));
    }
    return this.storages.get(pluginId)!;
  }

  clearStorage(pluginId: string): void {
    this.storages.delete(pluginId);
  }

  clearAll(): void {
    this.storages.clear();
  }
}

export const pluginStorageManager = new PluginStorageManager();
