import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderRepository } from '../provider.js';
import type { Database } from 'better-sqlite3';

describe('ProviderRepository', () => {
  let mockDb: any;
  let repository: ProviderRepository;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn(),
        get: vi.fn(),
        run: vi.fn()
      })
    };

    repository = new ProviderRepository(mockDb);
  });

  describe('mapRow', () => {
    it('maps database row to ProviderConfig entity with all fields', () => {
      const row = {
        id: 'prov-123',
        name: 'Claude Provider',
        type: 'claude',
        cli_path: '/usr/bin/claude',
        env: '{"ANTHROPIC_API_KEY":"test-key"}',
        is_default: 1,
        created_at: 1000,
        updated_at: 2000
      };

      const result = repository.mapRow(row);

      expect(result).toEqual({
        id: 'prov-123',
        name: 'Claude Provider',
        type: 'claude',
        cliPath: '/usr/bin/claude',
        env: { ANTHROPIC_API_KEY: 'test-key' },
        isDefault: true,
        createdAt: 1000,
        updatedAt: 2000
      });
    });

    it('handles null values correctly', () => {
      const row = {
        id: 'prov-123',
        name: 'Test Provider',
        type: 'claude',
        cli_path: null,
        env: null,
        is_default: 0,
        created_at: 1000,
        updated_at: 2000
      };

      const result = repository.mapRow(row);

      expect(result.cliPath).toBeNull();
      expect(result.env).toBeUndefined();
      expect(result.isDefault).toBe(false);
    });

    it('parses env JSON correctly', () => {
      const row = {
        id: 'prov-123',
        name: 'Provider',
        type: 'claude',
        env: '{"KEY1":"value1","KEY2":"value2"}',
        is_default: 0,
        created_at: 1000,
        updated_at: 2000
      };

      const result = repository.mapRow(row);

      expect(result.env).toEqual({
        KEY1: 'value1',
        KEY2: 'value2'
      });
    });
  });

  describe('createQuery', () => {
    it('generates INSERT query with all fields', () => {
      const data = {
        name: 'New Provider',
        type: 'claude',
        cliPath: '/path/to/cli',
        env: { API_KEY: 'test' },
        isDefault: true
      };

      const { sql, params } = repository.createQuery(data);

      expect(sql).toContain('INSERT INTO providers');
      expect(params[1]).toBe('New Provider');
      expect(params[2]).toBe('claude');
      expect(params[3]).toBe('/path/to/cli');
      expect(params[4]).toBe('{"API_KEY":"test"}');
      expect(params[5]).toBe(1);
    });

    it('uses default type when not specified', () => {
      const data = {
        name: 'Default Type'
      } as any;

      const { params } = repository.createQuery(data);

      expect(params[2]).toBe('claude');
    });

    it('converts isDefault to integer', () => {
      const dataTrue = { name: 'Test', isDefault: true } as any;
      const dataFalse = { name: 'Test', isDefault: false } as any;

      const { params: paramsTrue } = repository.createQuery(dataTrue);
      const { params: paramsFalse } = repository.createQuery(dataFalse);

      expect(paramsTrue[5]).toBe(1);
      expect(paramsFalse[5]).toBe(0);
    });

    it('generates UUID for id', () => {
      const data = { name: 'UUID Test' } as any;
      const { params } = repository.createQuery(data);

      expect(params[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('sets timestamps correctly', () => {
      const before = Date.now();
      const data = { name: 'Timestamps' } as any;
      const { params } = repository.createQuery(data);
      const after = Date.now();

      expect(params[6]).toBeGreaterThanOrEqual(before);
      expect(params[6]).toBeLessThanOrEqual(after);
      expect(params[7]).toBe(params[6]);
    });
  });

  describe('updateQuery', () => {
    it('generates UPDATE query for single field', () => {
      const { sql, params } = repository.updateQuery('prov-123', { name: 'Updated Name' });

      expect(sql).toContain('UPDATE providers SET');
      expect(sql).toContain('name = ?');
      expect(sql).toContain('updated_at = ?');
      expect(params).toContain('Updated Name');
      expect(params[params.length - 1]).toBe('prov-123');
    });

    it('generates UPDATE query for multiple fields', () => {
      const { sql, params } = repository.updateQuery('prov-123', {
        name: 'New Name',
        type: 'opencode',
        cliPath: '/new/path'
      });

      expect(sql).toContain('name = ?');
      expect(sql).toContain('type = ?');
      expect(sql).toContain('cli_path = ?');
      expect(params).toContain('New Name');
      expect(params).toContain('opencode');
      expect(params).toContain('/new/path');
    });

    it('handles env JSON serialization', () => {
      const { sql, params } = repository.updateQuery('prov-123', {
        env: { NEW_KEY: 'new-value' }
      });

      expect(sql).toContain('env = ?');
      expect(params).toContain('{"NEW_KEY":"new-value"}');
    });

    it('handles null env', () => {
      const { params } = repository.updateQuery('prov-123', {
        env: null
      });

      expect(params).toContain(null);
    });

    it('converts isDefault to integer', () => {
      const { params } = repository.updateQuery('prov-123', {
        isDefault: true
      });

      expect(params).toContain(1);
    });

    it('always updates updated_at timestamp', () => {
      const before = Date.now();
      const { params } = repository.updateQuery('prov-123', { name: 'Test' });
      const after = Date.now();

      const timestamp = params[params.length - 2];
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('findDefault', () => {
    it('returns default provider when found', () => {
      const mockRow = {
        id: 'prov-123',
        name: 'Default Provider',
        type: 'claude',
        is_default: 1,
        created_at: 1000,
        updated_at: 2000
      };
      mockDb.prepare().get.mockReturnValue(mockRow);

      const result = repository.findDefault();

      expect(result).not.toBeNull();
      expect(result?.id).toBe('prov-123');
      expect(result?.isDefault).toBe(true);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('WHERE is_default = 1'));
    });

    it('returns null when no default provider exists', () => {
      mockDb.prepare().get.mockReturnValue(undefined);

      const result = repository.findDefault();

      expect(result).toBeNull();
    });
  });

  describe('setDefault', () => {
    it('unsets all defaults and sets specified provider as default', () => {
      const mockRow = {
        id: 'prov-123',
        name: 'Test Provider',
        is_default: 1,
        created_at: 1000,
        updated_at: 2000
      };

      mockDb.prepare().run.mockReturnValue({ changes: 1 });
      mockDb.prepare().get.mockReturnValue(mockRow);

      const result = repository.setDefault('prov-123');

      expect(result.isDefault).toBe(true);
      expect(mockDb.prepare).toHaveBeenCalledWith('UPDATE providers SET is_default = 0');
    });

    it('throws error if provider not found', () => {
      mockDb.prepare().run.mockReturnValueOnce({ changes: 0 }); // First call for unset
      mockDb.prepare().run.mockReturnValueOnce({ changes: 0 }); // Second call for set

      expect(() => {
        repository.setDefault('non-existent');
      }).toThrow('Provider not found: non-existent');
    });

    it('throws error if update fails', () => {
      mockDb.prepare().run.mockReturnValueOnce({ changes: 0 }); // Unset
      mockDb.prepare().run.mockReturnValueOnce({ changes: 1 }); // Set
      mockDb.prepare().get.mockReturnValue(undefined); // findById returns null

      expect(() => {
        repository.setDefault('prov-123');
      }).toThrow('Failed to set default provider: prov-123');
    });
  });
});