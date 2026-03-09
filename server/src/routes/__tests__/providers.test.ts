import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createProviderRoutes } from '../providers.js';

// Mock command-scanner to avoid file system operations
vi.mock('../../utils/command-scanner.js', () => ({
  scanCustomCommands: vi.fn(() => []),
}));

// Create in-memory database for testing
function createTestDb(): Database.Database {
  const db = new Database(':memory:');

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
  `);

  return db;
}

function createTestApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  app.use('/api/providers', createProviderRoutes(db));
  return app;
}

describe('providers routes', () => {
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
    // Clear all providers before each test
    db.exec('DELETE FROM providers');
  });

  describe('GET /api/providers', () => {
    it('returns empty array when no providers exist', async () => {
      const res = await request(app).get('/api/providers');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it('returns all providers sorted by default first', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p1', 'Provider 1', 'claude', 0, now, now);
      db.prepare(`
        INSERT INTO providers (id, name, type, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p2', 'Default Provider', 'claude', 1, now, now);

      const res = await request(app).get('/api/providers');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      // Default provider should come first
      expect(res.body.data[0].name).toBe('Default Provider');
      expect(res.body.data[0].isDefault).toBe(true);
    });

    it('parses env JSON correctly', async () => {
      const now = Date.now();
      const env = { ANTHROPIC_API_KEY: 'test-key', HOME: '/custom/home' };
      db.prepare(`
        INSERT INTO providers (id, name, type, env, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p1', 'Provider', 'claude', JSON.stringify(env), now, now);

      const res = await request(app).get('/api/providers');

      expect(res.status).toBe(200);
      expect(res.body.data[0].env).toEqual(env);
    });
  });

  describe('GET /api/providers/:id', () => {
    it('returns provider by id', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, cli_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p1', 'My Provider', 'claude', '/path/to/claude', now, now);

      const res = await request(app).get('/api/providers/p1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('p1');
      expect(res.body.data.name).toBe('My Provider');
      expect(res.body.data.cliPath).toBe('/path/to/claude');
    });

    it('returns 404 for non-existent provider', async () => {
      const res = await request(app).get('/api/providers/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /api/providers', () => {
    it('creates provider with required fields', async () => {
      const res = await request(app)
        .post('/api/providers')
        .send({ name: 'New Provider' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('New Provider');
      expect(res.body.data.type).toBe('claude'); // default type
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.createdAt).toBeDefined();
    });

    it('returns 400 when name is missing', async () => {
      const res = await request(app)
        .post('/api/providers')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('stores env as JSON string', async () => {
      const env = { API_KEY: 'secret' };
      const res = await request(app)
        .post('/api/providers')
        .send({ name: 'Provider', env });

      expect(res.status).toBe(201);

      // Verify in database
      const row = db.prepare('SELECT env FROM providers WHERE id = ?').get(res.body.data.id) as { env: string };
      expect(JSON.parse(row.env)).toEqual(env);
    });

    it('unsets other defaults when creating with isDefault=true', async () => {
      // Create first default provider
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p1', 'First Default', 'claude', 1, now, now);

      // Create new default provider
      const res = await request(app)
        .post('/api/providers')
        .send({ name: 'New Default', isDefault: true });

      expect(res.status).toBe(201);
      expect(res.body.data.isDefault).toBe(true);

      // Check first provider is no longer default
      const first = db.prepare('SELECT is_default FROM providers WHERE id = ?').get('p1') as { is_default: number };
      expect(first.is_default).toBe(0);
    });

    it('accepts kimi as provider type', async () => {
      const res = await request(app)
        .post('/api/providers')
        .send({ name: 'Kimi Provider', type: 'kimi' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe('kimi');
    });
  });

  describe('PUT /api/providers/:id', () => {
    it('updates provider fields', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p1', 'Original', 'claude', now, now);

      const res = await request(app)
        .put('/api/providers/p1')
        .send({ name: 'Updated', cliPath: '/new/path' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify update
      const row = db.prepare('SELECT name, cli_path FROM providers WHERE id = ?').get('p1') as { name: string; cli_path: string };
      expect(row.name).toBe('Updated');
      expect(row.cli_path).toBe('/new/path');
    });

    it('returns 404 for non-existent provider', async () => {
      const res = await request(app)
        .put('/api/providers/nonexistent')
        .send({ name: 'Updated' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('unsets other defaults when updating to isDefault=true', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p1', 'First', 'claude', 1, now, now);
      db.prepare(`
        INSERT INTO providers (id, name, type, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p2', 'Second', 'claude', 0, now, now);

      const res = await request(app)
        .put('/api/providers/p2')
        .send({ isDefault: true });

      expect(res.status).toBe(200);

      // Check first provider is no longer default
      const first = db.prepare('SELECT is_default FROM providers WHERE id = ?').get('p1') as { is_default: number };
      expect(first.is_default).toBe(0);

      // Check second provider is now default
      const second = db.prepare('SELECT is_default FROM providers WHERE id = ?').get('p2') as { is_default: number };
      expect(second.is_default).toBe(1);
    });

    it('accepts updating provider type to kimi', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p3', 'Third', 'claude', now, now);

      const res = await request(app)
        .put('/api/providers/p3')
        .send({ type: 'kimi' });

      expect(res.status).toBe(200);
      const updated = db.prepare('SELECT type FROM providers WHERE id = ?').get('p3') as { type: string };
      expect(updated.type).toBe('kimi');
    });
  });

  describe('DELETE /api/providers/:id', () => {
    it('deletes provider', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p1', 'To Delete', 'claude', now, now);

      const res = await request(app).delete('/api/providers/p1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify deletion
      const row = db.prepare('SELECT * FROM providers WHERE id = ?').get('p1');
      expect(row).toBeUndefined();
    });

    it('returns 404 for non-existent provider', async () => {
      const res = await request(app).delete('/api/providers/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/providers/:id/commands', () => {
    it('returns commands for existing provider', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p1', 'Provider', 'claude', now, now);

      const res = await request(app).get('/api/providers/p1/commands');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns 404 for non-existent provider', async () => {
      const res = await request(app).get('/api/providers/nonexistent/commands');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/providers/type/:type/commands', () => {
    it('returns commands for provider type', async () => {
      const res = await request(app).get('/api/providers/type/claude/commands');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('POST /api/providers/:id/set-default', () => {
    it('sets provider as default', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p1', 'Provider', 'claude', 0, now, now);

      const res = await request(app).post('/api/providers/p1/set-default');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify it's now default
      const row = db.prepare('SELECT is_default FROM providers WHERE id = ?').get('p1') as { is_default: number };
      expect(row.is_default).toBe(1);
    });

    it('unsets other providers defaults', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p1', 'First', 'claude', 1, now, now);
      db.prepare(`
        INSERT INTO providers (id, name, type, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p2', 'Second', 'claude', 0, now, now);

      await request(app).post('/api/providers/p2/set-default');

      const first = db.prepare('SELECT is_default FROM providers WHERE id = ?').get('p1') as { is_default: number };
      expect(first.is_default).toBe(0);
    });

    it('returns 404 for non-existent provider', async () => {
      const res = await request(app).post('/api/providers/nonexistent/set-default');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });
});
