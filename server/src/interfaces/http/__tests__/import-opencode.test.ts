import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createOpenCodeImportRoutes } from '../import-opencode.js';

// We need to mock fs.existsSync for path checks and BetterSqlite3 for reading external DB
// Instead, we'll create real temp files for the OpenCode fixture DB

describe('OpenCode Import API Integration Tests', () => {
  let app: express.Application;
  let db: Database.Database;
  let tmpDir: string;
  let fixtureDbPath: string;

  function createOpenCodeFixtureDb(dbPath: string): Database.Database {
    const fixDb = new Database(dbPath);
    fixDb.exec(`
      CREATE TABLE project (
        id TEXT PRIMARY KEY,
        path TEXT
      );

      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        parent_id TEXT,
        slug TEXT,
        directory TEXT,
        title TEXT,
        version TEXT,
        time_created INTEGER,
        time_updated INTEGER
      );

      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        time_created INTEGER,
        time_updated INTEGER,
        data TEXT
      );

      CREATE TABLE part (
        id TEXT PRIMARY KEY,
        message_id TEXT,
        session_id TEXT,
        time_created INTEGER,
        time_updated INTEGER,
        data TEXT
      );
    `);
    return fixDb;
  }

  function seedFixtureData(fixDb: Database.Database) {
    // Insert project
    fixDb.prepare('INSERT INTO project (id, path) VALUES (?, ?)').run('proj-1', '/home/user/myproject');

    // Insert sessions
    fixDb.prepare(`
      INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('sess-1', 'proj-1', 'test-session', '/home/user/myproject', 'Test Session', '1.0.0', 1700000000000, 1700001000000);

    fixDb.prepare(`
      INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('sess-2', 'proj-1', 'another-session', '/home/user/myproject', 'Another Session', '1.0.0', 1700002000000, 1700003000000);

    // Insert messages for sess-1
    fixDb.prepare(`
      INSERT INTO message (id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?)
    `).run('msg-1', 'sess-1', 1700000100000, 1700000100000, JSON.stringify({
      role: 'user',
      time: 1700000100000
    }));

    fixDb.prepare(`
      INSERT INTO message (id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?)
    `).run('msg-2', 'sess-1', 1700000200000, 1700000200000, JSON.stringify({
      role: 'assistant',
      time: { created: 1700000200000, completed: 1700000250000 },
      tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 20, write: 5 } },
      cost: 0.001
    }));

    // Insert parts for msg-1 (user text)
    fixDb.prepare(`
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('part-1', 'msg-1', 'sess-1', 1700000100000, 1700000100000, JSON.stringify({
      type: 'text',
      text: 'Hello, help me with my code'
    }));

    // Insert parts for msg-2 (assistant text + tool)
    fixDb.prepare(`
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('part-2', 'msg-2', 'sess-1', 1700000200000, 1700000200000, JSON.stringify({
      type: 'text',
      text: 'Sure, let me read the file first.'
    }));

    fixDb.prepare(`
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('part-3', 'msg-2', 'sess-1', 1700000210000, 1700000210000, JSON.stringify({
      type: 'tool',
      callID: 'call-1',
      tool: 'read_file',
      state: {
        status: 'completed',
        input: { path: 'src/main.ts' },
        output: 'console.log("hello")'
      }
    }));

    // Insert messages for sess-2
    fixDb.prepare(`
      INSERT INTO message (id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?)
    `).run('msg-3', 'sess-2', 1700002100000, 1700002100000, JSON.stringify({
      role: 'user',
      time: 1700002100000
    }));

    fixDb.prepare(`
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('part-4', 'msg-3', 'sess-2', 1700002100000, 1700002100000, JSON.stringify({
      type: 'text',
      text: 'Fix the bug'
    }));
  }

  beforeEach(() => {
    // Create temp directory for fixture DB
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-test-'));
    fixtureDbPath = path.join(tmpDir, 'opencode.db');

    // Create and seed fixture DB
    const fixDb = createOpenCodeFixtureDb(fixtureDbPath);
    seedFixtureData(fixDb);
    fixDb.close();

    // Create in-memory app database
    db = new Database(':memory:');
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
        name TEXT NOT NULL,
        type TEXT DEFAULT 'code',
        provider_id TEXT,
        root_path TEXT,
        path TEXT,
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
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        offset INTEGER,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session_offset ON messages(session_id, offset);
    `);

    // Insert test project
    db.prepare(`
      INSERT INTO projects (id, name, root_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('test-project', 'Test Project', '/test/path', Date.now(), Date.now());

    // Setup Express app
    app = express();
    app.use(express.json());
    app.use('/api/import', createOpenCodeImportRoutes(db));
  });

  afterEach(() => {
    db.close();
    // Clean up temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('POST /api/import/opencode/scan', () => {
    it('should scan database and return sessions', async () => {
      const response = await request(app)
        .post('/api/import/opencode/scan')
        .send({ opencodePath: fixtureDbPath });

      expect(response.body.success).toBe(true);
      expect(response.body.data.projects).toHaveLength(1);

      const project = response.body.data.projects[0];
      expect(project.path).toBe('/home/user/myproject');
      expect(project.sessions).toHaveLength(2);

      // Sessions should be ordered by time_updated DESC
      const sess1 = project.sessions.find((s: any) => s.id === 'sess-1');
      const sess2 = project.sessions.find((s: any) => s.id === 'sess-2');
      expect(sess1).toBeDefined();
      expect(sess1.summary).toBe('Test Session');
      expect(sess1.messageCount).toBe(2);
      expect(sess2).toBeDefined();
      expect(sess2.summary).toBe('Another Session');
      expect(sess2.messageCount).toBe(1);
    });

    it('should return error for non-existent database', async () => {
      const response = await request(app)
        .post('/api/import/opencode/scan')
        .send({ opencodePath: '/nonexistent/path/opencode.db' });

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('DB_NOT_FOUND');
    });

    it('should handle invalid database file', async () => {
      const invalidDbPath = path.join(tmpDir, 'invalid.db');
      fs.writeFileSync(invalidDbPath, 'not a database');

      const response = await request(app)
        .post('/api/import/opencode/scan')
        .send({ opencodePath: invalidDbPath });

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('SCAN_ERROR');
    });
  });

  describe('POST /api/import/opencode/import', () => {
    it('should import a single session successfully', async () => {
      const response = await request(app)
        .post('/api/import/opencode/import')
        .send({
          opencodePath: fixtureDbPath,
          imports: [{ sessionId: 'sess-1', targetProjectId: 'test-project' }],
          options: { conflictStrategy: 'skip' }
        });

      expect(response.body.success).toBe(true);
      expect(response.body.data.imported).toBe(1);
      expect(response.body.data.skipped).toBe(0);
      expect(response.body.data.errors).toHaveLength(0);

      // Verify session in database
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get('sess-1') as any;
      expect(session).toBeDefined();
      expect(session.name).toBe('Test Session');
      expect(session.project_id).toBe('test-project');

      // Verify messages
      const messages = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at').all('sess-1') as any[];
      expect(messages).toHaveLength(2);

      // User message
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('Hello, help me with my code');

      // Assistant message with tool calls and usage
      expect(messages[1].role).toBe('assistant');
      expect(messages[1].content).toBe('Sure, let me read the file first.');

      const metadata = JSON.parse(messages[1].metadata);
      expect(metadata.usage.inputTokens).toBe(120); // 100 input + 20 cache read
      expect(metadata.usage.outputTokens).toBe(50);
      expect(metadata.toolCalls).toHaveLength(1);
      expect(metadata.toolCalls[0].name).toBe('read_file');
      expect(metadata.toolCalls[0].input).toEqual({ path: 'src/main.ts' });
      expect(metadata.toolCalls[0].output).toBe('console.log("hello")');
    });

    it('should skip duplicate sessions with skip strategy', async () => {
      // First import
      await request(app)
        .post('/api/import/opencode/import')
        .send({
          opencodePath: fixtureDbPath,
          imports: [{ sessionId: 'sess-1', targetProjectId: 'test-project' }],
          options: { conflictStrategy: 'skip' }
        });

      // Second import (should skip)
      const response = await request(app)
        .post('/api/import/opencode/import')
        .send({
          opencodePath: fixtureDbPath,
          imports: [{ sessionId: 'sess-1', targetProjectId: 'test-project' }],
          options: { conflictStrategy: 'skip' }
        });

      expect(response.body.success).toBe(true);
      expect(response.body.data.imported).toBe(0);
      expect(response.body.data.skipped).toBe(1);
    });

    it('should overwrite existing sessions with overwrite strategy', async () => {
      // First import
      await request(app)
        .post('/api/import/opencode/import')
        .send({
          opencodePath: fixtureDbPath,
          imports: [{ sessionId: 'sess-1', targetProjectId: 'test-project' }],
          options: { conflictStrategy: 'skip' }
        });

      // Second import with overwrite
      const response = await request(app)
        .post('/api/import/opencode/import')
        .send({
          opencodePath: fixtureDbPath,
          imports: [{ sessionId: 'sess-1', targetProjectId: 'test-project' }],
          options: { conflictStrategy: 'overwrite' }
        });

      expect(response.body.success).toBe(true);
      expect(response.body.data.imported).toBe(1);
      expect(response.body.data.skipped).toBe(0);

      // Verify session still has correct data
      const messages = db.prepare('SELECT * FROM messages WHERE session_id = ?').all('sess-1') as any[];
      expect(messages).toHaveLength(2);
    });

    it('should import multiple sessions', async () => {
      const response = await request(app)
        .post('/api/import/opencode/import')
        .send({
          opencodePath: fixtureDbPath,
          imports: [
            { sessionId: 'sess-1', targetProjectId: 'test-project' },
            { sessionId: 'sess-2', targetProjectId: 'test-project' }
          ],
          options: { conflictStrategy: 'skip' }
        });

      expect(response.body.success).toBe(true);
      expect(response.body.data.imported).toBe(2);

      const sessions = db.prepare('SELECT * FROM sessions').all() as any[];
      expect(sessions).toHaveLength(2);
    });

    it('should handle non-existent session gracefully', async () => {
      const response = await request(app)
        .post('/api/import/opencode/import')
        .send({
          opencodePath: fixtureDbPath,
          imports: [{ sessionId: 'nonexistent', targetProjectId: 'test-project' }],
          options: { conflictStrategy: 'skip' }
        });

      expect(response.body.success).toBe(true);
      expect(response.body.data.imported).toBe(0);
      expect(response.body.data.errors).toHaveLength(1);
      expect(response.body.data.errors[0].sessionId).toBe('nonexistent');
    });

    it('should return error for invalid request', async () => {
      const response = await request(app)
        .post('/api/import/opencode/import')
        .send({ opencodePath: fixtureDbPath });

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_REQUEST');
    });

    it('should return error for non-existent database', async () => {
      const response = await request(app)
        .post('/api/import/opencode/import')
        .send({
          opencodePath: '/nonexistent/opencode.db',
          imports: [{ sessionId: 'sess-1', targetProjectId: 'test-project' }],
          options: { conflictStrategy: 'skip' }
        });

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('DB_NOT_FOUND');
    });
  });
});
