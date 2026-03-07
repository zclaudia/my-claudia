/**
 * Plugin Storage - Persistent key-value store for plugins
 *
 * Each plugin gets its own isolated namespace for storage.
 * Data is persisted to ~/.claudia/plugin-storage/{pluginId}.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================
// Types
// ============================================

export interface StorageAPI {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
}

// ============================================
// Plugin Storage
// ============================================

export class PluginStorage implements StorageAPI {
  private pluginId: string;
  private storagePath: string;
  private cache: Map<string, unknown> = new Map();
  private loaded = false;

  constructor(pluginId: string) {
    this.pluginId = pluginId;
    this.storagePath = path.join(
      os.homedir(),
      '.claudia',
      'plugin-storage',
      `${pluginId}.json`
    );
  }

  /**
   * Ensure storage directory exists and load data into cache
   */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

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
      this.loaded = true; // Mark as loaded even on failure
    }
  }

  /**
   * Persist cache to disk
   */
  private async persist(): Promise<void> {
    try {
      const data = Object.fromEntries(this.cache);
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error(`[PluginStorage] Failed to persist storage for ${this.pluginId}:`, error);
    }
  }

  /**
   * Get a value from storage
   */
  async get<T>(key: string): Promise<T | undefined> {
    await this.ensureLoaded();
    return this.cache.get(key) as T | undefined;
  }

  /**
   * Set a value in storage
   */
  async set<T>(key: string, value: T): Promise<void> {
    await this.ensureLoaded();
    this.cache.set(key, value);
    await this.persist();
  }

  /**
   * Delete a value from storage
   */
  async delete(key: string): Promise<void> {
    await this.ensureLoaded();
    this.cache.delete(key);
    await this.persist();
  }

  /**
   * Clear all values for this plugin
   */
  async clear(): Promise<void> {
    this.cache.clear();
    await this.persist();
  }

  /**
   * Get all keys for this plugin
   */
  async keys(): Promise<string[]> {
    await this.ensureLoaded();
    return Array.from(this.cache.keys());
  }

  /**
   * Get the raw cache (for testing)
   */
  getCache(): Map<string, unknown> {
    return new Map(this.cache);
  }
}

// ============================================
// Storage Manager (factory for plugin storage)
// ============================================

export class PluginStorageManager {
  private storages = new Map<string, PluginStorage>();

  /**
   * Get or create storage for a plugin
   */
  getStorage(pluginId: string): StorageAPI {
    if (!this.storages.has(pluginId)) {
      this.storages.set(pluginId, new PluginStorage(pluginId));
    }
    return this.storages.get(pluginId)!;
  }

  /**
   * Clear storage for a plugin (when deactivated)
   */
  clearStorage(pluginId: string): void {
    this.storages.delete(pluginId);
  }

  /**
   * Clear all storages (for testing)
   */
  clearAll(): void {
    this.storages.clear();
  }
}

export const pluginStorageManager = new PluginStorageManager();
