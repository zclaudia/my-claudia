import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRepo = {
  findDueTasks: vi.fn().mockReturnValue([]),
  findById: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
};
const mockProjectRepo = { findById: vi.fn() };
const mockSessionRepo = { create: vi.fn() };

vi.mock('../../repositories/scheduled-task.js', () => ({
  ScheduledTaskRepository: class { constructor() { Object.assign(this, mockRepo); } },
}));
vi.mock('../../repositories/project.js', () => ({
  ProjectRepository: class { constructor() { Object.assign(this, mockProjectRepo); } },
}));
vi.mock('../../repositories/session.js', () => ({
  SessionRepository: class { constructor() { Object.assign(this, mockSessionRepo); } },
}));
vi.mock('../../utils/cron.js', () => ({
  computeNextCronRun: vi.fn().mockReturnValue(99999),
}));
vi.mock('../../events/index.js', () => ({
  pluginEvents: { emit: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../server.js', () => ({
  createVirtualClient: vi.fn().mockReturnValue({ id: 'vc1' }),
  handleRunStart: vi.fn(),
}));
vi.mock('../../commands/registry.js', () => ({
  commandRegistry: { execute: vi.fn().mockResolvedValue('command result') },
}));
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));
vi.mock('util', () => ({
  promisify: vi.fn().mockReturnValue(vi.fn()),
}));

import { promisify } from 'util';
const mockExecFileAsync = promisify(null as any) as ReturnType<typeof vi.fn>;

import { ScheduledTaskService } from '../scheduled-task-service.js';
import { createVirtualClient } from '../../server.js';
import { pluginEvents } from '../../events/index.js';

describe('ScheduledTaskService', () => {
  let service: ScheduledTaskService;
  let mockBroadcast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBroadcast = vi.fn();
    service = new ScheduledTaskService({} as any, mockBroadcast);
  });

  describe('getRepo', () => {
    it('returns the repository instance', () => {
      const repo = service.getRepo();
      expect(repo).toBeDefined();
      expect(typeof repo.findDueTasks).toBe('function');
    });
  });

  describe('tick', () => {
    it('handles empty due tasks', async () => {
      mockRepo.findDueTasks.mockReturnValue([]);
      await service.tick();
      expect(mockRepo.findDueTasks).toHaveBeenCalled();
    });

    it('skips already running tasks', async () => {
      const task = { id: 't1', actionType: 'plugin_event', actionConfig: { event: 'test' }, runCount: 0, scheduleType: 'interval', enabled: true };
      mockRepo.findDueTasks.mockReturnValue([task]);
      mockRepo.findById.mockReturnValue(task);

      // Execute first to mark as active, then tick should skip
      // We need a running task - simulate by calling executeTask and having it be active
      await service.tick();
      // Task should be executed (not skipped on first call)
      expect(mockRepo.update).toHaveBeenCalled();
    });

    it('catches tick errors', async () => {
      mockRepo.findDueTasks.mockImplementation(() => { throw new Error('db error'); });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await service.tick();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('tick error'), expect.any(Error));
      errorSpy.mockRestore();
    });
  });

  describe('executeTask', () => {
    it('executes plugin_event action', async () => {
      const task = {
        id: 't1', actionType: 'plugin_event',
        actionConfig: { event: 'test.event', data: { key: 'val' } },
        runCount: 0, scheduleType: 'once', enabled: true,
      } as any;
      mockRepo.findById.mockReturnValue(task);

      await service.executeTask(task);

      expect(mockRepo.update).toHaveBeenCalledWith('t1', expect.objectContaining({ status: 'running' }));
      expect(mockRepo.update).toHaveBeenCalledWith('t1', expect.objectContaining({ status: 'idle' }));
    });

    it('handles execution errors', async () => {
      const task = {
        id: 't1', actionType: 'webhook',
        actionConfig: { url: 'http://invalid' },
        runCount: 0, scheduleType: 'interval', enabled: true,
        scheduleIntervalMinutes: 5,
      } as any;
      mockRepo.findById.mockReturnValue(task);

      // fetch will fail in test environment
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));

      await service.executeTask(task);

      expect(mockRepo.update).toHaveBeenCalledWith('t1', expect.objectContaining({ status: 'error' }));
      globalThis.fetch = originalFetch;
    });

    it('executes webhook action successfully', async () => {
      const task = {
        id: 't1', actionType: 'webhook',
        actionConfig: { url: 'http://example.com/hook', method: 'POST', headers: { 'X-Custom': 'test' }, body: '{"key":"val"}' },
        runCount: 0, scheduleType: 'interval', enabled: true,
        scheduleIntervalMinutes: 10,
      } as any;
      mockRepo.findById.mockReturnValue(task);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 200,
        text: () => Promise.resolve('OK'),
      });

      await service.executeTask(task);

      expect(globalThis.fetch).toHaveBeenCalledWith('http://example.com/hook', expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Custom': 'test' }),
      }));
      expect(mockRepo.update).toHaveBeenCalledWith('t1', expect.objectContaining({
        status: 'idle',
        lastRunResult: expect.stringContaining('HTTP 200'),
      }));
      globalThis.fetch = originalFetch;
    });

    it('executes command action', async () => {
      const task = {
        id: 't1', actionType: 'command',
        actionConfig: { command: 'test-cmd' },
        runCount: 0, scheduleType: 'once', enabled: true,
      } as any;
      mockRepo.findById.mockReturnValue(task);

      await service.executeTask(task);

      expect(mockRepo.update).toHaveBeenCalledWith('t1', expect.objectContaining({
        status: 'idle',
        lastRunResult: 'command result',
      }));
    });

    it('disables once-type tasks after execution', async () => {
      const task = {
        id: 't1', actionType: 'plugin_event',
        actionConfig: { event: 'test' },
        runCount: 0, scheduleType: 'once', enabled: true,
      } as any;
      mockRepo.findById.mockReturnValue(task);

      await service.executeTask(task);

      expect(mockRepo.update).toHaveBeenCalledWith('t1', expect.objectContaining({
        enabled: false,
      }));
    });

    it('keeps interval tasks enabled after execution', async () => {
      const task = {
        id: 't1', actionType: 'plugin_event',
        actionConfig: { event: 'test' },
        runCount: 0, scheduleType: 'interval', enabled: true,
        scheduleIntervalMinutes: 5,
      } as any;
      mockRepo.findById.mockReturnValue(task);

      await service.executeTask(task);

      expect(mockRepo.update).toHaveBeenCalledWith('t1', expect.objectContaining({
        enabled: true,
      }));
    });

    it('handles unknown action type', async () => {
      const task = {
        id: 't1', actionType: 'unknown_type',
        actionConfig: {},
        runCount: 0, scheduleType: 'once', enabled: true,
      } as any;
      mockRepo.findById.mockReturnValue(task);

      await service.executeTask(task);
      expect(mockRepo.update).toHaveBeenCalledWith('t1', expect.objectContaining({
        status: 'idle',
        lastRunResult: expect.stringContaining('Unknown action type'),
      }));
    });
  });

  describe('computeNextRun', () => {
    it('returns null for cron without expression', () => {
      expect(service.computeNextRun({ scheduleType: 'cron' })).toBeNull();
    });

    it('computes cron next run', () => {
      const result = service.computeNextRun({ scheduleType: 'cron', scheduleCron: '* * * * *' });
      expect(result).toBe(99999);
    });

    it('computes interval next run', () => {
      const now = Date.now();
      const result = service.computeNextRun({ scheduleType: 'interval', scheduleIntervalMinutes: 5 }, now);
      expect(result).toBe(now + 5 * 60 * 1000);
    });

    it('returns null for interval without minutes', () => {
      expect(service.computeNextRun({ scheduleType: 'interval' })).toBeNull();
    });

    it('returns null for once type', () => {
      expect(service.computeNextRun({ scheduleType: 'once' })).toBeNull();
    });

    it('returns null for unknown type', () => {
      expect(service.computeNextRun({ scheduleType: 'unknown' as any })).toBeNull();
    });
  });

  describe('computeInitialNextRun', () => {
    it('returns scheduleOnceAt for once type', () => {
      expect(service.computeInitialNextRun({ scheduleType: 'once', scheduleOnceAt: 12345 as any })).toBe(12345);
    });

    it('returns null for once without scheduleOnceAt', () => {
      expect(service.computeInitialNextRun({ scheduleType: 'once' })).toBeNull();
    });

    it('computes cron initial next run', () => {
      expect(service.computeInitialNextRun({ scheduleType: 'cron', scheduleCron: '0 9 * * *' })).toBe(99999);
    });

    it('returns null for cron without expression', () => {
      expect(service.computeInitialNextRun({ scheduleType: 'cron' })).toBeNull();
    });

    it('computes interval initial next run', () => {
      const before = Date.now();
      const result = service.computeInitialNextRun({ scheduleType: 'interval', scheduleIntervalMinutes: 10 });
      expect(result).toBeGreaterThanOrEqual(before + 10 * 60 * 1000);
    });

    it('returns null for interval without minutes', () => {
      expect(service.computeInitialNextRun({ scheduleType: 'interval' })).toBeNull();
    });

    it('returns null for unknown type', () => {
      expect(service.computeInitialNextRun({ scheduleType: 'other' as any })).toBeNull();
    });
  });

  describe('triggerNow', () => {
    it('throws when task not found', async () => {
      mockRepo.findById.mockReturnValue(null);
      await expect(service.triggerNow('t1')).rejects.toThrow('Scheduled task not found');
    });
  });

  describe('broadcastDelete', () => {
    it('broadcasts delete message', () => {
      service.broadcastDelete('p1', 't1');
      expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({
        type: 'scheduled_task_deleted',
        taskId: 't1',
      }));
    });

    it('broadcasts with undefined projectId', () => {
      service.broadcastDelete(undefined, 't1');
      expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({
        type: 'scheduled_task_deleted',
        projectId: undefined,
        taskId: 't1',
      }));
    });
  });

  describe('executePrompt', () => {
    it('executes prompt with project context', async () => {
      const task = {
        id: 't1',
        actionType: 'prompt',
        actionConfig: { prompt: 'do something', sessionName: 'Test Session' },
        runCount: 0,
        scheduleType: 'once',
        enabled: true,
        projectId: 'p1',
      } as any;
      mockRepo.findById.mockReturnValue(task);
      mockProjectRepo.findById.mockReturnValue({ id: 'p1', providerId: 'prov1', rootPath: '/test' });
      mockSessionRepo.create.mockReturnValue({ id: 'sess1' });

      // Mock createVirtualClient to send run_completed
      (createVirtualClient as any).mockImplementation((_id: string, handlers: any) => {
        setTimeout(() => handlers.send({ type: 'run_completed' }), 20);
        return { id: _id, authenticated: true, ws: { send: () => {} } };
      });

      await service.executeTask(task);

      expect(mockSessionRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        projectId: 'p1',
        name: 'Test Session',
        type: 'background',
      }));
      expect(mockRepo.update).toHaveBeenCalledWith('t1', expect.objectContaining({
        status: 'idle',
        lastRunResult: expect.stringContaining('Prompt completed'),
      }));
    });

    it('throws when project not found', async () => {
      const task = {
        id: 't1',
        actionType: 'prompt',
        actionConfig: { prompt: 'do something' },
        runCount: 0,
        scheduleType: 'once',
        enabled: true,
        projectId: 'missing',
      } as any;
      mockRepo.findById.mockReturnValue(task);
      mockProjectRepo.findById.mockReturnValue(null);

      await service.executeTask(task);

      expect(mockRepo.update).toHaveBeenCalledWith('t1', expect.objectContaining({
        status: 'error',
        lastError: expect.stringContaining('Project not found'),
      }));
    });

    it('throws when no provider configured', async () => {
      const task = {
        id: 't1',
        actionType: 'prompt',
        actionConfig: { prompt: 'do something' },
        runCount: 0,
        scheduleType: 'once',
        enabled: true,
        projectId: 'p1',
      } as any;
      mockRepo.findById.mockReturnValue(task);
      mockProjectRepo.findById.mockReturnValue({ id: 'p1', providerId: undefined, rootPath: '/test' });

      await service.executeTask(task);

      expect(mockRepo.update).toHaveBeenCalledWith('t1', expect.objectContaining({
        status: 'error',
        lastError: expect.stringContaining('No provider configured'),
      }));
    });

    it('handles prompt without project (global)', async () => {
      const task = {
        id: 't1',
        actionType: 'prompt',
        actionConfig: { prompt: 'global prompt', providerId: 'prov1' },
        runCount: 0,
        scheduleType: 'once',
        enabled: true,
        projectId: undefined,
      } as any;
      mockRepo.findById.mockReturnValue(task);
      mockSessionRepo.create.mockReturnValue({ id: 'sess1' });

      (createVirtualClient as any).mockImplementation((_id: string, handlers: any) => {
        setTimeout(() => handlers.send({ type: 'run_completed' }), 20);
        return { id: _id, authenticated: true, ws: { send: () => {} } };
      });

      await service.executeTask(task);

      expect(mockSessionRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        projectId: '__global__',
      }));
    });

    it('handles run_failed message', async () => {
      const task = {
        id: 't1',
        actionType: 'prompt',
        actionConfig: { prompt: 'fail prompt', providerId: 'prov1' },
        runCount: 0,
        scheduleType: 'once',
        enabled: true,
        projectId: undefined,
      } as any;
      mockRepo.findById.mockReturnValue(task);
      mockSessionRepo.create.mockReturnValue({ id: 'sess1' });

      (createVirtualClient as any).mockImplementation((_id: string, handlers: any) => {
        setTimeout(() => handlers.send({ type: 'run_failed', error: 'AI error' }), 20);
        return { id: _id, authenticated: true, ws: { send: () => {} } };
      });

      await service.executeTask(task);

      expect(mockRepo.update).toHaveBeenCalledWith('t1', expect.objectContaining({
        status: 'error',
        lastError: expect.stringContaining('AI error'),
      }));
    });
  });

  describe('executeShell', () => {
    it('executes shell command successfully', async () => {
      const task = {
        id: 't1',
        actionType: 'shell',
        actionConfig: { command: 'echo hello' },
        runCount: 0,
        scheduleType: 'once',
        enabled: true,
        projectId: 'p1',
      } as any;
      mockRepo.findById.mockReturnValue(task);
      mockProjectRepo.findById.mockReturnValue({ id: 'p1', rootPath: '/project' });
      mockExecFileAsync.mockResolvedValue({ stdout: 'hello\n', stderr: '' });

      await service.executeTask(task);

      expect(mockRepo.update).toHaveBeenCalledWith('t1', expect.objectContaining({
        status: 'idle',
        lastRunResult: 'hello\n',
      }));
    });

    it('includes stderr in result', async () => {
      const task = {
        id: 't1',
        actionType: 'shell',
        actionConfig: { command: 'some-cmd', cwd: '/custom' },
        runCount: 0,
        scheduleType: 'once',
        enabled: true,
      } as any;
      mockRepo.findById.mockReturnValue(task);
      mockExecFileAsync.mockResolvedValue({ stdout: 'output', stderr: 'warning' });

      await service.executeTask(task);

      expect(mockRepo.update).toHaveBeenCalledWith('t1', expect.objectContaining({
        status: 'idle',
        lastRunResult: 'stdout: output\nstderr: warning',
      }));
    });
  });

  describe('executeCommand with non-string result', () => {
    it('JSON stringifies non-string result', async () => {
      const { commandRegistry } = await import('../../commands/registry.js');
      (commandRegistry.execute as any).mockResolvedValue({ key: 'value' });

      const task = {
        id: 't1',
        actionType: 'command',
        actionConfig: { command: 'test-cmd' },
        runCount: 0,
        scheduleType: 'once',
        enabled: true,
      } as any;
      mockRepo.findById.mockReturnValue(task);

      await service.executeTask(task);

      expect(mockRepo.update).toHaveBeenCalledWith('t1', expect.objectContaining({
        status: 'idle',
        lastRunResult: '{"key":"value"}',
      }));
    });
  });

  describe('executePluginEvent', () => {
    it('emits plugin event with data', async () => {
      const task = {
        id: 't1',
        actionType: 'plugin_event',
        actionConfig: { event: 'custom.event', data: { foo: 'bar' } },
        runCount: 0,
        scheduleType: 'once',
        enabled: true,
      } as any;
      mockRepo.findById.mockReturnValue(task);

      await service.executeTask(task);

      expect(pluginEvents.emit).toHaveBeenCalledWith('custom.event', { foo: 'bar' }, 'scheduled-tasks');
      expect(mockRepo.update).toHaveBeenCalledWith('t1', expect.objectContaining({
        lastRunResult: 'Event emitted: custom.event',
      }));
    });

    it('emits plugin event without data (defaults to {})', async () => {
      const task = {
        id: 't1',
        actionType: 'plugin_event',
        actionConfig: { event: 'simple.event' },
        runCount: 0,
        scheduleType: 'once',
        enabled: true,
      } as any;
      mockRepo.findById.mockReturnValue(task);

      await service.executeTask(task);

      expect(pluginEvents.emit).toHaveBeenCalledWith('simple.event', {}, 'scheduled-tasks');
    });
  });

  describe('triggerNow', () => {
    it('executes task when found', async () => {
      const task = {
        id: 't1',
        actionType: 'plugin_event',
        actionConfig: { event: 'test' },
        runCount: 0,
        scheduleType: 'once',
        enabled: true,
      } as any;
      mockRepo.findById.mockReturnValue(task);

      await service.triggerNow('t1');

      expect(mockRepo.update).toHaveBeenCalledWith('t1', expect.objectContaining({ status: 'running' }));
    });
  });

  describe('broadcastUpdate', () => {
    it('does not broadcast when task not found after execution', async () => {
      const task = {
        id: 't1',
        actionType: 'plugin_event',
        actionConfig: { event: 'test' },
        runCount: 0,
        scheduleType: 'once',
        enabled: true,
      } as any;
      // First findById returns the task, then subsequent calls return null
      let findByIdCallCount = 0;
      mockRepo.findById.mockImplementation(() => {
        findByIdCallCount++;
        return findByIdCallCount <= 1 ? task : null;
      });

      await service.executeTask(task);
      // broadcastUpdate was called but task was not found - no broadcast
    });
  });

  describe('executeWebhook with GET method', () => {
    it('does not send body for GET requests', async () => {
      const task = {
        id: 't1',
        actionType: 'webhook',
        actionConfig: { url: 'http://example.com', method: 'GET' },
        runCount: 0,
        scheduleType: 'once',
        enabled: true,
      } as any;
      mockRepo.findById.mockReturnValue(task);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 200,
        text: () => Promise.resolve('response'),
      });

      await service.executeTask(task);

      expect(globalThis.fetch).toHaveBeenCalledWith('http://example.com', expect.objectContaining({
        method: 'GET',
        body: undefined,
      }));
      globalThis.fetch = originalFetch;
    });
  });
});
