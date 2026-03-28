import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowRepository } from '../repository.js';

vi.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

describe('WorkflowRepository', () => {
  let mockDb: any;
  let repo: WorkflowRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue([]),
        get: vi.fn(),
        run: vi.fn(),
      }),
    };
    repo = new WorkflowRepository(mockDb);
  });

  describe('mapRow', () => {
    it('maps row with all fields', () => {
      const row = {
        id: 'w1', project_id: 'p1', name: 'flow', description: 'desc',
        status: 'active', definition: '{"nodes":[],"edges":[],"entryNodeId":"","triggers":[]}', template_id: 'tpl1',
        created_at: 100, updated_at: 200,
      };
      const result = repo.mapRow(row);
      expect(result).toEqual({
        id: 'w1', projectId: 'p1', name: 'flow', description: 'desc',
        status: 'active', definition: { nodes: [], edges: [], entryNodeId: '', triggers: [] }, templateId: 'tpl1',
        createdAt: 100, updatedAt: 200,
      });
    });

    it('handles null optional fields', () => {
      const row = {
        id: 'w1', project_id: 'p1', name: 'flow', description: null,
        status: 'active', definition: null, template_id: null,
        created_at: 100, updated_at: 200,
      };
      const result = repo.mapRow(row);
      expect(result.description).toBeUndefined();
      expect(result.templateId).toBeUndefined();
    });

    it('normalizes legacy step-based definitions', () => {
      const row = {
        id: 'w1',
        project_id: 'p1',
        name: 'legacy',
        status: 'active',
        definition: JSON.stringify({
          version: 1,
          steps: [
            { id: 's1', name: 'First', type: 'shell', config: { command: 'echo 1' } },
            { id: 's2', name: 'Second', type: 'shell', config: { command: 'echo 2' } },
          ],
          triggers: [{ type: 'manual' }],
        }),
        created_at: 100,
        updated_at: 200,
      };

      const result = repo.mapRow(row);
      expect(result.definition).toEqual({
        nodes: [
          { id: 's1', name: 'First', type: 'shell', config: { command: 'echo 1' }, position: { x: 300, y: 0 } },
          { id: 's2', name: 'Second', type: 'shell', config: { command: 'echo 2' }, position: { x: 300, y: 150 } },
        ],
        edges: [
          { id: 'edge_s1_to_s2', source: 's1', target: 's2', type: 'success' },
        ],
        entryNodeId: 's1',
        triggers: [{ type: 'manual' }],
      });
    });
  });

  describe('createQuery', () => {
    it('generates insert SQL', () => {
      const { sql, params } = repo.createQuery({
        projectId: 'p1', name: 'flow', description: 'desc',
        status: 'active' as any, definition: { nodes: [], edges: [], entryNodeId: '', triggers: [] } as any, templateId: 'tpl1',
      });
      expect(sql).toContain('INSERT INTO workflows');
      expect(params[0]).toBe('mock-uuid');
      expect(params[1]).toBe('p1');
      expect(params[5]).toBe('{"nodes":[],"edges":[],"entryNodeId":"","triggers":[]}');
    });

    it('handles nullable fields', () => {
      const { params } = repo.createQuery({
        projectId: 'p1', name: 'flow', status: 'active' as any, definition: {} as any,
      } as any);
      expect(params[3]).toBeNull(); // description
      expect(params[6]).toBeNull(); // templateId
    });
  });

  describe('updateQuery', () => {
    it('generates update SQL', () => {
      const { sql, params } = repo.updateQuery('w1', { name: 'new', status: 'disabled' as any });
      expect(sql).toContain('UPDATE workflows SET');
      expect(sql).toContain('name = ?');
      expect(params[params.length - 1]).toBe('w1');
    });

    it('handles definition serialization', () => {
      const { params } = repo.updateQuery('w1', { definition: { nodes: [{ id: 'n1' }], edges: [], entryNodeId: 'n1', triggers: [] } as any });
      expect(params).toContain('{"nodes":[{"id":"n1"}],"edges":[],"entryNodeId":"n1","triggers":[]}');
    });

    it('handles templateId', () => {
      const { sql } = repo.updateQuery('w1', { templateId: 'tpl2' });
      expect(sql).toContain('template_id = ?');
    });
  });

  describe('findByProject', () => {
    it('queries by project_id', () => {
      repo.findByProject('p1');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('project_id = ?'));
    });
  });

  describe('findByProjectAndTemplate', () => {
    it('returns null when not found', () => {
      mockDb.prepare().get.mockReturnValue(undefined);
      expect(repo.findByProjectAndTemplate('p1', 'tpl1')).toBeNull();
    });

    it('returns mapped row when found', () => {
      mockDb.prepare().get.mockReturnValue({
        id: 'w1', project_id: 'p1', name: 'flow', status: 'active',
        definition: '{}', created_at: 100, updated_at: 200,
      });
      const result = repo.findByProjectAndTemplate('p1', 'tpl1');
      expect(result).not.toBeNull();
    });
  });

  describe('findAllActive', () => {
    it('queries for active workflows', () => {
      repo.findAllActive();
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("status = 'active'"));
    });
  });
});
