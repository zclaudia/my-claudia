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

  it('passes the task contextTemplate through to handleRunStart', async () => {
    const clients = new Map<string, any>();
    const handleRunStart = vi.fn(async () => {});
    const orchestrator = createTaskOrchestrator({
      db,
      handleRunStart,
      getClients: () => clients,
      serverPort: null,
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
});
