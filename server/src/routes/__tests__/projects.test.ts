import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createProjectRoutes } from '../projects.js';

// Mock git-worktrees to avoid actual git operations
vi.mock('../../utils/git-worktrees.js', () => ({
  listGitWorktrees: vi.fn(() => []),
  createGitWorktree: vi.fn(() => ({ path: '/mock/worktree', branch: 'wt-branch', head: 'abc123' })),
}));

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
      system_prompt TEXT,
      permission_policy TEXT,
      agent_permission_override TEXT,
      agent TEXT,
      context_sync_status TEXT NOT NULL DEFAULT 'synced',
      review_provider_id TEXT,
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

function createTestApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  app.use('/api/projects', createProjectRoutes(db));
  return app;
}

describe('projects routes', () => {
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
    db.exec('DELETE FROM messages');
    db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM projects');
  });

  describe('POST /api/projects', () => {
    it('creates project with name only', async () => {
      const res = await request(app)
        .post('/api/projects')
        .send({ name: 'My Project' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('My Project');
      expect(res.body.data.type).toBe('code');
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.createdAt).toBeDefined();
      expect(res.body.data.updatedAt).toBeDefined();
    });

    it('creates project with all fields', async () => {
      const permissionPolicy = { defaultDecision: 'allow', rules: [] };
      const agentPermissionOverride = { defaultDecision: 'deny', rules: [{ tool: 'Read', decision: 'allow' }] };

      const res = await request(app)
        .post('/api/projects')
        .send({
          name: 'Full Project',
          type: 'chat_only',
          rootPath: '/home/user/project',
          systemPrompt: 'You are a helpful assistant.',
          permissionPolicy,
          agentPermissionOverride,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Full Project');
      expect(res.body.data.type).toBe('chat_only');
      expect(res.body.data.rootPath).toBe('/home/user/project');
      expect(res.body.data.systemPrompt).toBe('You are a helpful assistant.');
      expect(res.body.data.permissionPolicy).toEqual(permissionPolicy);
      expect(res.body.data.agentPermissionOverride).toEqual(agentPermissionOverride);
    });

    it('returns 400 when name is missing', async () => {
      const res = await request(app)
        .post('/api/projects')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Name is required');
    });

    it('stores project in database', async () => {
      const res = await request(app)
        .post('/api/projects')
        .send({ name: 'DB Check' });

      expect(res.status).toBe(201);

      const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(res.body.data.id) as any;
      expect(row).toBeDefined();
      expect(row.name).toBe('DB Check');
      expect(row.type).toBe('code');
    });

    it('defaults type to code when not specified', async () => {
      const res = await request(app)
        .post('/api/projects')
        .send({ name: 'Default Type' });

      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe('code');
    });

    it('stores permissionPolicy as JSON in database', async () => {
      const permissionPolicy = { defaultDecision: 'allow', rules: [] };

      const res = await request(app)
        .post('/api/projects')
        .send({ name: 'Policy Project', permissionPolicy });

      expect(res.status).toBe(201);

      const row = db.prepare('SELECT permission_policy FROM projects WHERE id = ?').get(res.body.data.id) as any;
      expect(JSON.parse(row.permission_policy)).toEqual(permissionPolicy);
    });
  });

  describe('GET /api/projects', () => {
    it('returns empty array when no projects exist', async () => {
      const res = await request(app).get('/api/projects');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it('returns all projects', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p1', 'Project 1', 'code', now, now);
      db.prepare(`
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p2', 'Project 2', 'chat_only', now + 1000, now + 1000);

      const res = await request(app).get('/api/projects');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
    });

    it('orders by updated_at DESC', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p1', 'Older', 'code', now, now);
      db.prepare(`
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p2', 'Newer', 'code', now, now + 1000);

      const res = await request(app).get('/api/projects');

      expect(res.status).toBe(200);
      expect(res.body.data[0].name).toBe('Newer');
      expect(res.body.data[1].name).toBe('Older');
    });

    it('includes is_internal projects in listing', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO projects (id, name, type, is_internal, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p1', 'Regular Project', 'code', 0, now, now);
      db.prepare(`
        INSERT INTO projects (id, name, type, is_internal, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p2', '_Agent Assistant', 'code', 1, now, now);

      const res = await request(app).get('/api/projects');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);

      const internalProject = res.body.data.find((p: any) => p.id === 'p2');
      expect(internalProject.isInternal).toBe(true);

      const regularProject = res.body.data.find((p: any) => p.id === 'p1');
      expect(regularProject.isInternal).toBe(false);
    });

    it('parses permissionPolicy and agentPermissionOverride as JSON', async () => {
      const now = Date.now();
      const policy = { defaultDecision: 'allow', rules: [] };
      const override = { defaultDecision: 'deny', rules: [{ tool: 'Bash', decision: 'allow' }] };
      db.prepare(`
        INSERT INTO projects (id, name, type, permission_policy, agent_permission_override, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('p1', 'Policy Project', 'code', JSON.stringify(policy), JSON.stringify(override), now, now);

      const res = await request(app).get('/api/projects');

      expect(res.status).toBe(200);
      expect(res.body.data[0].permissionPolicy).toEqual(policy);
      expect(res.body.data[0].agentPermissionOverride).toEqual(override);
    });

    it('returns undefined for null permissionPolicy and agentPermissionOverride', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p1', 'Simple Project', 'code', now, now);

      const res = await request(app).get('/api/projects');

      expect(res.status).toBe(200);
      expect(res.body.data[0].permissionPolicy).toBeUndefined();
      expect(res.body.data[0].agentPermissionOverride).toBeUndefined();
    });
  });

  describe('GET /api/projects/:id', () => {
    it('returns project by id', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO projects (id, name, type, root_path, system_prompt, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('p1', 'Test Project', 'code', '/home/user/project', 'Be helpful', now, now);

      const res = await request(app).get('/api/projects/p1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('p1');
      expect(res.body.data.name).toBe('Test Project');
      expect(res.body.data.type).toBe('code');
      expect(res.body.data.rootPath).toBe('/home/user/project');
      expect(res.body.data.systemPrompt).toBe('Be helpful');
      expect(res.body.data.isInternal).toBe(false);
    });

    it('returns 404 for non-existent project', async () => {
      const res = await request(app).get('/api/projects/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.message).toBe('Project not found');
    });

    it('parses JSON fields correctly', async () => {
      const now = Date.now();
      const policy = { defaultDecision: 'allow', rules: [] };
      const override = { defaultDecision: 'deny', rules: [] };
      db.prepare(`
        INSERT INTO projects (id, name, type, permission_policy, agent_permission_override, is_internal, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('p1', 'Full Project', 'code', JSON.stringify(policy), JSON.stringify(override), 1, now, now);

      const res = await request(app).get('/api/projects/p1');

      expect(res.status).toBe(200);
      expect(res.body.data.permissionPolicy).toEqual(policy);
      expect(res.body.data.agentPermissionOverride).toEqual(override);
      expect(res.body.data.isInternal).toBe(true);
    });
  });

  describe('PUT /api/projects/:id', () => {
    it('updates project name', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p1', 'Original', 'code', now, now);

      const res = await request(app)
        .put('/api/projects/p1')
        .send({ name: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify in database
      const row = db.prepare('SELECT name FROM projects WHERE id = ?').get('p1') as any;
      expect(row.name).toBe('Updated');
    });

    it('updates multiple fields', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p1', 'Original', 'code', now, now);

      const permissionPolicy = { defaultDecision: 'deny', rules: [] };
      const agentPermissionOverride = { defaultDecision: 'allow', rules: [] };

      const res = await request(app)
        .put('/api/projects/p1')
        .send({
          name: 'Updated',
          type: 'chat_only',
          rootPath: '/new/path',
          systemPrompt: 'Updated prompt',
          permissionPolicy,
          agentPermissionOverride,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify in database
      const row = db.prepare('SELECT * FROM projects WHERE id = ?').get('p1') as any;
      expect(row.name).toBe('Updated');
      expect(row.type).toBe('chat_only');
      expect(row.root_path).toBe('/new/path');
      expect(row.system_prompt).toBe('Updated prompt');
      expect(JSON.parse(row.permission_policy)).toEqual(permissionPolicy);
      expect(JSON.parse(row.agent_permission_override)).toEqual(agentPermissionOverride);
    });

    it('updates updated_at timestamp', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p1', 'Original', 'code', now, now);

      // Wait to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      await request(app)
        .put('/api/projects/p1')
        .send({ name: 'Updated' });

      const row = db.prepare('SELECT updated_at FROM projects WHERE id = ?').get('p1') as any;
      expect(row.updated_at).toBeGreaterThan(now);
    });

    it('returns 404 for non-existent project', async () => {
      const res = await request(app)
        .put('/api/projects/nonexistent')
        .send({ name: 'Updated' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.message).toBe('Project not found');
    });

    it('preserves name when not provided via COALESCE', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p1', 'Original Name', 'code', now, now);

      const res = await request(app)
        .put('/api/projects/p1')
        .send({ rootPath: '/some/path' });

      expect(res.status).toBe(200);

      const row = db.prepare('SELECT name FROM projects WHERE id = ?').get('p1') as any;
      expect(row.name).toBe('Original Name');
    });
  });

  describe('DELETE /api/projects/:id', () => {
    it('deletes existing project', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p1', 'To Delete', 'code', now, now);

      const res = await request(app).delete('/api/projects/p1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify deletion
      const row = db.prepare('SELECT * FROM projects WHERE id = ?').get('p1');
      expect(row).toBeUndefined();
    });

    it('returns 404 for non-existent project', async () => {
      const res = await request(app).delete('/api/projects/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.message).toBe('Project not found');
    });

    it('project is removed from database after deletion', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p1', 'Delete Me', 'code', now, now);

      // Confirm it exists before delete
      const before = db.prepare('SELECT id FROM projects WHERE id = ?').get('p1');
      expect(before).toBeDefined();

      await request(app).delete('/api/projects/p1');

      // Confirm it is gone
      const after = db.prepare('SELECT id FROM projects WHERE id = ?').get('p1');
      expect(after).toBeUndefined();
    });
  });

  describe('GET /api/projects/:id/worktrees', () => {
    it('returns worktrees for project with root path', async () => {
      const { listGitWorktrees } = await import('../../utils/git-worktrees.js');
      vi.mocked(listGitWorktrees).mockReturnValue([
        { path: '/repo/main', branch: 'main', head: 'abc123', isMain: true },
      ] as any);

      const now = Date.now();
      db.prepare(`
        INSERT INTO projects (id, name, type, root_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p1', 'Project', 'code', '/repo', now, now);

      const res = await request(app).get('/api/projects/p1/worktrees');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(listGitWorktrees).toHaveBeenCalledWith('/repo');
    });

    it('returns empty array for project without root path', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p1', 'No Root', 'code', now, now);

      const res = await request(app).get('/api/projects/p1/worktrees');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('returns 404 for non-existent project', async () => {
      const res = await request(app).get('/api/projects/nonexistent/worktrees');
      expect(res.status).toBe(404);
    });

    it('returns 500 when listGitWorktrees throws', async () => {
      const { listGitWorktrees } = await import('../../utils/git-worktrees.js');
      vi.mocked(listGitWorktrees).mockImplementation(() => { throw new Error('git error'); });

      const now = Date.now();
      db.prepare(`
        INSERT INTO projects (id, name, type, root_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p1', 'Project', 'code', '/repo', now, now);

      const res = await request(app).get('/api/projects/p1/worktrees');
      expect(res.status).toBe(500);

      vi.mocked(listGitWorktrees).mockReturnValue([]);
    });
  });

  describe('POST /api/projects/:id/worktrees', () => {
    it('creates worktree for project', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO projects (id, name, type, root_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p1', 'Project', 'code', '/repo', now, now);

      const res = await request(app)
        .post('/api/projects/p1/worktrees')
        .send({ branch: 'feature-branch' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });

    it('returns 404 for non-existent project', async () => {
      const res = await request(app)
        .post('/api/projects/nonexistent/worktrees')
        .send({ branch: 'test' });
      expect(res.status).toBe(404);
    });

    it('returns 400 for project without root path', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p1', 'No Root', 'code', now, now);

      const res = await request(app)
        .post('/api/projects/p1/worktrees')
        .send({ branch: 'test' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('auto-generates branch name when not provided', async () => {
      const { createGitWorktree } = await import('../../utils/git-worktrees.js');

      const now = Date.now();
      db.prepare(`
        INSERT INTO projects (id, name, type, root_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p1', 'Project', 'code', '/repo', now, now);

      const res = await request(app)
        .post('/api/projects/p1/worktrees')
        .send({});

      expect(res.status).toBe(200);
      // Branch should be auto-generated with wt- prefix
      expect(createGitWorktree).toHaveBeenCalledWith(
        '/repo',
        expect.stringContaining('.worktrees/wt-'),
        expect.stringContaining('wt-'),
      );
    });

    it('returns 500 when createGitWorktree throws', async () => {
      const { createGitWorktree } = await import('../../utils/git-worktrees.js');
      vi.mocked(createGitWorktree).mockImplementation(() => { throw new Error('git error'); });

      const now = Date.now();
      db.prepare(`
        INSERT INTO projects (id, name, type, root_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p1', 'Project', 'code', '/repo', now, now);

      const res = await request(app)
        .post('/api/projects/p1/worktrees')
        .send({ branch: 'test' });
      expect(res.status).toBe(500);

      vi.mocked(createGitWorktree).mockReturnValue({ path: '/mock', branch: 'b', head: 'h' } as any);
    });
  });

  describe('DELETE /api/projects/:id - error paths', () => {
    it('returns 500 when database error occurs during delete', async () => {
      // Insert a project first
      const now = Date.now();
      db.prepare(`
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p-del-err', 'Project To Delete', 'code', now, now);

      // Close the db to simulate error
      const originalPrepare = db.prepare.bind(db);
      let callCount = 0;
      const spy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        callCount++;
        if (callCount > 1) {
          throw Object.assign(new Error('SQLITE_ERROR'), { code: 'SQLITE_ERROR' });
        }
        return originalPrepare(sql);
      });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const res = await request(app).delete('/api/projects/p-del-err');
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('DB_ERROR');
      spy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe('PUT /api/projects/:id with reviewProviderId', () => {
    it('updates reviewProviderId', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('p1', 'Project', 'code', now, now);

      const res = await request(app)
        .put('/api/projects/p1')
        .send({ reviewProviderId: 'provider-1' });

      expect(res.status).toBe(200);
      const row = db.prepare('SELECT review_provider_id FROM projects WHERE id = ?').get('p1') as any;
      expect(row.review_provider_id).toBe('provider-1');
    });

    it('clears reviewProviderId when set to null', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO projects (id, name, type, review_provider_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('p1', 'Project', 'code', 'old-provider', now, now);

      const res = await request(app)
        .put('/api/projects/p1')
        .send({ reviewProviderId: null });

      expect(res.status).toBe(200);
      const row = db.prepare('SELECT review_provider_id FROM projects WHERE id = ?').get('p1') as any;
      expect(row.review_provider_id).toBeNull();
    });
  });
});
