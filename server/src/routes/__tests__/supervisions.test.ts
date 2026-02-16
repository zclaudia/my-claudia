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
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS supervisions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      goal TEXT NOT NULL,
      subtasks TEXT,
      status TEXT CHECK(status IN ('active', 'paused', 'completed', 'failed', 'cancelled')) NOT NULL DEFAULT 'active',
      max_iterations INTEGER NOT NULL DEFAULT 10,
      current_iteration INTEGER NOT NULL DEFAULT 0,
      cooldown_seconds INTEGER NOT NULL DEFAULT 5,
      last_run_id TEXT,
      error_message TEXT,
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

  describe('POST /api/supervisions/plan', () => {
    it('should return a plan with goal', async () => {
      const { sessionId } = createTestSession(db);

      const res = await request(app)
        .post('/api/supervisions/plan')
        .send({ sessionId, hint: 'Build auth system' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.goal).toBe('Build auth system');
      expect(res.body.data.subtasks).toEqual([]);
      expect(res.body.data.estimatedIterations).toBe(5);
    });

    it('should return 400 when sessionId is missing', async () => {
      const res = await request(app)
        .post('/api/supervisions/plan')
        .send({ hint: 'No session' })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('should not be caught by /:id route', async () => {
      const { sessionId } = createTestSession(db);

      // /plan should be handled by the plan route, not /:id
      const res = await request(app)
        .post('/api/supervisions/plan')
        .send({ sessionId })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('goal');
    });
  });
});
