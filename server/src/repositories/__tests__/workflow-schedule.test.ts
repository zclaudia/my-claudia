import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowScheduleRepository } from '../workflow-schedule.js';

vi.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

describe('WorkflowScheduleRepository', () => {
  let mockDb: any;
  let repo: WorkflowScheduleRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue([]),
        get: vi.fn(),
        run: vi.fn(),
      }),
    };
    repo = new WorkflowScheduleRepository(mockDb);
  });

  describe('findByWorkflow', () => {
    it('returns null when not found', () => {
      mockDb.prepare().get.mockReturnValue(undefined);
      expect(repo.findByWorkflow('w1')).toBeNull();
    });

    it('returns mapped schedule when found', () => {
      mockDb.prepare().get.mockReturnValue({
        id: 's1', workflow_id: 'w1', trigger_index: 0, next_run: 1000, enabled: 1,
      });
      const result = repo.findByWorkflow('w1');
      expect(result).toEqual({
        id: 's1', workflowId: 'w1', triggerIndex: 0, nextRun: 1000, enabled: true,
      });
    });

    it('handles disabled schedule', () => {
      mockDb.prepare().get.mockReturnValue({
        id: 's1', workflow_id: 'w1', trigger_index: 0, next_run: null, enabled: 0,
      });
      const result = repo.findByWorkflow('w1');
      expect(result!.enabled).toBe(false);
      expect(result!.nextRun).toBeNull();
    });
  });

  describe('findDue', () => {
    it('queries for enabled schedules with next_run <= now', () => {
      repo.findDue(5000);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('next_run <= ?'));
      expect(mockDb.prepare().all).toHaveBeenCalledWith(5000);
    });
  });

  describe('upsert', () => {
    it('updates existing schedule', () => {
      mockDb.prepare().get.mockReturnValue({
        id: 's1', workflow_id: 'w1', trigger_index: 0, next_run: 1000, enabled: 1,
      });
      const result = repo.upsert('w1', 1, 2000, false);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE workflow_schedules'));
      expect(result.triggerIndex).toBe(1);
      expect(result.nextRun).toBe(2000);
      expect(result.enabled).toBe(false);
    });

    it('inserts new schedule when not existing', () => {
      mockDb.prepare().get.mockReturnValue(undefined);
      const result = repo.upsert('w1', 0, 1000, true);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO workflow_schedules'));
      expect(result.id).toBe('mock-uuid');
      expect(result.workflowId).toBe('w1');
      expect(result.enabled).toBe(true);
    });
  });

  describe('updateNextRun', () => {
    it('updates next_run for workflow', () => {
      repo.updateNextRun('w1', 3000);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE workflow_schedules SET next_run'));
      expect(mockDb.prepare().run).toHaveBeenCalledWith(3000, 'w1');
    });

    it('can set next_run to null', () => {
      repo.updateNextRun('w1', null);
      expect(mockDb.prepare().run).toHaveBeenCalledWith(null, 'w1');
    });
  });

  describe('deleteByWorkflow', () => {
    it('deletes schedule by workflow_id', () => {
      repo.deleteByWorkflow('w1');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM workflow_schedules'));
      expect(mockDb.prepare().run).toHaveBeenCalledWith('w1');
    });
  });
});
