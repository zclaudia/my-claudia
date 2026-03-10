import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { StateRecovery } from '../state-recovery.js';
import { SupervisionTaskRepository } from '../../repositories/supervision-task.js';
import { SessionRepository } from '../../repositories/session.js';
import { ProjectRepository } from '../../repositories/project.js';
import type { ProjectAgent } from '@my-claudia/shared';

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
      last_run_status TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN key (project_id) REFERENCES projects(id) on delete CASCADE
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
  opts: { agent?: ProjectAgent; rootPath?: string } = {},
): string {
  const id = uuidv4();
  const now = Date.now();
  db.prepare(
    `INSERT INTO projects (id, name, type, root_path, agent, created_at, updated_at)
     VALUES (?, ?, 'code', ?, ?, ?, ?)`,
  ).run(id, 'Test Project', opts.rootPath ?? '/tmp/test', opts.agent ? JSON.stringify(opts.agent) : null, now, now);
  return id;
}

describe('StateRecovery', () => {
  let db: Database.Database;
  let taskRepo: SupervisionTaskRepository;
  let sessionRepo: SessionRepository;
  let projectRepo: ProjectRepository;
  let activeRuns: Map<string, unknown>;
  let mockSupervisorService: any;

  beforeAll(() => {
    db = createTestDb();
    taskRepo = new SupervisionTaskRepository(db);
    sessionRepo = new SessionRepository(db);
    projectRepo = new ProjectRepository(db);
  });

  afterAll(() => db.close());

  beforeEach(() => {
    db.exec('DELETE FROM supervision_v2_logs');
    db.exec('DELETE FROM supervision_tasks');
    db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM projects');
    activeRuns = new Map();
    mockSupervisorService = {
      hasWorktreePool: vi.fn().mockReturnValue(false),
      getWorktreePoolIfExists: vi.fn().mockReturnValue(undefined),
    };
  });

  function createRecovery() {
    return new StateRecovery(db, taskRepo, sessionRepo, projectRepo, mockSupervisorService, activeRuns);
  }

  // ========================================
  // recoverStuckTasks
  // ========================================

  describe('stuck task recovery', () => {
    it('re-queues a stuck running task with retries remaining', () => {
      const projectId = seedProject(db, { agent: makeAgent() });
      const task = taskRepo.create({
        projectId, title: 'Stuck', description: 'd', source: 'user', status: 'running', maxRetries: 2,
      });

      const recovery = createRecovery();
      const report = recovery.recover();

      const updated = taskRepo.findById(task.id)!;
      expect(updated.status).toBe('queued');
      expect(updated.attempt).toBe(2);

      const requeued = report.actions.filter(a => a.type === 'task_requeued');
      expect(requeued).toHaveLength(1);
      expect(requeued[0].id).toBe(task.id);
    });

    it('fails a stuck running task when max retries exceeded', () => {
      const projectId = seedProject(db, { agent: makeAgent() });
      const task = taskRepo.create({
        projectId, title: 'Stuck exhausted', description: 'd', source: 'user', status: 'running', maxRetries: 0,
      });

      const recovery = createRecovery();
      const report = recovery.recover();

      const updated = taskRepo.findById(task.id)!;
      expect(updated.status).toBe('failed');
      expect(updated.completedAt).toBeDefined();

      const failed = report.actions.filter(a => a.type === 'task_failed');
      expect(failed).toHaveLength(1);
    });

    it('does not touch running tasks that have an active run', () => {
      const projectId = seedProject(db, { agent: makeAgent() });
      const task = taskRepo.create({
        projectId, title: 'Active', description: 'd', source: 'user', status: 'running',
      });

      activeRuns.set(`supervisor_v2_task_${task.id}`, { runId: 'r1' });

      const recovery = createRecovery();
      const report = recovery.recover();

      const updated = taskRepo.findById(task.id)!;
      expect(updated.status).toBe('running');
      expect(report.actions.filter(a => a.type === 'task_requeued' || a.type === 'task_failed')).toHaveLength(0);
    });

    it('skips projects without agents', () => {
      const projectId = seedProject(db);
      db.prepare(
        `INSERT INTO supervision_tasks (id, project_id, title, description, source, status, priority, attempt, created_at, updated_at)
         VALUES (?, ?, 'orphan', 'd', 'user', 'running', 0, 1, ?, ?)`,
      ).run(uuidv4(), projectId, Date.now(), Date.now());

      const recovery = createRecovery();
      const report = recovery.recover();

      expect(report.actions).toHaveLength(0);
    });
  });

  // ========================================
  // releaseOrphanedWorktrees
  // ========================================

  describe('orphaned worktree release', () => {
    it('releases worktree slots for tasks in terminal states', () => {
      const projectId = seedProject(db, { agent: makeAgent() });
      taskRepo.create({
        projectId, title: 'Done', description: 'd', source: 'user', status: 'integrated',
      });

      const mockPool = {
        getStatus: vi.fn().mockReturnValue({
          total: 2,
          available: 1,
          inUse: [{ path: '/wt/slot-0', inUse: true, taskId: taskRepo.findByProjectId(projectId)[0].id }],
        }),
        release: vi.fn(),
      };
      mockSupervisorService.hasWorktreePool.mockReturnValue(true);
      mockSupervisorService.getWorktreePoolIfExists.mockReturnValue(mockPool);

      const recovery = createRecovery();
      const report = recovery.recover();

      expect(mockPool.release).toHaveBeenCalledWith('/wt/slot-0');
      const released = report.actions.filter(a => a.type === 'worktree_released');
      expect(released).toHaveLength(1);
    });

    it('does not release worktree for running tasks', () => {
      const projectId = seedProject(db, { agent: makeAgent() });
      const task = taskRepo.create({
        projectId, title: 'Running', description: 'd', source: 'user', status: 'running',
      });
      activeRuns.set(`supervisor_v2_task_${task.id}`, {});

      const mockPool = {
        getStatus: vi.fn().mockReturnValue({
          total: 2,
          available: 1,
          inUse: [{ path: '/wt/slot-0', inUse: true, taskId: task.id }],
        }),
        release: vi.fn(),
      };
      mockSupervisorService.hasWorktreePool.mockReturnValue(true);
      mockSupervisorService.getWorktreePoolIfExists.mockReturnValue(mockPool);

      const recovery = createRecovery();
      recovery.recover();

      expect(mockPool.release).not.toHaveBeenCalled();
    });

    it('releases worktree when task has been deleted', () => {
      const projectId = seedProject(db, { agent: makeAgent() });

      const mockPool = {
        getStatus: vi.fn().mockReturnValue({
          total: 1,
          available: 0,
          inUse: [{ path: '/wt/slot-0', inUse: true, taskId: 'deleted-task-id' }],
        }),
        release: vi.fn(),
      };
      mockSupervisorService.hasWorktreePool.mockReturnValue(true);
      mockSupervisorService.getWorktreePoolIfExists.mockReturnValue(mockPool);

      const recovery = createRecovery();
      const report = recovery.recover();

      expect(mockPool.release).toHaveBeenCalledWith('/wt/slot-0');
      expect(report.actions.filter(a => a.type === 'worktree_released')).toHaveLength(1);
    });
  });

  // ========================================
  // archiveOrphanedSessions
  // ========================================

  describe('orphaned session archival', () => {
    it('archives unarchived checkpoint sessions', () => {
      const projectId = seedProject(db, { agent: makeAgent() });
      const session = sessionRepo.create({
        projectId, name: 'Checkpoint', type: 'background', projectRole: 'checkpoint',
      } as any);

      const recovery = createRecovery();
      const report = recovery.recover();

      const updated = sessionRepo.findById(session.id)!;
      expect(updated.archivedAt).toBeDefined();
      expect(report.actions.filter(a => a.type === 'session_archived')).toHaveLength(1);
    });

    it('archives unarchived review sessions for terminal tasks', () => {
      const projectId = seedProject(db, { agent: makeAgent() });
      const task = taskRepo.create({
        projectId, title: 'Done', description: 'd', source: 'user', status: 'integrated',
      });
      sessionRepo.create({
        projectId, name: 'Review', type: 'background', projectRole: 'review', taskId: task.id,
      } as any);

      const recovery = createRecovery();
      const report = recovery.recover();

      expect(report.actions.filter(a => a.type === 'session_archived')).toHaveLength(1);
    });

    it('does not archive review sessions for non-terminal tasks', () => {
      const projectId = seedProject(db, { agent: makeAgent() });
      const task = taskRepo.create({
        projectId, title: 'Active', description: 'd', source: 'user', status: 'reviewing',
      });
      const session = sessionRepo.create({
        projectId, name: 'Review', type: 'background', projectRole: 'review', taskId: task.id,
      } as any);

      const recovery = createRecovery();
      const report = recovery.recover();

      const updated = sessionRepo.findById(session.id)!;
      expect(updated.archivedAt).toBeUndefined();
      expect(report.actions.filter(a => a.type === 'session_archived')).toHaveLength(0);
    });

    it('does not archive already archived sessions', () => {
      const projectId = seedProject(db, { agent: makeAgent() });
      const session = sessionRepo.create({
        projectId, name: 'Old checkpoint', type: 'background', projectRole: 'checkpoint',
      } as any);
      sessionRepo.update(session.id, { archivedAt: Date.now() });

      const recovery = createRecovery();
      const report = recovery.recover();

      expect(report.actions.filter(a => a.type === 'session_archived')).toHaveLength(0);
    });
  });

  // ========================================
  // fixIdleAgents
  // ========================================

  describe('idle agent fix', () => {
    it('transitions active agent to idle when no active tasks exist', () => {
      const projectId = seedProject(db, { agent: makeAgent({ phase: 'active' }) });

      const recovery = createRecovery();
      const report = recovery.recover();

      const project = projectRepo.findById(projectId)!;
      expect(project.agent!.phase).toBe('idle');
      expect(report.actions.filter(a => a.type === 'agent_idle')).toHaveLength(1);
    });

    it('does not transition agent to idle when pending tasks exist', () => {
      const projectId = seedProject(db, { agent: makeAgent({ phase: 'active' }) });
      taskRepo.create({
        projectId, title: 'Pending', description: 'd', source: 'user', status: 'pending',
      });

      const recovery = createRecovery();
      const report = recovery.recover();

      const project = projectRepo.findById(projectId)!;
      expect(project.agent!.phase).toBe('active');
      expect(report.actions.filter(a => a.type === 'agent_idle')).toHaveLength(0);
    });

    it('does not transition paused agents', () => {
      const projectId = seedProject(db, { agent: makeAgent({ phase: 'paused' }) });

      const recovery = createRecovery();
      const report = recovery.recover();

      const project = projectRepo.findById(projectId)!;
      expect(project.agent!.phase).toBe('paused');
      expect(report.actions.filter(a => a.type === 'agent_idle')).toHaveLength(0);
    });

    it('does not transition idle agents', () => {
      const projectId = seedProject(db, { agent: makeAgent({ phase: 'idle' }) });

      const recovery = createRecovery();
      const report = recovery.recover();

      expect(report.actions.filter(a => a.type === 'agent_idle')).toHaveLength(0);
    });
  });

  // ========================================
  // Combined scenarios
  // ========================================

  describe('combined recovery', () => {
    it('handles multiple projects and issues simultaneously', () => {
      const proj1 = seedProject(db, { agent: makeAgent({ phase: 'active' }) });
      const proj2 = seedProject(db, { agent: makeAgent({ phase: 'active' }) });

      // proj1: stuck task + orphaned checkpoint
      taskRepo.create({ projectId: proj1, title: 'Stuck', description: 'd', source: 'user', status: 'running' });
      sessionRepo.create({ projectId: proj1, name: 'Ckpt', type: 'background', projectRole: 'checkpoint' } as any);

      // proj2: no active tasks → should idle
      taskRepo.create({ projectId: proj2, title: 'Done', description: 'd', source: 'user', status: 'integrated' });

      const recovery = createRecovery();
      const report = recovery.recover();

      expect(report.actions.length).toBeGreaterThanOrEqual(3);

      const proj2Data = projectRepo.findById(proj2)!;
      expect(proj2Data.agent!.phase).toBe('idle');
    });

    it('returns empty report when nothing to recover', () => {
      seedProject(db, { agent: makeAgent({ phase: 'idle' }) });

      const recovery = createRecovery();
      const report = recovery.recover();

      expect(report.actions).toHaveLength(0);
    });

    it('idempotent: calling recover twice produces same result', () => {
      const projectId = seedProject(db, { agent: makeAgent({ phase: 'active' }) });
      taskRepo.create({ projectId, title: 'Stuck', description: 'd', source: 'user', status: 'running' });

      const recovery = createRecovery();
      const report1 = recovery.recover();
      expect(report1.actions.length).toBeGreaterThan(0);

      const report2 = recovery.recover();
      expect(report2.actions).toHaveLength(0);
    });
  });
});
