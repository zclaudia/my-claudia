import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowRunRepository } from '../workflow-run.js';

vi.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

describe('WorkflowRunRepository', () => {
  let mockDb: any;
  let repo: WorkflowRunRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue([]),
        get: vi.fn(),
        run: vi.fn(),
      }),
    };
    repo = new WorkflowRunRepository(mockDb);
  });

  describe('mapRow', () => {
    it('maps row with all fields', () => {
      const result = repo.mapRow({
        id: 'r1', workflow_id: 'w1', project_id: 'p1', status: 'running',
        trigger_source: 'manual', trigger_detail: 'user', current_step_id: 's1',
        started_at: 100, completed_at: 200, error: 'err',
      });
      expect(result).toEqual({
        id: 'r1', workflowId: 'w1', projectId: 'p1', status: 'running',
        triggerSource: 'manual', triggerDetail: 'user', currentStepId: 's1',
        startedAt: 100, completedAt: 200, error: 'err',
      });
    });

    it('handles null optional fields', () => {
      const result = repo.mapRow({
        id: 'r1', workflow_id: 'w1', project_id: 'p1', status: 'pending',
        trigger_source: 'cron', trigger_detail: null, current_step_id: null,
        started_at: 100, completed_at: null, error: null,
      });
      expect(result.triggerDetail).toBeUndefined();
      expect(result.currentStepId).toBeUndefined();
      expect(result.completedAt).toBeUndefined();
      expect(result.error).toBeUndefined();
    });
  });

  describe('createQuery', () => {
    it('generates insert SQL', () => {
      const { sql, params } = repo.createQuery({
        workflowId: 'w1', projectId: 'p1', status: 'pending' as any,
        triggerSource: 'manual' as any, triggerDetail: 'user',
        currentStepId: 's1', startedAt: 100,
      });
      expect(sql).toContain('INSERT INTO workflow_runs');
      expect(params[0]).toBe('mock-uuid');
      expect(params[1]).toBe('w1');
    });

    it('handles nullable fields', () => {
      const { params } = repo.createQuery({
        workflowId: 'w1', projectId: 'p1', status: 'pending' as any,
        triggerSource: 'manual' as any, startedAt: 100,
      } as any);
      expect(params[5]).toBeNull(); // triggerDetail
      expect(params[6]).toBeNull(); // currentStepId
    });
  });

  describe('updateQuery', () => {
    it('generates update SQL with provided fields', () => {
      const { sql, params } = repo.updateQuery('r1', { status: 'completed' as any, error: 'fail' });
      expect(sql).toContain('UPDATE workflow_runs SET');
      expect(params).toContain('completed');
      expect(params).toContain('fail');
    });

    it('returns no-op query when no fields provided', () => {
      const { sql } = repo.updateQuery('r1', {});
      expect(sql).toContain('SELECT 1');
    });

    it('handles all optional fields', () => {
      const { sql } = repo.updateQuery('r1', {
        triggerDetail: 'd', currentStepId: 's2', completedAt: 200,
      });
      expect(sql).toContain('trigger_detail = ?');
      expect(sql).toContain('current_step_id = ?');
      expect(sql).toContain('completed_at = ?');
    });
  });

  describe('findByWorkflow', () => {
    it('queries by workflow_id with default limit', () => {
      repo.findByWorkflow('w1');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('workflow_id = ?'));
      expect(mockDb.prepare().all).toHaveBeenCalledWith('w1', 20);
    });

    it('accepts custom limit', () => {
      repo.findByWorkflow('w1', 5);
      expect(mockDb.prepare().all).toHaveBeenCalledWith('w1', 5);
    });
  });

  describe('findActiveByWorkflow', () => {
    it('returns null when not found', () => {
      mockDb.prepare().get.mockReturnValue(undefined);
      expect(repo.findActiveByWorkflow('w1')).toBeNull();
    });

    it('returns mapped row when found', () => {
      mockDb.prepare().get.mockReturnValue({
        id: 'r1', workflow_id: 'w1', project_id: 'p1', status: 'running',
        trigger_source: 'manual', started_at: 100,
      });
      expect(repo.findActiveByWorkflow('w1')).not.toBeNull();
    });
  });

  describe('findByProject', () => {
    it('queries by project_id with default limit', () => {
      repo.findByProject('p1');
      expect(mockDb.prepare().all).toHaveBeenCalledWith('p1', 50);
    });
  });
});
