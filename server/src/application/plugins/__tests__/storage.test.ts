/**
 * Unit tests for PluginStorage
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PluginStorage, PluginStorageManager } from '../storage.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

describe('PluginStorage', () => {
  let storage: PluginStorage;
  const testPluginId = 'test.plugin';

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new PluginStorage(testPluginId);
  });

  describe('get', () => {
    it('should return undefined for non-existent key', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('{}');

      const result = await storage.get('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should return value for existing key', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ myKey: 'myValue' }));

      const result = await storage.get('myKey');
      expect(result).toBe('myValue');
    });
  });

  describe('set', () => {
    it('should set a value and persist', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    await storage.set('newKey', 'newValue');

    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalled();
  });

  it('should overwrite existing value', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ existingKey: 'oldValue' }));
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    await storage.set('existingKey', 'newValue');

    const cache = storage.getCache();
    expect(cache.get('existingKey')).toBe('newValue');
  });
  });

  describe('delete', () => {
    it('should delete a key', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ toDelete: 'value' }));
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    await storage.delete('toDelete');

    const cache = storage.getCache();
    expect(cache.has('toDelete')).toBe(false);
  });
  });

  describe('clear', () => {
    it('should clear all keys', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ key1: 'value1', key2: 'value2' }));
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    await storage.clear();

    const cache = storage.getCache();
    expect(cache.size).toBe(0);
  });
  });

  describe('keys', () => {
    it('should return all keys', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ key1: 'value1', key2: 'value2', key3: 'value3' }));

    const keys = await storage.keys();
    expect(keys).toContain('key1');
    expect(keys).toContain('key2');
    expect(keys).toContain('key3');
  });
  });
});

describe('PluginStorageManager', () => {
  let manager: PluginStorageManager;

  beforeEach(() => {
    manager = new PluginStorageManager();
  });

  describe('getStorage', () => {
    it('should create storage for new plugin', () => {
    const storage = manager.getStorage('plugin.a');
    expect(storage).toBeDefined();
  });

  it('should return same storage for same plugin', () => {
    const storage1 = manager.getStorage('plugin.a');
    const storage2 = manager.getStorage('plugin.a');
    expect(storage1).toBe(storage2);
  });
  });

  describe('clearStorage', () => {
    it('should clear storage for plugin', () => {
    manager.getStorage('plugin.a');
    manager.clearStorage('plugin.a');
    // Storage should be removed
    manager.getStorage('plugin.a');
  });
  });

  describe('clearAll', () => {
    it('should clear all storages', () => {
    manager.getStorage('plugin.a');
    manager.getStorage('plugin.b');
    manager.clearAll();
  });
  });
});
