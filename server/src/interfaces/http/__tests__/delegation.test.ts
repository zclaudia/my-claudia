import { beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createDelegationRoutes } from '../delegation.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS delegation_config (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      config_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
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
  `);
  return db;
}

function createTestApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  app.use('/api/delegation', createDelegationRoutes(db));
  return app;
}

describe('delegation routes', () => {
  const db = createTestDb();
  const app = createTestApp(db);

  beforeEach(() => {
    db.exec('DELETE FROM delegation_config');
    db.exec('DELETE FROM providers');
  });

  it('rejects analysisProviderId when the provider does not support cli-jobs', async () => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO providers (id, name, type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('p-legacy', 'Legacy Provider', 'unknown-type', now, now);

    const res = await request(app)
      .put('/api/delegation/config')
      .send({ analysisProviderId: 'p-legacy' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('does not support cli-jobs');
  });
});
