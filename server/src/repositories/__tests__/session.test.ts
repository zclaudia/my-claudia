import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionRepository } from '../session.js';
import type { Database } from 'better-sqlite3';

describe('SessionRepository', () => {
  let mockDb: any;
  let repository: SessionRepository;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn(),
        get: vi.fn(),
        run: vi.fn()
      })
    };

    repository = new SessionRepository(mockDb);
  });

  describe('mapRow', () => {
    it('maps database row to Session entity with all fields', () => {
      const row = {
        id: 'sess-123',
        project_id: 'proj-456',
        name: 'Test Session',
        provider_id: 'prov-789',
        sdk_session_id: 'sdk-sess-123',
        type: 'regular',
        parent_session_id: 'parent-sess-123',
        working_directory: '/path/to/work',
        created_at: 1000,
        updated_at: 2000,
        archived_at: 3000
      };

      const result = repository.mapRow(row);

      expect(result).toEqual({
        id: 'sess-123',
        projectId: 'proj-456',
        name: 'Test Session',
        providerId: 'prov-789',
        sdkSessionId: 'sdk-sess-123',
        type: 'regular',
        parentSessionId: 'parent-sess-123',
        workingDirectory: '/path/to/work',
        createdAt: 1000,
        updatedAt: 2000,
        archivedAt: 3000,
        projectRole: undefined,
        taskId: undefined,
      });
    });

    it('handles null values correctly', () => {
      const row = {
        id: 'sess-123',
        project_id: 'proj-456',
        name: null,
        provider_id: null,
        sdk_session_id: null,
        type: 'regular',
        parent_session_id: null,
        working_directory: null,
        created_at: 1000,
        updated_at: 2000,
        archived_at: null
      };

      const result = repository.mapRow(row);

      expect(result.name).toBeNull();
      expect(result.providerId).toBeNull();
      expect(result.sdkSessionId).toBeNull();
      expect(result.parentSessionId).toBeUndefined();
      expect(result.workingDirectory).toBeUndefined();
      expect(result.archivedAt).toBeUndefined();
    });

    it('uses default type when not specified', () => {
      const row = {
        id: 'sess-123',
        project_id: 'proj-456',
        type: null,
        created_at: 1000,
        updated_at: 2000
      };

      const result = repository.mapRow(row);

      expect(result.type).toBe('regular');
    });
  });

  describe('createQuery', () => {
    it('generates INSERT query with all fields', () => {
      const data = {
        projectId: 'proj-123',
        name: 'New Session',
        providerId: 'prov-456',
        sdkSessionId: 'sdk-789',
        type: 'sdk',
        parentSessionId: 'parent-123',
        workingDirectory: '/work/path'
      };

      const { sql, params } = repository.createQuery(data);

      expect(sql).toContain('INSERT INTO sessions');
      expect(params[1]).toBe('proj-123');
      expect(params[2]).toBe('New Session');
      expect(params[3]).toBe('prov-456');
      expect(params[4]).toBe('sdk-789');
      expect(params[5]).toBe('sdk');
      expect(params[6]).toBe('parent-123');
      expect(params[7]).toBe('/work/path');
    });

    it('uses default type when not specified', () => {
      const data = {
        projectId: 'proj-123'
      } as any;

      const { params } = repository.createQuery(data);

      expect(params[5]).toBe('regular');
    });

    it('generates UUID for id', () => {
      const data = {
        projectId: 'proj-123'
      } as any;

      const { params } = repository.createQuery(data);

      expect(params[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('sets timestamps correctly', () => {
      const before = Date.now();
      const data = { projectId: 'proj-123' } as any;
      const { params } = repository.createQuery(data);
      const after = Date.now();

      // params: [id, projectId, name, providerId, sdkSessionId, type, parentSessionId, workingDirectory, projectRole, taskId, createdAt, updatedAt]
      expect(params[10]).toBeGreaterThanOrEqual(before);
      expect(params[10]).toBeLessThanOrEqual(after);
      expect(params[11]).toBe(params[10]); // createdAt === updatedAt
    });
  });

  describe('updateQuery', () => {
    it('generates UPDATE query for single field', () => {
      const { sql, params } = repository.updateQuery('sess-123', { name: 'Updated Name' });

      expect(sql).toContain('UPDATE sessions SET');
      expect(sql).toContain('name = ?');
      expect(sql).toContain('updated_at = ?');
      expect(params).toContain('Updated Name');
      expect(params[params.length - 1]).toBe('sess-123');
    });

    it('generates UPDATE query for multiple fields', () => {
      const { sql, params } = repository.updateQuery('sess-123', {
        name: 'New Name',
        providerId: 'new-prov',
        sdkSessionId: 'new-sdk'
      });

      expect(sql).toContain('name = ?');
      expect(sql).toContain('provider_id = ?');
      expect(sql).toContain('sdk_session_id = ?');
      expect(params).toContain('New Name');
      expect(params).toContain('new-prov');
      expect(params).toContain('new-sdk');
    });

    it('handles archivedAt field', () => {
      const timestamp = Date.now();
      const { sql, params } = repository.updateQuery('sess-123', {
        archivedAt: timestamp
      });

      expect(sql).toContain('archived_at = ?');
      expect(params).toContain(timestamp);
    });

    it('handles workingDirectory with null', () => {
      const { params } = repository.updateQuery('sess-123', {
        workingDirectory: null
      });

      expect(params).toContain(null);
    });

    it('always updates updated_at timestamp', () => {
      const before = Date.now();
      const { params } = repository.updateQuery('sess-123', { name: 'Test' });
      const after = Date.now();

      const timestamp = params[params.length - 2];
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('findByProjectId', () => {
    it('returns sessions for a project ordered by updated_at DESC', () => {
      const mockRows = [
        { id: 'sess-1', project_id: 'proj-123', created_at: 1000, updated_at: 3000 },
        { id: 'sess-2', project_id: 'proj-123', created_at: 2000, updated_at: 2000 }
      ];
      mockDb.prepare().all.mockReturnValue(mockRows);

      const result = repository.findByProjectId('proj-123');

      expect(result).toHaveLength(2);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('WHERE project_id = ?'));
    });
  });

  describe('findByProjectRole', () => {
    it('returns sessions matching project and role', () => {
      const mockRows = [
        { id: 'sess-1', project_id: 'proj-123', project_role: 'checkpoint', created_at: 2000, updated_at: 2000 },
        { id: 'sess-2', project_id: 'proj-123', project_role: 'checkpoint', created_at: 1000, updated_at: 1000 }
      ];
      mockDb.prepare().all.mockReturnValue(mockRows);

      const result = repository.findByProjectRole('proj-123', 'checkpoint');

      expect(result).toHaveLength(2);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('WHERE project_id = ? AND project_role = ?'));
    });

    it('returns empty array when no sessions match', () => {
      mockDb.prepare().all.mockReturnValue([]);

      const result = repository.findByProjectRole('proj-123', 'review');

      expect(result).toHaveLength(0);
    });

    it('orders results by created_at DESC', () => {
      mockDb.prepare().all.mockReturnValue([]);

      repository.findByProjectRole('proj-123', 'task');

      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'));
    });
  });

  describe('findBySdkSessionId', () => {
    it('returns session when found by SDK session ID', () => {
      const mockRow = {
        id: 'sess-123',
        project_id: 'proj-456',
        sdk_session_id: 'sdk-789',
        created_at: 1000,
        updated_at: 2000
      };
      mockDb.prepare().get.mockReturnValue(mockRow);

      const result = repository.findBySdkSessionId('sdk-789');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('sess-123');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('WHERE sdk_session_id = ?'));
    });

    it('returns null when SDK session ID not found', () => {
      mockDb.prepare().get.mockReturnValue(undefined);

      const result = repository.findBySdkSessionId('non-existent');

      expect(result).toBeNull();
    });
  });
});