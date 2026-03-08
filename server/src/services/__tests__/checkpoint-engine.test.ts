import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { CheckpointEngine, type CheckpointResult } from '../checkpoint-engine.js';
import { SupervisionTaskRepository } from '../../repositories/supervision-task.js';
import { ProjectRepository } from '../../repositories/project.js';
import { SessionRepository } from '../../repositories/session.js';
import type { ProjectAgent, ServerMessage, SupervisionV2LogEvent, SupervisionTask } from '@my-claudia/shared';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'code',
      provider_id TEXT,
      root_path TEXT,
      system_prompt TEXT,
      permission_policy TEXT,
      agent_permission_override TEXT,
      agent TEXT,
      context_sync_status TEXT NOT NULL DEFAULT 'synced',
      is_internal INTEGER NOT NULL DEFAULT 0,
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
      working_directory TEXT,
      project_role TEXT,
      task_id TEXT,
      archived_at INTEGER,
      plan_status TEXT,
      is_read_only INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT CHECK(role IN ('user', 'assistant', 'system')) NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      offset INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE TABLE supervision_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'user',
      session_id TEXT,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      dependencies TEXT,
      dependency_mode TEXT DEFAULT 'all',
      relevant_doc_ids TEXT,
      task_specific_context TEXT,
      scope TEXT,
      acceptance_criteria TEXT,
      max_retries INTEGER DEFAULT 2,
      attempt INTEGER NOT NULL DEFAULT 1,
      base_commit TEXT,
      result TEXT,
      schedule_cron TEXT,
      schedule_next_run INTEGER,
      schedule_enabled INTEGER DEFAULT 0,
      retry_delay_ms INTEGER DEFAULT 5000,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
    );
    CREATE TABLE supervision_v2_logs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT,
      event TEXT NOT NULL,
      detail TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);
  return db;
}

function makeAgent(overrides: Partial<ProjectAgent> = {}): ProjectAgent {
  return {
    type: 'supervisor',
    phase: 'active',
    config: { maxConcurrentTasks: 1, trustLevel: 'low', autoDiscoverTasks: false },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function seedProject(
  db: Database.Database,
  opts: { agent?: ProjectAgent; rootPath?: string; name?: string } = {},
): string {
  const id = uuidv4();
  const now = Date.now();
  db.prepare(
    `INSERT INTO projects (id, name, type, root_path, agent, created_at, updated_at)
     VALUES (?, ?, 'code', ?, ?, ?, ?)`,
  ).run(id, opts.name ?? 'Test Project', opts.rootPath ?? '/tmp/test', opts.agent ? JSON.stringify(opts.agent) : null, now, now);
  return id;
}

describe('CheckpointEngine', () => {
  let db: Database.Database;
  let taskRepo: SupervisionTaskRepository;
  let projectRepo: ProjectRepository;
  let sessionRepo: SessionRepository;
  let broadcastFn: ReturnType<typeof vi.fn>;
  let logFn: ReturnType<typeof vi.fn>;
  let createTaskFn: ReturnType<typeof vi.fn>;
  let createVirtualClientFn: ReturnType<typeof vi.fn>;
  let handleRunStartFn: ReturnType<typeof vi.fn>;
  let mockContextManager: any;
  let getContextManagerFn: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    db = createTestDb();
    taskRepo = new SupervisionTaskRepository(db);
    projectRepo = new ProjectRepository(db);
    sessionRepo = new SessionRepository(db);
  });

  afterAll(() => db.close());

  beforeEach(() => {
    db.exec('DELETE FROM supervision_v2_logs');
    db.exec('DELETE FROM supervision_tasks');
    db.exec('DELETE FROM messages');
    db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM projects');

    broadcastFn = vi.fn();
    logFn = vi.fn();
    createTaskFn = vi.fn().mockImplementation(
      (_pid: string, data: any) => ({ id: uuidv4(), ...data, status: 'proposed', createdAt: Date.now() }),
    );
    createVirtualClientFn = vi.fn().mockReturnValue({ id: 'vc' });
    handleRunStartFn = vi.fn();

    mockContextManager = {
      isInitialized: vi.fn().mockReturnValue(true),
      loadAll: vi.fn().mockReturnValue({ documents: [], workflow: { onTaskComplete: [], onCheckpoint: [], checkpointTrigger: { type: 'on_task_complete' } } }),
      getWorkflow: vi.fn().mockReturnValue({
        onTaskComplete: [],
        onCheckpoint: [],
        checkpointTrigger: { type: 'on_task_complete' },
      }),
      getProjectSummary: vi.fn().mockReturnValue('Current summary'),
      updateProjectSummary: vi.fn(),
      updateDocument: vi.fn(),
      getContextForTask: vi.fn().mockReturnValue(''),
    };
    getContextManagerFn = vi.fn().mockReturnValue(mockContextManager);
  });

  afterEach(() => {
    // cleanup timers
  });

  function createEngine(): CheckpointEngine {
    return new CheckpointEngine(
      db,
      taskRepo,
      projectRepo,
      sessionRepo,
      getContextManagerFn,
      broadcastFn,
      logFn,
      createTaskFn,
      createVirtualClientFn,
      handleRunStartFn,
    );
  }

  // ========================================
  // shouldTrigger
  // ========================================

  describe('shouldTrigger()', () => {
    it('returns true for on_task_complete trigger when event is task_complete', () => {
      const projectId = seedProject(db, { agent: makeAgent() });
      const engine = createEngine();
      expect(engine.shouldTrigger(projectId, 'task_complete')).toBe(true);
    });

    it('returns false for on_task_complete trigger when event is idle', () => {
      const projectId = seedProject(db, { agent: makeAgent() });
      const engine = createEngine();
      expect(engine.shouldTrigger(projectId, 'idle')).toBe(false);
    });

    it('returns true for on_idle trigger when event is idle', () => {
      const projectId = seedProject(db, { agent: makeAgent() });
      mockContextManager.getWorkflow.mockReturnValue({
        onTaskComplete: [],
        onCheckpoint: [],
        checkpointTrigger: { type: 'on_idle' },
      });
      const engine = createEngine();
      expect(engine.shouldTrigger(projectId, 'idle')).toBe(true);
    });

    it('returns false for interval trigger (handled separately)', () => {
      const projectId = seedProject(db, { agent: makeAgent() });
      mockContextManager.getWorkflow.mockReturnValue({
        onTaskComplete: [],
        onCheckpoint: [],
        checkpointTrigger: { type: 'interval', minutes: 30 },
      });
      const engine = createEngine();
      expect(engine.shouldTrigger(projectId, 'task_complete')).toBe(false);
      expect(engine.shouldTrigger(projectId, 'idle')).toBe(false);
    });

    it('supports combined triggers', () => {
      const projectId = seedProject(db, { agent: makeAgent() });
      mockContextManager.getWorkflow.mockReturnValue({
        onTaskComplete: [],
        onCheckpoint: [],
        checkpointTrigger: {
          type: 'combined',
          triggers: [{ type: 'on_task_complete' }, { type: 'on_idle' }],
        },
      });
      const engine = createEngine();
      expect(engine.shouldTrigger(projectId, 'task_complete')).toBe(true);
      expect(engine.shouldTrigger(projectId, 'idle')).toBe(true);
    });

    it('returns false when agent is paused', () => {
      const projectId = seedProject(db, { agent: makeAgent({ phase: 'paused' }) });
      const engine = createEngine();
      expect(engine.shouldTrigger(projectId, 'task_complete')).toBe(false);
    });

    it('returns false when agent is archived', () => {
      const projectId = seedProject(db, { agent: makeAgent({ phase: 'archived' }) });
      const engine = createEngine();
      expect(engine.shouldTrigger(projectId, 'task_complete')).toBe(false);
    });

    it('returns false when no agent exists', () => {
      const projectId = seedProject(db);
      const engine = createEngine();
      expect(engine.shouldTrigger(projectId, 'task_complete')).toBe(false);
    });

    it('returns false when checkpoint is already running', () => {
      const projectId = seedProject(db, { agent: makeAgent() });
      const engine = createEngine();
      // Simulate running checkpoint via runCheckpoint, which adds to runningCheckpoints
      // We use the internal set directly since runCheckpoint is async and requires AI
      (engine as any).runningCheckpoints.add(projectId);
      expect(engine.shouldTrigger(projectId, 'task_complete')).toBe(false);
    });

    it('returns false when unarchived checkpoint session exists', () => {
      const projectId = seedProject(db, { agent: makeAgent() });
      sessionRepo.create({
        projectId, name: 'Ckpt', type: 'background', projectRole: 'checkpoint',
      } as any);
      const engine = createEngine();
      expect(engine.shouldTrigger(projectId, 'task_complete')).toBe(false);
    });

    it('returns true when only archived checkpoint sessions exist', () => {
      const projectId = seedProject(db, { agent: makeAgent() });
      const session = sessionRepo.create({
        projectId, name: 'Ckpt', type: 'background', projectRole: 'checkpoint',
      } as any);
      sessionRepo.update(session.id, { archivedAt: Date.now() });
      const engine = createEngine();
      expect(engine.shouldTrigger(projectId, 'task_complete')).toBe(true);
    });
  });

  // ========================================
  // parseCheckpointResult
  // ========================================

  describe('parseCheckpointResult()', () => {
    it('returns null when no CHECKPOINT_RESULT block exists', () => {
      const sessionId = uuidv4();
      const projectId = seedProject(db, { agent: makeAgent() });
      db.prepare(
        `INSERT INTO sessions (id, project_id, name, created_at, updated_at) VALUES (?, ?, 'test', ?, ?)`,
      ).run(sessionId, projectId, Date.now(), Date.now());
      db.prepare(
        `INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, 'assistant', 'no result here', ?)`,
      ).run(uuidv4(), sessionId, Date.now());

      const engine = createEngine();
      expect(engine.parseCheckpointResult(sessionId)).toBeNull();
    });

    it('parses project_summary_update', () => {
      const sessionId = uuidv4();
      const projectId = seedProject(db, { agent: makeAgent() });
      db.prepare(
        `INSERT INTO sessions (id, project_id, name, created_at, updated_at) VALUES (?, ?, 'test', ?, ?)`,
      ).run(sessionId, projectId, Date.now(), Date.now());

      const content = `Some preamble
[CHECKPOINT_RESULT]
project_summary_update: |
  Updated project summary with new info
  about recent changes.
[/CHECKPOINT_RESULT]
After text`;

      db.prepare(
        `INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)`,
      ).run(uuidv4(), sessionId, content, Date.now());

      const engine = createEngine();
      const result = engine.parseCheckpointResult(sessionId);
      expect(result).not.toBeNull();
      expect(result!.projectSummaryUpdate).toContain('Updated project summary');
    });

    it('parses discovered_tasks', () => {
      const sessionId = uuidv4();
      const projectId = seedProject(db, { agent: makeAgent() });
      db.prepare(
        `INSERT INTO sessions (id, project_id, name, created_at, updated_at) VALUES (?, ?, 'test', ?, ?)`,
      ).run(sessionId, projectId, Date.now(), Date.now());

      const content = `[CHECKPOINT_RESULT]
discovered_tasks:
  - title: Add caching layer
    description: Implement Redis caching for API responses
  - title: Fix memory leak
    description: Address the memory leak in WebSocket handler
[/CHECKPOINT_RESULT]`;

      db.prepare(
        `INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)`,
      ).run(uuidv4(), sessionId, content, Date.now());

      const engine = createEngine();
      const result = engine.parseCheckpointResult(sessionId);
      expect(result).not.toBeNull();
      expect(result!.discoveredTasks).toBeDefined();
      expect(result!.discoveredTasks!.length).toBeGreaterThanOrEqual(1);
      expect(result!.discoveredTasks![0].title).toBe('Add caching layer');
    });

    it('returns empty result for empty block', () => {
      const sessionId = uuidv4();
      const projectId = seedProject(db, { agent: makeAgent() });
      db.prepare(
        `INSERT INTO sessions (id, project_id, name, created_at, updated_at) VALUES (?, ?, 'test', ?, ?)`,
      ).run(sessionId, projectId, Date.now(), Date.now());

      const content = `[CHECKPOINT_RESULT]
[/CHECKPOINT_RESULT]`;

      db.prepare(
        `INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)`,
      ).run(uuidv4(), sessionId, content, Date.now());

      const engine = createEngine();
      const result = engine.parseCheckpointResult(sessionId);
      expect(result).not.toBeNull();
      expect(result!.projectSummaryUpdate).toBeUndefined();
      expect(result!.knowledgeUpdates).toBeUndefined();
      expect(result!.discoveredTasks).toBeUndefined();
    });
  });

  // ========================================
  // runCheckpoint
  // ========================================

  describe('runCheckpoint()', () => {
    it('creates a checkpoint session and triggers a run', async () => {
      const projectId = seedProject(db, { agent: makeAgent(), rootPath: '/tmp/proj' });
      const engine = createEngine();

      await engine.runCheckpoint(projectId);

      expect(createVirtualClientFn).toHaveBeenCalled();
      expect(handleRunStartFn).toHaveBeenCalled();

      const startArgs = handleRunStartFn.mock.calls[0][1];
      expect(startArgs.type).toBe('run_start');
      expect(startArgs.input).toContain('[PROJECT CHECKPOINT]');
      expect(startArgs.workingDirectory).toBe('/tmp/proj');

      expect(logFn).toHaveBeenCalledWith(
        projectId, 'checkpoint_started', expect.any(Object),
      );
    });

    it('does nothing when project has no rootPath', async () => {
      const projectId = seedProject(db, { agent: makeAgent(), rootPath: undefined });
      // Override the project to have no rootPath
      db.prepare('UPDATE projects SET root_path = NULL WHERE id = ?').run(projectId);

      const engine = createEngine();
      await engine.runCheckpoint(projectId);

      expect(handleRunStartFn).not.toHaveBeenCalled();
    });

    it('handles errors gracefully', async () => {
      const projectId = seedProject(db, { agent: makeAgent(), rootPath: '/tmp/proj' });
      createVirtualClientFn.mockImplementation(() => { throw new Error('mock error'); });

      const engine = createEngine();
      await engine.runCheckpoint(projectId);

      expect(logFn).toHaveBeenCalledWith(
        projectId, 'checkpoint_completed',
        expect.objectContaining({ error: 'mock error' }),
      );
      expect((engine as any).runningCheckpoints.has(projectId)).toBe(false);
    });
  });

  // ========================================
  // handleCheckpointRunMessage (via runCheckpoint callback)
  // ========================================

  describe('checkpoint run message handling', () => {
    it('applies results and archives session on run_completed', async () => {
      const projectId = seedProject(db, {
        agent: makeAgent({ config: { maxConcurrentTasks: 1, trustLevel: 'low', autoDiscoverTasks: true } }),
        rootPath: '/tmp/proj',
      });

      let capturedCallback: ((msg: ServerMessage) => void) | undefined;
      createVirtualClientFn.mockImplementation((_id: string, opts: any) => {
        capturedCallback = opts.send;
        return { id: _id };
      });

      const engine = createEngine();
      await engine.runCheckpoint(projectId);

      expect(capturedCallback).toBeDefined();

      // Insert a checkpoint result message for the created session
      const sessions = sessionRepo.findByProjectRole(projectId, 'checkpoint');
      expect(sessions.length).toBeGreaterThan(0);
      const sessionId = sessions[0].id;

      const resultContent = `[CHECKPOINT_RESULT]
project_summary_update: |
  Updated summary after checkpoint
discovered_tasks:
  - title: New discovered task
    description: Found during checkpoint
[/CHECKPOINT_RESULT]`;

      db.prepare(
        `INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)`,
      ).run(uuidv4(), sessionId, resultContent, Date.now());

      // Simulate run_completed
      capturedCallback!({ type: 'run_completed' } as ServerMessage);

      // Should have applied the project summary
      expect(mockContextManager.updateProjectSummary).toHaveBeenCalledWith(
        expect.stringContaining('Updated summary'),
      );

      // Should have created discovered task (autoDiscoverTasks=true)
      expect(createTaskFn).toHaveBeenCalledWith(
        projectId,
        expect.objectContaining({
          title: 'New discovered task',
          source: 'agent_discovered',
        }),
      );

      // Should have archived the session
      const updatedSession = sessionRepo.findById(sessionId);
      expect(updatedSession?.archivedAt).toBeDefined();

      // Should have broadcast
      expect(broadcastFn).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'supervision_checkpoint' }),
      );

      // runningCheckpoints should be cleared
      expect((engine as any).runningCheckpoints.has(projectId)).toBe(false);
    });

    it('cleans up on run_failed', async () => {
      const projectId = seedProject(db, { agent: makeAgent(), rootPath: '/tmp/proj' });

      let capturedCallback: ((msg: ServerMessage) => void) | undefined;
      createVirtualClientFn.mockImplementation((_id: string, opts: any) => {
        capturedCallback = opts.send;
        return { id: _id };
      });

      const engine = createEngine();
      await engine.runCheckpoint(projectId);

      const sessions = sessionRepo.findByProjectRole(projectId, 'checkpoint');
      const sessionId = sessions[0].id;

      capturedCallback!({ type: 'run_failed' } as ServerMessage);

      expect((engine as any).runningCheckpoints.has(projectId)).toBe(false);

      const updatedSession = sessionRepo.findById(sessionId);
      expect(updatedSession?.archivedAt).toBeDefined();

      expect(logFn).toHaveBeenCalledWith(
        projectId, 'checkpoint_completed',
        expect.objectContaining({ error: 'run_failed' }),
      );
    });

    it('does not create tasks when autoDiscoverTasks is false', async () => {
      const projectId = seedProject(db, {
        agent: makeAgent({ config: { maxConcurrentTasks: 1, trustLevel: 'low', autoDiscoverTasks: false } }),
        rootPath: '/tmp/proj',
      });

      let capturedCallback: ((msg: ServerMessage) => void) | undefined;
      createVirtualClientFn.mockImplementation((_id: string, opts: any) => {
        capturedCallback = opts.send;
        return { id: _id };
      });

      const engine = createEngine();
      await engine.runCheckpoint(projectId);

      const sessions = sessionRepo.findByProjectRole(projectId, 'checkpoint');
      const sessionId = sessions[0].id;

      const content = `[CHECKPOINT_RESULT]
discovered_tasks:
  - title: Should not be created
    description: Because auto discover is off
[/CHECKPOINT_RESULT]`;

      db.prepare(
        `INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)`,
      ).run(uuidv4(), sessionId, content, Date.now());

      capturedCallback!({ type: 'run_completed' } as ServerMessage);

      expect(createTaskFn).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // Interval management
  // ========================================

  describe('interval management', () => {
    it('startInterval creates a timer and stopInterval clears it', () => {
      const engine = createEngine();
      const projectId = 'proj-1';

      engine.startInterval(projectId, 60);
      expect((engine as any).intervalTimers.has(projectId)).toBe(true);

      engine.stopInterval(projectId);
      expect((engine as any).intervalTimers.has(projectId)).toBe(false);
    });

    it('startInterval replaces existing timer', () => {
      const engine = createEngine();
      const projectId = 'proj-1';

      engine.startInterval(projectId, 60);
      const timer1 = (engine as any).intervalTimers.get(projectId);

      engine.startInterval(projectId, 30);
      const timer2 = (engine as any).intervalTimers.get(projectId);

      expect(timer1).not.toBe(timer2);

      engine.stopInterval(projectId);
    });

    it('stop() clears all timers and running checkpoints', () => {
      const engine = createEngine();

      engine.startInterval('p1', 60);
      engine.startInterval('p2', 30);
      (engine as any).runningCheckpoints.add('p1');

      engine.stop();

      expect((engine as any).intervalTimers.size).toBe(0);
      expect((engine as any).runningCheckpoints.size).toBe(0);
    });
  });
});
