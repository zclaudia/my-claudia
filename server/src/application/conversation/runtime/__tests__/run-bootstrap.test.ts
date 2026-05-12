import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initializeRunBootstrap } from '../run-bootstrap.js';

function createDb(providerType: 'claude' | 'cursor'): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      cli_path TEXT,
      env TEXT,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      provider_id TEXT,
      root_path TEXT,
      system_prompt TEXT
    );

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT,
      sdk_session_id TEXT,
      type TEXT,
      working_directory TEXT,
      project_role TEXT,
      plan_status TEXT,
      task_id TEXT,
      provider_id TEXT,
      last_run_status TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      offset INTEGER
    );

    CREATE TABLE permission_memories (
      session_id TEXT,
      remember_key TEXT,
      decision TEXT
    );

    CREATE TABLE permission_outside_workspace_roots (
      project_id TEXT,
      allowed_root TEXT
    );
  `);

  const now = Date.now();
  db.prepare(`
    INSERT INTO providers (id, name, type, created_at, updated_at)
    VALUES ('provider-1', ?, ?, ?, ?)
  `).run(providerType, providerType, now, now);
  db.prepare(`
    INSERT INTO projects (id, provider_id, root_path, system_prompt)
    VALUES ('project-1', 'provider-1', '/tmp/project', NULL)
  `).run();
  db.prepare(`
    INSERT INTO sessions (
      id, project_id, name, sdk_session_id, type, working_directory,
      project_role, plan_status, task_id, provider_id, created_at, updated_at
    )
    VALUES (
      'session-1', 'project-1', 'Test Session', 'sdk-existing', 'regular', '/tmp/project',
      NULL, NULL, NULL, 'provider-1', ?, ?
    )
  `).run(now, now);

  return db;
}

function bootstrap(providerType: 'claude' | 'cursor', mode: string) {
  const activeRuns = new Map();
  return initializeRunBootstrap({
    activeRuns,
    client: {
      id: 'client-1',
      ws: {} as any,
      isAlive: true,
      isLocal: true,
      authenticated: true,
    },
    db: createDb(providerType) as any,
    message: {
      type: 'run_start',
      clientRequestId: 'req-1',
      sessionId: 'session-1',
      input: 'hello',
      mode,
    },
    runId: 'run-1',
    trace: {
      log: vi.fn(),
      setMeta: vi.fn(),
    } as any,
  });
}

describe('initializeRunBootstrap mode/session policy', () => {
  it('preserves Cursor sdk_session_id in ask mode so the next run can pass --resume', () => {
    const result = bootstrap('cursor', 'ask');

    expect(result?.providerConfig?.type).toBe('cursor');
    expect(result?.providerEventState.sdkSessionId).toBe('sdk-existing');
  });

  it('keeps the existing reset behavior for Claude non-default mode', () => {
    const result = bootstrap('claude', 'plan');

    expect(result?.providerConfig?.type).toBe('claude');
    expect(result?.providerEventState.sdkSessionId).toBeUndefined();
  });
});
