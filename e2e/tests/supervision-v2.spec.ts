/**
 * Supervision V2 E2E Tests (API-level)
 *
 * Tests the complete Supervision v2 API contract:
 * agent lifecycle, task CRUD, review, context, budget, and logs.
 *
 * Requires the server to be running on localhost:3100.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { setupCleanDB, createApiClient, readApiKey } from '../helpers/setup';
import type { ApiClient } from '../helpers/setup';

describe('Supervision V2', () => {
  let client: ApiClient;
  let projectId: string;

  beforeEach(async () => {
    await setupCleanDB();

    const apiKey = readApiKey();
    client = createApiClient(apiKey);

    // Create a test project
    const projRes = await client.fetch('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'test-sv2-project', type: 'code' }),
    });
    const projData = await projRes.json();
    expect(projData.success).toBe(true);
    projectId = projData.data.id;
  }, 15000);

  // SV2-1: Agent lifecycle
  describe('Agent Lifecycle', () => {
    test('init → pause → resume → archive', async () => {
      // Init
      const initRes = await client.fetch(`/api/v2/projects/${projectId}/agent/init`, {
        method: 'POST',
        body: JSON.stringify({
          config: { maxConcurrentTasks: 2, trustLevel: 'medium', autoDiscoverTasks: false },
        }),
      });
      const initData = await initRes.json();
      expect(initRes.status).toBe(200);
      expect(initData.success).toBe(true);
      expect(initData.data.phase).toBe('initializing');
      expect(initData.data.config.trustLevel).toBe('medium');

      // Get agent
      const getRes = await client.fetch(`/api/v2/projects/${projectId}/agent`);
      const getData = await getRes.json();
      expect(getRes.status).toBe(200);
      expect(getData.data.phase).toBe('initializing');

      // Pause
      const pauseRes = await client.fetch(`/api/v2/projects/${projectId}/agent/action`, {
        method: 'POST',
        body: JSON.stringify({ action: 'pause' }),
      });
      const pauseData = await pauseRes.json();
      expect(pauseRes.status).toBe(200);
      expect(pauseData.data.phase).toBe('paused');

      // Resume
      const resumeRes = await client.fetch(`/api/v2/projects/${projectId}/agent/action`, {
        method: 'POST',
        body: JSON.stringify({ action: 'resume' }),
      });
      const resumeData = await resumeRes.json();
      expect(resumeRes.status).toBe(200);
      // Resumes back to a non-paused phase
      expect(resumeData.data.phase).not.toBe('paused');

      // Archive
      const archiveRes = await client.fetch(`/api/v2/projects/${projectId}/agent/action`, {
        method: 'POST',
        body: JSON.stringify({ action: 'archive' }),
      });
      const archiveData = await archiveRes.json();
      expect(archiveRes.status).toBe(200);
      expect(archiveData.data.phase).toBe('archived');
    }, 30000);

    test('returns 404 for project without agent', async () => {
      const res = await client.fetch(`/api/v2/projects/${projectId}/agent`);
      expect(res.status).toBe(404);
    });
  });

  // SV2-2: Task lifecycle
  describe('Task Lifecycle', () => {
    beforeEach(async () => {
      // Init agent for task tests
      await client.fetch(`/api/v2/projects/${projectId}/agent/init`, {
        method: 'POST',
        body: JSON.stringify({
          config: { maxConcurrentTasks: 1, trustLevel: 'medium', autoDiscoverTasks: false },
        }),
      });
    });

    test('create → query → update task', async () => {
      // Create
      const createRes = await client.fetch(`/api/v2/projects/${projectId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: 'Test Task',
          description: 'A test task for E2E',
          priority: 1,
          acceptanceCriteria: ['Tests pass', 'No regressions'],
        }),
      });
      const createData = await createRes.json();
      expect(createRes.status).toBe(200);
      expect(createData.success).toBe(true);
      expect(createData.data.title).toBe('Test Task');
      expect(createData.data.status).toBe('pending'); // user-created → pending
      expect(createData.data.source).toBe('user');

      const taskId = createData.data.id;

      // Query all tasks
      const listRes = await client.fetch(`/api/v2/projects/${projectId}/tasks`);
      const listData = await listRes.json();
      expect(listRes.status).toBe(200);
      expect(listData.data).toHaveLength(1);
      expect(listData.data[0].id).toBe(taskId);

      // Update
      const updateRes = await client.fetch(`/api/v2/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify({ title: 'Updated Task', priority: 5 }),
      });
      const updateData = await updateRes.json();
      expect(updateRes.status).toBe(200);
      expect(updateData.data.title).toBe('Updated Task');
      expect(updateData.data.priority).toBe(5);
    }, 15000);

    test('create multiple tasks with dependencies', async () => {
      // Create task A
      const aRes = await client.fetch(`/api/v2/projects/${projectId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: 'Task A',
          description: 'First task',
          acceptanceCriteria: ['Done'],
        }),
      });
      const aData = await aRes.json();
      const taskAId = aData.data.id;

      // Create task B depending on A
      const bRes = await client.fetch(`/api/v2/projects/${projectId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: 'Task B',
          description: 'Depends on A',
          dependencies: [taskAId],
          dependencyMode: 'all',
          acceptanceCriteria: ['Done'],
        }),
      });
      const bData = await bRes.json();
      expect(bData.data.dependencies).toContain(taskAId);
      expect(bData.data.dependencyMode).toBe('all');
    }, 15000);
  });

  // SV2-3: Task approval/rejection
  describe('Task Approval', () => {
    beforeEach(async () => {
      await client.fetch(`/api/v2/projects/${projectId}/agent/init`, {
        method: 'POST',
        body: JSON.stringify({
          config: { maxConcurrentTasks: 1, trustLevel: 'medium', autoDiscoverTasks: false },
        }),
      });
    });

    test('approve a pending task', async () => {
      const createRes = await client.fetch(`/api/v2/projects/${projectId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: 'Task to approve',
          description: 'Test approval',
          acceptanceCriteria: ['Approved'],
        }),
      });
      const createData = await createRes.json();
      const taskId = createData.data.id;

      const approveRes = await client.fetch(`/api/v2/tasks/${taskId}/approve`, {
        method: 'POST',
      });
      expect(approveRes.status).toBe(200);
      const approveData = await approveRes.json();
      // User-created task approval should transition it
      expect(approveData.success).toBe(true);
    }, 15000);

    test('reject a pending task', async () => {
      const createRes = await client.fetch(`/api/v2/projects/${projectId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: 'Task to reject',
          description: 'Test rejection',
          acceptanceCriteria: ['Rejected'],
        }),
      });
      const createData = await createRes.json();
      const taskId = createData.data.id;

      const rejectRes = await client.fetch(`/api/v2/tasks/${taskId}/reject`, {
        method: 'POST',
      });
      expect(rejectRes.status).toBe(200);
      const rejectData = await rejectRes.json();
      expect(rejectData.success).toBe(true);
    }, 15000);
  });

  // SV2-4: Review flow (API contract only — no real AI execution)
  describe('Review API Contract', () => {
    beforeEach(async () => {
      await client.fetch(`/api/v2/projects/${projectId}/agent/init`, {
        method: 'POST',
        body: JSON.stringify({
          config: { maxConcurrentTasks: 1, trustLevel: 'low', autoDiscoverTasks: false },
        }),
      });
    });

    test('review approve/reject returns proper errors for non-reviewing tasks', async () => {
      const createRes = await client.fetch(`/api/v2/projects/${projectId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: 'Not reviewing',
          description: 'Task not in reviewing state',
          acceptanceCriteria: ['N/A'],
        }),
      });
      const createData = await createRes.json();
      const taskId = createData.data.id;

      // Try to approve result on a non-reviewing task
      const approveRes = await client.fetch(`/api/v2/tasks/${taskId}/review/approve`, {
        method: 'POST',
      });
      // Should fail because task is not in 'reviewing' state
      expect(approveRes.status).toBeGreaterThanOrEqual(400);

      // Try to reject result on a non-reviewing task
      const rejectRes = await client.fetch(`/api/v2/tasks/${taskId}/review/reject`, {
        method: 'POST',
        body: JSON.stringify({ notes: 'Not valid' }),
      });
      expect(rejectRes.status).toBeGreaterThanOrEqual(400);
    }, 15000);
  });

  // SV2-5: Context management
  describe('Context Management', () => {
    beforeEach(async () => {
      await client.fetch(`/api/v2/projects/${projectId}/agent/init`, {
        method: 'POST',
        body: JSON.stringify({
          config: { maxConcurrentTasks: 1, trustLevel: 'medium', autoDiscoverTasks: false },
        }),
      });
    });

    test('list and reload context documents', async () => {
      // List context
      const listRes = await client.fetch(`/api/v2/projects/${projectId}/context`);
      expect(listRes.status).toBe(200);
      const listData = await listRes.json();
      expect(listData.success).toBe(true);
      expect(Array.isArray(listData.data)).toBe(true);

      // Reload context
      const reloadRes = await client.fetch(`/api/v2/projects/${projectId}/context/reload`, {
        method: 'POST',
      });
      expect(reloadRes.status).toBe(200);
    }, 15000);
  });

  // SV2-6: Budget and logs
  describe('Budget and Logs', () => {
    beforeEach(async () => {
      await client.fetch(`/api/v2/projects/${projectId}/agent/init`, {
        method: 'POST',
        body: JSON.stringify({
          config: { maxConcurrentTasks: 1, trustLevel: 'medium', autoDiscoverTasks: false },
        }),
      });
    });

    test('budget endpoint returns usage data', async () => {
      const res = await client.fetch(`/api/v2/projects/${projectId}/budget`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(typeof data.data.usage).toBe('number');
      expect(data.data.usage).toBeGreaterThanOrEqual(0);
    }, 15000);

    test('logs endpoint returns event history', async () => {
      const res = await client.fetch(`/api/v2/projects/${projectId}/logs`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      // Should have at least the 'agent_initialized' event from init
      expect(data.data.length).toBeGreaterThanOrEqual(1);
      expect(data.data.some((l: any) => l.event === 'agent_initialized')).toBe(true);
    }, 15000);

    test('logs with limit parameter', async () => {
      const res = await client.fetch(`/api/v2/projects/${projectId}/logs?limit=5`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.length).toBeLessThanOrEqual(5);
    }, 15000);
  });
});
