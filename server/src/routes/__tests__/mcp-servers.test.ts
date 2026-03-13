import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createMcpServerRoutes } from '../mcp-servers.js';

// Mock claude-config
vi.mock('../../utils/claude-config.js', () => ({
  loadMcpServers: vi.fn().mockReturnValue({
    'test-server': { command: 'node', args: ['server.js'], env: { PORT: '3000' } },
  }),
}));

describe('mcp-servers routes', () => {
  let app: express.Express;
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        command TEXT NOT NULL,
        args TEXT,
        env TEXT,
        enabled INTEGER DEFAULT 1,
        description TEXT,
        source TEXT DEFAULT 'user',
        provider_scope TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )
    `);

    app = express();
    app.use(express.json());
    app.use('/api/mcp-servers', createMcpServerRoutes(db));
  });

  afterEach(() => {
    db.close();
  });

  describe('GET /api/mcp-servers', () => {
    it('returns empty list initially', async () => {
      const res = await request(app).get('/api/mcp-servers');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it('returns created servers', async () => {
      db.prepare(`
        INSERT INTO mcp_servers (id, name, command, args, env, enabled, source, created_at, updated_at)
        VALUES ('s1', 'test', 'node', '["server.js"]', '{"PORT":"3000"}', 1, 'user', 1000, 1000)
      `).run();

      const res = await request(app).get('/api/mcp-servers');
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('test');
      expect(res.body.data[0].args).toEqual(['server.js']);
      expect(res.body.data[0].env).toEqual({ PORT: '3000' });
      expect(res.body.data[0].enabled).toBe(true);
    });
  });

  describe('POST /api/mcp-servers', () => {
    it('creates a new server', async () => {
      const res = await request(app)
        .post('/api/mcp-servers')
        .send({ name: 'my-server', command: 'python', args: ['run.py'] });
      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('my-server');
      expect(res.body.data.command).toBe('python');
      expect(res.body.data.enabled).toBe(true);
    });

    it('returns 400 without name', async () => {
      const res = await request(app)
        .post('/api/mcp-servers')
        .send({ command: 'node' });
      expect(res.status).toBe(400);
    });

    it('returns 400 without command', async () => {
      const res = await request(app)
        .post('/api/mcp-servers')
        .send({ name: 'test' });
      expect(res.status).toBe(400);
    });

    it('returns 409 for duplicate name', async () => {
      await request(app)
        .post('/api/mcp-servers')
        .send({ name: 'my-server', command: 'node' });
      const res = await request(app)
        .post('/api/mcp-servers')
        .send({ name: 'my-server', command: 'python' });
      expect(res.status).toBe(409);
    });

    it('creates with env and description', async () => {
      const res = await request(app)
        .post('/api/mcp-servers')
        .send({
          name: 'srv',
          command: 'node',
          env: { KEY: 'val' },
          description: 'Test server',
          providerScope: ['claude'],
        });
      expect(res.status).toBe(201);
      expect(res.body.data.env).toEqual({ KEY: 'val' });
      expect(res.body.data.description).toBe('Test server');
      expect(res.body.data.providerScope).toEqual(['claude']);
    });
  });

  describe('PUT /api/mcp-servers/:id', () => {
    it('updates an existing server', async () => {
      const create = await request(app)
        .post('/api/mcp-servers')
        .send({ name: 'srv', command: 'node' });
      const id = create.body.data.id;

      const res = await request(app)
        .put(`/api/mcp-servers/${id}`)
        .send({ name: 'updated-srv', command: 'python' });
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('updated-srv');
      expect(res.body.data.command).toBe('python');
    });

    it('returns 404 for non-existent server', async () => {
      const res = await request(app)
        .put('/api/mcp-servers/nonexistent')
        .send({ name: 'test' });
      expect(res.status).toBe(404);
    });

    it('returns 409 for duplicate name', async () => {
      await request(app).post('/api/mcp-servers').send({ name: 'srv1', command: 'node' });
      const create2 = await request(app).post('/api/mcp-servers').send({ name: 'srv2', command: 'node' });
      const id2 = create2.body.data.id;

      const res = await request(app)
        .put(`/api/mcp-servers/${id2}`)
        .send({ name: 'srv1' });
      expect(res.status).toBe(409);
    });
  });

  describe('DELETE /api/mcp-servers/:id', () => {
    it('deletes an existing server', async () => {
      const create = await request(app)
        .post('/api/mcp-servers')
        .send({ name: 'srv', command: 'node' });
      const id = create.body.data.id;

      const res = await request(app).delete(`/api/mcp-servers/${id}`);
      expect(res.status).toBe(200);

      // Verify deleted
      const list = await request(app).get('/api/mcp-servers');
      expect(list.body.data).toHaveLength(0);
    });

    it('returns 404 for non-existent server', async () => {
      const res = await request(app).delete('/api/mcp-servers/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/mcp-servers/:id/toggle', () => {
    it('toggles enabled state', async () => {
      const create = await request(app)
        .post('/api/mcp-servers')
        .send({ name: 'srv', command: 'node' });
      const id = create.body.data.id;
      expect(create.body.data.enabled).toBe(true);

      const res = await request(app).post(`/api/mcp-servers/${id}/toggle`);
      expect(res.status).toBe(200);
      expect(res.body.data.enabled).toBe(false);

      const res2 = await request(app).post(`/api/mcp-servers/${id}/toggle`);
      expect(res2.body.data.enabled).toBe(true);
    });

    it('returns 404 for non-existent server', async () => {
      const res = await request(app).post('/api/mcp-servers/nonexistent/toggle');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/mcp-servers/import', () => {
    it('imports servers from config', async () => {
      const res = await request(app).post('/api/mcp-servers/import');
      expect(res.status).toBe(200);
      expect(res.body.data.imported).toHaveLength(1);
      expect(res.body.data.imported[0].name).toBe('test-server');
      expect(res.body.data.skipped).toEqual([]);
    });

    it('skips already existing servers', async () => {
      // First import
      await request(app).post('/api/mcp-servers/import');
      // Second import
      const res = await request(app).post('/api/mcp-servers/import');
      expect(res.body.data.imported).toHaveLength(0);
      expect(res.body.data.skipped).toEqual(['test-server']);
    });
  });

  describe('error handling - catch blocks', () => {
    it('GET /api/mcp-servers returns 500 on database error', async () => {
      const spy = vi.spyOn(db, 'prepare').mockImplementation(() => {
        throw new Error('DB error');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const res = await request(app).get('/api/mcp-servers');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DB_ERROR');
      expect(res.body.error.message).toBe('Failed to list MCP servers');
      spy.mockRestore();
      errorSpy.mockRestore();
    });

    it('POST /api/mcp-servers returns 500 on database error during insert', async () => {
      let callCount = 0;
      const spy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        callCount++;
        // Let the SELECT for uniqueness check pass, then throw on INSERT
        if (callCount === 1) {
          return { get: vi.fn().mockReturnValue(undefined) } as any;
        }
        throw new Error('DB error');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const res = await request(app)
        .post('/api/mcp-servers')
        .send({ name: 'fail-server', command: 'node' });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DB_ERROR');
      spy.mockRestore();
      errorSpy.mockRestore();
    });

    it('PUT /api/mcp-servers/:id returns 500 on database error', async () => {
      // First create a server normally
      const create = await request(app)
        .post('/api/mcp-servers')
        .send({ name: 'srv-err', command: 'node' });
      const id = create.body.data.id;

      // Now mock to throw
      const spy = vi.spyOn(db, 'prepare').mockImplementation(() => {
        throw new Error('DB error');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const res = await request(app)
        .put(`/api/mcp-servers/${id}`)
        .send({ name: 'updated' });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DB_ERROR');
      spy.mockRestore();
      errorSpy.mockRestore();
    });

    it('DELETE /api/mcp-servers/:id returns 500 on database error', async () => {
      const spy = vi.spyOn(db, 'prepare').mockImplementation(() => {
        throw new Error('DB error');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const res = await request(app).delete('/api/mcp-servers/some-id');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DB_ERROR');
      spy.mockRestore();
      errorSpy.mockRestore();
    });

    it('POST /api/mcp-servers/:id/toggle returns 500 on database error', async () => {
      const spy = vi.spyOn(db, 'prepare').mockImplementation(() => {
        throw new Error('DB error');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const res = await request(app).post('/api/mcp-servers/some-id/toggle');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DB_ERROR');
      spy.mockRestore();
      errorSpy.mockRestore();
    });

    it('POST /api/mcp-servers/import returns 500 on error', async () => {
      const { loadMcpServers } = await import('../../utils/claude-config.js');
      (loadMcpServers as any).mockImplementation(() => {
        throw new Error('Config error');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const res = await request(app).post('/api/mcp-servers/import');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('IMPORT_ERROR');

      // Reset mock
      (loadMcpServers as any).mockReturnValue({
        'test-server': { command: 'node', args: ['server.js'], env: { PORT: '3000' } },
      });
      errorSpy.mockRestore();
    });
  });

  describe('POST /api/mcp-servers - disabled creation', () => {
    it('creates a server with enabled=false', async () => {
      const res = await request(app)
        .post('/api/mcp-servers')
        .send({ name: 'disabled-srv', command: 'node', enabled: false });
      expect(res.status).toBe(201);
      expect(res.body.data.enabled).toBe(false);
    });
  });
});
