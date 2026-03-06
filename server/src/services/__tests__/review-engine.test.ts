import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

// Hoist mocks so they are available before module imports
const { mockActiveRuns, mockCreateVirtualClient, mockHandleRunStart } = vi.hoisted(() => ({
  mockActiveRuns: new Map(),
  mockCreateVirtualClient: vi.fn((clientId: string, opts: any) => ({
    id: clientId,
    ws: { send: vi.fn() },
    isAlive: true,
    isLocal: true,
    authenticated: true,
    ...opts,
  })),
  mockHandleRunStart: vi.fn(),
}));

vi.mock('../../server.js', () => ({
  createVirtualClient: mockCreateVirtualClient,
  handleRunStart: mockHandleRunStart,
  activeRuns: mockActiveRuns,
  sendMessage: vi.fn(),
}));

const mockWriteReviewResult = vi.fn();

vi.mock('../context-manager.js', () => {
  class MockContextManager {
    isInitialized = vi.fn().mockReturnValue(false);
    scaffold = vi.fn();
    loadAll = vi.fn().mockReturnValue({
      documents: [],
      workflow: {
        onTaskComplete: [],
        onCheckpoint: [],
        checkpointTrigger: { type: 'on_task_complete' },
      },
    });
    getContextForTask = vi.fn().mockReturnValue('');
    getWorkflow = vi.fn().mockReturnValue({
      onTaskComplete: [],
      onCheckpoint: [],
      checkpointTrigger: { type: 'on_task_complete' },
    });
    writeTaskResult = vi.fn();
    writeReviewResult = mockWriteReviewResult;
    constructor(_rootPath: string) {}
  }
  return { ContextManager: MockContextManager };
});

import { ReviewEngine } from '../review-engine.js';
import { SupervisionTaskRepository } from '../../repositories/supervision-task.js';
import { ProjectRepository } from '../../repositories/project.js';
import { SessionRepository } from '../../repositories/session.js';
import { ContextManager } from '../context-manager.js';
import type { ProjectAgent, SupervisionTask, TaskResult, ReviewVerdict, MergeResult } from '@my-claudia/shared';

// ========================================
// Test DB setup
// ========================================

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
      source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'agent_discovered')),
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
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
    );

    CREATE INDEX idx_supervision_tasks_project ON supervision_tasks(project_id);
    CREATE INDEX idx_supervision_tasks_status ON supervision_tasks(status);
    CREATE INDEX idx_supervision_tasks_session ON supervision_tasks(session_id);

    CREATE TABLE supervision_v2_logs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT,
      event TEXT NOT NULL,
      detail TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX idx_sv2_logs_project ON supervision_v2_logs(project_id);
    CREATE INDEX idx_sv2_logs_task ON supervision_v2_logs(task_id);
  `);

  return db;
}

// ========================================
// Seed helpers
// ========================================

function makeAgent(overrides: Partial<ProjectAgent> = {}): ProjectAgent {
  return {
    type: 'supervisor',
    phase: 'active',
    config: {
      maxConcurrentTasks: 1,
      trustLevel: 'low',
      autoDiscoverTasks: false,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function seedProject(
  db: Database.Database,
  opts: { name?: string; rootPath?: string; agent?: ProjectAgent } = {},
): string {
  const id = uuidv4();
  const now = Date.now();
  db.prepare(
    `INSERT INTO projects (id, name, type, root_path, agent, created_at, updated_at)
     VALUES (?, ?, 'code', ?, ?, ?, ?)`,
  ).run(
    id,
    opts.name ?? 'Test Project',
    opts.rootPath ?? '/tmp/test-project',
    opts.agent ? JSON.stringify(opts.agent) : null,
    now,
    now,
  );
  return id;
}

function seedTask(
  db: Database.Database,
  taskRepo: SupervisionTaskRepository,
  opts: {
    projectId: string;
    title?: string;
    description?: string;
    status?: string;
    attempt?: number;
    maxRetries?: number;
    acceptanceCriteria?: string[];
    result?: TaskResult;
    baseCommit?: string;
  },
): SupervisionTask {
  const task = taskRepo.create({
    projectId: opts.projectId,
    title: opts.title ?? 'Test Task',
    description: opts.description ?? 'Test task description',
    source: 'user',
    status: (opts.status ?? 'reviewing') as any,
    maxRetries: opts.maxRetries ?? 2,
    acceptanceCriteria: opts.acceptanceCriteria,
  });

  // Apply extra updates that create() doesn't handle directly
  if (opts.attempt !== undefined || opts.result !== undefined || opts.baseCommit !== undefined) {
    taskRepo.updateStatus(task.id, (opts.status ?? 'reviewing') as any, {
      attempt: opts.attempt,
      result: opts.result,
      baseCommit: opts.baseCommit,
    });
  }

  return taskRepo.findById(task.id)!;
}

function insertMessage(
  db: Database.Database,
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
): void {
  const id = uuidv4();
  const now = Date.now();
  db.prepare(
    `INSERT INTO messages (id, session_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, sessionId, role, content, now);
}

// ========================================
// Tests
// ========================================

describe('ReviewEngine', () => {
  let db: Database.Database;
  let taskRepo: SupervisionTaskRepository;
  let projectRepo: ProjectRepository;
  let sessionRepo: SessionRepository;
  let engine: ReviewEngine;
  let broadcastFn: ReturnType<typeof vi.fn>;
  let logFn: ReturnType<typeof vi.fn>;
  let collectGitEvidenceFn: ReturnType<typeof vi.fn>;
  let contextManagers: Map<string, ContextManager>;

  beforeAll(() => {
    db = createTestDb();
    taskRepo = new SupervisionTaskRepository(db);
    projectRepo = new ProjectRepository(db);
    sessionRepo = new SessionRepository(db);
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(() => {
    db.exec('DELETE FROM supervision_v2_logs');
    db.exec('DELETE FROM supervision_tasks');
    db.exec('DELETE FROM messages');
    db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM projects');

    broadcastFn = vi.fn();
    logFn = vi.fn();
    collectGitEvidenceFn = vi.fn().mockResolvedValue('diff --git a/file.ts\n+new line');
    contextManagers = new Map();
    mockWriteReviewResult.mockClear();
    mockCreateVirtualClient.mockClear();
    mockHandleRunStart.mockClear();
    mockActiveRuns.clear();

    engine = new ReviewEngine(
      db,
      taskRepo,
      projectRepo,
      sessionRepo,
      (projectId: string) => {
        if (!contextManagers.has(projectId)) {
          contextManagers.set(projectId, new ContextManager('/tmp/test-project'));
        }
        return contextManagers.get(projectId)!;
      },
      broadcastFn,
      logFn,
      collectGitEvidenceFn,
    );
  });

  // ========================================
  // parseVerdict
  // ========================================

  describe('parseVerdict()', () => {
    it('parses a valid approved verdict', () => {
      const projectId = seedProject(db);
      const session = sessionRepo.create({
        projectId,
        name: 'Review session',
        type: 'background',
      } as any);

      insertMessage(db, session.id, 'assistant', `
Here is my review.

[REVIEW_VERDICT]
approved: true
notes: |
  All acceptance criteria met. Code looks good.
[/REVIEW_VERDICT]
      `);

      const verdict = engine.parseVerdict(session.id);

      expect(verdict).not.toBeNull();
      expect(verdict!.approved).toBe(true);
      expect(verdict!.notes).toBe('All acceptance criteria met. Code looks good.');
      expect(verdict!.suggestedChanges).toBeUndefined();
    });

    it('parses a valid rejected verdict with suggestions', () => {
      const projectId = seedProject(db);
      const session = sessionRepo.create({
        projectId,
        name: 'Review session',
        type: 'background',
      } as any);

      insertMessage(db, session.id, 'assistant', `
[REVIEW_VERDICT]
approved: false
notes: |
  The implementation is incomplete.
suggested_changes:
  - Add error handling for edge cases
  - Fix the return type of the function
[/REVIEW_VERDICT]
      `);

      const verdict = engine.parseVerdict(session.id);

      expect(verdict).not.toBeNull();
      expect(verdict!.approved).toBe(false);
      expect(verdict!.notes).toBe('The implementation is incomplete.');
      expect(verdict!.suggestedChanges).toEqual([
        'Add error handling for edge cases',
        'Fix the return type of the function',
      ]);
    });

    it('returns null when no [REVIEW_VERDICT] block is present', () => {
      const projectId = seedProject(db);
      const session = sessionRepo.create({
        projectId,
        name: 'Review session',
        type: 'background',
      } as any);

      insertMessage(db, session.id, 'assistant', 'Just some text without verdict block.');

      const verdict = engine.parseVerdict(session.id);

      expect(verdict).toBeNull();
    });

    it('defaults approved to false for malformed/empty block', () => {
      const projectId = seedProject(db);
      const session = sessionRepo.create({
        projectId,
        name: 'Review session',
        type: 'background',
      } as any);

      insertMessage(db, session.id, 'assistant', `
[REVIEW_VERDICT]
[/REVIEW_VERDICT]
      `);

      const verdict = engine.parseVerdict(session.id);

      expect(verdict).not.toBeNull();
      expect(verdict!.approved).toBe(false);
      expect(verdict!.notes).toBe('');
    });

    it('parses notes with pipe syntax (multiline)', () => {
      const projectId = seedProject(db);
      const session = sessionRepo.create({
        projectId,
        name: 'Review session',
        type: 'background',
      } as any);

      insertMessage(db, session.id, 'assistant', `
[REVIEW_VERDICT]
approved: true
notes: |
  Line 1 of the review.
  Line 2 of the review.
  Line 3 of the review.
[/REVIEW_VERDICT]
      `);

      const verdict = engine.parseVerdict(session.id);

      expect(verdict).not.toBeNull();
      expect(verdict!.approved).toBe(true);
      expect(verdict!.notes).toContain('Line 1 of the review.');
      expect(verdict!.notes).toContain('Line 2 of the review.');
      expect(verdict!.notes).toContain('Line 3 of the review.');
    });
  });

  // ========================================
  // buildReviewPrompt
  // ========================================

  describe('buildReviewPrompt()', () => {
    function makeTask(overrides: Partial<SupervisionTask> = {}): SupervisionTask {
      return {
        id: uuidv4(),
        projectId: uuidv4(),
        title: 'Fix login bug',
        description: 'The login form does not validate email',
        source: 'user',
        status: 'reviewing',
        priority: 0,
        dependencies: [],
        dependencyMode: 'all',
        acceptanceCriteria: [],
        maxRetries: 2,
        attempt: 1,
        createdAt: Date.now(),
        ...overrides,
      };
    }

    it('contains task title, description, and attempt', () => {
      const task = makeTask({ title: 'Fix login bug', description: 'Email validation missing', attempt: 2 });
      const prompt = engine.buildReviewPrompt(task, 'MyProject', '(no changes)');

      expect(prompt).toContain('Title: Fix login bug');
      expect(prompt).toContain('Description: Email validation missing');
      expect(prompt).toContain('Attempt: 2');
      expect(prompt).toContain('Project: MyProject');
    });

    it('contains acceptance criteria when present', () => {
      const task = makeTask({
        acceptanceCriteria: ['All tests pass', 'No lint errors'],
      });
      const prompt = engine.buildReviewPrompt(task, 'MyProject', '(no changes)');

      expect(prompt).toContain('== Acceptance Criteria ==');
      expect(prompt).toContain('- All tests pass');
      expect(prompt).toContain('- No lint errors');
    });

    it('contains self-reported summary when present', () => {
      const task = makeTask({
        result: {
          summary: 'Fixed the login validation by adding email regex check.',
          filesChanged: ['src/login.ts'],
        },
      });
      const prompt = engine.buildReviewPrompt(task, 'MyProject', '(no changes)');

      expect(prompt).toContain('== Task Self-Reported Summary ==');
      expect(prompt).toContain('Fixed the login validation by adding email regex check.');
    });

    it('contains workflow action results when present', () => {
      const task = makeTask({
        result: {
          summary: 'Done',
          filesChanged: [],
          workflowOutputs: [
            { action: 'run_tests', output: 'All 42 tests passed', success: true },
            { action: 'lint', output: 'No errors', success: true },
          ],
        },
      });
      const prompt = engine.buildReviewPrompt(task, 'MyProject', '(no changes)');

      expect(prompt).toContain('== Workflow Action Results ==');
      expect(prompt).toContain('Action: run_tests');
      expect(prompt).toContain('Success: true');
      expect(prompt).toContain('All 42 tests passed');
      expect(prompt).toContain('Action: lint');
    });

    it('contains evidence diff', () => {
      const evidence = 'diff --git a/src/login.ts b/src/login.ts\n+const emailRegex = /^[^@]+@[^@]+$/;';
      const task = makeTask();
      const prompt = engine.buildReviewPrompt(task, 'MyProject', evidence);

      expect(prompt).toContain('== Objective Evidence (Code Diff) ==');
      expect(prompt).toContain(evidence);
    });

    it('contains [REVIEW_VERDICT] instructions', () => {
      const task = makeTask();
      const prompt = engine.buildReviewPrompt(task, 'MyProject', '(no changes)');

      expect(prompt).toContain('[REVIEW_VERDICT]');
      expect(prompt).toContain('approved: true/false');
      expect(prompt).toContain('[/REVIEW_VERDICT]');
    });
  });

  // ========================================
  // handleReviewComplete (medium/high trust)
  // ========================================

  describe('handleReviewComplete (medium/high trust)', () => {
    function setupMediumTrustProject(): { projectId: string } {
      const projectId = seedProject(db, {
        agent: makeAgent({
          config: {
            maxConcurrentTasks: 1,
            trustLevel: 'medium',
            autoDiscoverTasks: false,
          },
        }),
      });
      return { projectId };
    }

    function setupHighTrustProject(): { projectId: string } {
      const projectId = seedProject(db, {
        agent: makeAgent({
          config: {
            maxConcurrentTasks: 1,
            trustLevel: 'high',
            autoDiscoverTasks: false,
          },
        }),
      });
      return { projectId };
    }

    it('approved verdict sets task status to integrated', () => {
      const { projectId } = setupMediumTrustProject();
      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
        result: { summary: 'Done', filesChanged: ['file.ts'] },
      });

      const reviewSessionId = uuidv4();
      const verdict: ReviewVerdict = { approved: true, notes: 'Looks great!' };

      engine.handleReviewComplete(task, verdict, reviewSessionId);

      const updated = taskRepo.findById(task.id)!;
      expect(updated.status).toBe('integrated');
      expect(updated.result!.reviewVerdict!.approved).toBe(true);
      expect(updated.result!.reviewSessionId).toBe(reviewSessionId);
      expect(broadcastFn).toHaveBeenCalledWith(task.id, task.projectId);
    });

    it('rejected verdict with retries remaining re-queues the task', () => {
      const { projectId } = setupHighTrustProject();
      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
        attempt: 1,
        maxRetries: 2,
        result: { summary: 'Done', filesChanged: [] },
      });

      const reviewSessionId = uuidv4();
      const verdict: ReviewVerdict = {
        approved: false,
        notes: 'Missing error handling',
        suggestedChanges: ['Add try/catch blocks'],
      };

      engine.handleReviewComplete(task, verdict, reviewSessionId);

      const updated = taskRepo.findById(task.id)!;
      expect(updated.status).toBe('queued');
      expect(updated.attempt).toBe(2);
      expect(updated.result!.reviewNotes).toBe('Missing error handling');
      expect(updated.result!.reviewVerdict!.approved).toBe(false);
      expect(broadcastFn).toHaveBeenCalledWith(task.id, task.projectId);
    });

    it('rejected verdict with max retries exceeded fails the task', () => {
      const { projectId } = setupMediumTrustProject();
      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
        attempt: 3,
        maxRetries: 2,
        result: { summary: 'Done', filesChanged: [] },
      });

      const reviewSessionId = uuidv4();
      const verdict: ReviewVerdict = {
        approved: false,
        notes: 'Still broken after multiple attempts',
      };

      engine.handleReviewComplete(task, verdict, reviewSessionId);

      const updated = taskRepo.findById(task.id)!;
      expect(updated.status).toBe('failed');
      expect(updated.result!.reviewVerdict!.approved).toBe(false);
      expect(broadcastFn).toHaveBeenCalledWith(task.id, task.projectId);
    });

    it('null verdict (parse failure) keeps task in reviewing', () => {
      const { projectId } = setupMediumTrustProject();
      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
        result: { summary: 'Done', filesChanged: [] },
      });

      const reviewSessionId = uuidv4();

      engine.handleReviewComplete(task, null, reviewSessionId);

      const updated = taskRepo.findById(task.id)!;
      expect(updated.status).toBe('reviewing');
      expect(updated.result!.reviewSessionId).toBe(reviewSessionId);
      expect(updated.result!.reviewVerdict).toBeUndefined();
      expect(broadcastFn).toHaveBeenCalledWith(task.id, task.projectId);
    });

    it('writes review result file via context manager', () => {
      const { projectId } = setupMediumTrustProject();
      const task = seedTask(db, taskRepo, {
        projectId,
        title: 'My Task',
        status: 'reviewing',
        result: { summary: 'Done', filesChanged: [] },
      });

      const reviewSessionId = uuidv4();
      const verdict: ReviewVerdict = { approved: true, notes: 'All good' };

      engine.handleReviewComplete(task, verdict, reviewSessionId);

      expect(mockWriteReviewResult).toHaveBeenCalledWith(
        task.id,
        expect.stringContaining('APPROVED'),
      );
      expect(mockWriteReviewResult).toHaveBeenCalledWith(
        task.id,
        expect.stringContaining('All good'),
      );
    });

    it('writes review result file with REJECTED for rejected verdict', () => {
      const { projectId } = setupHighTrustProject();
      const task = seedTask(db, taskRepo, {
        projectId,
        title: 'Rejected Task',
        status: 'reviewing',
        attempt: 3,
        maxRetries: 2,
        result: { summary: 'Done', filesChanged: [] },
      });

      const reviewSessionId = uuidv4();
      const verdict: ReviewVerdict = {
        approved: false,
        notes: 'Needs work',
        suggestedChanges: ['Fix tests'],
      };

      engine.handleReviewComplete(task, verdict, reviewSessionId);

      expect(mockWriteReviewResult).toHaveBeenCalledWith(
        task.id,
        expect.stringContaining('REJECTED'),
      );
      expect(mockWriteReviewResult).toHaveBeenCalledWith(
        task.id,
        expect.stringContaining('Fix tests'),
      );
    });

    it('writes fallback review result when verdict is null', () => {
      const { projectId } = setupMediumTrustProject();
      const task = seedTask(db, taskRepo, {
        projectId,
        title: 'Null Verdict Task',
        status: 'reviewing',
        result: { summary: 'Done', filesChanged: [] },
      });

      const reviewSessionId = uuidv4();

      engine.handleReviewComplete(task, null, reviewSessionId);

      expect(mockWriteReviewResult).toHaveBeenCalledWith(
        task.id,
        expect.stringContaining('No structured verdict found'),
      );
    });
  });

  // ========================================
  // handleReviewComplete (low trust)
  // ========================================

  describe('handleReviewComplete (low trust)', () => {
    function setupLowTrustProject(): { projectId: string } {
      const projectId = seedProject(db, {
        agent: makeAgent({
          config: {
            maxConcurrentTasks: 1,
            trustLevel: 'low',
            autoDiscoverTasks: false,
          },
        }),
      });
      return { projectId };
    }

    it('approved verdict keeps task in reviewing with verdict attached', () => {
      const { projectId } = setupLowTrustProject();
      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
        result: { summary: 'Done', filesChanged: [] },
      });

      const reviewSessionId = uuidv4();
      const verdict: ReviewVerdict = { approved: true, notes: 'Looks good' };

      engine.handleReviewComplete(task, verdict, reviewSessionId);

      const updated = taskRepo.findById(task.id)!;
      expect(updated.status).toBe('reviewing');
      expect(updated.result!.reviewVerdict!.approved).toBe(true);
      expect(updated.result!.reviewVerdict!.notes).toBe('Looks good');
      expect(updated.result!.reviewSessionId).toBe(reviewSessionId);
      expect(broadcastFn).toHaveBeenCalledWith(task.id, task.projectId);
    });

    it('rejected verdict keeps task in reviewing with verdict attached', () => {
      const { projectId } = setupLowTrustProject();
      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
        result: { summary: 'Done', filesChanged: [] },
      });

      const reviewSessionId = uuidv4();
      const verdict: ReviewVerdict = {
        approved: false,
        notes: 'Needs work',
        suggestedChanges: ['Fix the tests'],
      };

      engine.handleReviewComplete(task, verdict, reviewSessionId);

      const updated = taskRepo.findById(task.id)!;
      expect(updated.status).toBe('reviewing');
      expect(updated.result!.reviewVerdict!.approved).toBe(false);
      expect(updated.result!.reviewVerdict!.notes).toBe('Needs work');
      expect(updated.result!.reviewVerdict!.suggestedChanges).toEqual(['Fix the tests']);
      expect(updated.result!.reviewSessionId).toBe(reviewSessionId);
    });

    it('logs review_completed with autoApplied=false for low trust', () => {
      const { projectId } = setupLowTrustProject();
      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
        result: { summary: 'Done', filesChanged: [] },
      });

      const reviewSessionId = uuidv4();
      const verdict: ReviewVerdict = { approved: true, notes: 'Good' };

      engine.handleReviewComplete(task, verdict, reviewSessionId);

      expect(logFn).toHaveBeenCalledWith(
        task.projectId,
        'review_completed',
        expect.objectContaining({
          taskId: task.id,
          approved: true,
          trustLevel: 'low',
          autoApplied: false,
        }),
        task.id,
      );
    });
  });

  // ========================================
  // createReview
  // ========================================

  describe('createReview()', () => {
    it('creates session with projectRole=review', async () => {
      const projectId = seedProject(db, {
        agent: makeAgent(),
      });
      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
        baseCommit: 'abc123',
      });

      await engine.createReview(task);

      // Check the session was created
      const sessions = sessionRepo.findByProjectId(projectId);
      expect(sessions.length).toBe(1);
      expect(sessions[0].projectRole).toBe('review');
      expect(sessions[0].taskId).toBe(task.id);
      expect(sessions[0].type).toBe('background');
      expect(sessions[0].name).toContain('Review:');
    });

    it('creates virtual client with correct ID pattern', async () => {
      const projectId = seedProject(db, {
        agent: makeAgent(),
      });
      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
      });

      await engine.createReview(task);

      expect(mockCreateVirtualClient).toHaveBeenCalledWith(
        `supervisor_v2_review_${task.id}`,
        expect.objectContaining({
          send: expect.any(Function),
        }),
      );
    });

    it('calls handleRunStart with review prompt', async () => {
      const projectId = seedProject(db, {
        agent: makeAgent(),
      });
      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
        baseCommit: 'abc123',
      });

      await engine.createReview(task);

      expect(mockHandleRunStart).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'run_start',
          input: expect.stringContaining('[INDEPENDENT CODE REVIEW]'),
        }),
        expect.anything(),
      );
    });

    it('logs review_started', async () => {
      const projectId = seedProject(db, {
        agent: makeAgent(),
      });
      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
      });

      await engine.createReview(task);

      expect(logFn).toHaveBeenCalledWith(
        task.projectId,
        'review_started',
        expect.objectContaining({
          taskId: task.id,
          reviewSessionId: expect.any(String),
        }),
        task.id,
      );
    });

    it('does nothing when project has no rootPath', async () => {
      const id = uuidv4();
      const now = Date.now();
      db.prepare(
        `INSERT INTO projects (id, name, type, root_path, agent, created_at, updated_at)
         VALUES (?, ?, 'code', NULL, ?, ?, ?)`,
      ).run(id, 'No Root', JSON.stringify(makeAgent()), now, now);

      const task = seedTask(db, taskRepo, {
        projectId: id,
        status: 'reviewing',
      });

      await engine.createReview(task);

      expect(mockCreateVirtualClient).not.toHaveBeenCalled();
      expect(mockHandleRunStart).not.toHaveBeenCalled();
    });

    it('collects git evidence when baseCommit is present', async () => {
      const projectId = seedProject(db, {
        agent: makeAgent(),
        rootPath: '/tmp/my-project',
      });
      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
        baseCommit: 'abc123',
      });

      await engine.createReview(task);

      expect(collectGitEvidenceFn).toHaveBeenCalledWith('/tmp/my-project', 'abc123');
    });

    it('uses fallback evidence when baseCommit is not present', async () => {
      const projectId = seedProject(db, {
        agent: makeAgent(),
      });
      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
        // no baseCommit
      });

      await engine.createReview(task);

      expect(collectGitEvidenceFn).not.toHaveBeenCalled();

      // The review prompt should contain the fallback evidence text
      const runStartCall = mockHandleRunStart.mock.calls[0];
      expect(runStartCall[1].input).toContain('(no git evidence available)');
    });
  });

  // ========================================
  // archiveReviewSession
  // ========================================

  describe('archiveReviewSession()', () => {
    it('sets archivedAt on the session', () => {
      const projectId = seedProject(db);
      const session = sessionRepo.create({
        projectId,
        name: 'Review session',
        type: 'background',
      } as any);

      expect(session.archivedAt).toBeUndefined();

      engine.archiveReviewSession(session.id);

      const updated = sessionRepo.findById(session.id)!;
      expect(updated.archivedAt).toBeDefined();
      expect(updated.archivedAt).toBeGreaterThan(0);
    });

    it('does not throw on non-existent session', () => {
      // Should log error but not throw
      expect(() => engine.archiveReviewSession('nonexistent-id')).not.toThrow();
    });
  });

  // ========================================
  // Review session failure (run_failed via handleReviewComplete paths)
  // ========================================

  describe('handleReviewComplete archives the review session', () => {
    it('archives review session after approved verdict (medium trust)', () => {
      const projectId = seedProject(db, {
        agent: makeAgent({
          config: {
            maxConcurrentTasks: 1,
            trustLevel: 'medium',
            autoDiscoverTasks: false,
          },
        }),
      });
      const reviewSession = sessionRepo.create({
        projectId,
        name: 'Review session',
        type: 'background',
        projectRole: 'review',
      } as any);
      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
        result: { summary: 'Done', filesChanged: [] },
      });

      const verdict: ReviewVerdict = { approved: true, notes: 'OK' };
      engine.handleReviewComplete(task, verdict, reviewSession.id);

      const archived = sessionRepo.findById(reviewSession.id)!;
      expect(archived.archivedAt).toBeDefined();
      expect(archived.archivedAt).toBeGreaterThan(0);
    });

    it('archives review session after rejected verdict (high trust)', () => {
      const projectId = seedProject(db, {
        agent: makeAgent({
          config: {
            maxConcurrentTasks: 1,
            trustLevel: 'high',
            autoDiscoverTasks: false,
          },
        }),
      });
      const reviewSession = sessionRepo.create({
        projectId,
        name: 'Review session',
        type: 'background',
        projectRole: 'review',
      } as any);
      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
        attempt: 3,
        maxRetries: 2,
        result: { summary: 'Done', filesChanged: [] },
      });

      const verdict: ReviewVerdict = { approved: false, notes: 'No good' };
      engine.handleReviewComplete(task, verdict, reviewSession.id);

      const archived = sessionRepo.findById(reviewSession.id)!;
      expect(archived.archivedAt).toBeDefined();
    });

    it('archives review session after null verdict (low trust)', () => {
      const projectId = seedProject(db, {
        agent: makeAgent({
          config: {
            maxConcurrentTasks: 1,
            trustLevel: 'low',
            autoDiscoverTasks: false,
          },
        }),
      });
      const reviewSession = sessionRepo.create({
        projectId,
        name: 'Review session',
        type: 'background',
        projectRole: 'review',
      } as any);
      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
        result: { summary: 'Done', filesChanged: [] },
      });

      engine.handleReviewComplete(task, null, reviewSession.id);

      // Low trust always archives at the end
      const archived = sessionRepo.findById(reviewSession.id)!;
      expect(archived.archivedAt).toBeDefined();
    });
  });

  // ========================================
  // handleReviewRunMessage (run_failed path)
  // ========================================

  describe('handleReviewRunMessage (run_failed)', () => {
    it('run_failed keeps task in reviewing with error logged and session archived', async () => {
      const projectId = seedProject(db, {
        agent: makeAgent({
          config: {
            maxConcurrentTasks: 1,
            trustLevel: 'medium',
            autoDiscoverTasks: false,
          },
        }),
      });
      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
        result: { summary: 'Done', filesChanged: [] },
      });

      // Use createReview to set up the virtual client callback
      // We need to capture the send callback that createReview passes to createVirtualClient
      let capturedSendFn: ((msg: any) => void) | undefined;
      mockCreateVirtualClient.mockImplementationOnce((clientId: string, opts: any) => {
        capturedSendFn = opts.send;
        return {
          id: clientId,
          ws: { send: vi.fn() },
          isAlive: true,
          isLocal: true,
          authenticated: true,
          ...opts,
        };
      });

      await engine.createReview(task);

      // Get the review session that was created
      const sessions = sessionRepo.findByProjectId(projectId);
      const reviewSession = sessions.find((s) => s.projectRole === 'review')!;

      // Simulate a run_failed message
      expect(capturedSendFn).toBeDefined();
      capturedSendFn!({ type: 'run_failed', error: 'Provider timeout' });

      // Task should stay in reviewing
      const updated = taskRepo.findById(task.id)!;
      expect(updated.status).toBe('reviewing');
      expect(updated.result!.reviewSessionId).toBe(reviewSession.id);

      // Should have logged the failure
      expect(logFn).toHaveBeenCalledWith(
        projectId,
        'review_failed',
        expect.objectContaining({
          taskId: task.id,
          error: 'Provider timeout',
          reviewSessionId: reviewSession.id,
        }),
        task.id,
      );

      // Session should be archived
      const archivedSession = sessionRepo.findById(reviewSession.id)!;
      expect(archivedSession.archivedAt).toBeDefined();

      // Should have broadcast task update
      expect(broadcastFn).toHaveBeenCalledWith(task.id, projectId);
    });
  });

  // ========================================
  // Logging checks for medium/high trust
  // ========================================

  describe('logging for review outcomes', () => {
    it('logs autoApplied=true and retrying=true when re-queuing', () => {
      const projectId = seedProject(db, {
        agent: makeAgent({
          config: {
            maxConcurrentTasks: 1,
            trustLevel: 'medium',
            autoDiscoverTasks: false,
          },
        }),
      });
      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
        attempt: 1,
        maxRetries: 2,
        result: { summary: 'Done', filesChanged: [] },
      });

      const verdict: ReviewVerdict = { approved: false, notes: 'Try again' };
      engine.handleReviewComplete(task, verdict, uuidv4());

      expect(logFn).toHaveBeenCalledWith(
        task.projectId,
        'review_completed',
        expect.objectContaining({
          taskId: task.id,
          approved: false,
          trustLevel: 'medium',
          autoApplied: true,
          retrying: true,
          newAttempt: 2,
        }),
        task.id,
      );
    });

    it('logs maxRetriesExceeded=true when failing after retries', () => {
      const projectId = seedProject(db, {
        agent: makeAgent({
          config: {
            maxConcurrentTasks: 1,
            trustLevel: 'high',
            autoDiscoverTasks: false,
          },
        }),
      });
      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
        attempt: 3,
        maxRetries: 2,
        result: { summary: 'Done', filesChanged: [] },
      });

      const verdict: ReviewVerdict = { approved: false, notes: 'No good' };
      engine.handleReviewComplete(task, verdict, uuidv4());

      expect(logFn).toHaveBeenCalledWith(
        task.projectId,
        'review_completed',
        expect.objectContaining({
          taskId: task.id,
          approved: false,
          trustLevel: 'high',
          autoApplied: true,
          retrying: false,
          maxRetriesExceeded: true,
        }),
        task.id,
      );
    });

    it('logs verdictParsed=false when verdict is null (medium trust)', () => {
      const projectId = seedProject(db, {
        agent: makeAgent({
          config: {
            maxConcurrentTasks: 1,
            trustLevel: 'medium',
            autoDiscoverTasks: false,
          },
        }),
      });
      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
        result: { summary: 'Done', filesChanged: [] },
      });

      engine.handleReviewComplete(task, null, uuidv4());

      expect(logFn).toHaveBeenCalledWith(
        task.projectId,
        'review_completed',
        expect.objectContaining({
          taskId: task.id,
          verdictParsed: false,
          trustLevel: 'medium',
        }),
        task.id,
      );
    });
  });

  // ========================================
  // Phase 3: Worktree-aware createReview
  // ========================================

  describe('createReview() worktree-aware', () => {
    it('collects evidence from session.workingDirectory when different from rootPath', async () => {
      const projectId = seedProject(db, {
        agent: makeAgent(),
        rootPath: '/tmp/project-root',
      });

      // Create a task session with a worktree path
      const taskSession = sessionRepo.create({
        projectId,
        name: 'Task session',
        type: 'background',
        projectRole: 'task',
        workingDirectory: '/tmp/worktrees/supervision/slot-0',
      } as any);

      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
        baseCommit: 'abc123',
      });
      taskRepo.updateStatus(task.id, 'reviewing', { sessionId: taskSession.id });
      const updatedTask = taskRepo.findById(task.id)!;

      await engine.createReview(updatedTask);

      // Should collect evidence from worktree path, not project root
      expect(collectGitEvidenceFn).toHaveBeenCalledWith(
        '/tmp/worktrees/supervision/slot-0',
        'abc123',
      );
    });

    it('falls back to project rootPath when task has no session', async () => {
      const projectId = seedProject(db, {
        agent: makeAgent(),
        rootPath: '/tmp/project-root',
      });

      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
        baseCommit: 'def456',
      });

      await engine.createReview(task);

      // Should fall back to project root
      expect(collectGitEvidenceFn).toHaveBeenCalledWith('/tmp/project-root', 'def456');
    });
  });

  // ========================================
  // Phase 3: handleReviewComplete with merge
  // ========================================

  describe('handleReviewComplete with worktree merge (medium/high trust)', () => {
    function setupWithWorktreePool(trustLevel: 'medium' | 'high'): {
      projectId: string;
      mockPool: { mergeBack: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
      engineWithPool: ReviewEngine;
    } {
      const projectId = seedProject(db, {
        agent: makeAgent({
          config: {
            maxConcurrentTasks: 2,
            trustLevel,
            autoDiscoverTasks: false,
          },
        }),
        rootPath: '/tmp/project-root',
      });

      const mockPool = {
        mergeBack: vi.fn().mockResolvedValue({ success: true } as MergeResult),
        release: vi.fn(),
        init: vi.fn(),
        acquire: vi.fn(),
        destroy: vi.fn(),
        getStatus: vi.fn(),
        isInitialized: vi.fn().mockReturnValue(true),
      };

      const engineWithPool = new ReviewEngine(
        db,
        taskRepo,
        projectRepo,
        sessionRepo,
        (pid: string) => {
          if (!contextManagers.has(pid)) {
            contextManagers.set(pid, new ContextManager('/tmp/project-root'));
          }
          return contextManagers.get(pid)!;
        },
        broadcastFn,
        logFn,
        collectGitEvidenceFn,
        (_pid: string) => mockPool as any,
      );

      return { projectId, mockPool, engineWithPool };
    }

    it('auto-approved verdict merges and integrates worktree task', async () => {
      const { projectId, mockPool, engineWithPool } = setupWithWorktreePool('medium');

      const taskSession = sessionRepo.create({
        projectId,
        name: 'Task session',
        type: 'background',
        projectRole: 'task',
        workingDirectory: '/tmp/worktrees/supervision/slot-0',
      } as any);

      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
        result: { summary: 'Done', filesChanged: [] },
      });
      taskRepo.updateStatus(task.id, 'reviewing', { sessionId: taskSession.id });
      const updatedTask = taskRepo.findById(task.id)!;

      mockPool.mergeBack.mockResolvedValue({ success: true });

      const verdict: ReviewVerdict = { approved: true, notes: 'LGTM' };
      await engineWithPool.handleReviewComplete(updatedTask, verdict, uuidv4());

      const result = taskRepo.findById(task.id)!;
      expect(result.status).toBe('integrated');
      expect(mockPool.mergeBack).toHaveBeenCalledWith(
        task.id, 1, '/tmp/worktrees/supervision/slot-0',
      );
      expect(mockPool.release).toHaveBeenCalledWith('/tmp/worktrees/supervision/slot-0');
    });

    it('auto-approved verdict sets merge_conflict when merge fails', async () => {
      const { projectId, mockPool, engineWithPool } = setupWithWorktreePool('high');

      const taskSession = sessionRepo.create({
        projectId,
        name: 'Task session',
        type: 'background',
        projectRole: 'task',
        workingDirectory: '/tmp/worktrees/supervision/slot-1',
      } as any);

      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
        result: { summary: 'Done', filesChanged: [] },
      });
      taskRepo.updateStatus(task.id, 'reviewing', { sessionId: taskSession.id });
      const updatedTask = taskRepo.findById(task.id)!;

      mockPool.mergeBack.mockResolvedValue({
        success: false,
        conflicts: ['CONFLICT src/file.ts'],
      });

      const verdict: ReviewVerdict = { approved: true, notes: 'Looks fine' };
      await engineWithPool.handleReviewComplete(updatedTask, verdict, uuidv4());

      const result = taskRepo.findById(task.id)!;
      expect(result.status).toBe('merge_conflict');
      // Should NOT release worktree on conflict
      expect(mockPool.release).not.toHaveBeenCalled();
    });

    it('releases worktree on rejection before re-queue', async () => {
      const { projectId, mockPool, engineWithPool } = setupWithWorktreePool('medium');

      const taskSession = sessionRepo.create({
        projectId,
        name: 'Task session',
        type: 'background',
        projectRole: 'task',
        workingDirectory: '/tmp/worktrees/supervision/slot-0',
      } as any);

      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
        attempt: 1,
        maxRetries: 2,
        result: { summary: 'Done', filesChanged: [] },
      });
      taskRepo.updateStatus(task.id, 'reviewing', { sessionId: taskSession.id });
      const updatedTask = taskRepo.findById(task.id)!;

      const verdict: ReviewVerdict = { approved: false, notes: 'Needs work' };
      await engineWithPool.handleReviewComplete(updatedTask, verdict, uuidv4());

      const result = taskRepo.findById(task.id)!;
      expect(result.status).toBe('queued');
      expect(mockPool.release).toHaveBeenCalledWith('/tmp/worktrees/supervision/slot-0');
    });

    it('serial task (no worktree) still integrates directly on approve', async () => {
      const { projectId, mockPool, engineWithPool } = setupWithWorktreePool('medium');

      // Session with same workingDirectory as project root → serial mode
      const taskSession = sessionRepo.create({
        projectId,
        name: 'Task session',
        type: 'background',
        projectRole: 'task',
        workingDirectory: '/tmp/project-root', // same as rootPath
      } as any);

      const task = seedTask(db, taskRepo, {
        projectId,
        status: 'reviewing',
        result: { summary: 'Done', filesChanged: [] },
      });
      taskRepo.updateStatus(task.id, 'reviewing', { sessionId: taskSession.id });
      const updatedTask = taskRepo.findById(task.id)!;

      const verdict: ReviewVerdict = { approved: true, notes: 'OK' };
      await engineWithPool.handleReviewComplete(updatedTask, verdict, uuidv4());

      const result = taskRepo.findById(task.id)!;
      expect(result.status).toBe('integrated');
      // Should NOT call mergeBack for serial mode
      expect(mockPool.mergeBack).not.toHaveBeenCalled();
    });
  });
});
