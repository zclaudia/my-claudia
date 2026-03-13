import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowStepRunRepository } from '../workflow-step-run.js';

vi.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

describe('WorkflowStepRunRepository', () => {
  let mockDb: any;
  let repo: WorkflowStepRunRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue([]),
        get: vi.fn(),
        run: vi.fn(),
      }),
    };
    repo = new WorkflowStepRunRepository(mockDb);
  });

  describe('mapRow', () => {
    it('maps row with all fields', () => {
      const result = repo.mapRow({
        id: 'sr1', run_id: 'r1', step_id: 's1', step_type: 'ai_prompt',
        status: 'completed', input: '{"x":1}', output: '{"y":2}',
        error: 'err', attempt: 2, session_id: 'sess1',
        started_at: 100, completed_at: 200,
      });
      expect(result).toEqual({
        id: 'sr1', runId: 'r1', stepId: 's1', stepType: 'ai_prompt',
        status: 'completed', input: { x: 1 }, output: { y: 2 },
        error: 'err', attempt: 2, sessionId: 'sess1',
        startedAt: 100, completedAt: 200,
      });
    });

    it('handles null optional fields', () => {
      const result = repo.mapRow({
        id: 'sr1', run_id: 'r1', step_id: 's1', step_type: 'ai_prompt',
        status: 'pending', input: null, output: null,
        error: null, attempt: 1, session_id: null,
        started_at: null, completed_at: null,
      });
      expect(result.input).toBeUndefined();
      expect(result.output).toBeUndefined();
      expect(result.error).toBeUndefined();
      expect(result.sessionId).toBeUndefined();
    });
  });

  describe('createQuery', () => {
    it('generates insert SQL', () => {
      const { sql, params } = repo.createQuery({
        runId: 'r1', stepId: 's1', stepType: 'ai_prompt' as any,
        status: 'pending' as any, attempt: 1, sessionId: 'sess1',
      });
      expect(sql).toContain('INSERT INTO workflow_step_runs');
      expect(params[0]).toBe('mock-uuid');
      expect(params[6]).toBe('sess1');
    });

    it('defaults nullable fields', () => {
      const { params } = repo.createQuery({
        runId: 'r1', stepId: 's1', stepType: 'ai_prompt' as any,
        status: 'pending' as any,
      } as any);
      expect(params[5]).toBe(1); // default attempt
      expect(params[6]).toBeNull(); // sessionId
    });
  });

  describe('updateQuery', () => {
    it('generates update SQL', () => {
      const { sql, params } = repo.updateQuery('sr1', {
        status: 'completed' as any, error: 'fail',
      });
      expect(sql).toContain('UPDATE workflow_step_runs SET');
      expect(params).toContain('completed');
      expect(params).toContain('fail');
    });

    it('returns no-op query when no fields', () => {
      const { sql } = repo.updateQuery('sr1', {});
      expect(sql).toContain('SELECT 1');
    });

    it('serializes input and output', () => {
      const { params } = repo.updateQuery('sr1', {
        input: { x: 1 } as any, output: { y: 2 } as any,
      });
      expect(params).toContain('{"x":1}');
      expect(params).toContain('{"y":2}');
    });

    it('handles all optional fields', () => {
      const { sql } = repo.updateQuery('sr1', {
        attempt: 2, sessionId: 's', startedAt: 1, completedAt: 2,
      });
      expect(sql).toContain('attempt = ?');
      expect(sql).toContain('session_id = ?');
      expect(sql).toContain('started_at = ?');
      expect(sql).toContain('completed_at = ?');
    });
  });

  describe('findByRun', () => {
    it('queries by run_id', () => {
      repo.findByRun('r1');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('run_id = ?'));
      expect(mockDb.prepare().all).toHaveBeenCalledWith('r1');
    });
  });

  describe('findByRunAndStep', () => {
    it('returns null when not found', () => {
      mockDb.prepare().get.mockReturnValue(undefined);
      expect(repo.findByRunAndStep('r1', 's1')).toBeNull();
    });

    it('returns mapped row when found', () => {
      mockDb.prepare().get.mockReturnValue({
        id: 'sr1', run_id: 'r1', step_id: 's1', step_type: 'ai_prompt',
        status: 'completed', attempt: 1,
      });
      expect(repo.findByRunAndStep('r1', 's1')).not.toBeNull();
    });
  });
});
