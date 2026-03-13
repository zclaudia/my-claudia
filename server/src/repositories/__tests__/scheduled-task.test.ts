import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScheduledTaskRepository } from '../scheduled-task.js';

vi.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

describe('ScheduledTaskRepository', () => {
  let mockDb: any;
  let repo: ScheduledTaskRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue([]),
        get: vi.fn(),
        run: vi.fn(),
      }),
    };
    repo = new ScheduledTaskRepository(mockDb);
  });

  describe('mapRow', () => {
    it('maps row with all fields', () => {
      const row = {
        id: 't1', project_id: 'p1', name: 'task', description: 'desc',
        enabled: 1, schedule_type: 'cron', schedule_cron: '* * * * *',
        schedule_interval_minutes: 5, schedule_once_at: '2026-01-01',
        next_run: 1000, action_type: 'prompt', action_config: '{"prompt":"hi"}',
        status: 'idle', last_run_at: 500, last_run_result: 'ok',
        last_error: 'err', run_count: 3, template_id: 'tpl1',
        created_at: 100, updated_at: 200,
      };
      const result = repo.mapRow(row);
      expect(result).toEqual({
        id: 't1', projectId: 'p1', name: 'task', description: 'desc',
        enabled: true, scheduleType: 'cron', scheduleCron: '* * * * *',
        scheduleIntervalMinutes: 5, scheduleOnceAt: '2026-01-01',
        nextRun: 1000, actionType: 'prompt', actionConfig: { prompt: 'hi' },
        status: 'idle', lastRunAt: 500, lastRunResult: 'ok',
        lastError: 'err', runCount: 3, templateId: 'tpl1',
        createdAt: 100, updatedAt: 200,
      });
    });

    it('handles null optional fields', () => {
      const row = {
        id: 't1', project_id: null, name: 'task', description: null,
        enabled: 0, schedule_type: 'interval', schedule_cron: null,
        schedule_interval_minutes: null, schedule_once_at: null,
        next_run: null, action_type: 'prompt', action_config: '{}',
        status: 'idle', last_run_at: null, last_run_result: null,
        last_error: null, run_count: 0, template_id: null,
        created_at: 100, updated_at: 200,
      };
      const result = repo.mapRow(row);
      expect(result.enabled).toBe(false);
      expect(result.projectId).toBeUndefined();
      expect(result.description).toBeUndefined();
      expect(result.scheduleCron).toBeUndefined();
    });
  });

  describe('createQuery', () => {
    it('generates insert SQL with all fields', () => {
      const data = {
        projectId: 'p1', name: 'task', description: 'desc',
        enabled: true, scheduleType: 'cron' as any, scheduleCron: '* * * * *',
        scheduleIntervalMinutes: undefined, scheduleOnceAt: undefined,
        nextRun: 1000, actionType: 'prompt' as any,
        actionConfig: { prompt: 'hi' }, templateId: 'tpl1',
      };
      const { sql, params } = repo.createQuery(data);
      expect(sql).toContain('INSERT INTO scheduled_tasks');
      expect(params[0]).toBe('mock-uuid');
      expect(params[2]).toBe('task');
      expect(params[11]).toBe('{"prompt":"hi"}');
    });

    it('handles nullable fields', () => {
      const data = {
        name: 'task', enabled: false, scheduleType: 'interval' as any,
        actionType: 'prompt' as any, actionConfig: {},
      };
      const { params } = repo.createQuery(data as any);
      expect(params[1]).toBeNull(); // projectId
      expect(params[3]).toBeNull(); // description
    });
  });

  describe('updateQuery', () => {
    it('generates update SQL with provided fields', () => {
      const { sql, params } = repo.updateQuery('t1', { name: 'new', enabled: true, status: 'running' as any });
      expect(sql).toContain('UPDATE scheduled_tasks SET');
      expect(sql).toContain('name = ?');
      expect(sql).toContain('enabled = ?');
      expect(sql).toContain('status = ?');
      expect(params).toContain('new');
      expect(params).toContain(1); // enabled
      expect(params[params.length - 1]).toBe('t1');
    });

    it('includes all optional fields when set', () => {
      const { sql } = repo.updateQuery('t1', {
        description: 'd', scheduleCron: 'c', scheduleIntervalMinutes: 5,
        scheduleOnceAt: 'o', nextRun: 1, actionConfig: {}, lastRunAt: 2,
        lastRunResult: 'ok', lastError: null, runCount: 1,
      });
      expect(sql).toContain('description = ?');
      expect(sql).toContain('schedule_cron = ?');
      expect(sql).toContain('run_count = ?');
    });
  });

  describe('findByProjectId', () => {
    it('queries by project_id', () => {
      repo.findByProjectId('p1');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('project_id = ?'));
      expect(mockDb.prepare().all).toHaveBeenCalledWith('p1');
    });
  });

  describe('findGlobalTasks', () => {
    it('queries for null project_id', () => {
      repo.findGlobalTasks();
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('project_id IS NULL'));
    });
  });

  describe('findDueTasks', () => {
    it('queries for enabled tasks with next_run <= now', () => {
      repo.findDueTasks(5000);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('next_run <= ?'));
      expect(mockDb.prepare().all).toHaveBeenCalledWith(5000);
    });
  });

  describe('findByTemplateId', () => {
    it('queries with projectId', () => {
      repo.findByTemplateId('p1', 'tpl1');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('project_id = ? AND template_id = ?'));
      expect(mockDb.prepare().get).toHaveBeenCalledWith('p1', 'tpl1');
    });

    it('queries without projectId', () => {
      repo.findByTemplateId(null, 'tpl1');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('project_id IS NULL AND template_id = ?'));
      expect(mockDb.prepare().get).toHaveBeenCalledWith('tpl1');
    });

    it('returns null when no row found', () => {
      mockDb.prepare().get.mockReturnValue(undefined);
      expect(repo.findByTemplateId('p1', 'tpl1')).toBeNull();
    });

    it('returns mapped row when found', () => {
      mockDb.prepare().get.mockReturnValue({
        id: 't1', project_id: 'p1', name: 'task', enabled: 1,
        schedule_type: 'cron', action_type: 'prompt', action_config: '{}',
        status: 'idle', run_count: 0, created_at: 100, updated_at: 200,
      });
      const result = repo.findByTemplateId('p1', 'tpl1');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('t1');
    });
  });
});
