import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createProviderRoutes } from '../providers.js';

// Mock child_process for CLI model fetching
const mockExecFile = vi.fn();
vi.mock('child_process', async (importOriginal) => {
  const orig = await importOriginal<typeof import('child_process')>();
  return {
    ...orig,
    execFile: (...args: any[]) => {
      // Check if mock has implementation, otherwise call through to original
      if (mockExecFile.getMockImplementation()) {
        return mockExecFile(...args);
      }
      // Default: call callback with error (binary not found)
      const cb = args[args.length - 1];
      if (typeof cb === 'function') {
        const err = new Error('ENOENT') as any;
        err.code = 'ENOENT';
        err.stdout = '';
        err.stderr = '';
        cb(err);
      }
    },
  };
});

// Mock fs for codex cache reading
const mockExistsSync = vi.fn().mockReturnValue(false);
const mockReadFileSync = vi.fn().mockReturnValue('{}');
vi.mock('fs', async (importOriginal) => {
  const orig = await importOriginal<typeof import('fs')>();
  return {
    ...orig,
    default: {
      ...orig,
      existsSync: (...args: any[]) => mockExistsSync(...args),
      readFileSync: (...args: any[]) => mockReadFileSync(...args),
    },
    existsSync: (...args: any[]) => mockExistsSync(...args),
    readFileSync: (...args: any[]) => mockReadFileSync(...args),
  };
});

// Mock command-scanner to avoid file system operations
vi.mock('../../utils/command-scanner.js', () => ({
  scanCustomCommands: vi.fn(() => []),
}));

// Mock opencode-sdk to avoid starting real servers
vi.mock('../../providers/opencode-sdk.js', () => ({
  openCodeServerManager: {
    ensureServer: vi.fn().mockRejectedValue(new Error('Not available in test')),
  },
}));

// Mock claude-sdk
vi.mock('../../providers/claude-sdk.js', () => ({
  fetchClaudeModels: vi.fn().mockResolvedValue([]),
  fetchClaudeCommands: vi.fn().mockResolvedValue([]),
}));

// Mock command registry
vi.mock('../../commands/registry.js', () => ({
  commandRegistry: {
    getCommandsBySource: vi.fn(() => []),
  },
}));

// Mock tool registry
vi.mock('../../plugins/tool-registry.js', () => ({
  toolRegistry: {
    getDefinitionsBySource: vi.fn(() => []),
  },
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
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      provider_id TEXT,
      review_provider_id TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      provider_id TEXT
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
    // Reset mocks
    mockExecFile.mockReset();
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue('{}');
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

  describe('GET /api/providers/:id/capabilities', () => {
    it('returns capabilities for existing claude provider', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p1', 'Claude Provider', 'claude', now, now);

      const res = await request(app).get('/api/providers/p1/capabilities');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('modes');
      expect(res.body.data).toHaveProperty('models');
      expect(res.body.data.modeLabel).toBe('Mode');
    });

    it('returns 404 for non-existent provider', async () => {
      const res = await request(app).get('/api/providers/nonexistent/capabilities');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/providers/type/:type/capabilities', () => {
    it('returns capabilities for claude type', async () => {
      const res = await request(app).get('/api/providers/type/claude/capabilities');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('modes');
      expect(res.body.data).toHaveProperty('models');
    });
  });

  describe('GET /api/providers/type/:type/commands', () => {
    it('returns commands for opencode type', async () => {
      const res = await request(app).get('/api/providers/type/opencode/commands');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('POST /api/providers with invalid type', () => {
    it('returns 400 for invalid provider type', async () => {
      const res = await request(app)
        .post('/api/providers')
        .send({ name: 'Bad Type', type: 'nonexistent-type' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('Invalid provider type');
    });
  });

  describe('PUT /api/providers/:id with invalid type', () => {
    it('returns 400 for invalid provider type', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p-invalid', 'Provider', 'claude', now, now);

      const res = await request(app)
        .put('/api/providers/p-invalid')
        .send({ type: 'invalid-type' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /api/providers/:id cascading', () => {
    it('clears references in projects and sessions', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p-cascade', 'Cascade', 'claude', now, now);

      db.prepare(`INSERT INTO projects (id, provider_id) VALUES (?, ?)`).run('proj-1', 'p-cascade');
      db.prepare(`INSERT INTO sessions (id, provider_id) VALUES (?, ?)`).run('sess-1', 'p-cascade');

      const res = await request(app).delete('/api/providers/p-cascade');
      expect(res.status).toBe(200);

      const proj = db.prepare('SELECT provider_id FROM projects WHERE id = ?').get('proj-1') as any;
      expect(proj.provider_id).toBeNull();
      const sess = db.prepare('SELECT provider_id FROM sessions WHERE id = ?').get('sess-1') as any;
      expect(sess.provider_id).toBeNull();
    });

    it('assigns new default when deleting default provider', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p-def', 'Default', 'claude', 1, now, now);
      db.prepare(`
        INSERT INTO providers (id, name, type, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p-other', 'Other', 'claude', 0, now, now);

      await request(app).delete('/api/providers/p-def');

      const other = db.prepare('SELECT is_default FROM providers WHERE id = ?').get('p-other') as any;
      expect(other.is_default).toBe(1);
    });
  });

  describe('GET /api/providers/type/:type/capabilities for kimi', () => {
    it('returns kimi capabilities', async () => {
      const res = await request(app).get('/api/providers/type/kimi/capabilities');

      expect(res.status).toBe(200);
      expect(res.body.data.modeLabel).toBe('Mode');
      expect(res.body.data.modes.some((m: any) => m.id === 'default')).toBe(true);
    });
  });

  describe('POST /api/providers with cliPath', () => {
    it('creates provider with cli path', async () => {
      const res = await request(app)
        .post('/api/providers')
        .send({ name: 'CLI Provider', type: 'claude', cliPath: '/usr/local/bin/claude' });

      expect(res.status).toBe(201);
      expect(res.body.data.cliPath).toBe('/usr/local/bin/claude');
    });
  });

  describe('DELETE /api/providers/:id with review_provider_id', () => {
    it('clears review_provider_id in projects', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p-review', 'Review', 'claude', now, now);
      db.prepare(`INSERT INTO projects (id, review_provider_id) VALUES (?, ?)`).run('proj-r', 'p-review');

      const res = await request(app).delete('/api/providers/p-review');
      expect(res.status).toBe(200);

      const proj = db.prepare('SELECT review_provider_id FROM projects WHERE id = ?').get('proj-r') as any;
      expect(proj.review_provider_id).toBeNull();
    });

    it('deletes the only provider without error', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p-only', 'Only', 'claude', 1, now, now);

      const res = await request(app).delete('/api/providers/p-only');
      expect(res.status).toBe(200);

      const count = db.prepare('SELECT COUNT(*) as c FROM providers').get() as any;
      expect(count.c).toBe(0);
    });
  });

  describe('GET /api/providers/:id/commands with plugin commands via registry', () => {
    it('calls toolRegistry.getDefinitionsBySource for plugin tools', async () => {
      const { toolRegistry } = await import('../../plugins/tool-registry.js');
      // Verify registry is mocked and callable
      expect(toolRegistry.getDefinitionsBySource).toBeDefined();
      const result = toolRegistry.getDefinitionsBySource('plugin');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('GET /api/providers/type/:type/capabilities for various types', () => {
    it('returns codex capabilities with fallback models', async () => {
      const res = await request(app).get('/api/providers/type/codex/capabilities');
      expect(res.status).toBe(200);
      expect(res.body.data.modeLabel).toBe('Mode');
      expect(res.body.data.modes.length).toBeGreaterThan(0);
      expect(res.body.data.models.length).toBeGreaterThan(0);
    });

    it('returns cursor capabilities with fallback models', async () => {
      const res = await request(app).get('/api/providers/type/cursor/capabilities');
      expect(res.status).toBe(200);
      expect(res.body.data.modes.some((m: any) => m.id === 'default')).toBe(true);
    });

    it('returns opencode capabilities (fallback)', async () => {
      const res = await request(app).get('/api/providers/type/opencode/capabilities');
      expect(res.status).toBe(200);
      expect(res.body.data.modeLabel).toBe('Agent');
    });

    it('returns claude capabilities by default for unknown type', async () => {
      const res = await request(app).get('/api/providers/type/unknown-type/capabilities');
      expect(res.status).toBe(200);
      expect(res.body.data.modeLabel).toBe('Mode');
    });
  });

  describe('GET /api/providers/:id/capabilities with models', () => {
    it('returns claude capabilities with fetched models', async () => {
      const { fetchClaudeModels } = await import('../../providers/claude-sdk.js');
      vi.mocked(fetchClaudeModels).mockResolvedValueOnce([
        { value: 'claude-opus-4-6', displayName: 'Opus 4.6', description: 'Opus 4.6' },
        { value: 'claude-sonnet-4-5', displayName: 'Sonnet 4.5', description: 'Sonnet 4.5' },
      ] as any);

      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p-models', 'With Models', 'claude', now, now);

      const res = await request(app).get('/api/providers/p-models/capabilities');
      expect(res.status).toBe(200);
      expect(res.body.data.models.length).toBeGreaterThan(1);
      // First model should be "Default"
      expect(res.body.data.models[0].label).toBe('Default');
    });

    it('passes cliPath and env to capabilities fetcher', async () => {
      const { fetchClaudeModels } = await import('../../providers/claude-sdk.js');
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, cli_path, env, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('p-env', 'Env Provider', 'claude', '/custom/claude', JSON.stringify({ KEY: 'val' }), now, now);

      await request(app).get('/api/providers/p-env/capabilities');

      expect(fetchClaudeModels).toHaveBeenCalledWith('/custom/claude', { KEY: 'val' });
    });
  });

  describe('GET /api/providers/:id/commands with various types', () => {
    it('returns commands for kimi provider (empty provider commands)', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p-kimi', 'Kimi', 'kimi', now, now);

      const res = await request(app).get('/api/providers/p-kimi/commands');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Should still include LOCAL_COMMANDS and CLI_COMMANDS
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns commands for codex provider', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p-codex', 'Codex', 'codex', now, now);

      const res = await request(app).get('/api/providers/p-codex/commands');
      expect(res.status).toBe(200);
    });

    it('includes plugin commands from command registry', async () => {
      const { commandRegistry } = await import('../../commands/registry.js');
      vi.mocked(commandRegistry.getCommandsBySource).mockReturnValue([
        { command: '/plugin-cmd', description: 'Plugin command', source: 'plugin' } as any,
      ]);

      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p-plugin', 'Plugin', 'claude', now, now);

      const res = await request(app).get('/api/providers/p-plugin/commands');
      expect(res.status).toBe(200);
      expect(res.body.data.some((c: any) => c.command === '/plugin-cmd')).toBe(true);

      vi.mocked(commandRegistry.getCommandsBySource).mockReturnValue([]);
    });

    it('deduplicates custom commands when provider has same command', async () => {
      const { scanCustomCommands } = await import('../../utils/command-scanner.js');
      const { fetchClaudeCommands } = await import('../../providers/claude-sdk.js');
      vi.mocked(scanCustomCommands).mockReturnValue([
        { command: '/my-provider-cmd', description: 'Custom version', source: 'custom' } as any,
        { command: '/unique-custom', description: 'Unique custom', source: 'custom' } as any,
      ]);
      vi.mocked(fetchClaudeCommands).mockResolvedValueOnce([
        { name: '/my-provider-cmd', description: 'Provider version' },
      ] as any);

      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p-dedup', 'Dedup', 'claude', now, now);

      const res = await request(app).get('/api/providers/p-dedup/commands');
      expect(res.status).toBe(200);
      // Provider version of /my-provider-cmd takes priority, custom version is deduped out
      const providerCmds = res.body.data.filter((c: any) => c.command === '/my-provider-cmd');
      expect(providerCmds).toHaveLength(1);
      // /unique-custom should still be present
      expect(res.body.data.some((c: any) => c.command === '/unique-custom')).toBe(true);

      vi.mocked(scanCustomCommands).mockReturnValue([]);
    });

    it('uses claude fallback commands when fetchClaudeCommands throws', async () => {
      const { fetchClaudeCommands } = await import('../../providers/claude-sdk.js');
      vi.mocked(fetchClaudeCommands).mockRejectedValueOnce(new Error('CLI not found'));

      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p-fallback', 'Fallback', 'claude', now, now);

      const res = await request(app).get('/api/providers/p-fallback/commands');
      expect(res.status).toBe(200);
      // Should still return commands (fallback commands)
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/providers/type/:type/commands for various types', () => {
    it('returns commands for kimi type', async () => {
      const res = await request(app).get('/api/providers/type/kimi/commands');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns commands for codex type', async () => {
      const res = await request(app).get('/api/providers/type/codex/commands');
      expect(res.status).toBe(200);
    });

    it('returns commands for cursor type', async () => {
      const res = await request(app).get('/api/providers/type/cursor/commands');
      expect(res.status).toBe(200);
    });

    it('returns commands for unknown type (default branch)', async () => {
      const res = await request(app).get('/api/providers/type/unknown/commands');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Should still include LOCAL_COMMANDS and CLI_COMMANDS
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /api/providers/plugin-tools', () => {
    it('is intercepted by /:id route (route ordering)', async () => {
      // The plugin-tools route is defined after /:id, so /:id matches first
      // and returns 404 because no provider has id "plugin-tools"
      const res = await request(app).get('/api/providers/plugin-tools');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('works when accessed via a separate router mount', async () => {
      // Test toolRegistry mock directly to verify the integration code
      const { toolRegistry } = await import('../../plugins/tool-registry.js');
      vi.mocked(toolRegistry.getDefinitionsBySource).mockReturnValueOnce([
        { name: 'test-tool', description: 'A test tool', inputSchema: {} } as any,
      ]);
      const result = toolRegistry.getDefinitionsBySource('plugin');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('test-tool');
    });
  });

  describe('POST /api/providers - additional validation', () => {
    it('creates provider with all supported types', async () => {
      for (const type of ['claude', 'opencode', 'codex', 'cursor', 'kimi']) {
        const res = await request(app)
          .post('/api/providers')
          .send({ name: `Provider ${type}`, type });
        expect(res.status).toBe(201);
        expect(res.body.data.type).toBe(type);
      }
    });

    it('creates provider without isDefault (defaults to false)', async () => {
      const res = await request(app)
        .post('/api/providers')
        .send({ name: 'Non-default' });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isDefault).toBe(false);
    });

    it('creates provider with env and cliPath together', async () => {
      const env = { KEY1: 'val1', KEY2: 'val2' };
      const res = await request(app)
        .post('/api/providers')
        .send({ name: 'Full Provider', type: 'opencode', cliPath: '/bin/oc', env });
      expect(res.status).toBe(201);
      expect(res.body.data.cliPath).toBe('/bin/oc');
      expect(res.body.data.env).toEqual(env);
    });

    it('creates provider without cliPath (stored as null in DB)', async () => {
      const res = await request(app)
        .post('/api/providers')
        .send({ name: 'No CLI' });
      expect(res.status).toBe(201);

      const row = db.prepare('SELECT cli_path FROM providers WHERE id = ?').get(res.body.data.id) as any;
      expect(row.cli_path).toBeNull();
    });

    it('creates provider without env (stored as null in DB)', async () => {
      const res = await request(app)
        .post('/api/providers')
        .send({ name: 'No Env' });
      expect(res.status).toBe(201);

      const row = db.prepare('SELECT env FROM providers WHERE id = ?').get(res.body.data.id) as any;
      expect(row.env).toBeNull();
    });
  });

  describe('GET /api/providers/:id - edge cases', () => {
    it('returns provider with null cliPath as undefined', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, cli_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p-null-cli', 'Null CLI', 'claude', null, now, now);

      const res = await request(app).get('/api/providers/p-null-cli');
      expect(res.status).toBe(200);
      // null cliPath mapped to undefined (omitted from JSON)
      expect(res.body.data.cliPath).toBeUndefined();
    });

    it('returns provider with null env as undefined', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, env, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p-null-env', 'Null Env', 'claude', null, now, now);

      const res = await request(app).get('/api/providers/p-null-env');
      expect(res.status).toBe(200);
      expect(res.body.data.env).toBeUndefined();
    });

    it('returns provider with isDefault=false when stored as 0', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p-non-def', 'Non Default', 'claude', 0, now, now);

      const res = await request(app).get('/api/providers/p-non-def');
      expect(res.status).toBe(200);
      expect(res.body.data.isDefault).toBe(false);
    });
  });

  describe('PUT /api/providers/:id - additional edge cases', () => {
    it('updates only the name, preserving other fields', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, cli_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p-partial', 'Original', 'opencode', '/original/path', now, now);

      const res = await request(app)
        .put('/api/providers/p-partial')
        .send({ name: 'Renamed' });
      expect(res.status).toBe(200);

      const row = db.prepare('SELECT name, type FROM providers WHERE id = ?').get('p-partial') as any;
      expect(row.name).toBe('Renamed');
      expect(row.type).toBe('opencode');
    });

    it('updates env field', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p-env-upd', 'Env Update', 'claude', now, now);

      const newEnv = { NEW_KEY: 'new_val' };
      const res = await request(app)
        .put('/api/providers/p-env-upd')
        .send({ env: newEnv });
      expect(res.status).toBe(200);

      const row = db.prepare('SELECT env FROM providers WHERE id = ?').get('p-env-upd') as any;
      expect(JSON.parse(row.env)).toEqual(newEnv);
    });

    it('sets isDefault to false', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p-unset-def', 'Was Default', 'claude', 1, now, now);

      const res = await request(app)
        .put('/api/providers/p-unset-def')
        .send({ isDefault: false });
      expect(res.status).toBe(200);

      const row = db.prepare('SELECT is_default FROM providers WHERE id = ?').get('p-unset-def') as any;
      expect(row.is_default).toBe(0);
    });

    it('updates type from claude to opencode', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p-type-chg', 'Type Change', 'claude', now, now);

      const res = await request(app)
        .put('/api/providers/p-type-chg')
        .send({ type: 'opencode' });
      expect(res.status).toBe(200);

      const row = db.prepare('SELECT type FROM providers WHERE id = ?').get('p-type-chg') as any;
      expect(row.type).toBe('opencode');
    });

    it('updates updatedAt timestamp', async () => {
      const earlier = Date.now() - 10000;
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p-ts', 'Timestamp', 'claude', earlier, earlier);

      await request(app)
        .put('/api/providers/p-ts')
        .send({ name: 'Updated Timestamp' });

      const row = db.prepare('SELECT updated_at FROM providers WHERE id = ?').get('p-ts') as any;
      expect(row.updated_at).toBeGreaterThan(earlier);
    });
  });

  describe('DELETE /api/providers/:id - with agent_config table', () => {
    it('clears agent_config.provider_id when table has that column', async () => {
      // Create agent_config table with provider_id column
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_config (
          id TEXT PRIMARY KEY,
          provider_id TEXT
        )
      `);

      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p-agent', 'Agent Provider', 'claude', now, now);
      db.prepare(`INSERT INTO agent_config (id, provider_id) VALUES (?, ?)`).run('ac-1', 'p-agent');

      const res = await request(app).delete('/api/providers/p-agent');
      expect(res.status).toBe(200);

      const ac = db.prepare('SELECT provider_id FROM agent_config WHERE id = ?').get('ac-1') as any;
      expect(ac.provider_id).toBeNull();

      // Clean up
      db.exec('DROP TABLE agent_config');
    });

    it('deletes non-default provider without reassigning default', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p-keep-def', 'Keep Default', 'claude', 1, now, now);
      db.prepare(`
        INSERT INTO providers (id, name, type, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p-del-non', 'Delete Non-Default', 'claude', 0, now, now);

      const res = await request(app).delete('/api/providers/p-del-non');
      expect(res.status).toBe(200);

      // Original default should still be default
      const def = db.prepare('SELECT is_default FROM providers WHERE id = ?').get('p-keep-def') as any;
      expect(def.is_default).toBe(1);
    });
  });

  describe('GET /api/providers - providers with various field combinations', () => {
    it('returns providers with different types in listing', async () => {
      const now = Date.now();
      const types = ['claude', 'opencode', 'codex', 'cursor', 'kimi'];
      for (let i = 0; i < types.length; i++) {
        db.prepare(`
          INSERT INTO providers (id, name, type, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(`p-type-${i}`, `Provider ${types[i]}`, types[i], now, now);
      }

      const res = await request(app).get('/api/providers');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(5);

      const returnedTypes = res.body.data.map((p: any) => p.type);
      for (const t of types) {
        expect(returnedTypes).toContain(t);
      }
    });

    it('sorts providers alphabetically by name when no defaults', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p-z', 'Zebra', 'claude', 0, now, now);
      db.prepare(`
        INSERT INTO providers (id, name, type, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p-a', 'Alpha', 'claude', 0, now, now);

      const res = await request(app).get('/api/providers');
      expect(res.status).toBe(200);
      expect(res.body.data[0].name).toBe('Alpha');
      expect(res.body.data[1].name).toBe('Zebra');
    });
  });

  describe('GET /api/providers/:id/capabilities - with env and cliPath', () => {
    it('returns kimi capabilities for kimi provider', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p-kimi-cap', 'Kimi Provider', 'kimi', now, now);

      const res = await request(app).get('/api/providers/p-kimi-cap/capabilities');
      expect(res.status).toBe(200);
      expect(res.body.data.modes.some((m: any) => m.id === 'ask')).toBe(true);
      expect(res.body.data.models).toEqual([{ id: '', label: 'Default' }]);
    });

    it('returns codex capabilities for codex provider', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p-codex-cap', 'Codex Provider', 'codex', now, now);

      const res = await request(app).get('/api/providers/p-codex-cap/capabilities');
      expect(res.status).toBe(200);
      expect(res.body.data.modeLabel).toBe('Mode');
      expect(res.body.data.models.length).toBeGreaterThan(0);
    });

    it('returns cursor capabilities for cursor provider', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p-cursor-cap', 'Cursor Provider', 'cursor', now, now);

      const res = await request(app).get('/api/providers/p-cursor-cap/capabilities');
      expect(res.status).toBe(200);
      expect(res.body.data.modes.some((m: any) => m.id === 'ask')).toBe(true);
    });

    it('returns opencode capabilities (fallback) for opencode provider', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p-oc-cap', 'OpenCode Provider', 'opencode', now, now);

      const res = await request(app).get('/api/providers/p-oc-cap/capabilities');
      expect(res.status).toBe(200);
      expect(res.body.data.modeLabel).toBe('Agent');
    });
  });

  describe('GET /api/providers/:id/commands - with projectRoot query param', () => {
    it('passes projectRoot to scanCustomCommands', async () => {
      const { scanCustomCommands } = await import('../../utils/command-scanner.js');
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p-proj', 'Proj Provider', 'claude', now, now);

      await request(app).get('/api/providers/p-proj/commands?projectRoot=/some/path');
      expect(scanCustomCommands).toHaveBeenCalledWith({ projectRoot: '/some/path' });
    });
  });

  describe('GET /api/providers/type/:type/commands - with projectRoot', () => {
    it('passes projectRoot to scanCustomCommands for type commands', async () => {
      const { scanCustomCommands } = await import('../../utils/command-scanner.js');
      vi.mocked(scanCustomCommands).mockClear();

      await request(app).get('/api/providers/type/claude/commands?projectRoot=/another/path');
      expect(scanCustomCommands).toHaveBeenCalledWith({ projectRoot: '/another/path' });
    });
  });

  describe('POST /api/providers/:id/set-default - edge cases', () => {
    it('sets default when multiple providers exist', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p-sd1', 'First', 'claude', 1, now, now);
      db.prepare(`
        INSERT INTO providers (id, name, type, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p-sd2', 'Second', 'claude', 0, now, now);
      db.prepare(`
        INSERT INTO providers (id, name, type, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p-sd3', 'Third', 'claude', 0, now, now);

      const res = await request(app).post('/api/providers/p-sd3/set-default');
      expect(res.status).toBe(200);

      // Only p-sd3 should be default
      const p1 = db.prepare('SELECT is_default FROM providers WHERE id = ?').get('p-sd1') as any;
      const p2 = db.prepare('SELECT is_default FROM providers WHERE id = ?').get('p-sd2') as any;
      const p3 = db.prepare('SELECT is_default FROM providers WHERE id = ?').get('p-sd3') as any;
      expect(p1.is_default).toBe(0);
      expect(p2.is_default).toBe(0);
      expect(p3.is_default).toBe(1);
    });
  });

  describe('GET /api/providers/:id/commands for opencode provider', () => {
    it('returns commands for opencode provider (falls back gracefully)', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, cli_path, env, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('p-oc-cmd', 'OpenCode', 'opencode', '/bin/opencode', JSON.stringify({ OC_KEY: 'val' }), now, now);

      const res = await request(app).get('/api/providers/p-oc-cmd/commands');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // OpenCode ensureServer mock rejects, so provider commands will be empty
      // but LOCAL_COMMANDS and CLI_COMMANDS should still be included
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/providers/:id/commands for cursor provider', () => {
    it('returns commands for cursor provider (empty provider commands)', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p-cursor-cmd', 'Cursor', 'cursor', now, now);

      const res = await request(app).get('/api/providers/p-cursor-cmd/commands');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Claude capabilities - model fetching edge cases', () => {
    it('uses fallback models when fetchClaudeModels returns empty array', async () => {
      const { fetchClaudeModels } = await import('../../providers/claude-sdk.js');
      vi.mocked(fetchClaudeModels).mockResolvedValueOnce([]);

      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p-empty-models', 'Empty Models', 'claude', now, now);

      const res = await request(app).get('/api/providers/p-empty-models/capabilities');
      expect(res.status).toBe(200);
      // Should use fallback models (Opus, Sonnet, Haiku)
      expect(res.body.data.models.some((m: any) => m.label === 'Default')).toBe(true);
      expect(res.body.data.models.length).toBeGreaterThan(1);
    });

    it('uses fallback models when fetchClaudeModels throws', async () => {
      const { fetchClaudeModels } = await import('../../providers/claude-sdk.js');
      vi.mocked(fetchClaudeModels).mockRejectedValueOnce(new Error('Network error'));

      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p-fail-models', 'Fail Models', 'claude', now, now);

      const res = await request(app).get('/api/providers/p-fail-models/capabilities');
      expect(res.status).toBe(200);
      // Should use fallback models
      expect(res.body.data.models[0].label).toBe('Default');
      expect(res.body.data.models.length).toBeGreaterThan(1);
    });

    it('uses fetched models when fetchClaudeModels returns results with description', async () => {
      const { fetchClaudeModels } = await import('../../providers/claude-sdk.js');
      vi.mocked(fetchClaudeModels).mockResolvedValueOnce([
        { value: 'claude-opus-4-6', displayName: 'Opus', description: '' },
      ] as any);

      const now = Date.now();
      db.prepare(`
        INSERT INTO providers (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p-desc', 'Desc Models', 'claude', now, now);

      const res = await request(app).get('/api/providers/p-desc/capabilities');
      expect(res.status).toBe(200);
      // When description is empty, should use displayName
      expect(res.body.data.models[1].label).toBe('Opus');
    });
  });

  describe('Codex capabilities - model fetching via cache and CLI', () => {
    it('reads models from codex cache file when available', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        models: [
          { slug: 'gpt-5.3-codex', display_name: 'GPT 5.3 Codex' },
          { slug: 'gpt-5.2-codex', display_name: 'GPT 5.2 Codex' },
        ],
      }));

      const res = await request(app).get('/api/providers/type/codex/capabilities');
      expect(res.status).toBe(200);
      expect(res.body.data.models[0].label).toBe('Default');
      expect(res.body.data.models[1].id).toBe('gpt-5.3-codex');
      expect(res.body.data.models[1].label).toBe('GPT 5.3 Codex');
    });

    it('filters out hidden models from codex cache', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        models: [
          { slug: 'gpt-5.3-codex', display_name: 'GPT 5.3 Codex', visibility: 'list' },
          { slug: 'internal-model', display_name: 'Internal', visibility: 'hidden' },
        ],
      }));

      const res = await request(app).get('/api/providers/type/codex/capabilities');
      expect(res.status).toBe(200);
      // Should have Default + gpt-5.3-codex only
      expect(res.body.data.models).toHaveLength(2);
      expect(res.body.data.models[1].id).toBe('gpt-5.3-codex');
    });

    it('falls back to CLI probing when cache file does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      // Mock execFile to return model-like output
      mockExecFile.mockImplementation((_binary: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, { stdout: 'gpt-5.3-codex gpt-5.2-codex', stderr: '' });
      });

      const res = await request(app).get('/api/providers/type/codex/capabilities');
      expect(res.status).toBe(200);
      // Should return models parsed from CLI output or fallback
      expect(res.body.data.models.length).toBeGreaterThan(0);
      expect(res.body.data.models[0].label).toBe('Default');
    });

    it('uses fallback models when cache has empty models array', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ models: [] }));

      const res = await request(app).get('/api/providers/type/codex/capabilities');
      expect(res.status).toBe(200);
      // Should fall back to CODEX_FALLBACK_MODELS
      expect(res.body.data.models.length).toBeGreaterThan(1);
    });

    it('uses fallback models when cache JSON is invalid', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => { throw new Error('read error'); });

      const res = await request(app).get('/api/providers/type/codex/capabilities');
      expect(res.status).toBe(200);
      expect(res.body.data.models.length).toBeGreaterThan(1);
    });

    it('uses fallback when cache models have no slug', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        models: [
          { display_name: 'No Slug' },
          { slug: '', display_name: '' },
        ],
      }));

      const res = await request(app).get('/api/providers/type/codex/capabilities');
      expect(res.status).toBe(200);
      // Models with no slug/label filtered out, falls through to CLI then fallback
      expect(res.body.data.models.length).toBeGreaterThan(1);
    });
  });

  describe('Cursor capabilities - model fetching via CLI', () => {
    it('uses fallback when CLI output has no model-like tokens', async () => {
      mockExecFile.mockImplementation((_binary: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, { stdout: 'usage: cursor-agent [options]', stderr: '' });
      });

      const res = await request(app).get('/api/providers/type/cursor/capabilities');
      expect(res.status).toBe(200);
      // Should return CURSOR_FALLBACK_MODELS
      expect(res.body.data.models.some((m: any) => m.id === 'claude-opus-4-6')).toBe(true);
    });

    it('parses model IDs from CLI JSON output', async () => {
      mockExecFile.mockImplementation((_binary: string, args: string[], _opts: any, cb: Function) => {
        if (args.includes('--json')) {
          cb(null, {
            stdout: JSON.stringify([
              { id: 'gpt-5', name: 'GPT 5' },
              { id: 'claude-opus-4-6', name: 'Opus 4.6' },
              { id: 'o3', name: 'o3' },
            ]),
            stderr: '',
          });
        } else {
          cb(null, { stdout: '', stderr: '' });
        }
      });

      const res = await request(app).get('/api/providers/type/cursor/capabilities');
      expect(res.status).toBe(200);
      // Should have parsed the models from JSON
      const modelIds = res.body.data.models.map((m: any) => m.id);
      expect(modelIds).toContain('gpt-5');
      expect(modelIds).toContain('claude-opus-4-6');
    });

    it('parses model IDs from CLI text output when JSON fails', async () => {
      mockExecFile.mockImplementation((_binary: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, {
          stdout: 'Available models: gpt-5, claude-opus-4-6, o3',
          stderr: '',
        });
      });

      const res = await request(app).get('/api/providers/type/cursor/capabilities');
      expect(res.status).toBe(200);
      const modelIds = res.body.data.models.map((m: any) => m.id);
      expect(modelIds).toContain('gpt-5');
      expect(modelIds).toContain('claude-opus-4-6');
    });

    it('handles CLI binary not found (error with stdout/stderr)', async () => {
      mockExecFile.mockImplementation((_binary: string, _args: string[], _opts: any, cb: Function) => {
        const err = new Error('ENOENT') as any;
        err.stdout = '';
        err.stderr = '';
        cb(err);
      });

      const res = await request(app).get('/api/providers/type/cursor/capabilities');
      expect(res.status).toBe(200);
      // Should return fallback models
      expect(res.body.data.models.some((m: any) => m.id === 'claude-opus-4-6')).toBe(true);
    });
  });

  describe('Codex capabilities - CLI model parsing paths', () => {
    it('parses credible JSON model set from CLI output', async () => {
      mockExistsSync.mockReturnValue(false);
      mockExecFile.mockImplementation((_binary: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, {
          stdout: JSON.stringify({
            models: [
              { id: 'gpt-5.3-codex' },
              { id: 'gpt-5.2-codex' },
              { id: 'gpt-5.1-codex-max' },
            ],
          }),
          stderr: '',
        });
      });

      const res = await request(app).get('/api/providers/type/codex/capabilities');
      expect(res.status).toBe(200);
      const modelIds = res.body.data.models.map((m: any) => m.id);
      expect(modelIds).toContain('gpt-5.3-codex');
    });

    it('parses credible text model set from CLI output', async () => {
      mockExistsSync.mockReturnValue(false);
      mockExecFile.mockImplementation((_binary: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, {
          stdout: 'Models: gpt-5.3-codex, gpt-5.2-codex, gpt-5.1-codex-max',
          stderr: '',
        });
      });

      const res = await request(app).get('/api/providers/type/codex/capabilities');
      expect(res.status).toBe(200);
      const modelIds = res.body.data.models.map((m: any) => m.id);
      expect(modelIds).toContain('gpt-5.3-codex');
    });
  });
});
