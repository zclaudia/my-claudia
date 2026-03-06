import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createSessionRoutes } from '../sessions.js';

// Create in-memory database for testing
function createTestDb(): Database.Database {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT CHECK(type IN ('chat_only', 'code')) DEFAULT 'code',
      provider_id TEXT,
      root_path TEXT,
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
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT CHECK(role IN ('user', 'assistant', 'system')) NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      offset INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session_offset ON messages(session_id, offset);
  `);

  return db;
}

let activeRuns: Map<string, any>;

function createTestApp(db: Database.Database, runs?: Map<string, any>) {
  const app = express();
  app.use(express.json());
  activeRuns = runs || new Map<string, any>();
  app.use('/api/sessions', createSessionRoutes(db, activeRuns));
  return app;
}

describe('sessions archive/restore/sync routes', () => {
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
    db.exec('DROP TRIGGER IF EXISTS messages_fts_insert');
    db.exec('DROP TABLE IF EXISTS messages_fts');
    db.exec('DELETE FROM messages');
    db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM projects');
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content, session_id UNINDEXED, role UNINDEXED
      );
      CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content, session_id, role)
          VALUES (NEW.rowid, NEW.content, NEW.session_id, NEW.role);
      END;
    `);

    // Create a test project
    const now = Date.now();
    db.prepare(`
      INSERT INTO projects (id, name, type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('project-1', 'Test Project', 'code', now, now);

    // Reset activeRuns
    activeRuns.clear();
  });

  // ---------------------------------------------------------------------------
  // Archive endpoints
  // ---------------------------------------------------------------------------
  describe('POST /api/sessions/archive', () => {
    it('archives a single session', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Session 1', now, now);

      const res = await request(app)
        .post('/api/sessions/archive')
        .send({ sessionIds: ['s1'] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.archived).toBe(1);
    });

    it('archives multiple sessions', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Session 1', now, now);
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s2', 'project-1', 'Session 2', now, now);
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s3', 'project-1', 'Session 3', now, now);

      const res = await request(app)
        .post('/api/sessions/archive')
        .send({ sessionIds: ['s1', 's2', 's3'] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.archived).toBe(3);
    });

    it('returns 400 when sessionIds is empty', async () => {
      const res = await request(app)
        .post('/api/sessions/archive')
        .send({ sessionIds: [] });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when sessionIds is missing', async () => {
      const res = await request(app)
        .post('/api/sessions/archive')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('sets archived_at timestamp on archived sessions', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Session 1', now, now);

      await request(app)
        .post('/api/sessions/archive')
        .send({ sessionIds: ['s1'] });

      const row = db.prepare('SELECT archived_at FROM sessions WHERE id = ?').get('s1') as { archived_at: number | null };
      expect(row.archived_at).not.toBeNull();
      expect(row.archived_at).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Restore endpoints
  // ---------------------------------------------------------------------------
  describe('POST /api/sessions/restore', () => {
    it('restores a single archived session', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, archived_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Archived Session', now, now, now);

      const res = await request(app)
        .post('/api/sessions/restore')
        .send({ sessionIds: ['s1'] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.restored).toBe(1);
    });

    it('restores multiple archived sessions', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, archived_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Archived 1', now, now, now);
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, archived_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s2', 'project-1', 'Archived 2', now, now, now);

      const res = await request(app)
        .post('/api/sessions/restore')
        .send({ sessionIds: ['s1', 's2'] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.restored).toBe(2);
    });

    it('returns 400 when sessionIds is empty', async () => {
      const res = await request(app)
        .post('/api/sessions/restore')
        .send({ sessionIds: [] });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('clears archived_at after restore', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, archived_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Archived Session', now, now, now);

      // Verify archived_at is set before restore
      const before = db.prepare('SELECT archived_at FROM sessions WHERE id = ?').get('s1') as { archived_at: number | null };
      expect(before.archived_at).not.toBeNull();

      await request(app)
        .post('/api/sessions/restore')
        .send({ sessionIds: ['s1'] });

      const after = db.prepare('SELECT archived_at FROM sessions WHERE id = ?').get('s1') as { archived_at: number | null };
      expect(after.archived_at).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/sessions/archived
  // ---------------------------------------------------------------------------
  describe('GET /api/sessions/archived', () => {
    it('returns only archived sessions', async () => {
      const now = Date.now();
      // One archived, one not
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, archived_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s-archived', 'project-1', 'Archived', now, now, now);
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s-active', 'project-1', 'Active', now, now);

      const res = await request(app).get('/api/sessions/archived');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe('s-archived');
    });

    it('returns empty array when no archived sessions exist', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Active Session', now, now);

      const res = await request(app).get('/api/sessions/archived');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it('orders archived sessions by archived_at DESC', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, archived_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s-old', 'project-1', 'Archived First', now - 2000, now - 5000, now - 2000);
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, archived_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s-new', 'project-1', 'Archived Second', now, now - 3000, now);

      const res = await request(app).get('/api/sessions/archived');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      // Most recently archived should come first
      expect(res.body.data[0].id).toBe('s-new');
      expect(res.body.data[1].id).toBe('s-old');
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/sessions filtering (archived_at)
  // ---------------------------------------------------------------------------
  describe('GET /api/sessions (archived filtering)', () => {
    it('excludes archived sessions by default', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s-active', 'project-1', 'Active', now, now);
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, archived_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s-archived', 'project-1', 'Archived', now, now, now);

      const res = await request(app).get('/api/sessions');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe('s-active');
    });

    it('includes archived sessions when includeArchived=true', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s-active', 'project-1', 'Active', now, now);
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, archived_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s-archived', 'project-1', 'Archived', now, now, now);

      const res = await request(app).get('/api/sessions?includeArchived=true');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });

    it('filters by projectId and still excludes archived', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('project-2', 'Other Project', 'code', now, now);

      // project-1: one active, one archived
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1-active', 'project-1', 'P1 Active', now, now);
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, archived_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s1-archived', 'project-1', 'P1 Archived', now, now, now);

      // project-2: one active
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s2-active', 'project-2', 'P2 Active', now, now);

      const res = await request(app).get('/api/sessions?projectId=project-1');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe('s1-active');
      expect(res.body.data[0].projectId).toBe('project-1');
    });
  });

  // ---------------------------------------------------------------------------
  // Sync endpoint
  // ---------------------------------------------------------------------------
  describe('GET /api/sessions/sync', () => {
    it('returns sessions updated after the since timestamp', async () => {
      const base = Date.now() - 10000;
      // Old session (should NOT appear)
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s-old', 'project-1', 'Old Session', base, base);
      // Recent session (should appear)
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s-new', 'project-1', 'New Session', base + 5000, base + 5000);

      const res = await request(app).get(`/api/sessions/sync?since=${base + 1000}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.sessions).toHaveLength(1);
      expect(res.body.data.sessions[0].id).toBe('s-new');
      expect(res.body.data.timestamp).toBeDefined();
      expect(res.body.data.total).toBe(1);
    });

    it('excludes archived sessions from sync results', async () => {
      const base = Date.now() - 10000;
      // Non-archived recent session
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s-active', 'project-1', 'Active', base + 5000, base + 5000);
      // Archived recent session
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, archived_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s-archived', 'project-1', 'Archived', base + 5000, base + 5000, base + 5000);

      const res = await request(app).get(`/api/sessions/sync?since=${base}`);

      expect(res.status).toBe(200);
      expect(res.body.data.sessions).toHaveLength(1);
      expect(res.body.data.sessions[0].id).toBe('s-active');
    });

    it('includes isActive status from activeRuns', async () => {
      const base = Date.now() - 10000;
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s-running', 'project-1', 'Running Session', base + 5000, base + 5000);
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s-idle', 'project-1', 'Idle Session', base + 5000, base + 5000);

      // Mark one session as actively running (activeRuns is keyed by runId, not sessionId)
      activeRuns.set('run-1', { sessionId: 's-running' });

      const res = await request(app).get(`/api/sessions/sync?since=${base}`);

      expect(res.status).toBe(200);
      expect(res.body.data.sessions).toHaveLength(2);

      const running = res.body.data.sessions.find((s: any) => s.id === 's-running');
      const idle = res.body.data.sessions.find((s: any) => s.id === 's-idle');

      expect(running.isActive).toBe(true);
      expect(idle.isActive).toBe(false);
    });
  });
});
