import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createServerRoutes } from '../servers.js';

// Create in-memory database for testing
function createTestDb(): Database.Database {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      connection_mode TEXT CHECK(connection_mode IN ('direct', 'gateway')) DEFAULT 'direct',

      -- Gateway mode fields
      gateway_url TEXT,
      gateway_secret TEXT,
      backend_id TEXT,

      -- Common fields
      api_key TEXT,
      client_id TEXT,
      is_default INTEGER DEFAULT 0,
      requires_auth INTEGER DEFAULT 0,

      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_connected INTEGER
    );
  `);

  return db;
}

function createTestApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  app.use('/api/servers', createServerRoutes(db));
  return app;
}

describe('servers routes', () => {
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
    db.exec('DELETE FROM servers');
  });

  describe('POST /api/servers', () => {
    it('creates a server with name and address', async () => {
      const res = await request(app)
        .post('/api/servers')
        .send({ name: 'My Server', address: 'http://localhost:3000' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('My Server');
      expect(res.body.data.address).toBe('http://localhost:3000');
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.id).toMatch(/^server_/);
    });

    it('creates a server with optional fields', async () => {
      const res = await request(app)
        .post('/api/servers')
        .send({
          name: 'Default Server',
          address: 'http://localhost:4000',
          clientId: 'client-abc',
          isDefault: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Default Server');
      expect(res.body.data.clientId).toBe('client-abc');
      expect(res.body.data.isDefault).toBe(true);
    });

    it('returns 400 when name is missing', async () => {
      const res = await request(app)
        .post('/api/servers')
        .send({ address: 'http://localhost:3000' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Name and address are required');
    });

    it('returns 400 when address is missing', async () => {
      const res = await request(app)
        .post('/api/servers')
        .send({ name: 'My Server' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Name and address are required');
    });

    it('returns 400 when both name and address are missing', async () => {
      const res = await request(app)
        .post('/api/servers')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('unsets other defaults when creating a server with isDefault true', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO servers (id, name, address, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('existing-1', 'Existing Server', 'http://existing:3000', 1, now, now);

      const res = await request(app)
        .post('/api/servers')
        .send({ name: 'New Default', address: 'http://new:3000', isDefault: true });

      expect(res.status).toBe(201);

      // Verify the old server is no longer default
      const oldServer = db.prepare('SELECT is_default FROM servers WHERE id = ?').get('existing-1') as { is_default: number };
      expect(oldServer.is_default).toBe(0);
    });
  });

  describe('GET /api/servers', () => {
    it('returns empty array when no servers exist', async () => {
      const res = await request(app).get('/api/servers');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it('returns all servers', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO servers (id, name, address, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s1', 'Server 1', 'http://server1:3000', 0, now, now);
      db.prepare(`
        INSERT INTO servers (id, name, address, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s2', 'Server 2', 'http://server2:3000', 0, now + 1000, now + 1000);

      const res = await request(app).get('/api/servers');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
    });

    it('returns servers with boolean isDefault and requiresAuth', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO servers (id, name, address, is_default, requires_auth, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('s1', 'Server 1', 'http://server1:3000', 1, 0, now, now);

      const res = await request(app).get('/api/servers');

      expect(res.status).toBe(200);
      expect(res.body.data[0].isDefault).toBe(true);
      expect(res.body.data[0].requiresAuth).toBe(false);
    });

    it('orders by is_default DESC then updated_at DESC', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO servers (id, name, address, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s1', 'Non-default Older', 'http://s1:3000', 0, now, now);
      db.prepare(`
        INSERT INTO servers (id, name, address, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s2', 'Non-default Newer', 'http://s2:3000', 0, now, now + 2000);
      db.prepare(`
        INSERT INTO servers (id, name, address, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s3', 'Default Server', 'http://s3:3000', 1, now, now + 1000);

      const res = await request(app).get('/api/servers');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      // Default server should come first
      expect(res.body.data[0].name).toBe('Default Server');
      // Then non-default servers ordered by updated_at DESC
      expect(res.body.data[1].name).toBe('Non-default Newer');
      expect(res.body.data[2].name).toBe('Non-default Older');
    });
  });

  describe('GET /api/servers/:id', () => {
    it('returns server by id', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO servers (id, name, address, connection_mode, client_id, is_default, requires_auth, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('s1', 'Test Server', 'http://test:3000', 'direct', 'client-123', 1, 0, now, now);

      const res = await request(app).get('/api/servers/s1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('s1');
      expect(res.body.data.name).toBe('Test Server');
      expect(res.body.data.address).toBe('http://test:3000');
      expect(res.body.data.connectionMode).toBe('direct');
      expect(res.body.data.clientId).toBe('client-123');
      expect(res.body.data.isDefault).toBe(true);
      expect(res.body.data.requiresAuth).toBe(false);
      expect(res.body.data.createdAt).toBe(now);
      expect(res.body.data.updatedAt).toBe(now);
    });

    it('returns 404 for non-existent server', async () => {
      const res = await request(app).get('/api/servers/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.message).toBe('Server not found');
    });
  });

  describe('PUT /api/servers/:id', () => {
    beforeEach(() => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO servers (id, name, address, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s1', 'Original Server', 'http://original:3000', 0, now, now);
    });

    it('updates server name', async () => {
      const res = await request(app)
        .put('/api/servers/s1')
        .send({ name: 'Updated Server' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify in database
      const row = db.prepare('SELECT name FROM servers WHERE id = ?').get('s1') as { name: string };
      expect(row.name).toBe('Updated Server');
    });

    it('updates server address', async () => {
      const res = await request(app)
        .put('/api/servers/s1')
        .send({ address: 'http://updated:4000' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const row = db.prepare('SELECT address FROM servers WHERE id = ?').get('s1') as { address: string };
      expect(row.address).toBe('http://updated:4000');
    });

    it('updates isDefault', async () => {
      const res = await request(app)
        .put('/api/servers/s1')
        .send({ isDefault: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const row = db.prepare('SELECT is_default FROM servers WHERE id = ?').get('s1') as { is_default: number };
      expect(row.is_default).toBe(1);
    });

    it('unsets other defaults when setting isDefault to true', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO servers (id, name, address, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s2', 'Other Server', 'http://other:3000', 1, now, now);

      await request(app)
        .put('/api/servers/s1')
        .send({ isDefault: true });

      const otherRow = db.prepare('SELECT is_default FROM servers WHERE id = ?').get('s2') as { is_default: number };
      expect(otherRow.is_default).toBe(0);

      const updatedRow = db.prepare('SELECT is_default FROM servers WHERE id = ?').get('s1') as { is_default: number };
      expect(updatedRow.is_default).toBe(1);
    });

    it('updates lastConnected', async () => {
      const lastConnected = Date.now() + 5000;
      const res = await request(app)
        .put('/api/servers/s1')
        .send({ lastConnected });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const row = db.prepare('SELECT last_connected FROM servers WHERE id = ?').get('s1') as { last_connected: number };
      expect(row.last_connected).toBe(lastConnected);
    });

    it('updates updated_at timestamp', async () => {
      const beforeUpdate = db.prepare('SELECT updated_at FROM servers WHERE id = ?').get('s1') as { updated_at: number };

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      await request(app)
        .put('/api/servers/s1')
        .send({ name: 'Updated' });

      const afterUpdate = db.prepare('SELECT updated_at FROM servers WHERE id = ?').get('s1') as { updated_at: number };
      expect(afterUpdate.updated_at).toBeGreaterThan(beforeUpdate.updated_at);
    });

    it('returns 404 for non-existent server', async () => {
      const res = await request(app)
        .put('/api/servers/nonexistent')
        .send({ name: 'Updated' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.message).toBe('Server not found');
    });
  });

  describe('DELETE /api/servers/:id', () => {
    it('deletes a non-local server', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO servers (id, name, address, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s1', 'To Delete', 'http://delete:3000', 0, now, now);

      const res = await request(app).delete('/api/servers/s1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify deletion
      const row = db.prepare('SELECT * FROM servers WHERE id = ?').get('s1');
      expect(row).toBeUndefined();
    });

    it('blocks deletion of the local server', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO servers (id, name, address, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('local', 'Local Backend', 'http://localhost:3001', 1, now, now);

      const res = await request(app).delete('/api/servers/local');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Cannot delete the default local server');

      // Verify the server still exists
      const row = db.prepare('SELECT * FROM servers WHERE id = ?').get('local');
      expect(row).toBeDefined();
    });

    it('returns 404 for non-existent server', async () => {
      const res = await request(app).delete('/api/servers/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.message).toBe('Server not found');
    });
  });
});
