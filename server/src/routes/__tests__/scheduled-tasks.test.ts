import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createScheduledTaskRoutes } from '../scheduled-tasks.js';

// Mock cron
vi.mock('../../utils/cron.js', () => ({
  isValidCron: vi.fn().mockReturnValue(true),
}));

// Mock templates
vi.mock('../../scheduled-task-templates.js', () => ({
  BUILTIN_TEMPLATES: [
    {
      id: 'tmpl-1',
      name: 'Test Template',
      description: 'A test template',
      scheduleType: 'cron',
      defaultSchedule: { cron: '0 * * * *' },
      actionType: 'prompt',
      defaultActionConfig: { prompt: 'Hello' },
    },
  ],
}));

import { isValidCron } from '../../utils/cron.js';

const mockTask = {
  id: 'task-1',
  projectId: 'proj-1',
  name: 'Test Task',
  enabled: true,
  scheduleType: 'cron',
  scheduleCron: '0 * * * *',
  actionType: 'prompt',
};

function createMockService() {
  const repo = {
    findByProjectId: vi.fn().mockReturnValue([mockTask]),
    findGlobalTasks: vi.fn().mockReturnValue([]),
    findById: vi.fn().mockReturnValue(mockTask),
    findByTemplateId: vi.fn().mockReturnValue(null),
    create: vi.fn().mockReturnValue(mockTask),
    update: vi.fn().mockReturnValue(mockTask),
    delete: vi.fn(),
  };
  return {
    getRepo: vi.fn().mockReturnValue(repo),
    computeInitialNextRun: vi.fn().mockReturnValue(Date.now() + 3600000),
    triggerNow: vi.fn().mockResolvedValue(undefined),
    broadcastDelete: vi.fn(),
    _repo: repo,
  };
}

describe('scheduled-tasks routes', () => {
  let app: express.Express;
  let service: ReturnType<typeof createMockService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createMockService();
    app = express();
    app.use(express.json());
    app.use('/api', createScheduledTaskRoutes(service as any));
  });

  describe('GET /api/projects/:projectId/scheduled-tasks', () => {
    it('lists project tasks', async () => {
      const res = await request(app).get('/api/projects/proj-1/scheduled-tasks');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([mockTask]);
    });

    it('returns 500 on error', async () => {
      service._repo.findByProjectId.mockImplementation(() => { throw new Error('DB'); });
      const res = await request(app).get('/api/projects/proj-1/scheduled-tasks');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/scheduled-tasks/global', () => {
    it('lists global tasks', async () => {
      const res = await request(app).get('/api/scheduled-tasks/global');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe('POST /api/projects/:projectId/scheduled-tasks', () => {
    it('creates a task', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/scheduled-tasks')
        .send({
          name: 'New Task',
          scheduleType: 'cron',
          scheduleCron: '0 * * * *',
          actionType: 'prompt',
        });
      expect(res.status).toBe(201);
    });

    it('returns 400 for missing name', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/scheduled-tasks')
        .send({ scheduleType: 'cron', actionType: 'prompt' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid scheduleType', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/scheduled-tasks')
        .send({ name: 'Task', scheduleType: 'invalid', actionType: 'prompt' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid actionType', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/scheduled-tasks')
        .send({ name: 'Task', scheduleType: 'cron', actionType: 'invalid' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid cron', async () => {
      vi.mocked(isValidCron).mockReturnValue(false);
      const res = await request(app)
        .post('/api/projects/proj-1/scheduled-tasks')
        .send({ name: 'Task', scheduleType: 'cron', scheduleCron: 'bad', actionType: 'prompt' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/scheduled-tasks/global', () => {
    it('creates a global task', async () => {
      vi.mocked(isValidCron).mockReturnValue(true);
      const res = await request(app)
        .post('/api/scheduled-tasks/global')
        .send({
          name: 'Global Task',
          scheduleType: 'interval',
          scheduleIntervalMinutes: 30,
          actionType: 'shell',
        });
      expect(res.status).toBe(201);
    });
  });

  describe('PATCH /api/scheduled-tasks/:taskId', () => {
    it('updates a task', async () => {
      const res = await request(app)
        .patch('/api/scheduled-tasks/task-1')
        .send({ name: 'Updated' });
      expect(res.status).toBe(200);
    });

    it('returns 400 for invalid cron', async () => {
      vi.mocked(isValidCron).mockReturnValue(false);
      const res = await request(app)
        .patch('/api/scheduled-tasks/task-1')
        .send({ scheduleCron: 'bad cron' });
      expect(res.status).toBe(400);
    });

    it('returns 404 for missing task', async () => {
      vi.mocked(isValidCron).mockReturnValue(true);
      service._repo.findById.mockReturnValue(null);
      const res = await request(app)
        .patch('/api/scheduled-tasks/missing')
        .send({ name: 'Updated' });
      expect(res.status).toBe(404);
    });

    it('recomputes nextRun when schedule changes', async () => {
      vi.mocked(isValidCron).mockReturnValue(true);
      const res = await request(app)
        .patch('/api/scheduled-tasks/task-1')
        .send({ scheduleCron: '30 * * * *' });
      expect(res.status).toBe(200);
      expect(service.computeInitialNextRun).toHaveBeenCalled();
    });

    it('sets nextRun to null when disabled', async () => {
      const res = await request(app)
        .patch('/api/scheduled-tasks/task-1')
        .send({ enabled: false });
      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/scheduled-tasks/:taskId', () => {
    it('deletes a task', async () => {
      const res = await request(app).delete('/api/scheduled-tasks/task-1');
      expect(res.status).toBe(200);
      expect(service._repo.delete).toHaveBeenCalledWith('task-1');
      expect(service.broadcastDelete).toHaveBeenCalled();
    });

    it('returns 404 for missing task', async () => {
      service._repo.findById.mockReturnValue(null);
      const res = await request(app).delete('/api/scheduled-tasks/missing');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/scheduled-tasks/:taskId/trigger', () => {
    it('triggers a task manually', async () => {
      const res = await request(app).post('/api/scheduled-tasks/task-1/trigger');
      expect(res.status).toBe(200);
      expect(service.triggerNow).toHaveBeenCalledWith('task-1');
    });

    it('returns 404 for missing task', async () => {
      service._repo.findById.mockReturnValue(null);
      const res = await request(app).post('/api/scheduled-tasks/missing/trigger');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/scheduled-task-templates', () => {
    it('lists built-in templates', async () => {
      const res = await request(app).get('/api/scheduled-task-templates');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe('tmpl-1');
    });
  });

  describe('POST /api/projects/:projectId/scheduled-tasks/from-template/:templateId', () => {
    it('creates task from template', async () => {
      vi.mocked(isValidCron).mockReturnValue(true);
      const res = await request(app)
        .post('/api/projects/proj-1/scheduled-tasks/from-template/tmpl-1');
      expect(res.status).toBe(201);
    });

    it('returns 404 for missing template', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/scheduled-tasks/from-template/missing');
      expect(res.status).toBe(404);
    });

    it('toggles existing template instance', async () => {
      service._repo.findByTemplateId.mockReturnValue({ ...mockTask, enabled: true, id: 'task-2' });
      const res = await request(app)
        .post('/api/projects/proj-1/scheduled-tasks/from-template/tmpl-1');
      expect(res.status).toBe(200);
      expect(service._repo.update).toHaveBeenCalledWith('task-2', expect.objectContaining({ enabled: false }));
    });

    it('re-enables disabled template instance', async () => {
      service._repo.findByTemplateId.mockReturnValue({ ...mockTask, enabled: false, id: 'task-2' });
      const res = await request(app)
        .post('/api/projects/proj-1/scheduled-tasks/from-template/tmpl-1');
      expect(res.status).toBe(200);
      expect(service._repo.update).toHaveBeenCalledWith('task-2', expect.objectContaining({ enabled: true }));
    });
  });
});
