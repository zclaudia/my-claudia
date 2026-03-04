import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectRepository } from '../project.js';
import type { Database } from 'better-sqlite3';

describe('ProjectRepository', () => {
  let mockDb: any;
  let repository: ProjectRepository;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn(),
        get: vi.fn(),
        run: vi.fn()
      })
    };

    repository = new ProjectRepository(mockDb);
  });

  describe('mapRow', () => {
    it('maps database row to Project entity with all fields', () => {
      const row = {
        id: 'proj-123',
        name: 'Test Project',
        type: 'code',
        provider_id: 'prov-456',
        root_path: '/path/to/project',
        system_prompt: 'Test prompt',
        permission_policy: '{"mode":"autoApprove"}',
        is_internal: 1,
        created_at: 1000,
        updated_at: 2000
      };

      const result = repository.mapRow(row);

      expect(result).toEqual({
        id: 'proj-123',
        name: 'Test Project',
        type: 'code',
        providerId: 'prov-456',
        rootPath: '/path/to/project',
        systemPrompt: 'Test prompt',
        permissionPolicy: { mode: 'autoApprove' },
        isInternal: true,
        createdAt: 1000,
        updatedAt: 2000
      });
    });

    it('handles null values correctly', () => {
      const row = {
        id: 'proj-123',
        name: 'Test',
        type: 'code',
        provider_id: null,
        root_path: null,
        system_prompt: null,
        permission_policy: null,
        is_internal: 0,
        created_at: 1000,
        updated_at: 2000
      };

      const result = repository.mapRow(row);

      expect(result.providerId).toBeNull();
      expect(result.rootPath).toBeNull();
      expect(result.systemPrompt).toBeNull();
      expect(result.permissionPolicy).toBeUndefined();
      expect(result.isInternal).toBe(false);
    });
  });

  describe('createQuery', () => {
    it('generates INSERT query with all fields', () => {
      const data = {
        name: 'New Project',
        type: 'code',
        providerId: 'prov-789',
        rootPath: '/new/path',
        systemPrompt: 'New prompt',
        permissionPolicy: { mode: 'askUser' }
      };

      const { sql, params } = repository.createQuery(data);

      expect(sql).toContain('INSERT INTO projects');
      expect(params[1]).toBe('New Project');
      expect(params[2]).toBe('code');
      expect(params[3]).toBe('prov-789');
      expect(params[4]).toBe('/new/path');
      expect(params[5]).toBe('New prompt');
      expect(params[6]).toBe('{"mode":"askUser"}');
    });

    it('uses default type when not specified', () => {
      const data = {
        name: 'Default Type'
      } as any;

      const { params } = repository.createQuery(data);

      expect(params[2]).toBe('code');
    });

    it('generates UUID for id', () => {
      const data = {
        name: 'UUID Test'
      } as any;

      const { params } = repository.createQuery(data);

      expect(params[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('sets timestamps correctly', () => {
      const before = Date.now();
      const data = { name: 'Timestamps' } as any;
      const { params } = repository.createQuery(data);
      const after = Date.now();

      expect(params[7]).toBeGreaterThanOrEqual(before);
      expect(params[7]).toBeLessThanOrEqual(after);
      expect(params[8]).toBe(params[7]); // createdAt === updatedAt
    });
  });

  describe('updateQuery', () => {
    it('generates UPDATE query for single field', () => {
      const { sql, params } = repository.updateQuery('proj-123', { name: 'Updated Name' });

      expect(sql).toContain('UPDATE projects SET');
      expect(sql).toContain('name = ?');
      expect(sql).toContain('updated_at = ?');
      expect(params).toContain('Updated Name');
      expect(params[params.length - 1]).toBe('proj-123');
    });

    it('generates UPDATE query for multiple fields', () => {
      const { sql, params } = repository.updateQuery('proj-123', {
        name: 'New Name',
        type: 'sdk',
        providerId: 'new-prov'
      });

      expect(sql).toContain('name = ?');
      expect(sql).toContain('type = ?');
      expect(sql).toContain('provider_id = ?');
      expect(params).toContain('New Name');
      expect(params).toContain('sdk');
      expect(params).toContain('new-prov');
    });

    it('handles permission_policy JSON serialization', () => {
      const { sql, params } = repository.updateQuery('proj-123', {
        permissionPolicy: { mode: 'autoApprove' }
      });

      expect(sql).toContain('permission_policy = ?');
      expect(params).toContain('{"mode":"autoApprove"}');
    });

    it('handles null permission_policy', () => {
      const { params } = repository.updateQuery('proj-123', {
        permissionPolicy: null
      });

      expect(params).toContain(null);
    });

    it('always updates updated_at timestamp', () => {
      const before = Date.now();
      const { params } = repository.updateQuery('proj-123', { name: 'Test' });
      const after = Date.now();

      const timestamp = params[params.length - 2]; // Second to last param
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });
});