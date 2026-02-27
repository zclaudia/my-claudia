import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

// Mock server.ts exports before importing
vi.mock('../../server.js', () => ({
  createVirtualClient: vi.fn((clientId: string, opts: { send: (msg: any) => void }) => ({
    id: clientId,
    ws: {
      readyState: 1,
      send: (data: string) => opts.send(JSON.parse(data)),
    },
    authenticated: true,
    isAlive: true,
  })),
  handleRunStart: vi.fn(),
  activeRuns: new Map(),
  sendMessage: vi.fn(),
}));

import { SupervisorService } from '../../services/supervisor-service.js';
import { createSupervisionRoutes } from '../../routes/supervisions.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'claude',
      cli_path TEXT,
      env TEXT,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT CHECK(type IN ('chat_only', 'code')) DEFAULT 'code',
      provider_id TEXT,
      root_path TEXT,
      system_prompt TEXT,
      permission_policy TEXT,
      agent_permission_override TEXT,
      is_internal INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT,
      provider_id TEXT,
      sdk_session_id TEXT,
      type TEXT DEFAULT 'regular',
      parent_session_id TEXT,
      archived_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT CHECK(role IN ('user', 'assistant', 'system')) NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      offset INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session_offset ON messages(session_id, offset);

    CREATE TABLE IF NOT EXISTS supervisions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      goal TEXT NOT NULL,
      subtasks TEXT,
      status TEXT CHECK(status IN ('planning', 'active', 'paused', 'completed', 'failed', 'cancelled')) NOT NULL DEFAULT 'active',
      max_iterations INTEGER NOT NULL DEFAULT 10,
      current_iteration INTEGER NOT NULL DEFAULT 0,
      cooldown_seconds INTEGER NOT NULL DEFAULT 5,
      last_run_id TEXT,
      error_message TEXT,
      plan_session_id TEXT,
      acceptance_criteria TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS supervision_logs (
      id TEXT PRIMARY KEY,
      supervision_id TEXT NOT NULL,
      iteration INTEGER,
      event TEXT NOT NULL,
      detail TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  return db;
}

function createTestSession(db: Database.Database): { projectId: string; sessionId: string } {
  const projectId = uuidv4();
  const sessionId = uuidv4();
  const now = Date.now();

  db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at)
    VALUES (?, ?, 'code', ?, ?)`).run(projectId, 'Test Project', now, now);
  db.prepare(`INSERT INTO sessions (id, project_id, name, created_at, updated_at)
    VALUES (?, ?, 'Test Session', ?, ?)`).run(sessionId, projectId, now, now);

  return { projectId, sessionId };
}

describe('Supervision Routes', () => {
  let db: Database.Database;
  let app: express.Express;
  let service: SupervisorService;

  beforeAll(() => {
    db = createTestDb();
    service = new SupervisorService(db);
    app = express();
    app.use(express.json());
    app.use('/api/supervisions', createSupervisionRoutes(service));
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(() => {
    db.exec('DELETE FROM supervision_logs');
    db.exec('DELETE FROM supervisions');
    db.exec('DELETE FROM messages');
    db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM projects');
  });

  describe('POST /api/supervisions', () => {
    it('should create a supervision', async () => {
      const { sessionId } = createTestSession(db);

      const res = await request(app)
        .post('/api/supervisions')
        .send({ sessionId, goal: 'Implement feature' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.sessionId).toBe(sessionId);
      expect(res.body.data.goal).toBe('Implement feature');
      expect(res.body.data.status).toBe('active');
    });

    it('should return 400 when sessionId is missing', async () => {
      const res = await request(app)
        .post('/api/supervisions')
        .send({ goal: 'No session' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when goal is missing', async () => {
      const { sessionId } = createTestSession(db);

      const res = await request(app)
        .post('/api/supervisions')
        .send({ sessionId })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('should return 409 when session already has active supervision', async () => {
      const { sessionId } = createTestSession(db);

      await request(app)
        .post('/api/supervisions')
        .send({ sessionId, goal: 'First' })
        .expect(200);

      const res = await request(app)
        .post('/api/supervisions')
        .send({ sessionId, goal: 'Second' })
        .expect(409);

      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('should create supervision with subtasks', async () => {
      const { sessionId } = createTestSession(db);

      const res = await request(app)
        .post('/api/supervisions')
        .send({
          sessionId,
          goal: 'Build system',
          subtasks: ['Task 1', 'Task 2'],
        })
        .expect(200);

      expect(res.body.data.subtasks).toHaveLength(2);
      expect(res.body.data.maxIterations).toBe(6); // 2 * 3
    });
  });

  describe('GET /api/supervisions', () => {
    it('should list all supervisions', async () => {
      const { sessionId: s1 } = createTestSession(db);
      const { sessionId: s2 } = createTestSession(db);

      await request(app).post('/api/supervisions').send({ sessionId: s1, goal: 'Goal 1' });
      await request(app).post('/api/supervisions').send({ sessionId: s2, goal: 'Goal 2' });

      const res = await request(app).get('/api/supervisions').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
    });
  });

  describe('GET /api/supervisions/session/:sid', () => {
    it('should get active supervision by session ID', async () => {
      const { sessionId } = createTestSession(db);

      await request(app).post('/api/supervisions').send({ sessionId, goal: 'Test' });

      const res = await request(app)
        .get(`/api/supervisions/session/${sessionId}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.sessionId).toBe(sessionId);
    });

    it('should return null for session without supervision', async () => {
      const { sessionId } = createTestSession(db);

      const res = await request(app)
        .get(`/api/supervisions/session/${sessionId}`)
        .expect(200);

      expect(res.body.data).toBeNull();
    });

    it('should not be caught by /:id route', async () => {
      // This tests that /session/:sid comes before /:id in routing
      const { sessionId } = createTestSession(db);
      await request(app).post('/api/supervisions').send({ sessionId, goal: 'Test' });

      const res = await request(app)
        .get(`/api/supervisions/session/${sessionId}`)
        .expect(200);

      // Should return the supervision by session, not 404 from /:id
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/supervisions/:id', () => {
    it('should get supervision by ID', async () => {
      const { sessionId } = createTestSession(db);

      const createRes = await request(app)
        .post('/api/supervisions')
        .send({ sessionId, goal: 'Test' });

      const supId = createRes.body.data.id;

      const res = await request(app)
        .get(`/api/supervisions/${supId}`)
        .expect(200);

      expect(res.body.data.id).toBe(supId);
    });

    it('should return 404 for non-existent supervision', async () => {
      const res = await request(app)
        .get('/api/supervisions/non-existent')
        .expect(404);

      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /api/supervisions/:id/logs', () => {
    it('should return supervision logs', async () => {
      const { sessionId } = createTestSession(db);

      const createRes = await request(app)
        .post('/api/supervisions')
        .send({ sessionId, goal: 'Test' });

      const supId = createRes.body.data.id;

      // Pause to generate a log entry
      await request(app).post(`/api/supervisions/${supId}/pause`);

      const res = await request(app)
        .get(`/api/supervisions/${supId}/logs`)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThan(0);
      const pauseLog = res.body.data.find((l: any) => l.event === 'paused');
      expect(pauseLog).toBeDefined();
    });
  });

  describe('PUT /api/supervisions/:id', () => {
    it('should update supervision settings', async () => {
      const { sessionId } = createTestSession(db);

      const createRes = await request(app)
        .post('/api/supervisions')
        .send({ sessionId, goal: 'Old goal' });

      const supId = createRes.body.data.id;

      const res = await request(app)
        .put(`/api/supervisions/${supId}`)
        .send({ goal: 'New goal', maxIterations: 50 })
        .expect(200);

      expect(res.body.data.goal).toBe('New goal');
      expect(res.body.data.maxIterations).toBe(50);
    });
  });

  describe('POST /api/supervisions/:id/pause', () => {
    it('should pause an active supervision', async () => {
      const { sessionId } = createTestSession(db);

      const createRes = await request(app)
        .post('/api/supervisions')
        .send({ sessionId, goal: 'Test' });

      const supId = createRes.body.data.id;

      const res = await request(app)
        .post(`/api/supervisions/${supId}/pause`)
        .expect(200);

      expect(res.body.data.status).toBe('paused');
    });
  });

  describe('POST /api/supervisions/:id/resume', () => {
    it('should resume a paused supervision', async () => {
      const { sessionId } = createTestSession(db);

      const createRes = await request(app)
        .post('/api/supervisions')
        .send({ sessionId, goal: 'Test' });

      const supId = createRes.body.data.id;

      await request(app).post(`/api/supervisions/${supId}/pause`);

      const res = await request(app)
        .post(`/api/supervisions/${supId}/resume`)
        .expect(200);

      expect(res.body.data.status).toBe('active');
    });

    it('should resume with updated maxIterations', async () => {
      const { sessionId } = createTestSession(db);

      const createRes = await request(app)
        .post('/api/supervisions')
        .send({ sessionId, goal: 'Test', maxIterations: 2 });

      const supId = createRes.body.data.id;

      await request(app).post(`/api/supervisions/${supId}/pause`);

      const res = await request(app)
        .post(`/api/supervisions/${supId}/resume`)
        .send({ maxIterations: 20 })
        .expect(200);

      expect(res.body.data.maxIterations).toBe(20);
    });

    it('should return 400 when resuming non-paused supervision', async () => {
      const { sessionId } = createTestSession(db);

      const createRes = await request(app)
        .post('/api/supervisions')
        .send({ sessionId, goal: 'Test' });

      const supId = createRes.body.data.id;

      const res = await request(app)
        .post(`/api/supervisions/${supId}/resume`)
        .expect(400);

      expect(res.body.error.code).toBe('INVALID_STATE');
    });
  });

  describe('POST /api/supervisions/:id/cancel', () => {
    it('should cancel a supervision', async () => {
      const { sessionId } = createTestSession(db);

      const createRes = await request(app)
        .post('/api/supervisions')
        .send({ sessionId, goal: 'Test' });

      const supId = createRes.body.data.id;

      const res = await request(app)
        .post(`/api/supervisions/${supId}/cancel`)
        .expect(200);

      expect(res.body.data.status).toBe('cancelled');
    });
  });

  describe('POST /api/supervisions/plan/start', () => {
    it('should return 400 when sessionId is missing', async () => {
      const res = await request(app)
        .post('/api/supervisions/plan/start')
        .send({ hint: 'No session' })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('should return 400 when hint is missing', async () => {
      const { sessionId } = createTestSession(db);

      const res = await request(app)
        .post('/api/supervisions/plan/start')
        .send({ sessionId })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('should not be caught by /:id route', async () => {
      // /plan/start should be handled by the plan route, not /:id
      const res = await request(app)
        .post('/api/supervisions/plan/start')
        .send({})
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should start planning and return supervision with planSessionId', async () => {
      const { sessionId } = createTestSession(db);

      const res = await request(app)
        .post('/api/supervisions/plan/start')
        .send({ sessionId, hint: 'Build a REST API' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.supervision.status).toBe('planning');
      expect(res.body.data.supervision.sessionId).toBe(sessionId);
      expect(res.body.data.planSessionId).toBeDefined();
    });

    it('should return 409 when session already has active supervision', async () => {
      const { sessionId } = createTestSession(db);

      // Create an active supervision first
      await request(app)
        .post('/api/supervisions')
        .send({ sessionId, goal: 'Existing goal' })
        .expect(200);

      const res = await request(app)
        .post('/api/supervisions/plan/start')
        .send({ sessionId, hint: 'Another goal' })
        .expect(409);

      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('should return 409 when session already has planning supervision', async () => {
      const { sessionId } = createTestSession(db);

      // Start planning first
      await request(app)
        .post('/api/supervisions/plan/start')
        .send({ sessionId, hint: 'First plan' })
        .expect(200);

      const res = await request(app)
        .post('/api/supervisions/plan/start')
        .send({ sessionId, hint: 'Second plan' })
        .expect(409);

      expect(res.body.error.code).toBe('CONFLICT');
    });
  });

  describe('POST /api/supervisions/plan/:id/respond', () => {
    it('should return 400 when message is missing', async () => {
      const { sessionId } = createTestSession(db);

      const planRes = await request(app)
        .post('/api/supervisions/plan/start')
        .send({ sessionId, hint: 'Plan something' })
        .expect(200);

      const supId = planRes.body.data.supervision.id;

      const res = await request(app)
        .post(`/api/supervisions/plan/${supId}/respond`)
        .send({})
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should accept a response for planning supervision', async () => {
      const { sessionId } = createTestSession(db);

      const planRes = await request(app)
        .post('/api/supervisions/plan/start')
        .send({ sessionId, hint: 'Plan something' })
        .expect(200);

      const supId = planRes.body.data.supervision.id;

      const res = await request(app)
        .post(`/api/supervisions/plan/${supId}/respond`)
        .send({ message: 'I want to build a REST API with Express' })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('should return 400 when supervision is not in planning status', async () => {
      const { sessionId } = createTestSession(db);

      // Create an active (non-planning) supervision
      const createRes = await request(app)
        .post('/api/supervisions')
        .send({ sessionId, goal: 'Active goal' })
        .expect(200);

      const supId = createRes.body.data.id;

      const res = await request(app)
        .post(`/api/supervisions/plan/${supId}/respond`)
        .send({ message: 'Hello' })
        .expect(400);

      expect(res.body.error.code).toBe('INVALID_STATE');
    });
  });

  describe('POST /api/supervisions/plan/:id/approve', () => {
    it('should return 400 when goal is missing', async () => {
      const { sessionId } = createTestSession(db);

      const planRes = await request(app)
        .post('/api/supervisions/plan/start')
        .send({ sessionId, hint: 'Plan something' })
        .expect(200);

      const supId = planRes.body.data.supervision.id;

      const res = await request(app)
        .post(`/api/supervisions/plan/${supId}/approve`)
        .send({ subtasks: [{ description: 'Task 1' }] })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when subtasks is missing', async () => {
      const { sessionId } = createTestSession(db);

      const planRes = await request(app)
        .post('/api/supervisions/plan/start')
        .send({ sessionId, hint: 'Plan something' })
        .expect(200);

      const supId = planRes.body.data.supervision.id;

      const res = await request(app)
        .post(`/api/supervisions/plan/${supId}/approve`)
        .send({ goal: 'Refined goal' })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should approve plan and transition to active', async () => {
      const { sessionId } = createTestSession(db);

      const planRes = await request(app)
        .post('/api/supervisions/plan/start')
        .send({ sessionId, hint: 'Plan something' })
        .expect(200);

      const supId = planRes.body.data.supervision.id;

      const res = await request(app)
        .post(`/api/supervisions/plan/${supId}/approve`)
        .send({
          goal: 'Build a REST API with Express',
          subtasks: [
            { description: 'Set up project', phase: 1, acceptanceCriteria: ['package.json exists'] },
            { description: 'Create routes', phase: 2, acceptanceCriteria: ['GET /api works'] },
          ],
          acceptanceCriteria: ['Server starts on port 3000', 'All tests pass'],
          maxIterations: 10,
          cooldownSeconds: 3,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('active');
      expect(res.body.data.goal).toBe('Build a REST API with Express');
      expect(res.body.data.subtasks).toHaveLength(2);
      expect(res.body.data.subtasks[0].phase).toBe(1);
      expect(res.body.data.subtasks[0].acceptanceCriteria).toEqual(['package.json exists']);
      expect(res.body.data.acceptanceCriteria).toEqual(['Server starts on port 3000', 'All tests pass']);
      expect(res.body.data.maxIterations).toBe(10);
    });

    it('should return 400 when approving a non-planning supervision', async () => {
      const { sessionId } = createTestSession(db);

      const createRes = await request(app)
        .post('/api/supervisions')
        .send({ sessionId, goal: 'Active goal' })
        .expect(200);

      const supId = createRes.body.data.id;

      const res = await request(app)
        .post(`/api/supervisions/plan/${supId}/approve`)
        .send({
          goal: 'New goal',
          subtasks: [{ description: 'Task 1' }],
        })
        .expect(400);

      expect(res.body.error.code).toBe('INVALID_STATE');
    });
  });

  describe('GET /api/supervisions/plan/:id/conversation', () => {
    it('should return empty array for supervision without plan session', async () => {
      const { sessionId } = createTestSession(db);

      const createRes = await request(app)
        .post('/api/supervisions')
        .send({ sessionId, goal: 'No plan session' })
        .expect(200);

      const supId = createRes.body.data.id;

      const res = await request(app)
        .get(`/api/supervisions/plan/${supId}/conversation`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it('should return messages for planning supervision', async () => {
      const { sessionId } = createTestSession(db);

      const planRes = await request(app)
        .post('/api/supervisions/plan/start')
        .send({ sessionId, hint: 'Plan something' })
        .expect(200);

      const supId = planRes.body.data.supervision.id;
      const planSessionId = planRes.body.data.planSessionId;

      // Insert some messages into the plan session
      const now = Date.now();
      db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run('msg-1', planSessionId, 'user', 'I want to build something', now);
      db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run('msg-2', planSessionId, 'assistant', 'What kind of project?', now + 1);

      const res = await request(app)
        .get(`/api/supervisions/plan/${supId}/conversation`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].role).toBe('user');
      expect(res.body.data[0].content).toBe('I want to build something');
      expect(res.body.data[1].role).toBe('assistant');
      expect(res.body.data[1].content).toBe('What kind of project?');
    });
  });

  describe('POST /api/supervisions/plan/:id/cancel', () => {
    it('should cancel a planning supervision', async () => {
      const { sessionId } = createTestSession(db);

      const planRes = await request(app)
        .post('/api/supervisions/plan/start')
        .send({ sessionId, hint: 'Plan something' })
        .expect(200);

      const supId = planRes.body.data.supervision.id;

      const res = await request(app)
        .post(`/api/supervisions/plan/${supId}/cancel`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('cancelled');
    });

    it('should return 400 when cancelling a non-planning supervision', async () => {
      const { sessionId } = createTestSession(db);

      const createRes = await request(app)
        .post('/api/supervisions')
        .send({ sessionId, goal: 'Active goal' })
        .expect(200);

      const supId = createRes.body.data.id;

      const res = await request(app)
        .post(`/api/supervisions/plan/${supId}/cancel`)
        .expect(400);

      expect(res.body.error.code).toBe('INVALID_STATE');
    });

    it('should allow new supervision after cancelled planning', async () => {
      const { sessionId } = createTestSession(db);

      // Start planning
      const planRes = await request(app)
        .post('/api/supervisions/plan/start')
        .send({ sessionId, hint: 'Plan something' })
        .expect(200);

      // Cancel it
      await request(app)
        .post(`/api/supervisions/plan/${planRes.body.data.supervision.id}/cancel`)
        .expect(200);

      // Should be able to create a new supervision
      const res = await request(app)
        .post('/api/supervisions')
        .send({ sessionId, goal: 'New goal after cancel' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('active');
    });
  });

  describe('Planning full flow', () => {
    it('should complete plan/start → plan/:id/approve lifecycle', async () => {
      const { sessionId } = createTestSession(db);

      // Step 1: Start planning
      const planRes = await request(app)
        .post('/api/supervisions/plan/start')
        .send({ sessionId, hint: 'Build a web app' })
        .expect(200);

      const supId = planRes.body.data.supervision.id;
      expect(planRes.body.data.supervision.status).toBe('planning');

      // Step 2: Verify supervision shows as planning
      const getRes = await request(app)
        .get(`/api/supervisions/${supId}`)
        .expect(200);

      expect(getRes.body.data.status).toBe('planning');

      // Step 3: Verify session-level lookup includes planning
      const sessionRes = await request(app)
        .get(`/api/supervisions/session/${sessionId}`)
        .expect(200);

      expect(sessionRes.body.data).not.toBeNull();
      expect(sessionRes.body.data.status).toBe('planning');

      // Step 4: Approve the plan
      const approveRes = await request(app)
        .post(`/api/supervisions/plan/${supId}/approve`)
        .send({
          goal: 'Build a full-stack web application',
          subtasks: [
            { description: 'Backend setup', phase: 1 },
            { description: 'Frontend setup', phase: 1 },
            { description: 'Integration testing', phase: 2 },
          ],
          acceptanceCriteria: ['App runs locally'],
        })
        .expect(200);

      expect(approveRes.body.data.status).toBe('active');
      expect(approveRes.body.data.subtasks).toHaveLength(3);

      // Step 5: Verify logs show planning events
      const logsRes = await request(app)
        .get(`/api/supervisions/${supId}/logs`)
        .expect(200);

      const events = logsRes.body.data.map((l: any) => l.event);
      expect(events).toContain('planning_started');
      expect(events).toContain('planning_approved');
    });
  });
});
