import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTaskOrchestrator } from '../task-orchestrator.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE orchestrator_tasks (
      id TEXT PRIMARY KEY,
      parent_task_id TEXT,
      root_task_id TEXT,
      project_id TEXT,
      session_id TEXT,
      branch_id TEXT,
      branch_action TEXT,
      context_reset INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL,
      context_template TEXT NOT NULL,
      status TEXT NOT NULL,
      task TEXT NOT NULL,
      external_id TEXT,
      initiator TEXT NOT NULL DEFAULT 'system',
      schedule_type TEXT,
      schedule_config TEXT,
      depends_on TEXT,
      provider_id TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 0,
      result_summary TEXT,
      error_summary TEXT,
      response_text TEXT,
      tool_count INTEGER,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT,
      type TEXT,
      parent_session_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE claudia_branches (
      id TEXT PRIMARY KEY,
      host_project_id TEXT NOT NULL,
      active_session_id TEXT,
      title TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_task_id TEXT
    );
  `);
  return db;
}

describe('orchestration/task-orchestrator', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  function mockCreateVirtualClient(clientId: string, ws: any) {
    return { id: clientId, ws, authenticated: true, isAlive: true, isLocal: true, subscriptions: new Set() };
  }

  function mockSessionDeps() {
    return {
      createVirtualClient: mockCreateVirtualClient as any,
      createSession: (opts: any) => {
        const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const now = Date.now();
        db.prepare('INSERT INTO sessions (id, project_id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, opts.projectId, opts.name, opts.type, now, now);
        return { id };
      },
      sessionExists: (id: string) => !!db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(id),
    };
  }

  it('passes the task contextTemplate through to handleRunStart', async () => {
    const clients = new Map<string, any>();
    const handleRunStart = vi.fn(async () => {});
    const orchestrator = createTaskOrchestrator({
      db,
      handleRunStart,
      getClients: () => clients,
      serverPort: null,
      ...mockSessionDeps(),
    });

    const taskId = await orchestrator.spawnTask(null, {
      task: 'Review latest diff',
      projectId: 'project-1',
      contextTemplate: 'review',
      providerId: 'provider-1',
    });

    await orchestrator.tick();

    expect(handleRunStart).toHaveBeenCalledWith(
      expect.objectContaining({ id: `orchestrator-${taskId}` }),
      expect.objectContaining({
        type: 'run_start',
        input: 'Review latest diff',
        providerId: 'provider-1',
        _contextTemplate: 'review',
      }),
      db,
      {},
      clients,
    );

    const task = db.prepare('SELECT status, context_template FROM orchestrator_tasks WHERE id = ?').get(taskId) as any;
    expect(task).toMatchObject({
      status: 'running',
      context_template: 'review',
    });
  });

  it('fails waiting tasks when any dependency is cancelled', async () => {
    const orchestrator = createTaskOrchestrator({
      db,
      handleRunStart: vi.fn(async () => {}),
      getClients: () => new Map(),
      serverPort: null,
      ...mockSessionDeps(),
    });

    const dependencyId = await orchestrator.spawnTask(null, {
      task: 'Prepare environment',
      projectId: 'project-1',
    });
    const dependentId = await orchestrator.spawnTask(null, {
      task: 'Run analysis',
      projectId: 'project-1',
      dependsOn: [dependencyId],
    });

    await orchestrator.killTask(dependencyId);
    await orchestrator.tick();

    await expect(orchestrator.getTaskResult(dependentId)).resolves.toMatchObject({
      taskId: dependentId,
      status: 'failed',
      error: 'Dependency failed or was cancelled',
    });
  });

  it('reports waiting tasks as in-progress before they are settled', async () => {
    const orchestrator = createTaskOrchestrator({
      db,
      handleRunStart: vi.fn(async () => {}),
      getClients: () => new Map(),
      serverPort: null,
      ...mockSessionDeps(),
    });

    const dependencyId = await orchestrator.spawnTask(null, {
      task: 'Dependency task',
      projectId: 'project-1',
    });
    const taskId = await orchestrator.spawnTask(null, {
      task: 'Blocked task',
      projectId: 'project-1',
      dependsOn: [dependencyId],
    });

    await expect(orchestrator.getTaskResult(taskId)).resolves.toMatchObject({
      taskId,
      status: 'waiting',
      summary: expect.stringContaining('still waiting'),
    });
  });

  it('creates a fresh session when branch.active_session_id points to a missing session', async () => {
    const staleSessionId = 'missing-session';
    db.prepare(`
      INSERT INTO claudia_branches (id, host_project_id, active_session_id, title, created_at, updated_at, last_task_id)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
    `).run('branch-1', 'project-1', staleSessionId, 'Branch', 1, 1);

    const orchestrator = createTaskOrchestrator({
      db,
      handleRunStart: vi.fn(async () => {}),
      getClients: () => new Map(),
      serverPort: null,
      ...mockSessionDeps(),
    });

    const taskId = await orchestrator.spawnTask(null, {
      task: 'Run on branch',
      projectId: 'project-1',
      branchId: 'branch-1',
    });

    await orchestrator.tick();

    const task = db.prepare('SELECT session_id FROM orchestrator_tasks WHERE id = ?').get(taskId) as { session_id: string | null };
    const session = task.session_id
      ? db.prepare('SELECT id FROM sessions WHERE id = ?').get(task.session_id) as { id: string } | undefined
      : undefined;
    const branch = db.prepare('SELECT active_session_id FROM claudia_branches WHERE id = ?').get('branch-1') as { active_session_id: string | null };

    expect(task.session_id).toBeTruthy();
    expect(task.session_id).not.toBe(staleSessionId);
    expect(session?.id).toBe(task.session_id);
    expect(branch.active_session_id).toBe(task.session_id);
  });
});
