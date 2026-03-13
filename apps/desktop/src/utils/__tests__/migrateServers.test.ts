import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migrateServersFromLocalStorage, needsMigration } from '../migrateServers';

describe('migrateServers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('migrateServersFromLocalStorage', () => {
    it('returns 0 when no old data', async () => {
      const addServer = vi.fn();
      const result = await migrateServersFromLocalStorage(addServer);
      expect(result).toBe(0);
      expect(addServer).not.toHaveBeenCalled();
    });

    it('returns 0 for empty servers array', async () => {
      localStorage.setItem('my-claudia-servers', JSON.stringify({ state: { servers: [] } }));
      const addServer = vi.fn();
      const result = await migrateServersFromLocalStorage(addServer);
      expect(result).toBe(0);
    });

    it('returns 0 when only local server exists', async () => {
      localStorage.setItem('my-claudia-servers', JSON.stringify({
        state: { servers: [{ id: 'local', name: 'Local', address: 'localhost:3100' }] },
      }));
      const addServer = vi.fn();
      const result = await migrateServersFromLocalStorage(addServer);
      expect(result).toBe(0);
      expect(addServer).not.toHaveBeenCalled();
      // Old storage should be cleaned up
      expect(localStorage.getItem('my-claudia-servers')).toBeNull();
    });

    it('migrates non-local servers', async () => {
      localStorage.setItem('my-claudia-servers', JSON.stringify({
        state: {
          servers: [
            { id: 'local', name: 'Local', address: 'localhost:3100' },
            { id: 'remote1', name: 'Remote', address: 'example.com:3100', createdAt: 123, lastConnected: 456 },
          ],
        },
      }));
      const addServer = vi.fn();
      const result = await migrateServersFromLocalStorage(addServer);
      expect(result).toBe(1);
      expect(addServer).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Remote',
        address: 'example.com:3100',
      }));
      expect(localStorage.getItem('my-claudia-servers')).toBeNull();
    });

    it('returns 0 on parse error', async () => {
      localStorage.setItem('my-claudia-servers', 'invalid json');
      const addServer = vi.fn();
      const result = await migrateServersFromLocalStorage(addServer);
      expect(result).toBe(0);
    });
  });

  describe('needsMigration', () => {
    it('returns false when no old data', () => {
      expect(needsMigration()).toBe(false);
    });

    it('returns false for only local server', () => {
      localStorage.setItem('my-claudia-servers', JSON.stringify({
        state: { servers: [{ id: 'local' }] },
      }));
      expect(needsMigration()).toBe(false);
    });

    it('returns true for non-local servers', () => {
      localStorage.setItem('my-claudia-servers', JSON.stringify({
        state: { servers: [{ id: 'local' }, { id: 'remote' }] },
      }));
      expect(needsMigration()).toBe(true);
    });

    it('returns false for invalid JSON', () => {
      localStorage.setItem('my-claudia-servers', 'not json');
      expect(needsMigration()).toBe(false);
    });
  });
});
