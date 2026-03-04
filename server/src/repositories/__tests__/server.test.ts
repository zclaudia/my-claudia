import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServerRepository } from '../server.js';
import type { Database } from 'better-sqlite3';

describe('ServerRepository', () => {
  let mockDb: any;
  let repository: ServerRepository;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn(),
        get: vi.fn(),
        run: vi.fn()
      })
    };

    repository = new ServerRepository(mockDb);
  });

  describe('mapRow', () => {
    it('maps database row to BackendServer entity with all fields', () => {
      const row = {
        id: 'server-123',
        name: 'Test Server',
        address: 'http://localhost:3000',
        is_default: 1,
        last_connected: 1000,
        created_at: 2000,
        client_id: 'client-456',
        connection_mode: 'direct'
      };

      const result = repository.mapRow(row);

      expect(result).toEqual({
        id: 'server-123',
        name: 'Test Server',
        address: 'http://localhost:3000',
        isDefault: true,
        lastConnected: 1000,
        createdAt: 2000,
        clientId: 'client-456',
        connectionMode: 'direct'
      });
    });

    it('handles null values correctly', () => {
      const row = {
        id: 'server-123',
        name: 'Test Server',
        address: 'http://localhost:3000',
        is_default: 0,
        last_connected: null,
        created_at: 2000,
        client_id: null,
        connection_mode: 'direct'
      };

      const result = repository.mapRow(row);

      expect(result.isDefault).toBe(false);
      expect(result.lastConnected).toBeNull();
      expect(result.clientId).toBeNull();
    });

    it('converts is_default integer to boolean', () => {
      const rowTrue = {
        id: 'server-1',
        name: 'Server',
        address: 'http://test',
        is_default: 1,
        created_at: 1000,
        connection_mode: 'direct'
      };
      const rowFalse = {
        id: 'server-2',
        name: 'Server',
        address: 'http://test',
        is_default: 0,
        created_at: 1000,
        connection_mode: 'direct'
      };

      const resultTrue = repository.mapRow(rowTrue);
      const resultFalse = repository.mapRow(rowFalse);

      expect(resultTrue.isDefault).toBe(true);
      expect(resultFalse.isDefault).toBe(false);
    });
  });

  describe('createQuery', () => {
    it('generates INSERT query with all fields', () => {
      const data = {
        name: 'New Server',
        address: 'http://localhost:3100',
        isDefault: true,
        clientId: 'client-789',
        connectionMode: 'gateway',
        lastConnected: 3000
      };

      const { sql, params } = repository.createQuery(data);

      expect(sql).toContain('INSERT INTO servers');
      expect(params[1]).toBe('New Server');
      expect(params[2]).toBe('http://localhost:3100');
      expect(params[3]).toBe('gateway');
      expect(params[5]).toBe('client-789');
      expect(params[6]).toBe(1); // isDefault as integer
      expect(params[10]).toBe(3000);
    });

    it('uses default connection mode when not specified', () => {
      const data = {
        name: 'Default Mode',
        address: 'http://localhost:3000'
      } as any;

      const { params } = repository.createQuery(data);

      expect(params[3]).toBe('direct');
    });

    it('converts isDefault to integer', () => {
      const dataTrue = { name: 'Test', address: 'http://test', isDefault: true } as any;
      const dataFalse = { name: 'Test', address: 'http://test', isDefault: false } as any;

      const { params: paramsTrue } = repository.createQuery(dataTrue);
      const { params: paramsFalse } = repository.createQuery(dataFalse);

      expect(paramsTrue[6]).toBe(1);
      expect(paramsFalse[6]).toBe(0);
    });

    it('generates UUID for id', () => {
      const data = { name: 'UUID Test', address: 'http://test' } as any;
      const { params } = repository.createQuery(data);

      expect(params[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('sets timestamps correctly', () => {
      const before = Date.now();
      const data = { name: 'Timestamps', address: 'http://test' } as any;
      const { params } = repository.createQuery(data);
      const after = Date.now();

      expect(params[8]).toBeGreaterThanOrEqual(before);
      expect(params[8]).toBeLessThanOrEqual(after);
      expect(params[9]).toBe(params[8]);
    });

    it('sets deprecated fields to null', () => {
      const data = { name: 'Test', address: 'http://test' } as any;
      const { params } = repository.createQuery(data);

      expect(params[4]).toBe(null); // api_key (deprecated)
      expect(params[7]).toBe(0); // requires_auth (deprecated)
    });
  });

  describe('updateQuery', () => {
    it('generates UPDATE query for single field', () => {
      const { sql, params } = repository.updateQuery('server-123', { name: 'Updated Name' });

      expect(sql).toContain('UPDATE servers SET');
      expect(sql).toContain('name = ?');
      expect(sql).toContain('updated_at = ?');
      expect(params).toContain('Updated Name');
      expect(params[params.length - 1]).toBe('server-123');
    });

    it('generates UPDATE query for multiple fields', () => {
      const { sql, params } = repository.updateQuery('server-123', {
        name: 'New Name',
        address: 'http://newaddress',
        connectionMode: 'gateway'
      });

      expect(sql).toContain('name = ?');
      expect(sql).toContain('address = ?');
      expect(sql).toContain('connection_mode = ?');
      expect(params).toContain('New Name');
      expect(params).toContain('http://newaddress');
      expect(params).toContain('gateway');
    });

    it('converts isDefault to integer', () => {
      const { params } = repository.updateQuery('server-123', {
        isDefault: true
      });

      expect(params).toContain(1);
    });

    it('handles lastConnected field', () => {
      const timestamp = Date.now();
      const { sql, params } = repository.updateQuery('server-123', {
        lastConnected: timestamp
      });

      expect(sql).toContain('last_connected = ?');
      expect(params).toContain(timestamp);
    });

    it('always updates updated_at timestamp', () => {
      const before = Date.now();
      const { params } = repository.updateQuery('server-123', { name: 'Test' });
      const after = Date.now();

      const timestamp = params[params.length - 2];
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('findDefault', () => {
    it('returns default server when found', () => {
      const mockRow = {
        id: 'server-123',
        name: 'Default Server',
        address: 'http://localhost:3000',
        is_default: 1,
        created_at: 1000,
        connection_mode: 'direct'
      };
      mockDb.prepare().get.mockReturnValue(mockRow);

      const result = repository.findDefault();

      expect(result).not.toBeNull();
      expect(result?.id).toBe('server-123');
      expect(result?.isDefault).toBe(true);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('WHERE is_default = 1'));
    });

    it('returns null when no default server exists', () => {
      mockDb.prepare().get.mockReturnValue(undefined);

      const result = repository.findDefault();

      expect(result).toBeNull();
    });
  });

  describe('setDefault', () => {
    it('unsets all defaults and sets specified server as default', () => {
      const mockRow = {
        id: 'server-123',
        name: 'Test Server',
        is_default: 1,
        created_at: 1000,
        address: 'http://test',
        connection_mode: 'direct'
      };

      mockDb.prepare().run.mockReturnValue({ changes: 1 });
      mockDb.prepare().get.mockReturnValue(mockRow);

      const result = repository.setDefault('server-123');

      expect(result.isDefault).toBe(true);
      expect(mockDb.prepare).toHaveBeenCalledWith('UPDATE servers SET is_default = 0');
    });

    it('throws error if server not found', () => {
      mockDb.prepare().run.mockReturnValueOnce({ changes: 0 }); // First call for unset
      mockDb.prepare().run.mockReturnValueOnce({ changes: 0 }); // Second call for set

      expect(() => {
        repository.setDefault('non-existent');
      }).toThrow('Server not found: non-existent');
    });

    it('throws error if update fails', () => {
      mockDb.prepare().run.mockReturnValueOnce({ changes: 0 }); // Unset
      mockDb.prepare().run.mockReturnValueOnce({ changes: 1 }); // Set
      mockDb.prepare().get.mockReturnValue(undefined); // findById returns null

      expect(() => {
        repository.setDefault('server-123');
      }).toThrow('Failed to set default server: server-123');
    });
  });

  describe('updateLastConnected', () => {
    it('updates last_connected timestamp', () => {
      mockDb.prepare().run.mockReturnValue({ changes: 1 });

      const before = Date.now();
      repository.updateLastConnected('server-123');
      const after = Date.now();

      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE servers SET last_connected = ?'));

      // Verify the call was made
      const callArgs = mockDb.prepare().run.mock.calls[0];
      const timestamp = callArgs[0];
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });
});