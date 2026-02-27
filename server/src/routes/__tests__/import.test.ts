import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import Database from 'better-sqlite3';
import { createImportRoutes } from '../import.js';
import { vol } from 'memfs';
import * as fs from 'fs';

// Mock fs module
vi.mock('fs', async () => {
  const memfs = await import('memfs');
  return memfs.fs;
});

describe('Import API Integration Tests', () => {
  let app: express.Application;
  let db: Database.Database;
  const mockClaudePath = '/mock/.claude';

  beforeEach(() => {
    // Create in-memory database with schema
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
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
      INSERT INTO projects (id, name, path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('test-project', 'Test Project', '/test/path', Date.now(), Date.now());

    // Setup Express app
    app = express();
    app.use(express.json());
    app.use('/api/import', createImportRoutes(db));

    // Clear virtual filesystem
    vol.reset();
  });

  afterEach(() => {
    db.close();
    vol.reset();
  });

  describe('POST /api/import/claude-cli/scan', () => {
    it('should scan directory and return sessions', async () => {
      // Setup mock filesystem
      vol.fromJSON({
        [`${mockClaudePath}/projects/test-project/sessions-index.json`]: JSON.stringify({
          version: 1,
          entries: [
            {
              sessionId: 'session-1',
              summary: 'Test Session 1',
              messageCount: 5,
              fileMtime: Date.now(),
              firstPrompt: 'Hello world'
            },
            {
              sessionId: 'session-2',
              summary: 'Test Session 2',
              messageCount: 3,
              fileMtime: Date.now()
            }
          ]
        })
      });

      const response = await request(app)
        .post('/api/import/claude-cli/scan')
        .send({ claudeCliPath: mockClaudePath })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.projects).toHaveLength(1);
      expect(response.body.data.projects[0].path).toBe('test-project');
      expect(response.body.data.projects[0].sessions).toHaveLength(2);
      expect(response.body.data.projects[0].sessions[0].id).toBe('session-1');
      expect(response.body.data.projects[0].sessions[0].summary).toBe('Test Session 1');
    });

    it('should return error for missing claudeCliPath', async () => {
      const response = await request(app)
        .post('/api/import/claude-cli/scan')
        .send({})
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_REQUEST');
    });

    it('should return error for non-existent directory', async () => {
      const response = await request(app)
        .post('/api/import/claude-cli/scan')
        .send({ claudeCliPath: '/non/existent/path' })
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('DIRECTORY_NOT_FOUND');
    });

    it('should return error when no projects directory exists', async () => {
      vol.fromJSON({
        [`${mockClaudePath}/some-file.txt`]: 'content'
      });

      const response = await request(app)
        .post('/api/import/claude-cli/scan')
        .send({ claudeCliPath: mockClaudePath })
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NO_PROJECTS');
    });

    it('should handle malformed sessions-index.json gracefully', async () => {
      vol.fromJSON({
        [`${mockClaudePath}/projects/bad-project/sessions-index.json`]: 'invalid json{'
      });

      const response = await request(app)
        .post('/api/import/claude-cli/scan')
        .send({ claudeCliPath: mockClaudePath })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.projects).toHaveLength(0);
    });
  });

  describe('POST /api/import/claude-cli/import', () => {
    beforeEach(() => {
      // Setup mock filesystem with session data
      vol.fromJSON({
        [`${mockClaudePath}/projects/test-project/session-1.jsonl`]: [
          JSON.stringify({ type: 'summary', summary: 'Test Session' }),
          JSON.stringify({
            type: 'user',
            uuid: 'msg-1',
            timestamp: '2026-01-27T10:00:00.000Z',
            message: { role: 'user', content: 'Hello' }
          }),
          JSON.stringify({
            type: 'assistant',
            uuid: 'msg-2',
            timestamp: '2026-01-27T10:00:05.000Z',
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'Hi there!' }],
              usage: { input_tokens: 10, output_tokens: 5 }
            }
          })
        ].join('\n'),
        [`${mockClaudePath}/projects/test-project/session-2.jsonl`]: [
          JSON.stringify({ type: 'summary', summary: 'Another Session' }),
          JSON.stringify({
            type: 'user',
            uuid: 'msg-3',
            timestamp: '2026-01-27T11:00:00.000Z',
            message: { role: 'user', content: 'Test' }
          })
        ].join('\n')
      });
    });

    it('should import sessions successfully', async () => {
      const response = await request(app)
        .post('/api/import/claude-cli/import')
        .send({
          claudeCliPath: mockClaudePath,
          imports: [
            {
              sessionId: 'session-1',
              projectPath: 'test-project',
              targetProjectId: 'test-project'
            }
          ],
          options: { conflictStrategy: 'skip' }
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.imported).toBe(1);
      expect(response.body.data.skipped).toBe(0);
      expect(response.body.data.errors).toHaveLength(0);

      // Verify database
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get('session-1');
      expect(session).toBeDefined();
      expect((session as any).name).toBe('Test Session');

      const messages = db.prepare('SELECT * FROM messages WHERE session_id = ?').all('session-1');
      expect(messages).toHaveLength(2);
      expect((messages[0] as any).content).toBe('Hello');
      expect((messages[1] as any).content).toBe('Hi there!');
    });

    it('should skip duplicate sessions with skip strategy', async () => {
      // Insert existing session
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('session-1', 'test-project', 'Existing Session', Date.now(), Date.now());

      const response = await request(app)
        .post('/api/import/claude-cli/import')
        .send({
          claudeCliPath: mockClaudePath,
          imports: [
            {
              sessionId: 'session-1',
              projectPath: 'test-project',
              targetProjectId: 'test-project'
            }
          ],
          options: { conflictStrategy: 'skip' }
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.imported).toBe(0);
      expect(response.body.data.skipped).toBe(1);

      // Verify session wasn't changed
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get('session-1');
      expect((session as any).name).toBe('Existing Session');
    });

    it('should overwrite existing sessions with overwrite strategy', async () => {
      // Insert existing session with messages
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('session-1', 'test-project', 'Old Session', Date.now(), Date.now());

      db.prepare(`
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('old-msg', 'session-1', 'user', 'Old message', Date.now());

      const response = await request(app)
        .post('/api/import/claude-cli/import')
        .send({
          claudeCliPath: mockClaudePath,
          imports: [
            {
              sessionId: 'session-1',
              projectPath: 'test-project',
              targetProjectId: 'test-project'
            }
          ],
          options: { conflictStrategy: 'overwrite' }
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.imported).toBe(1);

      // Verify session was overwritten
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get('session-1');
      expect((session as any).name).toBe('Test Session');

      // Verify old messages were deleted
      const messages = db.prepare('SELECT * FROM messages WHERE session_id = ?').all('session-1');
      expect(messages).toHaveLength(2);
      expect(messages.every((m: any) => m.id !== 'old-msg')).toBe(true);
    });

    it('should import multiple sessions in one request', async () => {
      const response = await request(app)
        .post('/api/import/claude-cli/import')
        .send({
          claudeCliPath: mockClaudePath,
          imports: [
            {
              sessionId: 'session-1',
              projectPath: 'test-project',
              targetProjectId: 'test-project'
            },
            {
              sessionId: 'session-2',
              projectPath: 'test-project',
              targetProjectId: 'test-project'
            }
          ],
          options: { conflictStrategy: 'skip' }
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.imported).toBe(2);

      const sessions = db.prepare('SELECT * FROM sessions').all();
      expect(sessions).toHaveLength(2); // 2 imported (no pre-existing session in this test)
    });

    it('should handle errors gracefully and report them', async () => {
      const response = await request(app)
        .post('/api/import/claude-cli/import')
        .send({
          claudeCliPath: mockClaudePath,
          imports: [
            {
              sessionId: 'non-existent-session',
              projectPath: 'test-project',
              targetProjectId: 'test-project'
            }
          ],
          options: { conflictStrategy: 'skip' }
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.imported).toBe(0);
      expect(response.body.data.errors).toHaveLength(1);
      expect(response.body.data.errors[0].sessionId).toBe('non-existent-session');
      expect(response.body.data.errors[0].error).toContain('not found');
    });

    it('should validate request parameters', async () => {
      const response = await request(app)
        .post('/api/import/claude-cli/import')
        .send({
          claudeCliPath: mockClaudePath
          // Missing imports array
        })
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_REQUEST');
    });

    it('should handle malformed JSONL gracefully', async () => {
      vol.fromJSON({
        [`${mockClaudePath}/projects/test-project/bad-session.jsonl`]: 'invalid json line\n{broken'
      });

      const response = await request(app)
        .post('/api/import/claude-cli/import')
        .send({
          claudeCliPath: mockClaudePath,
          imports: [
            {
              sessionId: 'bad-session',
              projectPath: 'test-project',
              targetProjectId: 'test-project'
            }
          ],
          options: { conflictStrategy: 'skip' }
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.errors).toHaveLength(1);
    });

    it('should preserve message metadata (usage, tool calls)', async () => {
      vol.fromJSON({
        [`${mockClaudePath}/projects/test-project/session-with-tools.jsonl`]: [
          JSON.stringify({ type: 'summary', summary: 'Tool Session' }),
          JSON.stringify({
            type: 'assistant',
            uuid: 'msg-tool',
            timestamp: '2026-01-27T10:00:00.000Z',
            message: {
              role: 'assistant',
              content: [
                { type: 'text', text: 'Using tools' },
                { type: 'tool_use', id: 'tool-1', name: 'read_file', input: { path: 'test.txt' } },
                { type: 'tool_result', tool_use_id: 'tool-1', content: 'File content' }
              ],
              usage: { input_tokens: 100, output_tokens: 50 }
            }
          })
        ].join('\n')
      });

      await request(app)
        .post('/api/import/claude-cli/import')
        .send({
          claudeCliPath: mockClaudePath,
          imports: [
            {
              sessionId: 'session-with-tools',
              projectPath: 'test-project',
              targetProjectId: 'test-project'
            }
          ],
          options: { conflictStrategy: 'skip' }
        })
        .expect(200);

      const message = db.prepare('SELECT * FROM messages WHERE id = ?').get('msg-tool') as any;
      expect(message).toBeDefined();

      const metadata = JSON.parse(message.metadata);
      expect(metadata.usage.inputTokens).toBe(100);
      expect(metadata.usage.outputTokens).toBe(50);
      expect(metadata.toolCalls).toHaveLength(1);
      expect(metadata.toolCalls[0].name).toBe('read_file');
      expect(metadata.toolCalls[0].input.path).toBe('test.txt');
      expect(metadata.toolCalls[0].output).toBe('File content');
    });
  });
});
