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
        updatedAt: 2000,
        agent: undefined,
        contextSyncStatus: undefined,
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

    it('parses agent JSON', () => {
      const row = {
        id: 'proj-1', name: 'Test', type: 'code',
        created_at: 1000, updated_at: 2000,
        agent: '{"name":"bot"}', context_sync_status: 'synced',
      };
      expect(repository.mapRow(row).agent).toEqual({ name: 'bot' });
    });

    it('maps context_sync_status error', () => {
      const row = {
        id: 'proj-1', name: 'Test', type: 'code',
        created_at: 1000, updated_at: 2000,
        context_sync_status: 'error',
      };
      expect(repository.mapRow(row).contextSyncStatus).toBe('error');
    });

    it('maps reviewProviderId', () => {
      const row = {
        id: 'proj-1', name: 'Test', type: 'code',
        created_at: 1000, updated_at: 2000,
        review_provider_id: 'rev-1',
      };
      expect(repository.mapRow(row).reviewProviderId).toBe('rev-1');
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

      // params: [id, name, type, providerId, rootPath, systemPrompt, permissionPolicy, agent, contextSyncStatus, createdAt, updatedAt]
      expect(params[9]).toBeGreaterThanOrEqual(before);
      expect(params[9]).toBeLessThanOrEqual(after);
      expect(params[10]).toBe(params[9]); // createdAt === updatedAt
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

    it('handles rootPath update', () => {
      const { sql } = repository.updateQuery('proj-1', { rootPath: '/new/path' });
      expect(sql).toContain('root_path = ?');
    });

    it('handles systemPrompt update', () => {
      const { sql } = repository.updateQuery('proj-1', { systemPrompt: 'new prompt' });
      expect(sql).toContain('system_prompt = ?');
    });

    it('handles agent JSON in update', () => {
      const { sql, params } = repository.updateQuery('proj-1', { agent: { name: 'bot' } as any });
      expect(sql).toContain('agent = ?');
      expect(params).toContain('{"name":"bot"}');
    });

    it('handles null agent in update', () => {
      const { params } = repository.updateQuery('proj-1', { agent: null as any });
      expect(params).toContain(null);
    });

    it('handles contextSyncStatus update', () => {
      const { sql } = repository.updateQuery('proj-1', { contextSyncStatus: 'error' as any });
      expect(sql).toContain('context_sync_status = ?');
    });

    it('handles reviewProviderId update', () => {
      const { sql } = repository.updateQuery('proj-1', { reviewProviderId: 'rev-1' as any });
      expect(sql).toContain('review_provider_id = ?');
    });
  });
});