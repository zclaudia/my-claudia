import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SessionQueryError, SessionQueryService } from '../query-service.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
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
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      offset INTEGER
    );
  `);
  return db;
}

describe('SessionQueryService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('lists active sessions by default and includes archived when requested', () => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO sessions (id, project_id, name, archived_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('s1', 'project-1', 'Active', null, now, now);
    db.prepare(`
      INSERT INTO sessions (id, project_id, name, archived_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('s2', 'project-1', 'Archived', now, now, now);

    const service = new SessionQueryService(db, new Map());

    expect(service.listSessions()).toHaveLength(1);
    expect(service.listSessions(undefined, true)).toHaveLength(2);
    expect(service.listArchivedSessions()).toHaveLength(1);
  });

  it('filters session list by project', () => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO sessions (id, project_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('s1', 'project-1', 'One', now, now);
    db.prepare(`
      INSERT INTO sessions (id, project_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('s2', 'project-2', 'Two', now, now);

    const service = new SessionQueryService(db, new Map());

    const sessions = service.listSessions('project-1');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('s1');
  });

  it('returns sync payload with active state and last offset', () => {
    const base = Date.now() - 1000;
    db.prepare(`
      INSERT INTO sessions (id, project_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('s1', 'project-1', 'Recent', base, base);
    db.prepare(`
      INSERT INTO messages (id, session_id, role, content, created_at, offset)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('m1', 's1', 'user', 'Hi', base, 9);

    const activeRuns = new Map<string, { status: string; sessionId: string }>();
    activeRuns.set('run-1', { status: 'streaming', sessionId: 's1' });
    const service = new SessionQueryService(db, activeRuns, () => 123456);

    const result = service.syncSessions(String(base - 1));

    expect(result).toEqual({
      sessions: [
        {
          id: 's1',
          projectId: 'project-1',
          name: 'Recent',
          providerId: undefined,
          workingDirectory: undefined,
          createdAt: base,
          updatedAt: base,
          isActive: true,
          lastMessageOffset: 9,
        },
      ],
      timestamp: 123456,
      total: 1,
    });
  });

  it('rejects invalid sync since parameter', () => {
    const service = new SessionQueryService(db, new Map());

    expect(() => service.syncSessions('-1')).toThrowError(SessionQueryError);
  });
});
