import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createSessionRoutes } from '../sessions.js';

vi.mock('../../gateway-instance.js', () => ({
  getGatewayClient: vi.fn(() => null),
}));

vi.mock('../../events/index.js', () => ({
  pluginEvents: { emit: vi.fn().mockReturnValue(Promise.resolve()) },
}));

vi.mock('../../storage/metadata-extractor.js', () => ({
  extractAndIndexMetadata: vi.fn(),
}));

let activeRuns: Map<string, any>;

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
      last_run_status TEXT,
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

    CREATE TABLE IF NOT EXISTS search_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default',
      query TEXT NOT NULL,
      result_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);

  return db;
}

function createTestApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  activeRuns = new Map<string, any>();
  app.use('/api/sessions', createSessionRoutes(db, activeRuns));
  return app;
}

describe('sessions routes', () => {
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
    // Drop FTS trigger to avoid conflicts during cleanup, then recreate
    db.exec('DROP TRIGGER IF EXISTS messages_fts_insert');
    db.exec('DROP TABLE IF EXISTS messages_fts');
    db.exec('DELETE FROM messages');
    db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM projects');
    db.exec('DELETE FROM search_history');
    activeRuns.clear();
    // Recreate FTS table and trigger
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
  });

  describe('GET /api/sessions', () => {
    it('returns empty array when no sessions exist', async () => {
      const res = await request(app).get('/api/sessions');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it('returns all sessions', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Session 1', now, now);
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s2', 'project-1', 'Session 2', now + 1000, now + 1000);

      const res = await request(app).get('/api/sessions');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });

    it('filters by projectId when provided', async () => {
      const now = Date.now();
      // Create another project
      db.prepare(`
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('project-2', 'Another Project', 'code', now, now);

      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Session 1', now, now);
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s2', 'project-2', 'Session 2', now, now);

      const res = await request(app).get('/api/sessions?projectId=project-1');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].projectId).toBe('project-1');
    });

    it('orders by updated_at DESC', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Older', now, now);
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s2', 'project-1', 'Newer', now, now + 1000);

      const res = await request(app).get('/api/sessions');

      expect(res.status).toBe(200);
      expect(res.body.data[0].name).toBe('Newer');
    });
  });

  describe('GET /api/sessions/:id', () => {
    it('returns session by id', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, sdk_session_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Test Session', 'sdk-123', now, now);

      const res = await request(app).get('/api/sessions/s1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('s1');
      expect(res.body.data.name).toBe('Test Session');
      expect(res.body.data.sdkSessionId).toBe('sdk-123');
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app).get('/api/sessions/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /api/sessions', () => {
    it('creates session with projectId', async () => {
      const res = await request(app)
        .post('/api/sessions')
        .send({ projectId: 'project-1', name: 'New Session' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.projectId).toBe('project-1');
      expect(res.body.data.name).toBe('New Session');
      expect(res.body.data.id).toBeDefined();
    });

    it('returns 400 when projectId missing', async () => {
      const res = await request(app)
        .post('/api/sessions')
        .send({ name: 'New Session' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when project does not exist', async () => {
      const res = await request(app)
        .post('/api/sessions')
        .send({ projectId: 'nonexistent' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('Project not found');
    });
  });

  describe('PUT /api/sessions/:id', () => {
    it('updates session fields', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Original', now, now);

      const res = await request(app)
        .put('/api/sessions/s1')
        .send({ name: 'Updated', sdkSessionId: 'sdk-456' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify update
      const row = db.prepare('SELECT name, sdk_session_id FROM sessions WHERE id = ?').get('s1') as { name: string; sdk_session_id: string };
      expect(row.name).toBe('Updated');
      expect(row.sdk_session_id).toBe('sdk-456');
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app)
        .put('/api/sessions/nonexistent')
        .send({ name: 'Updated' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('DELETE /api/sessions/:id', () => {
    it('deletes session', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'To Delete', now, now);

      const res = await request(app).delete('/api/sessions/s1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify deletion
      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get('s1');
      expect(row).toBeUndefined();
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app).delete('/api/sessions/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/sessions/:id/messages', () => {
    beforeEach(() => {
      const now = Date.now();
      // Create a session for message tests
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Test Session', now, now);
    });

    it('returns messages with pagination info', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('m1', 's1', 'user', 'Hello', now);

      const res = await request(app).get('/api/sessions/s1/messages');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messages).toHaveLength(1);
      expect(res.body.data.pagination).toBeDefined();
      expect(res.body.data.pagination.total).toBe(1);
    });

    it('limits results to specified limit', async () => {
      const now = Date.now();
      for (let i = 0; i < 10; i++) {
        db.prepare(`
          INSERT INTO messages (id, session_id, role, content, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(`m${i}`, 's1', 'user', `Message ${i}`, now + i);
      }

      const res = await request(app).get('/api/sessions/s1/messages?limit=5');

      expect(res.status).toBe(200);
      expect(res.body.data.messages).toHaveLength(5);
      expect(res.body.data.pagination.hasMore).toBe(true);
    });

    it('returns messages in chronological order', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('m1', 's1', 'user', 'First', now);
      db.prepare(`
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('m2', 's1', 'assistant', 'Second', now + 1000);
      db.prepare(`
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('m3', 's1', 'user', 'Third', now + 2000);

      const res = await request(app).get('/api/sessions/s1/messages');

      expect(res.status).toBe(200);
      expect(res.body.data.messages[0].content).toBe('First');
      expect(res.body.data.messages[1].content).toBe('Second');
      expect(res.body.data.messages[2].content).toBe('Third');
    });

    it('paginates with before cursor', async () => {
      const now = Date.now();
      for (let i = 0; i < 10; i++) {
        db.prepare(`
          INSERT INTO messages (id, session_id, role, content, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(`m${i}`, 's1', 'user', `Message ${i}`, now + i * 1000);
      }

      // Get messages before timestamp of message 5
      const beforeTimestamp = now + 5000;
      const res = await request(app).get(`/api/sessions/s1/messages?before=${beforeTimestamp}&limit=3`);

      expect(res.status).toBe(200);
      expect(res.body.data.messages).toHaveLength(3);
      // Should get messages 2, 3, 4 (the 3 most recent before message 5)
      expect(res.body.data.messages[0].content).toBe('Message 2');
    });

    it('calculates hasMore correctly', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('m1', 's1', 'user', 'Only one', now);

      const res = await request(app).get('/api/sessions/s1/messages?limit=50');

      expect(res.status).toBe(200);
      expect(res.body.data.pagination.hasMore).toBe(false);
    });

    it('returns a window around a target message', async () => {
      const now = Date.now();
      for (let i = 0; i < 10; i++) {
        db.prepare(`
          INSERT INTO messages (id, session_id, role, content, created_at, offset)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(`m${i}`, 's1', 'user', `Message ${i}`, now + i * 1000, i + 1);
      }

      const res = await request(app).get('/api/sessions/s1/messages?aroundMessageId=m5&limit=5');

      expect(res.status).toBe(200);
      expect(res.body.data.messages).toHaveLength(5);
      expect(res.body.data.messages.map((m: any) => m.id)).toEqual(['m3', 'm4', 'm5', 'm6', 'm7']);
    });

    it('returns activeRun when foreground run is still running', async () => {
      activeRuns.set('run-1', { sessionId: 's1', completed: false, sessionType: 'regular' });

      const res = await request(app).get('/api/sessions/s1/messages');

      expect(res.status).toBe(200);
      expect(res.body.data.activeRun).toEqual({ runId: 'run-1' });
    });

    it('does not return activeRun for completed or background runs', async () => {
      activeRuns.set('run-completed', { sessionId: 's1', completed: true, sessionType: 'regular' });
      activeRuns.set('run-bg', { sessionId: 's1', completed: false, sessionType: 'background' });

      const res = await request(app).get('/api/sessions/s1/messages');

      expect(res.status).toBe(200);
      expect(res.body.data.activeRun).toBeNull();
    });
  });

  describe('POST /api/sessions/:id/messages', () => {
    beforeEach(() => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Test Session', now, now);
    });

    it('creates message', async () => {
      const res = await request(app)
        .post('/api/sessions/s1/messages')
        .send({ role: 'user', content: 'Hello!' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.role).toBe('user');
      expect(res.body.data.content).toBe('Hello!');
      expect(res.body.data.sessionId).toBe('s1');
    });

    it('updates session updated_at', async () => {
      const beforeUpdate = db.prepare('SELECT updated_at FROM sessions WHERE id = ?').get('s1') as { updated_at: number };

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      await request(app)
        .post('/api/sessions/s1/messages')
        .send({ role: 'user', content: 'Hello!' });

      const afterUpdate = db.prepare('SELECT updated_at FROM sessions WHERE id = ?').get('s1') as { updated_at: number };
      expect(afterUpdate.updated_at).toBeGreaterThan(beforeUpdate.updated_at);
    });

    it('returns 400 when role or content missing', async () => {
      const res1 = await request(app)
        .post('/api/sessions/s1/messages')
        .send({ content: 'Hello!' });
      expect(res1.status).toBe(400);

      const res2 = await request(app)
        .post('/api/sessions/s1/messages')
        .send({ role: 'user' });
      expect(res2.status).toBe(400);
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app)
        .post('/api/sessions/nonexistent/messages')
        .send({ role: 'user', content: 'Hello!' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('stores metadata as JSON', async () => {
      const metadata = { tokenCount: 100, model: 'claude' };
      const res = await request(app)
        .post('/api/sessions/s1/messages')
        .send({ role: 'user', content: 'Hello!', metadata });

      expect(res.status).toBe(201);

      // Verify in database
      const row = db.prepare('SELECT metadata FROM messages WHERE id = ?').get(res.body.data.id) as { metadata: string };
      expect(JSON.parse(row.metadata)).toEqual(metadata);
    });
  });

  describe('GET /api/sessions/:id/export', () => {
    beforeEach(() => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Export Test Session', now, now);
    });

    it('returns markdown with session name and messages', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('m1', 's1', 'user', 'Hello Claude', now);
      db.prepare(`
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('m2', 's1', 'assistant', 'Hello! How can I help?', now + 1000);

      const res = await request(app).get('/api/sessions/s1/export');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.sessionName).toBe('Export Test Session');
      expect(res.body.data.markdown).toContain('# Export Test Session');
      expect(res.body.data.markdown).toContain('## User');
      expect(res.body.data.markdown).toContain('Hello Claude');
      expect(res.body.data.markdown).toContain('## Assistant');
      expect(res.body.data.markdown).toContain('Hello! How can I help?');
    });

    it('includes tool calls summary from metadata', async () => {
      const now = Date.now();
      const metadata = {
        toolCalls: [
          { name: 'Read', input: { file_path: '/foo.ts' }, output: 'contents', isError: false },
          { name: 'Bash', input: { command: 'ls' }, output: 'error', isError: true },
        ],
      };
      db.prepare(`
        INSERT INTO messages (id, session_id, role, content, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('m1', 's1', 'assistant', 'Done', JSON.stringify(metadata), now);

      const res = await request(app).get('/api/sessions/s1/export');

      expect(res.status).toBe(200);
      expect(res.body.data.markdown).toContain('**Tool Calls:**');
      expect(res.body.data.markdown).toContain('**Read**');
      expect(res.body.data.markdown).toContain('ok');
      expect(res.body.data.markdown).toContain('**Bash**');
      expect(res.body.data.markdown).toContain('error');
    });

    it('includes token usage from metadata', async () => {
      const now = Date.now();
      const metadata = {
        usage: { inputTokens: 1500, outputTokens: 800 },
      };
      db.prepare(`
        INSERT INTO messages (id, session_id, role, content, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('m1', 's1', 'assistant', 'Response', JSON.stringify(metadata), now);

      const res = await request(app).get('/api/sessions/s1/export');

      expect(res.status).toBe(200);
      expect(res.body.data.markdown).toContain('Tokens:');
      expect(res.body.data.markdown).toContain('1,500');
      expect(res.body.data.markdown).toContain('800');
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app).get('/api/sessions/nonexistent/export');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('uses "Untitled Session" for session without name', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s2', 'project-1', null, now, now);

      const res = await request(app).get('/api/sessions/s2/export');

      expect(res.status).toBe(200);
      expect(res.body.data.markdown).toContain('# Untitled Session');
    });
  });

  describe('GET /api/sessions/search/messages', () => {
    beforeEach(() => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Session 1', now, now);

      // Insert messages that will be indexed by FTS trigger
      db.prepare(`
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('m1', 's1', 'user', 'How to implement authentication?', now);
      db.prepare(`
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('m2', 's1', 'assistant', 'You can use JWT tokens for authentication.', now + 1000);
      db.prepare(`
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('m3', 's1', 'user', 'Tell me about database migrations.', now + 2000);
    });

    it('returns matching messages for search query', async () => {
      const res = await request(app).get('/api/sessions/search/messages?q=authentication');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.results.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.results.some((r: { content: string }) => r.content.includes('authentication'))).toBe(true);
    });

    it('returns empty results for empty query', async () => {
      const res = await request(app).get('/api/sessions/search/messages?q=');

      expect(res.status).toBe(200);
      expect(res.body.data.results).toEqual([]);
    });

    it('filters by projectId', async () => {
      const now = Date.now();
      // Create another project with a session and message
      db.prepare(`
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('project-2', 'Other Project', 'code', now, now);
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s2', 'project-2', 'Session 2', now, now);
      db.prepare(`
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('m4', 's2', 'user', 'Authentication in project 2', now);

      const res = await request(app).get('/api/sessions/search/messages?q=authentication&projectId=project-1');

      expect(res.status).toBe(200);
      // All results should be from project-1
      for (const result of res.body.data.results) {
        expect(result.sessionId).toBe('s1');
      }
    });

    it('truncates content to 200 characters', async () => {
      const now = Date.now();
      const longContent = 'authentication '.repeat(50); // > 200 chars
      db.prepare(`
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('m-long', 's1', 'user', longContent, now + 5000);

      const res = await request(app).get('/api/sessions/search/messages?q=authentication');

      expect(res.status).toBe(200);
      const longResult = res.body.data.results.find((r: { id: string }) => r.id === 'm-long');
      if (longResult) {
        expect(longResult.content.length).toBeLessThanOrEqual(203); // 200 + "..."
        expect(longResult.content.endsWith('...')).toBe(true);
      }
    });

    it('sanitizes think blocks and whitespace in search preview', async () => {
      const now = Date.now();
      const contentWithThink = `<think>

internal reasoning cursor plan

</think>


  cursor-adapter configured successfully   `;
      db.prepare(`
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('m-think', 's1', 'assistant', contentWithThink, now + 6000);

      const res = await request(app).get('/api/sessions/search/messages?q=cursor');

      expect(res.status).toBe(200);
      const thinkResult = res.body.data.results.find((r: { id: string }) => r.id === 'm-think');
      expect(thinkResult).toBeDefined();
      if (thinkResult) {
        expect(thinkResult.content).not.toContain('<think>');
        expect(thinkResult.content).not.toContain('</think>');
        expect(thinkResult.content).toBe('cursor-adapter configured successfully');
      }
    });

    it('respects limit parameter', async () => {
      const res = await request(app).get('/api/sessions/search/messages?q=authentication&limit=1');

      expect(res.status).toBe(200);
      expect(res.body.data.results.length).toBeLessThanOrEqual(1);
    });

    it('includes session name in results', async () => {
      const res = await request(app).get('/api/sessions/search/messages?q=authentication');

      expect(res.status).toBe(200);
      if (res.body.data.results.length > 0) {
        expect(res.body.data.results[0].sessionName).toBe('Session 1');
      }
    });
  });

  describe('GET /api/sessions with includeArchived', () => {
    it('excludes archived sessions by default', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, archived_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s-active', 'project-1', 'Active', null, now, now);
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
        INSERT INTO sessions (id, project_id, name, archived_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s-active', 'project-1', 'Active', null, now, now);
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, archived_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s-archived', 'project-1', 'Archived', now, now, now);

      const res = await request(app).get('/api/sessions?includeArchived=true');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });
  });

  describe('GET /api/sessions/archived', () => {
    it('returns only archived sessions', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, archived_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s-active', 'project-1', 'Active', null, now, now);
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, archived_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s-archived', 'project-1', 'Archived', now, now, now);

      const res = await request(app).get('/api/sessions/archived');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe('s-archived');
    });

    it('returns empty array when no archived sessions', async () => {
      const res = await request(app).get('/api/sessions/archived');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe('POST /api/sessions/archive', () => {
    it('archives sessions', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Session 1', now, now);
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s2', 'project-1', 'Session 2', now, now);

      const res = await request(app)
        .post('/api/sessions/archive')
        .send({ sessionIds: ['s1', 's2'] });

      expect(res.status).toBe(200);
      expect(res.body.data.archived).toBe(2);

      const row = db.prepare('SELECT archived_at FROM sessions WHERE id = ?').get('s1') as any;
      expect(row.archived_at).toBeDefined();
      expect(row.archived_at).not.toBeNull();
    });

    it('returns 400 when sessionIds missing', async () => {
      const res = await request(app)
        .post('/api/sessions/archive')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when sessionIds is empty array', async () => {
      const res = await request(app)
        .post('/api/sessions/archive')
        .send({ sessionIds: [] });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/sessions/restore', () => {
    it('restores archived sessions', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, archived_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Session 1', now, now, now);

      const res = await request(app)
        .post('/api/sessions/restore')
        .send({ sessionIds: ['s1'] });

      expect(res.status).toBe(200);
      expect(res.body.data.restored).toBe(1);

      const row = db.prepare('SELECT archived_at FROM sessions WHERE id = ?').get('s1') as any;
      expect(row.archived_at).toBeNull();
    });

    it('returns 400 when sessionIds missing', async () => {
      const res = await request(app)
        .post('/api/sessions/restore')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/sessions/sync', () => {
    it('returns sessions updated since timestamp', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Old', now - 10000, now - 10000);
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s2', 'project-1', 'New', now, now);

      const res = await request(app).get(`/api/sessions/sync?since=${now - 5000}`);
      expect(res.status).toBe(200);
      expect(res.body.data.sessions).toHaveLength(1);
      expect(res.body.data.sessions[0].id).toBe('s2');
      expect(res.body.data.timestamp).toBeDefined();
      expect(res.body.data.total).toBe(1);
    });

    it('returns all sessions when since=0', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'S1', now, now);

      const res = await request(app).get('/api/sessions/sync?since=0');
      expect(res.status).toBe(200);
      expect(res.body.data.sessions.length).toBeGreaterThanOrEqual(1);
    });

    it('returns 400 for invalid since parameter', async () => {
      const res = await request(app).get('/api/sessions/sync?since=-1');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('excludes archived sessions', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, archived_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s-archived', 'project-1', 'Archived', now, now, now);

      const res = await request(app).get('/api/sessions/sync?since=0');
      expect(res.status).toBe(200);
      expect(res.body.data.sessions.every((s: any) => s.id !== 's-archived')).toBe(true);
    });

    it('includes isActive status from activeRuns', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Running', now, now);
      activeRuns.set('run-1', { sessionId: 's1', completed: false, sessionType: 'regular' });

      const res = await request(app).get('/api/sessions/sync?since=0');
      expect(res.status).toBe(200);
      const session = res.body.data.sessions.find((s: any) => s.id === 's1');
      expect(session.isActive).toBe(true);
    });
  });

  describe('GET /api/sessions/:id/run-state', () => {
    it('returns run state when no active run', async () => {
      const res = await request(app).get('/api/sessions/s1/run-state');
      expect(res.status).toBe(200);
      expect(res.body.data.sessionId).toBe('s1');
      expect(res.body.data.isRunning).toBe(false);
      expect(res.body.data.activeRunId).toBeUndefined();
    });

    it('returns run state with active run', async () => {
      activeRuns.set('run-1', { sessionId: 's1', completed: false, sessionType: 'regular' });

      const res = await request(app).get('/api/sessions/s1/run-state');
      expect(res.status).toBe(200);
      expect(res.body.data.isRunning).toBe(true);
      expect(res.body.data.activeRunId).toBe('run-1');
    });

    it('returns isRunning true for background runs', async () => {
      activeRuns.set('run-bg', { sessionId: 's1', completed: false, sessionType: 'background' });

      const res = await request(app).get('/api/sessions/s1/run-state');
      expect(res.status).toBe(200);
      expect(res.body.data.isRunning).toBe(true);
      // activeRunId should be undefined because findForegroundActiveRunIdForSession excludes background
      expect(res.body.data.activeRunId).toBeUndefined();
    });
  });

  describe('PATCH /api/sessions/:id/unlock', () => {
    it('unlocks a read-only session', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, is_read_only, plan_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Locked', 1, 'completed', now, now);

      const res = await request(app).patch('/api/sessions/s1/unlock');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const row = db.prepare('SELECT is_read_only, plan_status FROM sessions WHERE id = ?').get('s1') as any;
      expect(row.is_read_only).toBe(0);
      expect(row.plan_status).toBe('planning');
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app).patch('/api/sessions/nonexistent/unlock');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/sessions/:id/reset-sdk-session', () => {
    it('resets sdk_session_id to null', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, sdk_session_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Test', 'sdk-123', now, now);

      const res = await request(app).post('/api/sessions/s1/reset-sdk-session');
      expect(res.status).toBe(200);
      expect(res.body.data.sessionId).toBe('s1');
      expect(res.body.data.reset).toBe(true);

      const row = db.prepare('SELECT sdk_session_id FROM sessions WHERE id = ?').get('s1') as any;
      expect(row.sdk_session_id).toBeNull();
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app).post('/api/sessions/nonexistent/reset-sdk-session');
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/sessions/:id/dismiss-interrupted', () => {
    it('clears last_run_status', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, last_run_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Test', 'interrupted', now, now);

      const res = await request(app).patch('/api/sessions/s1/dismiss-interrupted');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const row = db.prepare('SELECT last_run_status FROM sessions WHERE id = ?').get('s1') as any;
      expect(row.last_run_status).toBeNull();
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app).patch('/api/sessions/nonexistent/dismiss-interrupted');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/sessions with type', () => {
    it('creates background session', async () => {
      const res = await request(app)
        .post('/api/sessions')
        .send({ projectId: 'project-1', name: 'BG', type: 'background' });

      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe('background');
    });

    it('defaults to regular session for unknown type', async () => {
      const res = await request(app)
        .post('/api/sessions')
        .send({ projectId: 'project-1', name: 'Regular', type: 'unknown' });

      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe('regular');
    });

    it('creates session with parentSessionId', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('parent-1', 'project-1', 'Parent', now, now);

      const res = await request(app)
        .post('/api/sessions')
        .send({ projectId: 'project-1', name: 'Child', parentSessionId: 'parent-1' });

      expect(res.status).toBe(201);
      expect(res.body.data.parentSessionId).toBe('parent-1');
    });
  });

  describe('GET /api/sessions/:id/messages with after/afterOffset', () => {
    beforeEach(() => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Test Session', now, now);

      for (let i = 0; i < 5; i++) {
        db.prepare(`
          INSERT INTO messages (id, session_id, role, content, created_at, offset)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(`m${i}`, 's1', 'user', `Message ${i}`, now + i * 1000, i);
      }
    });

    it('returns messages after timestamp', async () => {
      const now = Date.now();
      const afterTimestamp = now + 1500; // After message 1, before message 2

      const res = await request(app).get(`/api/sessions/s1/messages?after=${afterTimestamp}`);
      expect(res.status).toBe(200);
      // Should get messages 2, 3, 4 (after the timestamp)
      expect(res.body.data.messages.length).toBeGreaterThanOrEqual(1);
      // Messages should be in ASC order (oldest first)
      if (res.body.data.messages.length > 1) {
        expect(res.body.data.messages[0].createdAt).toBeLessThan(
          res.body.data.messages[res.body.data.messages.length - 1].createdAt
        );
      }
    });

    it('returns messages after offset', async () => {
      const res = await request(app).get('/api/sessions/s1/messages?afterOffset=2');
      expect(res.status).toBe(200);
      // Should get messages with offset > 2 (i.e., offset 3, 4)
      expect(res.body.data.messages.length).toBe(2);
      expect(res.body.data.messages[0].content).toBe('Message 3');
      expect(res.body.data.messages[1].content).toBe('Message 4');
    });

    it('returns maxOffset in pagination', async () => {
      const res = await request(app).get('/api/sessions/s1/messages');
      expect(res.status).toBe(200);
      expect(res.body.data.pagination.maxOffset).toBe(4);
    });
  });

  describe('GET /api/sessions/search/history', () => {
    it('returns empty history initially', async () => {
      const res = await request(app).get('/api/sessions/search/history');
      expect(res.status).toBe(200);
      expect(res.body.data.history).toEqual([]);
    });

    it('returns search history after searches', async () => {
      // Insert some search history
      const now = Date.now();
      db.prepare(`
        INSERT INTO search_history (id, user_id, query, result_count, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('sh1', 'default', 'test query', 5, now);

      const res = await request(app).get('/api/sessions/search/history');
      expect(res.status).toBe(200);
      expect(res.body.data.history).toHaveLength(1);
      expect(res.body.data.history[0].query).toBe('test query');
    });
  });

  describe('DELETE /api/sessions/search/history', () => {
    it('clears search history', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO search_history (id, user_id, query, result_count, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('sh1', 'default', 'test', 5, now);

      const res = await request(app).delete('/api/sessions/search/history');
      expect(res.status).toBe(200);
      expect(res.body.data.cleared).toBe(true);

      const count = db.prepare('SELECT COUNT(*) as c FROM search_history WHERE user_id = ?').get('default') as any;
      expect(count.c).toBe(0);
    });
  });

  describe('PATCH /api/sessions/:id/working-directory', () => {
    it('updates working directory successfully', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Test', now, now);

      // Mock fs.existsSync to return true
      const fs = require('fs');
      const origExistsSync = fs.existsSync;
      fs.existsSync = vi.fn().mockReturnValue(true);

      const res = await request(app)
        .patch('/api/sessions/s1/working-directory')
        .send({ workingDirectory: '/tmp/test-dir' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.workingDirectory).toBe('/tmp/test-dir');

      fs.existsSync = origExistsSync;
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app)
        .patch('/api/sessions/nonexistent/working-directory')
        .send({ workingDirectory: '/tmp' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 409 for locked planning task session', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, project_role, plan_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Task', 'task', 'planning', now, now);

      const res = await request(app)
        .patch('/api/sessions/s1/working-directory')
        .send({ workingDirectory: '/tmp' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LOCKED');
    });

    it('returns 400 when path does not exist', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Test', now, now);

      const fs = require('fs');
      const origExistsSync = fs.existsSync;
      fs.existsSync = vi.fn().mockReturnValue(false);

      const res = await request(app)
        .patch('/api/sessions/s1/working-directory')
        .send({ workingDirectory: '/nonexistent/path' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');

      fs.existsSync = origExistsSync;
    });

    it('clears working directory when not provided', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, working_directory, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Test', '/old/path', now, now);

      const res = await request(app)
        .patch('/api/sessions/s1/working-directory')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('search with role and sort filters', () => {
    beforeEach(() => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Session 1', now, now);

      db.prepare(`
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('m1', 's1', 'user', 'authentication request from user', now);
      db.prepare(`
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('m2', 's1', 'assistant', 'authentication response from assistant', now + 1000);
    });

    it('filters by role=user', async () => {
      const res = await request(app).get('/api/sessions/search/messages?q=authentication&role=user');

      expect(res.status).toBe(200);
      for (const r of res.body.data.results) {
        expect(r.role).toBe('user');
      }
    });

    it('filters by role=assistant', async () => {
      const res = await request(app).get('/api/sessions/search/messages?q=authentication&role=assistant');

      expect(res.status).toBe(200);
      for (const r of res.body.data.results) {
        expect(r.role).toBe('assistant');
      }
    });

    it('sorts by newest', async () => {
      const res = await request(app).get('/api/sessions/search/messages?q=authentication&sort=newest');
      expect(res.status).toBe(200);
      if (res.body.data.results.length > 1) {
        expect(res.body.data.results[0].createdAt).toBeGreaterThan(res.body.data.results[1].createdAt);
      }
    });

    it('sorts by oldest', async () => {
      const res = await request(app).get('/api/sessions/search/messages?q=authentication&sort=oldest');
      expect(res.status).toBe(200);
      if (res.body.data.results.length > 1) {
        expect(res.body.data.results[0].createdAt).toBeLessThan(res.body.data.results[1].createdAt);
      }
    });

    it('sorts by session', async () => {
      const res = await request(app).get('/api/sessions/search/messages?q=authentication&sort=session');
      expect(res.status).toBe(200);
      expect(res.body.data.results.length).toBeGreaterThanOrEqual(1);
    });

    it('filters by sessionIds', async () => {
      const res = await request(app).get('/api/sessions/search/messages?q=authentication&sessionIds=s1');
      expect(res.status).toBe(200);
      for (const r of res.body.data.results) {
        expect(r.sessionId).toBe('s1');
      }
    });

    it('filters by date range', async () => {
      const now = Date.now();
      const res = await request(app).get(`/api/sessions/search/messages?q=authentication&startDate=${now - 100000}&endDate=${now + 100000}`);
      expect(res.status).toBe(200);
      expect(res.body.data.results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('gateway broadcast paths', () => {
    let mockGatewayClient: { broadcastSessionEvent: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
      mockGatewayClient = { broadcastSessionEvent: vi.fn() };
      const { getGatewayClient } = await import('../../gateway-instance.js');
      (getGatewayClient as ReturnType<typeof vi.fn>).mockReturnValue(mockGatewayClient);
    });

    afterEach(async () => {
      const { getGatewayClient } = await import('../../gateway-instance.js');
      (getGatewayClient as ReturnType<typeof vi.fn>).mockReturnValue(null);
    });

    it('broadcasts session created on POST', async () => {
      const res = await request(app)
        .post('/api/sessions')
        .send({ projectId: 'project-1', name: 'New Session' });

      expect(res.status).toBe(201);
      expect(mockGatewayClient.broadcastSessionEvent).toHaveBeenCalledWith('created', expect.objectContaining({ name: 'New Session' }));
    });

    it('broadcasts session updated on PUT', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Original', now, now);

      await request(app).put('/api/sessions/s1').send({ name: 'Updated' });

      expect(mockGatewayClient.broadcastSessionEvent).toHaveBeenCalledWith('updated', expect.objectContaining({ id: 's1' }));
    });

    it('broadcasts session deleted on DELETE', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'To Delete', now, now);

      await request(app).delete('/api/sessions/s1');

      expect(mockGatewayClient.broadcastSessionEvent).toHaveBeenCalledWith('deleted', expect.objectContaining({ id: 's1' }));
    });

    it('broadcasts on archive', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Session', now, now);

      await request(app).post('/api/sessions/archive').send({ sessionIds: ['s1'] });

      expect(mockGatewayClient.broadcastSessionEvent).toHaveBeenCalledWith('updated', expect.objectContaining({ id: 's1' }));
    });

    it('broadcasts on restore', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, archived_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Session', now, now, now);

      await request(app).post('/api/sessions/restore').send({ sessionIds: ['s1'] });

      expect(mockGatewayClient.broadcastSessionEvent).toHaveBeenCalledWith('updated', expect.objectContaining({ id: 's1' }));
    });

    it('broadcasts on unlock', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, is_read_only, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Locked', 1, now, now);

      await request(app).patch('/api/sessions/s1/unlock');

      expect(mockGatewayClient.broadcastSessionEvent).toHaveBeenCalledWith('updated', expect.objectContaining({ id: 's1' }));
    });

    it('broadcasts on reset-sdk-session', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, sdk_session_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Test', 'sdk-123', now, now);

      await request(app).post('/api/sessions/s1/reset-sdk-session');

      expect(mockGatewayClient.broadcastSessionEvent).toHaveBeenCalledWith('updated', expect.objectContaining({ id: 's1' }));
    });
  });

  describe('message size trimming', () => {
    it('trims large messages to stay within size limit', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'project-1', 'Test', now, now);

      // Insert messages with large content (each > 256KB)
      const largeContent = 'x'.repeat(300 * 1024);
      for (let i = 0; i < 3; i++) {
        db.prepare(`
          INSERT INTO messages (id, session_id, role, content, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(`m${i}`, 's1', 'user', largeContent, now + i * 1000);
      }

      const res = await request(app).get('/api/sessions/s1/messages?limit=100');
      expect(res.status).toBe(200);
      // Should have trimmed - at 300KB per message, only 1-2 should fit in 512KB
      expect(res.body.data.messages.length).toBeLessThan(3);
      // But always at least 1
      expect(res.body.data.messages.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/sessions/search/suggestions', () => {
    it('returns suggestions matching prefix', async () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO search_history (id, user_id, query, result_count, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('sh1', 'default', 'authentication setup', 5, now);
      db.prepare(`
        INSERT INTO search_history (id, user_id, query, result_count, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('sh2', 'default', 'auth token', 3, now + 1000);
      db.prepare(`
        INSERT INTO search_history (id, user_id, query, result_count, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('sh3', 'default', 'database migration', 2, now + 2000);

      const res = await request(app).get('/api/sessions/search/suggestions?prefix=auth');
      expect(res.status).toBe(200);
      expect(res.body.data.suggestions.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.suggestions.every((s: string) => s.startsWith('auth'))).toBe(true);
    });

    it('returns empty for non-matching prefix', async () => {
      const res = await request(app).get('/api/sessions/search/suggestions?prefix=zzz');
      expect(res.status).toBe(200);
      expect(res.body.data.suggestions).toEqual([]);
    });
  });
});
