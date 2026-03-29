import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { vol } from 'memfs';
import { ImportService } from '../import-service.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('fs', async () => {
  const memfs = await import('memfs');
  return memfs.fs;
});

describe('ImportService', () => {
  let db: Database.Database;
  let service: ImportService;
  const mockClaudePath = '/mock/.claude';
  let tmpDir: string;
  let fixtureDbPath: string;
  let realFs: typeof import('node:fs');

  beforeEach(async () => {
    realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        provider_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        offset INTEGER
      );
    `);

    db.prepare(`
      INSERT INTO projects (id, name, path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('project-1', 'Project 1', '/tmp/project-1', Date.now(), Date.now());

    service = new ImportService(db);
    tmpDir = realFs.mkdtempSync(path.join(os.tmpdir(), 'opencode-service-test-'));
    fixtureDbPath = path.join(tmpDir, 'opencode.db');
    vol.reset();
  });

  afterEach(() => {
    db.close();
    vol.reset();
    try {
      realFs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

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
        directory TEXT,
        title TEXT,
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

  it('imports Claude sessions into the database', async () => {
    vol.fromJSON({
      [`${mockClaudePath}/projects/source-project/session-1.jsonl`]: [
        JSON.stringify({ type: 'summary', summary: 'Imported Session' }),
        JSON.stringify({
          type: 'user',
          uuid: 'msg-1',
          timestamp: '2026-01-27T10:00:00.000Z',
          message: { role: 'user', content: 'Hello' },
        }),
      ].join('\n'),
    });

    const result = await service.importClaudeSessions(
      mockClaudePath,
      [{ sessionId: 'session-1', projectPath: 'source-project', targetProjectId: 'project-1' }],
      { conflictStrategy: 'skip' },
    );

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get('session-1') as { name: string } | undefined;
    const messages = db.prepare('SELECT * FROM messages WHERE session_id = ?').all('session-1');
    expect(session?.name).toBe('Imported Session');
    expect(messages).toHaveLength(1);
  });

  it('reports missing session files as import errors', async () => {
    const result = await service.importClaudeSessions(
      mockClaudePath,
      [{ sessionId: 'missing-session', projectPath: 'source-project', targetProjectId: 'project-1' }],
      { conflictStrategy: 'skip' },
    );

    expect(result.imported).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error.code).toBe('IMPORT_ERROR');
    expect(result.errors[0].error.message).toContain('Session file not found');
  });

  it('scans OpenCode sessions from external database', () => {
    const fixDb = createOpenCodeFixtureDb(fixtureDbPath);
    fixDb.prepare('INSERT INTO project (id, path) VALUES (?, ?)').run('proj-1', '/tmp/proj');
    fixDb.prepare(`
      INSERT INTO session (id, project_id, directory, title, time_created, time_updated)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('sess-1', 'proj-1', '/tmp/proj', 'OpenCode Session', 10, 20);
    fixDb.prepare(`
      INSERT INTO message (id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?)
    `).run('msg-1', 'sess-1', 10, 10, JSON.stringify({ role: 'user', time: 10 }));
    fixDb.prepare(`
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('part-1', 'msg-1', 'sess-1', 10, 10, JSON.stringify({ type: 'text', text: 'hello' }));
    fixDb.close();

    const result = service.scanOpenCodeDb(fixtureDbPath);

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].sessions[0].id).toBe('sess-1');
    expect(result.projects[0].sessions[0].summary).toBe('OpenCode Session');
  });

  it('imports OpenCode sessions with provider binding', () => {
    db.prepare(`
      INSERT INTO providers (id, name, type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('provider-opencode', 'OpenCode', 'opencode', Date.now(), Date.now());

    const fixDb = createOpenCodeFixtureDb(fixtureDbPath);
    fixDb.prepare('INSERT INTO project (id, path) VALUES (?, ?)').run('proj-1', '/tmp/proj');
    fixDb.prepare(`
      INSERT INTO session (id, project_id, directory, title, time_created, time_updated)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('sess-1', 'proj-1', '/tmp/proj', 'OpenCode Session', 10, 20);
    fixDb.prepare(`
      INSERT INTO message (id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?)
    `).run('msg-1', 'sess-1', 10, 10, JSON.stringify({ role: 'user', time: 10 }));
    fixDb.prepare(`
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('part-1', 'msg-1', 'sess-1', 10, 10, JSON.stringify({ type: 'text', text: 'hello' }));
    fixDb.close();

    const result = service.importOpenCodeSessions(
      fixtureDbPath,
      [{ sessionId: 'sess-1', targetProjectId: 'project-1' }],
      { conflictStrategy: 'skip' },
    );

    expect(result.imported).toBe(1);
    const session = db.prepare('SELECT provider_id FROM sessions WHERE id = ?').get('sess-1') as { provider_id: string };
    const messages = db.prepare('SELECT * FROM messages WHERE session_id = ?').all('sess-1');
    expect(session.provider_id).toBe('provider-opencode');
    expect(messages).toHaveLength(1);
  });
});
