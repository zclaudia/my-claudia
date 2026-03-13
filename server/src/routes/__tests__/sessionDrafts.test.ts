import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createSessionDraftRoutes } from '../sessionDrafts.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');

  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT CHECK(type IN ('chat_only', 'code')) DEFAULT 'code',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS session_drafts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL DEFAULT '',
      editing_by TEXT,
      editing_at INTEGER,
      updated_at INTEGER NOT NULL,
      archived_at INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
  `);

  return db;
}

function createTestApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  app.use('/api/sessions', createSessionDraftRoutes(db));
  return app;
}

describe('sessionDrafts routes', () => {
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
    db.exec('DELETE FROM session_drafts');
    db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM projects');

    const now = Date.now();
    db.prepare(`
      INSERT INTO projects (id, name, type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('project-1', 'Test Project', 'code', now, now);

    db.prepare(`
      INSERT INTO sessions (id, project_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('session-1', 'project-1', 'Test Session', now, now);
  });

  it('acquires a draft lock for an existing session', async () => {
    const res = await request(app)
      .post('/api/sessions/session-1/draft/lock')
      .send({ deviceId: 'device-a' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.locked).toBe(true);
    expect(res.body.data.draft.sessionId).toBe('session-1');
    expect(res.body.data.draft.editingBy).toBe('device-a');
  });

  it('returns 404 instead of 500 when locking a non-existent session', async () => {
    const res = await request(app)
      .post('/api/sessions/missing-session/draft/lock')
      .send({ deviceId: 'device-a' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 when deviceId is missing, even if body is absent', async () => {
    const res = await request(app)
      .post('/api/sessions/session-1/draft/lock');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe('deviceId is required');
  });
});
