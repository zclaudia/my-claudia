import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createAgentRoutes } from '../agent.js';

// Create in-memory database for testing
function createTestDb(): Database.Database {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_config (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      enabled INTEGER NOT NULL DEFAULT 1,
      project_id TEXT,
      session_id TEXT,
      provider_id TEXT,
      permission_workflow_override_id TEXT,
      permission_policy TEXT,
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
      working_directory TEXT,
      project_role TEXT,
      task_id TEXT,
      plan_status TEXT,
      is_read_only INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

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

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      is_system INTEGER NOT NULL DEFAULT 0
    );
  `);

  return db;
}

function createTestApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  app.use('/api/agent', createAgentRoutes(db));
  return app;
}

function seedDefaultConfig(db: Database.Database) {
  const now = Date.now();
  db.prepare(`
    INSERT OR IGNORE INTO agent_config (id, enabled, created_at, updated_at)
    VALUES (1, 1, ?, ?)
  `).run(now, now);
}

describe('agent routes', () => {
  let db: Database.Database;
  let app: ReturnType<typeof express>;

  beforeAll(() => {
    db = createTestDb();
    app = createTestApp(db);
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(() => {
    db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM projects');
    db.exec('DELETE FROM providers');
    db.exec('DELETE FROM workflows');
    db.exec('DELETE FROM agent_config');
  });

  describe('GET /api/agent/config', () => {
    it('returns 404 when no config row exists', async () => {
      const res = await request(app).get('/api/agent/config');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.message).toBe('Agent config not found');
    });

    it('returns default config with enabled=true and null IDs', async () => {
      seedDefaultConfig(db);

      const res = await request(app).get('/api/agent/config');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        id: 1,
        enabled: true,
        projectId: null,
        sessionId: null,
        providerId: null,
        permissionWorkflowOverrideId: null,
        permissionPolicy: null,
      });
      expect(res.body.data.createdAt).toBeDefined();
      expect(res.body.data.updatedAt).toBeDefined();
    });

    it('returns configured config with project and session IDs', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO agent_config (id, enabled, project_id, session_id, provider_id, permission_policy, created_at, updated_at)
        VALUES (1, 0, 'proj-1', 'sess-1', 'prov-1', '{"trustLevel":"aggressive"}', ?, ?)
      `).run(now, now);

      const res = await request(app).get('/api/agent/config');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        id: 1,
        enabled: false,
        projectId: 'proj-1',
        sessionId: 'sess-1',
        providerId: 'prov-1',
        permissionWorkflowOverrideId: null,
        permissionPolicy: '{"trustLevel":"aggressive"}',
      });
    });
  });

  describe('POST /api/agent/ensure', () => {
    beforeEach(() => {
      seedDefaultConfig(db);
    });

    it('creates a hidden __claudia host project and session when missing', async () => {
      const res = await request(app).post('/api/agent/ensure');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.projectId).toBeTruthy();
      expect(res.body.data.sessionId).toBeTruthy();

      const project = db.prepare('SELECT name, type, is_internal FROM projects WHERE id = ?')
        .get(res.body.data.projectId) as { name: string; type: string; is_internal: number };
      const session = db.prepare('SELECT name, project_id FROM sessions WHERE id = ?')
        .get(res.body.data.sessionId) as { name: string; project_id: string };
      const config = db.prepare('SELECT project_id, session_id FROM agent_config WHERE id = 1')
        .get() as { project_id: string; session_id: string };

      expect(project).toEqual({ name: '__claudia', type: 'chat_only', is_internal: 1 });
      expect(session).toEqual({ name: 'Claudia Chat', project_id: res.body.data.projectId });
      expect(config).toEqual({ project_id: res.body.data.projectId, session_id: res.body.data.sessionId });
    });

    it('reuses legacy _Agent Assistant project and renames it to __claudia', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO projects (id, name, type, is_internal, created_at, updated_at)
        VALUES ('legacy-project', '_Agent Assistant', 'chat_only', 1, ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, type, created_at, updated_at)
        VALUES ('legacy-session', 'legacy-project', 'Agent Chat', 'regular', ?, ?)
      `).run(now, now);

      const res = await request(app).post('/api/agent/ensure');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        projectId: 'legacy-project',
        sessionId: 'legacy-session',
      });

      const project = db.prepare('SELECT name, is_internal FROM projects WHERE id = ?')
        .get('legacy-project') as { name: string; is_internal: number };
      const session = db.prepare('SELECT name FROM sessions WHERE id = ?')
        .get('legacy-session') as { name: string };

      expect(project).toEqual({ name: '__claudia', is_internal: 1 });
      expect(session).toEqual({ name: 'Claudia Chat' });
    });

    it('creates a new Claudia session instead of renaming an unrelated session in the host project', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO projects (id, name, type, is_internal, created_at, updated_at)
        VALUES ('claudia-project', '__claudia', 'chat_only', 1, ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, type, created_at, updated_at)
        VALUES ('user-session', 'claudia-project', 'Keep Me', 'regular', ?, ?)
      `).run(now, now);

      const res = await request(app).post('/api/agent/ensure');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.projectId).toBe('claudia-project');
      expect(res.body.data.sessionId).not.toBe('user-session');

      const reusedSession = db.prepare('SELECT name FROM sessions WHERE id = ?')
        .get('user-session') as { name: string };
      const claudiaSession = db.prepare('SELECT name, project_id FROM sessions WHERE id = ?')
        .get(res.body.data.sessionId) as { name: string; project_id: string };

      expect(reusedSession).toEqual({ name: 'Keep Me' });
      expect(claudiaSession).toEqual({ name: 'Claudia Chat', project_id: 'claudia-project' });
    });
  });

  describe('PUT /api/agent/config', () => {
    beforeEach(() => {
      seedDefaultConfig(db);
    });

    it('updates enabled to false', async () => {
      const res = await request(app)
        .put('/api/agent/config')
        .send({ enabled: false });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.enabled).toBe(false);
    });

    it('updates enabled to true', async () => {
      // First disable
      db.prepare('UPDATE agent_config SET enabled = 0 WHERE id = 1').run();

      const res = await request(app)
        .put('/api/agent/config')
        .send({ enabled: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.enabled).toBe(true);
    });

    it('updates providerId', async () => {
      const res = await request(app)
        .put('/api/agent/config')
        .send({ providerId: 'my-provider-id' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.providerId).toBe('my-provider-id');
    });

    it('updates permissionPolicy as JSON object', async () => {
      const policy = { trustLevel: 'cautious', strategies: {} };
      const res = await request(app)
        .put('/api/agent/config')
        .send({ permissionPolicy: policy });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.permissionPolicy).toBe(JSON.stringify(policy));
    });

    it('updates permissionPolicy as string', async () => {
      const policyStr = '{"trustLevel":"cautious"}';
      const res = await request(app)
        .put('/api/agent/config')
        .send({ permissionPolicy: policyStr });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.permissionPolicy).toBe(policyStr);
    });

    it('sets permissionPolicy to stringified null when sent as null', async () => {
      // First set a policy
      db.prepare("UPDATE agent_config SET permission_policy = '{\"x\":1}' WHERE id = 1").run();

      const res = await request(app)
        .put('/api/agent/config')
        .send({ permissionPolicy: null });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // typeof null is 'object', so route does JSON.stringify(null) => "null"
      expect(res.body.data.permissionPolicy).toBe('null');
    });

    it('clears permissionPolicy when field is omitted from request', async () => {
      // First set a policy
      db.prepare("UPDATE agent_config SET permission_policy = '{\"x\":1}' WHERE id = 1").run();

      // When permissionPolicy is not in the body (undefined), it passes null to COALESCE
      // But the UPDATE uses a direct ? (not COALESCE) for permission_policy, so it becomes NULL
      const res = await request(app)
        .put('/api/agent/config')
        .send({ enabled: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.permissionPolicy).toBeNull();
    });

    it('updates multiple fields at once', async () => {
      const res = await request(app)
        .put('/api/agent/config')
        .send({
          enabled: false,
          providerId: 'new-provider',
          permissionPolicy: { trustLevel: 'strict' },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.enabled).toBe(false);
      expect(res.body.data.providerId).toBe('new-provider');
      expect(res.body.data.permissionPolicy).toBe(JSON.stringify({ trustLevel: 'strict' }));
    });

    it('updates permissionWorkflowOverrideId', async () => {
      db.prepare(`INSERT INTO workflows (id, is_system) VALUES (?, 0)`).run('wf-user');

      const res = await request(app)
        .put('/api/agent/config')
        .send({ permissionWorkflowOverrideId: 'wf-user' });

      expect(res.status).toBe(200);
      expect(res.body.data.permissionWorkflowOverrideId).toBe('wf-user');
      const row = db.prepare('SELECT permission_workflow_override_id FROM agent_config WHERE id = 1').get() as any;
      expect(row.permission_workflow_override_id).toBe('wf-user');
    });

    it('clears permissionWorkflowOverrideId when set to null', async () => {
      db.prepare(`INSERT INTO workflows (id, is_system) VALUES (?, 0)`).run('wf-user');
      db.prepare(`UPDATE agent_config SET permission_workflow_override_id = 'wf-user' WHERE id = 1`).run();

      const res = await request(app)
        .put('/api/agent/config')
        .send({ permissionWorkflowOverrideId: null });

      expect(res.status).toBe(200);
      expect(res.body.data.permissionWorkflowOverrideId).toBeNull();
      const row = db.prepare('SELECT permission_workflow_override_id FROM agent_config WHERE id = 1').get() as any;
      expect(row.permission_workflow_override_id).toBeNull();
    });

    it('rejects unknown permissionWorkflowOverrideId', async () => {
      const res = await request(app)
        .put('/api/agent/config')
        .send({ permissionWorkflowOverrideId: 'wf-missing' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects system fallback as global override', async () => {
      db.prepare(`INSERT INTO workflows (id, is_system) VALUES (?, 1)`).run('wf-system');

      const res = await request(app)
        .put('/api/agent/config')
        .send({ permissionWorkflowOverrideId: 'wf-system' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects permissionPolicy when aiReview.analysisProviderId does not support cli-jobs', async () => {
      seedDefaultConfig(db);
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p-legacy', 'Legacy Provider', 'unknown-type', now, now);

      const res = await request(app)
        .put('/api/agent/config')
        .send({
          permissionPolicy: {
            enabled: true,
            profile: {
              fileRead: 'auto-approve',
              fileWrite: 'auto-approve',
              shellSafe: 'auto-approve',
              networkOps: 'auto-approve',
              destructiveOps: 'ask',
              userQuestions: 'ask',
            },
            aiReview: {
              enabled: true,
              analysisProviderId: 'p-legacy',
            },
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('does not support cli-jobs');
    });

    it('preserves unchanged fields when only updating one field', async () => {
      // Pre-configure provider
      db.prepare("UPDATE agent_config SET provider_id = 'original-provider' WHERE id = 1").run();

      const res = await request(app)
        .put('/api/agent/config')
        .send({ enabled: false });

      expect(res.status).toBe(200);
      expect(res.body.data.enabled).toBe(false);
      expect(res.body.data.providerId).toBe('original-provider');
    });

    it('updates the updatedAt timestamp', async () => {
      const before = db.prepare('SELECT updated_at FROM agent_config WHERE id = 1').get() as { updated_at: number };

      // Small delay to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      await request(app)
        .put('/api/agent/config')
        .send({ enabled: false });

      const after = db.prepare('SELECT updated_at FROM agent_config WHERE id = 1').get() as { updated_at: number };
      expect(after.updated_at).toBeGreaterThan(before.updated_at);
    });
  });

  describe('GET /api/agent/config - error handling', () => {
    it('returns 500 on database error', async () => {
      const spy = vi.spyOn(db, 'prepare').mockImplementation(() => {
        throw new Error('DB error');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const res = await request(app).get('/api/agent/config');

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('DB_ERROR');
      spy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe('PUT /api/agent/config - error handling', () => {
    it('returns 500 on database error', async () => {
      const spy = vi.spyOn(db, 'prepare').mockImplementation(() => {
        throw new Error('DB error');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const res = await request(app)
        .put('/api/agent/config')
        .send({ enabled: false });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('DB_ERROR');
      spy.mockRestore();
      errorSpy.mockRestore();
    });
  });
});
