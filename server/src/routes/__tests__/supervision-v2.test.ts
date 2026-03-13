import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSupervisionV2Routes } from '../supervision-v2.js';
import type { SupervisorV2Service } from '../../services/supervisor-v2-service.js';
import type { ProjectAgent, SupervisionTask } from '@my-claudia/shared';

function makeMockAgent(overrides: Partial<ProjectAgent> = {}): ProjectAgent {
  return {
    type: 'supervisor',
    phase: 'active',
    config: {
      maxConcurrentTasks: 1,
      trustLevel: 'low',
      autoDiscoverTasks: false,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeMockTask(overrides: Partial<SupervisionTask> = {}): SupervisionTask {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    title: 'Test Task',
    description: 'A test task',
    source: 'user',
    status: 'pending',
    priority: 0,
    dependencies: [],
    dependencyMode: 'all',
    acceptanceCriteria: [],
    maxRetries: 2,
    attempt: 1,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('Supervision V2 Routes', () => {
  let app: express.Express;
  let mockService: Record<string, ReturnType<typeof vi.fn>>;

  beforeAll(() => {
    mockService = {
      initAgent: vi.fn(),
      updateAgentPhase: vi.fn(),
      getAgent: vi.fn(),
      getTasks: vi.fn(),
      createTask: vi.fn(),
      updateTask: vi.fn(),
      approveTask: vi.fn(),
      rejectTask: vi.fn(),
      approveTaskResult: vi.fn(),
      rejectTaskResult: vi.fn(),
      resolveConflict: vi.fn(),
      reloadContext: vi.fn(),
      getContextDocuments: vi.fn(),
      getTokenUsage: vi.fn(),
      getLogs: vi.fn(),
      retryTask: vi.fn(),
      cancelTask: vi.fn(),
      runTaskNow: vi.fn(),
    };

    app = express();
    app.use(express.json());
    app.use('/api/v2', createSupervisionV2Routes(mockService as unknown as SupervisorV2Service));
  });

  beforeEach(() => {
    Object.values(mockService).forEach((fn) => fn.mockReset());
  });

  // ========================================
  // POST /projects/:projectId/agent/init
  // ========================================

  describe('POST /projects/:projectId/agent/init', () => {
    it('calls initAgent and returns 200', async () => {
      const agent = makeMockAgent();
      mockService.initAgent.mockReturnValue(agent);

      const res = await request(app)
        .post('/api/v2/projects/proj-1/agent/init')
        .send({ config: { trustLevel: 'high' } })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe('supervisor');
      expect(mockService.initAgent).toHaveBeenCalledWith('proj-1', { trustLevel: 'high' }, undefined, undefined);
    });

    it('returns 400 when initAgent throws', async () => {
      mockService.initAgent.mockImplementation(() => {
        throw new Error('Project not found: proj-bad');
      });

      const res = await request(app)
        .post('/api/v2/projects/proj-bad/agent/init')
        .send({})
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INIT_ERROR');
    });
  });

  // ========================================
  // POST /projects/:projectId/agent/action
  // ========================================

  describe('POST /projects/:projectId/agent/action', () => {
    it('validates action param — rejects invalid action', async () => {
      const res = await request(app)
        .post('/api/v2/projects/proj-1/agent/action')
        .send({ action: 'invalid_action' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('action must be one of');
    });

    it('validates action param — rejects missing action', async () => {
      const res = await request(app)
        .post('/api/v2/projects/proj-1/agent/action')
        .send({})
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('accepts valid pause action', async () => {
      const agent = makeMockAgent({ phase: 'paused' });
      mockService.updateAgentPhase.mockReturnValue(agent);

      const res = await request(app)
        .post('/api/v2/projects/proj-1/agent/action')
        .send({ action: 'pause' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockService.updateAgentPhase).toHaveBeenCalledWith('proj-1', 'pause');
    });

    it('accepts valid resume action', async () => {
      const agent = makeMockAgent({ phase: 'active' });
      mockService.updateAgentPhase.mockReturnValue(agent);

      const res = await request(app)
        .post('/api/v2/projects/proj-1/agent/action')
        .send({ action: 'resume' })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('accepts valid archive action', async () => {
      const agent = makeMockAgent({ phase: 'archived' });
      mockService.updateAgentPhase.mockReturnValue(agent);

      const res = await request(app)
        .post('/api/v2/projects/proj-1/agent/action')
        .send({ action: 'archive' })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('accepts valid approve_setup action', async () => {
      const agent = makeMockAgent({ phase: 'idle' });
      mockService.updateAgentPhase.mockReturnValue(agent);

      const res = await request(app)
        .post('/api/v2/projects/proj-1/agent/action')
        .send({ action: 'approve_setup' })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  // ========================================
  // GET /projects/:projectId/agent
  // ========================================

  describe('GET /projects/:projectId/agent', () => {
    it('returns agent when found', async () => {
      const agent = makeMockAgent();
      mockService.getAgent.mockReturnValue(agent);

      const res = await request(app)
        .get('/api/v2/projects/proj-1/agent')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe('supervisor');
    });

    it('returns 404 if no agent', async () => {
      mockService.getAgent.mockReturnValue(undefined);

      const res = await request(app)
        .get('/api/v2/projects/proj-1/agent')
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ========================================
  // GET /projects/:projectId/tasks
  // ========================================

  describe('GET /projects/:projectId/tasks', () => {
    it('returns task list', async () => {
      const tasks = [makeMockTask({ id: 't1' }), makeMockTask({ id: 't2' })];
      mockService.getTasks.mockReturnValue(tasks);

      const res = await request(app)
        .get('/api/v2/projects/proj-1/tasks')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(mockService.getTasks).toHaveBeenCalledWith('proj-1');
    });

    it('returns empty array when no tasks', async () => {
      mockService.getTasks.mockReturnValue([]);

      const res = await request(app)
        .get('/api/v2/projects/proj-1/tasks')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });
  });

  // ========================================
  // POST /projects/:projectId/tasks
  // ========================================

  describe('POST /projects/:projectId/tasks', () => {
    it('validates title and description required', async () => {
      const res = await request(app)
        .post('/api/v2/projects/proj-1/tasks')
        .send({})
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('title and description are required');
    });

    it('validates title required', async () => {
      const res = await request(app)
        .post('/api/v2/projects/proj-1/tasks')
        .send({ description: 'Has desc but no title' })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('validates description required', async () => {
      const res = await request(app)
        .post('/api/v2/projects/proj-1/tasks')
        .send({ title: 'Has title but no desc' })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('creates task and returns 200', async () => {
      const task = makeMockTask();
      mockService.createTask.mockReturnValue(task);

      const res = await request(app)
        .post('/api/v2/projects/proj-1/tasks')
        .send({ title: 'New task', description: 'Do something' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe('Test Task');
      expect(mockService.createTask).toHaveBeenCalledWith('proj-1', expect.objectContaining({
        title: 'New task',
        description: 'Do something',
      }));
    });

    it('returns 409 for budget exceeded error', async () => {
      mockService.createTask.mockImplementation(() => {
        throw new Error('budget limit exceeded: maxTotalTasks=5 reached. Agent paused.');
      });

      const res = await request(app)
        .post('/api/v2/projects/proj-1/tasks')
        .send({ title: 'Over budget', description: 'd' })
        .expect(409);

      expect(res.body.error.code).toBe('BUDGET_EXCEEDED');
    });

    it('returns 400 when no agent exists', async () => {
      mockService.createTask.mockImplementation(() => {
        throw new Error('No agent found for project: proj-1');
      });

      const res = await request(app)
        .post('/api/v2/projects/proj-1/tasks')
        .send({ title: 'No agent', description: 'd' })
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  // ========================================
  // POST /tasks/:taskId/approve
  // ========================================

  describe('POST /tasks/:taskId/approve', () => {
    it('calls approveTask and returns 200', async () => {
      const task = makeMockTask({ status: 'pending' });
      mockService.approveTask.mockReturnValue(task);

      const res = await request(app)
        .post('/api/v2/tasks/task-1/approve')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockService.approveTask).toHaveBeenCalledWith('task-1');
    });

    it('returns 400 when approveTask throws', async () => {
      mockService.approveTask.mockImplementation(() => {
        throw new Error("Cannot approve task in status 'pending'; must be 'proposed'");
      });

      const res = await request(app)
        .post('/api/v2/tasks/task-1/approve')
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_STATE');
    });
  });

  // ========================================
  // POST /tasks/:taskId/reject
  // ========================================

  describe('POST /tasks/:taskId/reject', () => {
    it('calls rejectTask and returns 200', async () => {
      const task = makeMockTask({ status: 'cancelled' });
      mockService.rejectTask.mockReturnValue(task);

      const res = await request(app)
        .post('/api/v2/tasks/task-1/reject')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockService.rejectTask).toHaveBeenCalledWith('task-1');
    });

    it('returns 400 when rejectTask throws', async () => {
      mockService.rejectTask.mockImplementation(() => {
        throw new Error('Task not found: task-bad');
      });

      const res = await request(app)
        .post('/api/v2/tasks/task-bad/reject')
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  // ========================================
  // POST /tasks/:taskId/review/approve
  // ========================================

  describe('POST /tasks/:taskId/review/approve', () => {
    it('calls approveTaskResult and returns 200', async () => {
      const task = makeMockTask({ status: 'integrated' });
      mockService.approveTaskResult.mockReturnValue(task);

      const res = await request(app)
        .post('/api/v2/tasks/task-1/review/approve')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockService.approveTaskResult).toHaveBeenCalledWith('task-1');
    });

    it('returns 400 when approveTaskResult throws', async () => {
      mockService.approveTaskResult.mockImplementation(() => {
        throw new Error("Cannot approve result for task in status 'pending'");
      });

      const res = await request(app)
        .post('/api/v2/tasks/task-1/review/approve')
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  // ========================================
  // POST /tasks/:taskId/review/reject
  // ========================================

  describe('POST /tasks/:taskId/review/reject', () => {
    it('validates notes required', async () => {
      const res = await request(app)
        .post('/api/v2/tasks/task-1/review/reject')
        .send({})
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('notes are required');
    });

    it('calls rejectTaskResult with notes and returns 200', async () => {
      const task = makeMockTask({ status: 'queued', attempt: 2 });
      mockService.rejectTaskResult.mockReturnValue(task);

      const res = await request(app)
        .post('/api/v2/tasks/task-1/review/reject')
        .send({ notes: 'Needs more work on error handling' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockService.rejectTaskResult).toHaveBeenCalledWith(
        'task-1',
        'Needs more work on error handling',
      );
    });

    it('returns 400 when rejectTaskResult throws', async () => {
      mockService.rejectTaskResult.mockImplementation(() => {
        throw new Error("Cannot reject result for task in status 'pending'");
      });

      const res = await request(app)
        .post('/api/v2/tasks/task-1/review/reject')
        .send({ notes: 'Some notes' })
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  // ========================================
  // POST /projects/:projectId/context/reload
  // ========================================

  describe('POST /projects/:projectId/context/reload', () => {
    it('calls reloadContext and returns 200', async () => {
      mockService.reloadContext.mockReturnValue(undefined);

      const res = await request(app)
        .post('/api/v2/projects/proj-1/context/reload')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockService.reloadContext).toHaveBeenCalledWith('proj-1');
    });

    it('returns 500 when reloadContext throws', async () => {
      mockService.reloadContext.mockImplementation(() => {
        throw new Error('Project proj-bad has no rootPath');
      });

      const res = await request(app)
        .post('/api/v2/projects/proj-bad/context/reload')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ========================================
  // GET /projects/:projectId/context
  // ========================================

  describe('GET /projects/:projectId/context', () => {
    it('returns context documents', async () => {
      const docs = [
        { id: 'goal.md', category: 'goal', source: 'user', version: 1, updated: '2026-01-01', content: '# Goal' },
      ];
      mockService.getContextDocuments.mockReturnValue(docs);

      const res = await request(app)
        .get('/api/v2/projects/proj-1/context')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe('goal.md');
    });
  });

  // ========================================
  // PUT /tasks/:taskId
  // ========================================

  describe('PUT /tasks/:taskId', () => {
    it('updates task and returns 200', async () => {
      const task = makeMockTask({ title: 'Updated' });
      mockService.updateTask.mockReturnValue(task);

      const res = await request(app)
        .put('/api/v2/tasks/task-1')
        .send({ title: 'Updated' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockService.updateTask).toHaveBeenCalledWith('task-1', { title: 'Updated' });
    });

    it('returns 404 when task not found', async () => {
      mockService.updateTask.mockReturnValue(undefined);

      const res = await request(app)
        .put('/api/v2/tasks/nonexistent')
        .send({ title: 'Nope' })
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ========================================
  // GET /projects/:projectId/budget
  // ========================================

  describe('GET /projects/:projectId/budget', () => {
    it('returns budget info with usage and limit', async () => {
      mockService.getTokenUsage.mockReturnValue(500);
      mockService.getAgent.mockReturnValue(makeMockAgent({
        config: {
          maxConcurrentTasks: 1,
          trustLevel: 'low',
          autoDiscoverTasks: false,
          maxTokenBudget: 1000,
        },
      }));

      const res = await request(app)
        .get('/api/v2/projects/proj-1/budget')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.usage).toBe(500);
      expect(res.body.data.limit).toBe(1000);
      expect(res.body.data.remaining).toBe(500);
    });

    it('returns undefined remaining when no budget limit', async () => {
      mockService.getTokenUsage.mockReturnValue(300);
      mockService.getAgent.mockReturnValue(makeMockAgent());

      const res = await request(app)
        .get('/api/v2/projects/proj-1/budget')
        .expect(200);

      expect(res.body.data.usage).toBe(300);
      expect(res.body.data.limit).toBeUndefined();
      expect(res.body.data.remaining).toBeUndefined();
    });
  });

  // ========================================
  // GET /projects/:projectId/logs
  // ========================================

  describe('GET /projects/:projectId/logs', () => {
    it('returns logs with default limit', async () => {
      const mockLogs = [
        { id: 'l1', projectId: 'proj-1', event: 'task_created', createdAt: 2000 },
        { id: 'l2', projectId: 'proj-1', event: 'phase_changed', createdAt: 1000 },
      ];
      mockService.getLogs.mockReturnValue(mockLogs);

      const res = await request(app)
        .get('/api/v2/projects/proj-1/logs')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(mockService.getLogs).toHaveBeenCalledWith('proj-1', 100);
    });

    it('respects limit query parameter', async () => {
      mockService.getLogs.mockReturnValue([]);

      await request(app)
        .get('/api/v2/projects/proj-1/logs?limit=50')
        .expect(200);

      expect(mockService.getLogs).toHaveBeenCalledWith('proj-1', 50);
    });

    it('returns 500 when getLogs throws', async () => {
      mockService.getLogs.mockImplementation(() => {
        throw new Error('DB error');
      });

      const res = await request(app)
        .get('/api/v2/projects/proj-1/logs')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ========================================
  // POST /tasks/:taskId/resolve-conflict
  // ========================================

  describe('POST /tasks/:taskId/resolve-conflict', () => {
    it('calls resolveConflict and returns 200', async () => {
      const task = makeMockTask({ status: 'running', attempt: 2 });
      mockService.resolveConflict.mockReturnValue(task);

      const res = await request(app)
        .post('/api/v2/tasks/task-1/resolve-conflict')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockService.resolveConflict).toHaveBeenCalledWith('task-1');
    });

    it('returns 400 when task is not in merge_conflict state', async () => {
      mockService.resolveConflict.mockImplementation(() => {
        throw new Error('Task task-1 is not in merge_conflict state');
      });

      const res = await request(app)
        .post('/api/v2/tasks/task-1/resolve-conflict')
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_STATE');
    });

    it('returns 500 for unexpected merge error', async () => {
      mockService.resolveConflict.mockImplementation(() => {
        throw new Error('Git merge failed unexpectedly');
      });

      const res = await request(app)
        .post('/api/v2/tasks/task-1/resolve-conflict')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('MERGE_ERROR');
    });
  });

  // ========================================
  // Error handling: agent action service throw
  // ========================================

  describe('POST /projects/:projectId/agent/action — error handling', () => {
    it('returns 400 when updateAgentPhase throws with "not in" message', async () => {
      mockService.updateAgentPhase.mockImplementation(() => {
        throw new Error('Agent is not in a valid state to pause');
      });

      const res = await request(app)
        .post('/api/v2/projects/proj-1/agent/action')
        .send({ action: 'pause' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_STATE');
    });

    it('returns 500 for unexpected errors', async () => {
      mockService.updateAgentPhase.mockImplementation(() => {
        throw new Error('Database connection lost');
      });

      const res = await request(app)
        .post('/api/v2/projects/proj-1/agent/action')
        .send({ action: 'resume' })
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ========================================
  // Error handling: GET endpoints
  // ========================================

  describe('Error handling for GET endpoints', () => {
    it('GET /projects/:projectId/agent returns 500 on unexpected error', async () => {
      mockService.getAgent.mockImplementation(() => {
        throw new Error('Unexpected');
      });

      const res = await request(app)
        .get('/api/v2/projects/proj-1/agent')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    });

    it('GET /projects/:projectId/tasks returns 500 on error', async () => {
      mockService.getTasks.mockImplementation(() => {
        throw new Error('DB read error');
      });

      const res = await request(app)
        .get('/api/v2/projects/proj-1/tasks')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    });

    it('GET /projects/:projectId/budget returns 500 on error', async () => {
      mockService.getTokenUsage.mockImplementation(() => {
        throw new Error('Budget calc failed');
      });

      const res = await request(app)
        .get('/api/v2/projects/proj-1/budget')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    });

    it('GET /projects/:projectId/context returns 500 on error', async () => {
      mockService.getContextDocuments.mockImplementation(() => {
        throw new Error('FS read failed');
      });

      const res = await request(app)
        .get('/api/v2/projects/proj-1/context')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ========================================
  // POST /projects/:projectId/tasks — optional fields
  // ========================================

  describe('POST /projects/:projectId/tasks — optional fields', () => {
    it('passes optional fields to service', async () => {
      const task = makeMockTask();
      mockService.createTask.mockReturnValue(task);

      await request(app)
        .post('/api/v2/projects/proj-1/tasks')
        .send({
          title: 'Full task',
          description: 'With all options',
          priority: 5,
          dependencies: ['dep-1'],
          dependencyMode: 'any',
          acceptanceCriteria: ['Works', 'Tests pass'],
          relevantDocIds: ['doc.md'],
          scope: ['src/'],
        })
        .expect(200);

      expect(mockService.createTask).toHaveBeenCalledWith('proj-1', {
        title: 'Full task',
        description: 'With all options',
        priority: 5,
        dependencies: ['dep-1'],
        dependencyMode: 'any',
        acceptanceCriteria: ['Works', 'Tests pass'],
        relevantDocIds: ['doc.md'],
        scope: ['src/'],
      });
    });

    it('returns 500 for unexpected createTask error', async () => {
      mockService.createTask.mockImplementation(() => {
        throw new Error('Database write failed');
      });

      const res = await request(app)
        .post('/api/v2/projects/proj-1/tasks')
        .send({ title: 'Fail', description: 'd' })
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ========================================
  // PUT /tasks/:taskId — error handling
  // ========================================

  describe('PUT /tasks/:taskId — error handling', () => {
    it('returns 500 when updateTask throws', async () => {
      mockService.updateTask.mockImplementation(() => {
        throw new Error('Unexpected DB error');
      });

      const res = await request(app)
        .put('/api/v2/tasks/task-1')
        .send({ title: 'Crash' })
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ========================================
  // POST /tasks/:taskId/retry
  // ========================================
  describe('POST /tasks/:taskId/retry', () => {
    it('retries a task successfully', async () => {
      const task = makeMockTask({ status: 'pending', attempt: 2 });
      mockService.retryTask.mockReturnValue(task);

      const res = await request(app)
        .post('/api/v2/tasks/task-1/retry')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockService.retryTask).toHaveBeenCalledWith('task-1');
    });

    it('returns 404 when task not found', async () => {
      mockService.retryTask.mockImplementation(() => {
        throw new Error('Task not found');
      });

      const res = await request(app)
        .post('/api/v2/tasks/nonexistent/retry')
        .expect(404);

      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 for invalid state', async () => {
      mockService.retryTask.mockImplementation(() => {
        throw new Error('Task is not in a retriable state');
      });

      const res = await request(app)
        .post('/api/v2/tasks/task-1/retry')
        .expect(400);

      expect(res.body.error.code).toBe('INVALID_STATE');
    });
  });

  // ========================================
  // POST /tasks/:taskId/cancel
  // ========================================
  describe('POST /tasks/:taskId/cancel', () => {
    it('cancels a task successfully', async () => {
      const task = makeMockTask({ status: 'cancelled' });
      mockService.cancelTask.mockReturnValue(task);

      const res = await request(app)
        .post('/api/v2/tasks/task-1/cancel')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockService.cancelTask).toHaveBeenCalledWith('task-1');
    });

    it('returns 404 when task not found', async () => {
      mockService.cancelTask.mockImplementation(() => {
        throw new Error('Task not found');
      });

      const res = await request(app)
        .post('/api/v2/tasks/nonexistent/cancel')
        .expect(404);

      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 for invalid state', async () => {
      mockService.cancelTask.mockImplementation(() => {
        throw new Error('Cannot cancel completed task');
      });

      const res = await request(app)
        .post('/api/v2/tasks/task-1/cancel')
        .expect(400);

      expect(res.body.error.code).toBe('INVALID_STATE');
    });
  });

  // ========================================
  // POST /tasks/:taskId/run-now
  // ========================================
  describe('POST /tasks/:taskId/run-now', () => {
    it('runs a task immediately', async () => {
      const task = makeMockTask({ status: 'queued' });
      mockService.runTaskNow.mockReturnValue(task);

      const res = await request(app)
        .post('/api/v2/tasks/task-1/run-now')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockService.runTaskNow).toHaveBeenCalledWith('task-1');
    });

    it('returns 404 when task not found', async () => {
      mockService.runTaskNow.mockImplementation(() => {
        throw new Error('Task not found');
      });

      const res = await request(app)
        .post('/api/v2/tasks/nonexistent/run-now')
        .expect(404);

      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 for invalid state', async () => {
      mockService.runTaskNow.mockImplementation(() => {
        throw new Error('Task cannot be run now');
      });

      const res = await request(app)
        .post('/api/v2/tasks/task-1/run-now')
        .expect(400);

      expect(res.body.error.code).toBe('INVALID_STATE');
    });
  });

  // ========================================
  // GET /projects/:projectId/context
  // ========================================
  describe('GET /projects/:projectId/context', () => {
    it('returns context documents', async () => {
      const docs = [{ id: 'doc-1', content: 'Test doc' }];
      mockService.getContextDocuments.mockReturnValue(docs);

      const res = await request(app)
        .get('/api/v2/projects/proj-1/context')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(docs);
    });

    it('returns 500 when getContextDocuments throws', async () => {
      mockService.getContextDocuments.mockImplementation(() => {
        throw new Error('DB error');
      });

      const res = await request(app)
        .get('/api/v2/projects/proj-1/context')
        .expect(500);

      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
