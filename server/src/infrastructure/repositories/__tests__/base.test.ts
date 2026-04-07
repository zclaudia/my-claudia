import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseRepository } from '../base.js';
import type { Database } from 'better-sqlite3';

// Create a concrete implementation for testing
interface TestEntity {
  id: string;
  name: string;
  value: number;
}

interface TestCreate {
  name: string;
  value: number;
}

interface TestUpdate {
  name?: string;
  value?: number;
}

class TestRepository extends BaseRepository<TestEntity, TestCreate, TestUpdate> {
  mapRow(row: any): TestEntity {
    return {
      id: row.id,
      name: row.name,
      value: row.value
    };
  }

  createQuery(data: TestCreate): { sql: string; params: any[] } {
    return {
      sql: 'INSERT INTO test_table (id, name, value) VALUES (?, ?, ?)',
      params: ['test-id', data.name, data.value]
    };
  }

  updateQuery(id: string, data: TestUpdate): { sql: string; params: any[] } {
    const updates: string[] = [];
    const params: any[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      params.push(data.name);
    }
    if (data.value !== undefined) {
      updates.push('value = ?');
      params.push(data.value);
    }
    params.push(id);

    return {
      sql: `UPDATE test_table SET ${updates.join(', ')} WHERE id = ?`,
      params
    };
  }
}

describe('BaseRepository', () => {
  let mockDb: any;
  let repository: TestRepository;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn(),
        get: vi.fn(),
        run: vi.fn()
      })
    };

    repository = new TestRepository(mockDb, 'test_table');
  });

  describe('findAll', () => {
    it('returns all entities mapped to correct type', () => {
      const mockRows = [
        { id: '1', name: 'test1', value: 10 },
        { id: '2', name: 'test2', value: 20 }
      ];
      mockDb.prepare().all.mockReturnValue(mockRows);

      const result = repository.findAll();

      expect(result).toEqual([
        { id: '1', name: 'test1', value: 10 },
        { id: '2', name: 'test2', value: 20 }
      ]);
      expect(mockDb.prepare).toHaveBeenCalledWith('SELECT * FROM test_table');
    });

    it('returns empty array when no entities exist', () => {
      mockDb.prepare().all.mockReturnValue([]);

      const result = repository.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('findById', () => {
    it('returns entity when found', () => {
      const mockRow = { id: 'test-id', name: 'test', value: 42 };
      mockDb.prepare().get.mockReturnValue(mockRow);

      const result = repository.findById('test-id');

      expect(result).toEqual({ id: 'test-id', name: 'test', value: 42 });
      expect(mockDb.prepare).toHaveBeenCalledWith('SELECT * FROM test_table WHERE id = ?');
    });

    it('returns null when entity not found', () => {
      mockDb.prepare().get.mockReturnValue(undefined);

      const result = repository.findById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('creates entity and returns created record', () => {
      const mockRow = { id: 'test-id', name: 'new-entity', value: 100 };
      mockDb.prepare().run.mockReturnValue({ changes: 1 });
      mockDb.prepare().get.mockReturnValue(mockRow);

      const result = repository.create({ name: 'new-entity', value: 100 });

      expect(result).toEqual({ id: 'test-id', name: 'new-entity', value: 100 });
      expect(mockDb.prepare).toHaveBeenCalledWith('INSERT INTO test_table (id, name, value) VALUES (?, ?, ?)');
    });

    it('throws error if creation fails', () => {
      mockDb.prepare().run.mockReturnValue({ changes: 1 });
      mockDb.prepare().get.mockReturnValue(undefined);

      expect(() => {
        repository.create({ name: 'fail', value: 0 });
      }).toThrow('Failed to create test_table');
    });
  });

  describe('update', () => {
    it('updates entity and returns updated record', () => {
      const mockRow = { id: 'test-id', name: 'updated', value: 200 };
      mockDb.prepare().run.mockReturnValue({ changes: 1 });
      mockDb.prepare().get.mockReturnValue(mockRow);

      const result = repository.update('test-id', { name: 'updated', value: 200 });

      expect(result).toEqual({ id: 'test-id', name: 'updated', value: 200 });
    });

    it('throws error if entity not found', () => {
      mockDb.prepare().run.mockReturnValue({ changes: 0 });

      expect(() => {
        repository.update('non-existent', { name: 'fail' });
      }).toThrow('test_table not found: non-existent');
    });

    it('throws error if update fails', () => {
      mockDb.prepare().run.mockReturnValue({ changes: 1 });
      mockDb.prepare().get.mockReturnValue(undefined);

      expect(() => {
        repository.update('test-id', { name: 'fail' });
      }).toThrow('Failed to update test_table: test-id');
    });
  });

  describe('delete', () => {
    it('returns true when entity deleted', () => {
      mockDb.prepare().run.mockReturnValue({ changes: 1 });

      const result = repository.delete('test-id');

      expect(result).toBe(true);
      expect(mockDb.prepare).toHaveBeenCalledWith('DELETE FROM test_table WHERE id = ?');
    });

    it('returns false when entity not found', () => {
      mockDb.prepare().run.mockReturnValue({ changes: 0 });

      const result = repository.delete('non-existent');

      expect(result).toBe(false);
    });
  });
});
