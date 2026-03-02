import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
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
        permissionPolicy: '{"trustLevel":"aggressive"}',
      });
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

});
