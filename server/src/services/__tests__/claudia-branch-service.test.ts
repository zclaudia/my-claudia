import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudiaBranchService } from '../claudia-branch-service.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT,
      type TEXT,
      parent_session_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE orchestrator_tasks (
      id TEXT PRIMARY KEY,
      branch_id TEXT,
      status TEXT NOT NULL
    );

    CREATE TABLE claudia_branches (
      id TEXT PRIMARY KEY,
      host_project_id TEXT NOT NULL,
      active_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      title TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_task_id TEXT
    );

    CREATE TABLE claudia_project_state (
      host_project_id TEXT PRIMARY KEY,
      active_branch_id TEXT REFERENCES claudia_branches(id) ON DELETE SET NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

describe('ClaudiaBranchService', () => {
  let db: Database.Database;
  let service: ClaudiaBranchService;

  beforeEach(() => {
    db = createTestDb();
    service = new ClaudiaBranchService(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates branches without attaching a non-existent session', () => {
    const branch = service.createBranch({
      hostProjectId: 'project-1',
      title: 'Conversation',
    });

    expect(branch.activeSessionId).toBeNull();

    const stored = db.prepare('SELECT active_session_id FROM claudia_branches WHERE id = ?').get(branch.id) as { active_session_id: string | null };
    expect(stored.active_session_id).toBeNull();
  });

  it('does not reuse a branch from a different host project', () => {
    const foreignBranch = service.createBranch({
      hostProjectId: 'project-a',
      title: 'Other project',
    });
    db.prepare(`
      INSERT INTO sessions (id, project_id, name, type, parent_session_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?)
    `).run('session-a', 'project-a', 'Session', 'agent', 1, 1);
    service.attachSession(foreignBranch.id, 'session-a');

    const allocation = service.allocateBranch({
      hostProjectId: 'project-b',
      activeBranchId: foreignBranch.id,
      title: 'Current project',
      sessionId: 'fresh-session',
    });

    expect(allocation.action).toBe('created');
    expect(allocation.branchId).not.toBe(foreignBranch.id);
    expect(allocation.sessionId).toBe('fresh-session');
  });

  it('treats waiting tasks as active when deciding whether to reuse a branch', () => {
    const branch = service.createBranch({
      hostProjectId: 'project-1',
      title: 'Conversation',
    });
    db.prepare('INSERT INTO orchestrator_tasks (id, branch_id, status) VALUES (?, ?, ?)').run('task-1', branch.id, 'waiting');

    const allocation = service.allocateBranch({
      hostProjectId: 'project-1',
      activeBranchId: branch.id,
      title: 'Follow-up',
      sessionId: 'fresh-session',
    });

    expect(allocation.action).toBe('forked');
    expect(allocation.branchId).not.toBe(branch.id);
  });

  it('stores active branch per project', () => {
    const branch = service.createBranch({
      hostProjectId: 'project-1',
      title: 'Conversation',
    });

    service.setActiveBranchId('project-1', branch.id);

    expect(service.getActiveBranchId('project-1')).toBe(branch.id);
    expect(service.listActiveBranches()).toEqual([{ projectId: 'project-1', branchId: branch.id }]);
  });

  it('falls back to a fresh session when the active branch session is missing', () => {
    const branch = service.createBranch({
      hostProjectId: 'project-1',
      title: 'Conversation',
    });
    db.pragma('foreign_keys = OFF');
    db.prepare('UPDATE claudia_branches SET active_session_id = ? WHERE id = ?').run('missing-session', branch.id);
    db.pragma('foreign_keys = ON');

    const allocation = service.allocateBranch({
      hostProjectId: 'project-1',
      activeBranchId: branch.id,
      title: 'Follow-up',
      sessionId: 'fresh-session',
    });

    expect(allocation).toEqual({
      branchId: branch.id,
      sessionId: 'fresh-session',
      action: 'created',
      contextReset: true,
    });
  });

  it('falls back to a fresh session when continuing from a branch with a missing session', () => {
    const branch = service.createBranch({
      hostProjectId: 'project-1',
      title: 'Conversation',
    });
    db.pragma('foreign_keys = OFF');
    db.prepare('UPDATE claudia_branches SET active_session_id = ? WHERE id = ?').run('missing-session', branch.id);
    db.pragma('foreign_keys = ON');

    const allocation = service.allocateForContinue({
      taskBranchId: branch.id,
      hostProjectId: 'project-1',
      title: 'Continue',
      sessionId: 'fresh-session',
    });

    expect(allocation).toEqual({
      branchId: branch.id,
      sessionId: 'fresh-session',
      action: 'created',
      contextReset: true,
    });
  });
});
