import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/api', () => ({
  listScheduledTasks: vi.fn(),
  listGlobalScheduledTasks: vi.fn(),
  createScheduledTask: vi.fn(),
  updateScheduledTask: vi.fn(),
  deleteScheduledTask: vi.fn(),
  triggerScheduledTask: vi.fn(),
  listScheduledTaskTemplates: vi.fn(),
  enableTemplateTask: vi.fn(),
}));

import { useScheduledTaskStore } from '../scheduledTaskStore';
import {
  listScheduledTasks,
  listGlobalScheduledTasks,
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  triggerScheduledTask,
  listScheduledTaskTemplates,
  enableTemplateTask,
} from '../../services/api';

const makeTask = (id: string, name = 'Task') => ({
  id,
  name,
  enabled: true,
  scheduleType: 'cron' as const,
  actionType: 'prompt' as const,
  actionConfig: {},
  status: 'idle' as const,
  runCount: 0,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

describe('scheduledTaskStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useScheduledTaskStore.setState({ tasks: {}, templates: [] });
  });

  describe('loadTasks', () => {
    it('loads tasks for a project', async () => {
      const tasks = [makeTask('t1'), makeTask('t2')];
      vi.mocked(listScheduledTasks).mockResolvedValue(tasks as any);

      await useScheduledTaskStore.getState().loadTasks('proj-1');

      expect(useScheduledTaskStore.getState().tasks['proj-1']).toEqual(tasks);
    });
  });

  describe('loadGlobalTasks', () => {
    it('loads global tasks', async () => {
      const tasks = [makeTask('g1')];
      vi.mocked(listGlobalScheduledTasks).mockResolvedValue(tasks as any);

      await useScheduledTaskStore.getState().loadGlobalTasks();

      expect(useScheduledTaskStore.getState().tasks['__global__']).toEqual(tasks);
    });
  });

  describe('loadTemplates', () => {
    it('loads templates', async () => {
      const templates = [{ id: 'tmpl-1', name: 'Template' }];
      vi.mocked(listScheduledTaskTemplates).mockResolvedValue(templates as any);

      await useScheduledTaskStore.getState().loadTemplates();

      expect(useScheduledTaskStore.getState().templates).toEqual(templates);
    });
  });

  describe('create', () => {
    it('creates and prepends task', async () => {
      const newTask = makeTask('t-new');
      vi.mocked(createScheduledTask).mockResolvedValue(newTask as any);

      useScheduledTaskStore.setState({ tasks: { 'proj-1': [makeTask('t-existing')] as any } });
      const result = await useScheduledTaskStore.getState().create('proj-1', { name: 'New' });

      expect(result).toEqual(newTask);
      const tasks = useScheduledTaskStore.getState().tasks['proj-1'];
      expect(tasks[0].id).toBe('t-new');
      expect(tasks).toHaveLength(2);
    });

    it('creates global task when projectId is undefined', async () => {
      const newTask = makeTask('t-global');
      vi.mocked(createScheduledTask).mockResolvedValue(newTask as any);

      await useScheduledTaskStore.getState().create(undefined, { name: 'Global' });

      expect(useScheduledTaskStore.getState().tasks['__global__']).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('updates and upserts task', async () => {
      const updatedTask = makeTask('t1');
      updatedTask.name = 'Updated';
      vi.mocked(updateScheduledTask).mockResolvedValue(updatedTask as any);

      useScheduledTaskStore.setState({ tasks: { 'proj-1': [makeTask('t1')] as any } });
      await useScheduledTaskStore.getState().update('t1', 'proj-1', { name: 'Updated' });

      expect(useScheduledTaskStore.getState().tasks['proj-1'][0].name).toBe('Updated');
    });
  });

  describe('remove', () => {
    it('deletes and removes task', async () => {
      vi.mocked(deleteScheduledTask).mockResolvedValue(undefined as any);

      useScheduledTaskStore.setState({ tasks: { 'proj-1': [makeTask('t1'), makeTask('t2')] as any } });
      await useScheduledTaskStore.getState().remove('t1', 'proj-1');

      expect(deleteScheduledTask).toHaveBeenCalledWith('t1');
      expect(useScheduledTaskStore.getState().tasks['proj-1']).toHaveLength(1);
      expect(useScheduledTaskStore.getState().tasks['proj-1'][0].id).toBe('t2');
    });
  });

  describe('trigger', () => {
    it('triggers and upserts task', async () => {
      const triggered = makeTask('t1');
      triggered.status = 'running' as any;
      vi.mocked(triggerScheduledTask).mockResolvedValue(triggered as any);

      useScheduledTaskStore.setState({ tasks: { 'proj-1': [makeTask('t1')] as any } });
      await useScheduledTaskStore.getState().trigger('t1', 'proj-1');

      expect(useScheduledTaskStore.getState().tasks['proj-1'][0].status).toBe('running');
    });
  });

  describe('enableTemplate', () => {
    it('enables template and upserts result', async () => {
      const task = makeTask('t-from-template');
      vi.mocked(enableTemplateTask).mockResolvedValue(task as any);

      const result = await useScheduledTaskStore.getState().enableTemplate('proj-1', 'tmpl-1');

      expect(result).toEqual(task);
      expect(useScheduledTaskStore.getState().tasks['proj-1']).toHaveLength(1);
    });
  });

  describe('upsertTask', () => {
    it('updates existing task', () => {
      useScheduledTaskStore.setState({ tasks: { 'proj-1': [makeTask('t1')] as any } });

      const updated = makeTask('t1');
      updated.name = 'Changed';
      useScheduledTaskStore.getState().upsertTask('proj-1', updated as any);

      expect(useScheduledTaskStore.getState().tasks['proj-1'][0].name).toBe('Changed');
    });

    it('prepends new task if not found', () => {
      useScheduledTaskStore.setState({ tasks: { 'proj-1': [makeTask('t1')] as any } });

      useScheduledTaskStore.getState().upsertTask('proj-1', makeTask('t2') as any);

      expect(useScheduledTaskStore.getState().tasks['proj-1']).toHaveLength(2);
      expect(useScheduledTaskStore.getState().tasks['proj-1'][0].id).toBe('t2');
    });

    it('uses global key when projectId is undefined', () => {
      useScheduledTaskStore.getState().upsertTask(undefined, makeTask('t1') as any);

      expect(useScheduledTaskStore.getState().tasks['__global__']).toHaveLength(1);
    });
  });

  describe('removeTask', () => {
    it('removes task by id', () => {
      useScheduledTaskStore.setState({ tasks: { 'proj-1': [makeTask('t1'), makeTask('t2')] as any } });

      useScheduledTaskStore.getState().removeTask('proj-1', 't1');

      expect(useScheduledTaskStore.getState().tasks['proj-1']).toHaveLength(1);
      expect(useScheduledTaskStore.getState().tasks['proj-1'][0].id).toBe('t2');
    });

    it('handles missing project key gracefully', () => {
      useScheduledTaskStore.getState().removeTask('nonexistent', 't1');
      expect(useScheduledTaskStore.getState().tasks['nonexistent']).toEqual([]);
    });
  });
});
