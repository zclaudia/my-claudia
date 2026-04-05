import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SessionLifecycleError, SessionLifecycleService } from '../../domains/sessions/lifecycle-service.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'code',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

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
  `);
  return db;
}

describe('SessionLifecycleService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    const now = Date.now();
    db.prepare(`
      INSERT INTO projects (id, name, type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('project-1', 'Test Project', 'code', now, now);
  });

  afterEach(() => {
    db.close();
  });

  it('creates session and emits created side effects', () => {
    const broadcastSessionEvent = vi.fn();
    const emitPluginEvent = vi.fn().mockResolvedValue(undefined);
    const service = new SessionLifecycleService(db, {
      broadcastSessionEvent,
      emitPluginEvent,
      pathExists: () => true,
    });

    const session = service.createSession({
      projectId: 'project-1',
      name: 'New Session',
      type: 'background',
      workingDirectory: '/tmp/worktree',
    });

    expect(session.projectId).toBe('project-1');
    expect(session.type).toBe('background');
    expect(broadcastSessionEvent).toHaveBeenCalledWith('created', expect.objectContaining({ id: session.id }));
    expect(emitPluginEvent).toHaveBeenCalledWith('session.created', expect.objectContaining({ sessionId: session.id }));
  });

  it('archives and restores sessions with updated side effects', () => {
    const broadcastSessionEvent = vi.fn();
    const emitPluginEvent = vi.fn().mockResolvedValue(undefined);
    const service = new SessionLifecycleService(db, {
      broadcastSessionEvent,
      emitPluginEvent,
    });
    const now = Date.now();
    db.prepare(`
      INSERT INTO sessions (id, project_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('s1', 'project-1', 'Session 1', now, now);

    expect(service.archiveSessions(['s1'])).toEqual({ archived: 1 });
    let row = db.prepare('SELECT archived_at FROM sessions WHERE id = ?').get('s1') as { archived_at: number | null };
    expect(row.archived_at).not.toBeNull();

    expect(service.restoreSessions(['s1'])).toEqual({ restored: 1 });
    row = db.prepare('SELECT archived_at FROM sessions WHERE id = ?').get('s1') as { archived_at: number | null };
    expect(row.archived_at).toBeNull();
    expect(broadcastSessionEvent).toHaveBeenCalledWith('updated', expect.objectContaining({ id: 's1' }));
    expect(emitPluginEvent).toHaveBeenCalledWith('session.archived', { sessionId: 's1' });
    expect(emitPluginEvent).toHaveBeenCalledWith('session.restored', { sessionId: 's1' });
  });

  it('rejects working directory updates while planning task session is locked', () => {
    const service = new SessionLifecycleService(db, { pathExists: () => true });
    const now = Date.now();
    db.prepare(`
      INSERT INTO sessions (id, project_id, name, project_role, plan_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('s1', 'project-1', 'Task Session', 'task', 'planning', now, now);

    expect(() => service.updateWorkingDirectory('s1', '/tmp/other')).toThrowError(SessionLifecycleError);
  });

  it('unlocks session and resets sdk session through repository update path', () => {
    const broadcastSessionEvent = vi.fn();
    const emitPluginEvent = vi.fn().mockResolvedValue(undefined);
    const service = new SessionLifecycleService(db, {
      broadcastSessionEvent,
      emitPluginEvent,
    });
    const now = Date.now();
    db.prepare(`
      INSERT INTO sessions (id, project_id, name, sdk_session_id, is_read_only, project_role, plan_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('s1', 'project-1', 'Session', 'sdk-123', 1, 'task', 'ready', now, now);

    const unlocked = service.unlockSession('s1');
    expect(unlocked.isReadOnly).toBeUndefined();
    expect(unlocked.planStatus).toBe('planning');

    expect(service.resetSdkSession('s1')).toEqual({ sessionId: 's1', reset: true });
    const row = db.prepare('SELECT sdk_session_id FROM sessions WHERE id = ?').get('s1') as { sdk_session_id: string | null };
    expect(row.sdk_session_id).toBeNull();
    expect(emitPluginEvent).toHaveBeenCalledWith('session.updated', expect.objectContaining({ sessionId: 's1' }));
    expect(broadcastSessionEvent).toHaveBeenCalledWith('updated', expect.objectContaining({ id: 's1' }));
  });

  it('deletes sessions and reorders project sessions', () => {
    const broadcastSessionEvent = vi.fn();
    const emitPluginEvent = vi.fn().mockResolvedValue(undefined);
    const service = new SessionLifecycleService(db, {
      broadcastSessionEvent,
      emitPluginEvent,
    });
    const now = Date.now();
    db.prepare(`
      INSERT INTO sessions (id, project_id, name, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('s1', 'project-1', 'Session 1', 0, now, now);
    db.prepare(`
      INSERT INTO sessions (id, project_id, name, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('s2', 'project-1', 'Session 2', 1, now, now);

    service.reorderSessions('project-1', ['s2', 's1']);
    let rows = db.prepare('SELECT id, sort_order FROM sessions ORDER BY id').all() as Array<{ id: string; sort_order: number }>;
    expect(rows).toEqual([
      { id: 's1', sort_order: 1 },
      { id: 's2', sort_order: 0 },
    ]);

    service.deleteSession('s1');
    rows = db.prepare('SELECT id FROM sessions ORDER BY id').all() as Array<{ id: string }>;
    expect(rows).toEqual([{ id: 's2' }]);
    expect(broadcastSessionEvent).toHaveBeenCalledWith('deleted', expect.objectContaining({ id: 's1' }));
    expect(emitPluginEvent).toHaveBeenCalledWith('session.deleted', expect.objectContaining({ sessionId: 's1' }));
  });
});
