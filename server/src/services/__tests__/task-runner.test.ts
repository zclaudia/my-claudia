import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

// Hoist mocks so they are available before module imports
const { mockExec, mockExecSync } = vi.hoisted(() => ({
  mockExec: vi.fn(),
  mockExecSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  exec: mockExec,
  execSync: mockExecSync,
}));

vi.mock('../../server.js', () => ({
  createVirtualClient: vi.fn(),
  handleRunStart: vi.fn(),
  activeRuns: new Map(),
  sendMessage: vi.fn(),
}));

import { TaskRunner } from '../task-runner.js';
import { SupervisionTaskRepository } from '../../repositories/supervision-task.js';
import { ProjectRepository } from '../../repositories/project.js';
import type { ContextManager, WorkflowAction } from '../context-manager.js';
import type { SupervisionTask, SupervisionV2LogEvent } from '@my-claudia/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function seedProject(db: Database.Database, rootPath = '/tmp/test-project'): string {
  const id = uuidv4();
  const now = Date.now();
  db.prepare(
    `INSERT INTO projects (id, name, type, root_path, created_at, updated_at)
     VALUES (?, ?, 'code', ?, ?, ?)`,
  ).run(id, 'Test Project', rootPath, now, now);
  return id;
}

function seedSession(db: Database.Database, projectId: string): string {
  const id = uuidv4();
  const now = Date.now();
  db.prepare(
    `INSERT INTO sessions (id, project_id, name, created_at, updated_at)
     VALUES (?, ?, 'test-session', ?, ?)`,
  ).run(id, projectId, now, now);
  return id;
}

function seedMessage(
  db: Database.Database,
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  createdAt?: number,
): string {
  const id = uuidv4();
  const ts = createdAt ?? Date.now();
  db.prepare(
    `INSERT INTO messages (id, session_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, sessionId, role, content, ts);
  return id;
}

/**
 * Helper to make mockExec behave like Node's callback-based exec,
 * so that promisify(exec) works correctly.
 */
function mockExecResolves(stdout: string, stderr = '') {
  mockExec.mockImplementation(
    (_cmd: string, _opts: unknown, callback?: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      if (typeof _opts === 'function') {
        // exec(cmd, callback) form
        (_opts as (err: Error | null, result: { stdout: string; stderr: string }) => void)(null, { stdout, stderr });
      } else if (callback) {
        callback(null, { stdout, stderr });
      }
    },
  );
}

function mockExecRejects(stdout = '', stderr = '', message = 'Command failed') {
  mockExec.mockImplementation(
    (_cmd: string, _opts: unknown, callback?: (err: Error & { stdout?: string; stderr?: string }, result?: null) => void) => {
      const err = Object.assign(new Error(message), { stdout, stderr });
      if (typeof _opts === 'function') {
        (_opts as (err: Error, result?: null) => void)(err);
      } else if (callback) {
        callback(err);
      }
    },
  );
}

/**
 * Create a sequence of exec responses, consumed in order.
 * Each entry can specify a command prefix match and either resolve/reject.
 */
function mockExecSequence(
  sequence: Array<{
    match?: string;
    stdout?: string;
    stderr?: string;
    reject?: boolean;
    message?: string;
  }>,
) {
  let idx = 0;
  mockExec.mockImplementation(
    (cmd: string, _opts: unknown, callback?: (...args: any[]) => void) => {
      const cb = typeof _opts === 'function' ? (_opts as (...args: any[]) => void) : callback;
      // Find first matching entry, or use next in order
      let entry = sequence.find((s, i) => i >= idx && s.match && cmd.includes(s.match));
      if (!entry && idx < sequence.length) {
        entry = sequence[idx];
      }
      idx++;

      if (!entry) {
        cb?.(null, { stdout: '', stderr: '' });
        return;
      }

      if (entry.reject) {
        const err = Object.assign(new Error(entry.message ?? 'Command failed'), {
          stdout: entry.stdout ?? '',
          stderr: entry.stderr ?? '',
        });
        cb?.(err);
      } else {
        cb?.(null, { stdout: entry.stdout ?? '', stderr: entry.stderr ?? '' });
      }
    },
  );
}

function makeContextManager(overrides: Partial<ContextManager> = {}): ContextManager {
  return {
    isInitialized: vi.fn().mockReturnValue(true),
    scaffold: vi.fn(),
    loadAll: vi.fn().mockReturnValue({
      documents: [],
      workflow: { onTaskComplete: [], onCheckpoint: [], checkpointTrigger: { type: 'on_task_complete' } },
    }),
    getContextForTask: vi.fn().mockReturnValue(''),
    getWorkflow: vi.fn().mockReturnValue({
      onTaskComplete: [],
      onCheckpoint: [],
      checkpointTrigger: { type: 'on_task_complete' },
    }),
    writeTaskResult: vi.fn(),
    writeReviewResult: vi.fn(),
    ...overrides,
  } as unknown as ContextManager;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaskRunner', () => {
  let db: Database.Database;
  let taskRepo: SupervisionTaskRepository;
  let projectRepo: ProjectRepository;
  let broadcastFn: ReturnType<typeof vi.fn>;
  let logFn: ReturnType<typeof vi.fn>;
  let onReadyForReview: ReturnType<typeof vi.fn>;
  let contextManager: ContextManager;
  let runner: TaskRunner;

  beforeAll(() => {
    db = createTestDb();
    taskRepo = new SupervisionTaskRepository(db);
    projectRepo = new ProjectRepository(db);
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

    mockExec.mockReset();
    mockExecSync.mockReset();

    broadcastFn = vi.fn();
    logFn = vi.fn();
    onReadyForReview = vi.fn().mockResolvedValue(undefined);
    contextManager = makeContextManager();

    runner = new TaskRunner(
      db,
      taskRepo,
      projectRepo,
      (_projectId: string) => contextManager,
      broadcastFn,
      logFn,
      onReadyForReview,
    );
  });

  // ========================================
  // parseTaskResult
  // ========================================

  describe('parseTaskResult()', () => {
    it('returns parsed TaskResult from valid [TASK_RESULT] block', () => {
      const projectId = seedProject(db);
      const sessionId = seedSession(db, projectId);
      seedMessage(db, sessionId, 'assistant', [
        'Here is the result:',
        '[TASK_RESULT]',
        '- summary: Implemented the login feature',
        '- files_changed: src/auth.ts, src/login.tsx',
        '[/TASK_RESULT]',
      ].join('\n'));

      const result = runner.parseTaskResult(sessionId);

      expect(result).not.toBeNull();
      expect(result!.summary).toBe('Implemented the login feature');
      expect(result!.filesChanged).toEqual(['src/auth.ts', 'src/login.tsx']);
      expect(result!.workflowOutputs).toBeUndefined();
    });

    it('returns null when no [TASK_RESULT] block is present', () => {
      const projectId = seedProject(db);
      const sessionId = seedSession(db, projectId);
      seedMessage(db, sessionId, 'assistant', 'I completed the work successfully.');

      const result = runner.parseTaskResult(sessionId);

      expect(result).toBeNull();
    });

    it('finds result in an earlier message when multiple messages exist', () => {
      const projectId = seedProject(db);
      const sessionId = seedSession(db, projectId);
      const now = Date.now();

      // Earlier message with the TASK_RESULT
      seedMessage(
        db,
        sessionId,
        'assistant',
        [
          '[TASK_RESULT]',
          '- summary: Fixed the parser bug',
          '- files_changed: src/parser.ts',
          '[/TASK_RESULT]',
        ].join('\n'),
        now - 2000,
      );

      // Later message without TASK_RESULT
      seedMessage(db, sessionId, 'assistant', 'Done with everything.', now);

      const result = runner.parseTaskResult(sessionId);

      expect(result).not.toBeNull();
      expect(result!.summary).toBe('Fixed the parser bug');
      expect(result!.filesChanged).toEqual(['src/parser.ts']);
    });

    it('populates workflowOutputs when tests field is present', () => {
      const projectId = seedProject(db);
      const sessionId = seedSession(db, projectId);
      seedMessage(db, sessionId, 'assistant', [
        '[TASK_RESULT]',
        '- summary: Added unit tests',
        '- files_changed: src/utils.test.ts',
        '- tests: All 12 tests passed',
        '[/TASK_RESULT]',
      ].join('\n'));

      const result = runner.parseTaskResult(sessionId);

      expect(result).not.toBeNull();
      expect(result!.workflowOutputs).toEqual([
        { action: 'tests', output: 'All 12 tests passed', success: true },
      ]);
    });
  });

  // ========================================
  // executeWorkflowActions
  // ========================================

  describe('executeWorkflowActions()', () => {
    it('captures output and returns success=true when command succeeds', async () => {
      mockExecResolves('build ok\n', '');

      const actions: WorkflowAction[] = [
        { type: 'run_command', command: 'npm run build', description: 'Build project' },
      ];

      const results = await runner.executeWorkflowActions(actions, '/tmp/project');

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('Build project');
      expect(results[0].output).toBe('build ok\n');
      expect(results[0].success).toBe(true);
    });

    it('captures stderr and returns success=false when command fails', async () => {
      mockExecRejects('', 'Error: compilation failed\n', 'exit code 1');

      const actions: WorkflowAction[] = [
        { type: 'run_command', command: 'npm run build' },
      ];

      const results = await runner.executeWorkflowActions(actions, '/tmp/project');

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('npm run build');
      expect(results[0].output).toContain('Error: compilation failed');
      expect(results[0].success).toBe(false);
    });

    it('skips non-run_command actions and returns empty results', async () => {
      const actions: WorkflowAction[] = [
        { type: 'notify', description: 'Send slack notification' },
        { type: 'review', prompt: 'Check the code' },
      ];

      const results = await runner.executeWorkflowActions(actions, '/tmp/project');

      expect(results).toHaveLength(0);
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('runs multiple actions in sequence', async () => {
      const callOrder: string[] = [];

      mockExec.mockImplementation(
        (cmd: string, _opts: unknown, callback?: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
          callOrder.push(cmd);
          const cb = typeof _opts === 'function' ? (_opts as (...args: any[]) => void) : callback;
          cb?.(null, { stdout: `output of ${cmd}`, stderr: '' });
        },
      );

      const actions: WorkflowAction[] = [
        { type: 'run_command', command: 'npm test', description: 'Run tests' },
        { type: 'run_command', command: 'npm run lint', description: 'Run linter' },
      ];

      const results = await runner.executeWorkflowActions(actions, '/tmp/project');

      expect(results).toHaveLength(2);
      expect(results[0].action).toBe('Run tests');
      expect(results[0].success).toBe(true);
      expect(results[1].action).toBe('Run linter');
      expect(results[1].success).toBe(true);
      expect(callOrder).toEqual(['npm test', 'npm run lint']);
    });
  });

  // ========================================
  // autoCommitRemainingChanges
  // ========================================

  describe('autoCommitRemainingChanges()', () => {
    it('calls git add + commit when there are uncommitted changes', async () => {
      const commands: string[] = [];

      mockExec.mockImplementation(
        (cmd: string, _opts: unknown, callback?: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
          commands.push(cmd);
          const cb = typeof _opts === 'function' ? (_opts as (...args: any[]) => void) : callback;
          if (cmd.includes('git status --porcelain')) {
            cb?.(null, { stdout: ' M file.ts\n', stderr: '' });
          } else {
            cb?.(null, { stdout: '', stderr: '' });
          }
        },
      );

      await runner.autoCommitRemainingChanges('/tmp/project', 'task-123');

      expect(commands).toContain('git status --porcelain');
      expect(commands).toContain('git add -A');
      const commitCmd = commands.find((c) => c.includes('git commit'));
      expect(commitCmd).toBeDefined();
      expect(commitCmd).toContain('task-123');
    });

    it('does not commit when porcelain output is empty', async () => {
      mockExecResolves('', '');

      await runner.autoCommitRemainingChanges('/tmp/project', 'task-456');

      // Only one call: git status --porcelain
      expect(mockExec).toHaveBeenCalledTimes(1);
    });

    it('does not throw when commit fails (non-fatal)', async () => {
      let callCount = 0;
      mockExec.mockImplementation(
        (cmd: string, _opts: unknown, callback?: (...args: any[]) => void) => {
          callCount++;
          const cb = typeof _opts === 'function' ? (_opts as (...args: any[]) => void) : callback;
          if (cmd.includes('git status --porcelain')) {
            cb?.(null, { stdout: ' M dirty.ts\n', stderr: '' });
          } else if (cmd.includes('git commit')) {
            const err = Object.assign(new Error('nothing to commit'), { stdout: '', stderr: 'nothing to commit' });
            cb?.(err);
          } else {
            cb?.(null, { stdout: '', stderr: '' });
          }
        },
      );

      // Should not throw
      await expect(
        runner.autoCommitRemainingChanges('/tmp/project', 'task-789'),
      ).resolves.toBeUndefined();
    });
  });

  // ========================================
  // collectGitEvidence
  // ========================================

  describe('collectGitEvidence()', () => {
    it('returns normal diff output', async () => {
      const diffOutput = 'diff --git a/file.ts b/file.ts\n+ new line\n';
      mockExecResolves(diffOutput, '');

      const result = await runner.collectGitEvidence('/tmp/project', 'abc123');

      expect(result).toBe(diffOutput);
    });

    it('truncates large diffs at 50KB', async () => {
      // Create a string that is exactly 60,000 characters
      const largeDiff = 'x'.repeat(60_000);
      mockExecResolves(largeDiff, '');

      const result = await runner.collectGitEvidence('/tmp/project', 'abc123');

      expect(result.length).toBeLessThanOrEqual(50_000 + 50); // 50KB + truncation message
      expect(result).toContain('[... diff truncated at 50KB ...]');
    });

    it('returns fallback string when git command fails', async () => {
      mockExecRejects('', '', 'git diff failed');

      const result = await runner.collectGitEvidence('/tmp/project', 'abc123');

      expect(result).toBe('(failed to collect git diff)');
    });
  });

  // ========================================
  // isGitProject
  // ========================================

  describe('isGitProject()', () => {
    it('returns true when execSync succeeds', () => {
      mockExecSync.mockReturnValue('true\n');

      const result = runner.isGitProject('/tmp/git-project');

      expect(result).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'git rev-parse --is-inside-work-tree',
        expect.objectContaining({ cwd: '/tmp/git-project' }),
      );
    });

    it('returns false when execSync throws', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not a git repo');
      });

      const result = runner.isGitProject('/tmp/not-git');

      expect(result).toBe(false);
    });
  });

  // ========================================
  // onTaskComplete (integration)
  // ========================================

  describe('onTaskComplete()', () => {
    it('full pipeline: parses result, updates status to reviewing, calls onReadyForReview', async () => {
      const projectId = seedProject(db, '/tmp/test-project');
      const sessionId = seedSession(db, projectId);
      seedMessage(db, sessionId, 'assistant', [
        '[TASK_RESULT]',
        '- summary: Built the feature',
        '- files_changed: src/feature.ts, src/feature.test.ts',
        '[/TASK_RESULT]',
      ].join('\n'));

      const task = taskRepo.create({
        projectId,
        title: 'Build feature',
        description: 'Build the new feature',
        source: 'user',
        status: 'running',
      });
      taskRepo.updateStatus(task.id, 'running', { sessionId });

      // Mock git: is a git project, no changes
      mockExecSync.mockReturnValue('true\n');
      mockExecResolves('', '');

      await runner.onTaskComplete(task.id, projectId);

      // Task should be in reviewing status
      const updated = taskRepo.findById(task.id)!;
      expect(updated.status).toBe('reviewing');
      expect(updated.result).toBeDefined();
      expect(updated.result!.summary).toBe('Built the feature');
      expect(updated.result!.filesChanged).toEqual(['src/feature.ts', 'src/feature.test.ts']);

      // broadcastTaskUpdate should have been called
      expect(broadcastFn).toHaveBeenCalledWith(task.id, projectId);

      // logFn should have been called with task_status_changed
      expect(logFn).toHaveBeenCalledWith(
        projectId,
        'task_status_changed',
        expect.objectContaining({ taskId: task.id, from: 'running', to: 'reviewing' }),
        task.id,
      );

      // onReadyForReview should have been called
      expect(onReadyForReview).toHaveBeenCalledTimes(1);
      expect(onReadyForReview).toHaveBeenCalledWith(
        expect.objectContaining({ id: task.id, status: 'reviewing' }),
      );

      // contextManager.writeTaskResult should have been called
      expect(contextManager.writeTaskResult).toHaveBeenCalledWith(
        task.id,
        expect.stringContaining('Built the feature'),
      );
    });

    it('runs workflow actions when configured', async () => {
      const cm = makeContextManager({
        getWorkflow: vi.fn().mockReturnValue({
          onTaskComplete: [
            { type: 'run_command', command: 'npm test', description: 'Run tests' },
          ],
          onCheckpoint: [],
          checkpointTrigger: { type: 'on_task_complete' },
        }),
      } as any);

      const localRunner = new TaskRunner(
        db,
        taskRepo,
        projectRepo,
        (_projectId: string) => cm,
        broadcastFn,
        logFn,
        onReadyForReview,
      );

      const projectId = seedProject(db, '/tmp/test-project');
      const sessionId = seedSession(db, projectId);
      seedMessage(db, sessionId, 'assistant', 'Done with the work.');

      const task = taskRepo.create({
        projectId,
        title: 'Workflow task',
        description: 'Task with workflow',
        source: 'user',
        status: 'running',
      });
      taskRepo.updateStatus(task.id, 'running', { sessionId });

      // isGitProject returns false so auto-commit is skipped
      mockExecSync.mockImplementation(() => {
        throw new Error('not git');
      });

      // Mock exec for the workflow command
      mockExecResolves('tests passed\n', '');

      await localRunner.onTaskComplete(task.id, projectId);

      const updated = taskRepo.findById(task.id)!;
      expect(updated.status).toBe('reviewing');
      expect(updated.result).toBeDefined();
      // No [TASK_RESULT] in messages, so falls back to default summary
      expect(updated.result!.summary).toBe('Completed (no structured result)');
      // Workflow outputs should be populated
      expect(updated.result!.workflowOutputs).toEqual([
        { action: 'Run tests', output: 'tests passed\n', success: true },
      ]);
    });

    it('returns early when task is not found', async () => {
      const projectId = seedProject(db, '/tmp/test-project');

      await runner.onTaskComplete('nonexistent-task-id', projectId);

      expect(broadcastFn).not.toHaveBeenCalled();
      expect(onReadyForReview).not.toHaveBeenCalled();
    });

    it('returns early when task status is not running', async () => {
      const projectId = seedProject(db, '/tmp/test-project');

      const task = taskRepo.create({
        projectId,
        title: 'Pending task',
        description: 'Not yet running',
        source: 'user',
        status: 'pending',
      });

      await runner.onTaskComplete(task.id, projectId);

      expect(broadcastFn).not.toHaveBeenCalled();
      expect(onReadyForReview).not.toHaveBeenCalled();

      // Task status should remain unchanged
      const updated = taskRepo.findById(task.id)!;
      expect(updated.status).toBe('pending');
    });

    it('uses session.workingDirectory when available (worktree mode)', async () => {
      const projectId = seedProject(db, '/tmp/project-root');

      // Create a session with a worktree path
      const worktreePath = '/tmp/worktrees/supervision/slot-0';
      const now = Date.now();
      const sessionId = uuidv4();
      db.prepare(
        `INSERT INTO sessions (id, project_id, name, working_directory, created_at, updated_at)
         VALUES (?, ?, 'task-session', ?, ?, ?)`,
      ).run(sessionId, projectId, worktreePath, now, now);

      seedMessage(db, sessionId, 'assistant', [
        '[TASK_RESULT]',
        '- summary: Did work in worktree',
        '- files_changed: src/a.ts',
        '[/TASK_RESULT]',
      ].join('\n'));

      const task = taskRepo.create({
        projectId,
        title: 'Worktree task',
        description: 'Task in worktree',
        source: 'user',
        status: 'running',
      });
      taskRepo.updateStatus(task.id, 'running', { sessionId });

      // isGitProject returns true, and auto-commit finds no changes
      mockExecSync.mockReturnValue('true\n');
      mockExecResolves('', '');

      await runner.onTaskComplete(task.id, projectId);

      // The exec calls for git operations should use the worktree path
      const execCalls = mockExec.mock.calls;
      const statusCall = execCalls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('git status --porcelain'),
      );
      if (statusCall) {
        // The cwd option should be the worktree path, not project root
        const opts = typeof statusCall[1] === 'object' ? statusCall[1] : {};
        expect((opts as any).cwd).toBe(worktreePath);
      }

      // Task should be in reviewing
      const updated = taskRepo.findById(task.id)!;
      expect(updated.status).toBe('reviewing');
    });

    it('falls back to project.rootPath when session has no workingDirectory', async () => {
      const projectId = seedProject(db, '/tmp/project-root');

      // Session without workingDirectory
      const sessionId = seedSession(db, projectId);

      seedMessage(db, sessionId, 'assistant', [
        '[TASK_RESULT]',
        '- summary: Done',
        '- files_changed: src/b.ts',
        '[/TASK_RESULT]',
      ].join('\n'));

      const task = taskRepo.create({
        projectId,
        title: 'Normal task',
        description: 'Task in project root',
        source: 'user',
        status: 'running',
      });
      taskRepo.updateStatus(task.id, 'running', { sessionId });

      mockExecSync.mockReturnValue('true\n');
      mockExecResolves('', '');

      await runner.onTaskComplete(task.id, projectId);

      // Git operations should use project root path
      const execCalls = mockExec.mock.calls;
      const statusCall = execCalls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('git status --porcelain'),
      );
      if (statusCall) {
        const opts = typeof statusCall[1] === 'object' ? statusCall[1] : {};
        expect((opts as any).cwd).toBe('/tmp/project-root');
      }

      const updated = taskRepo.findById(task.id)!;
      expect(updated.status).toBe('reviewing');
    });
  });

  // ========================================
  // formatTaskResult
  // ========================================

  describe('formatTaskResult()', () => {
    it('includes summary and files changed', () => {
      const task: SupervisionTask = {
        id: 'task-1',
        projectId: 'proj-1',
        title: 'My Task',
        description: 'A test task',
        source: 'user',
        status: 'reviewing',
        priority: 0,
        dependencies: [],
        dependencyMode: 'all',
        acceptanceCriteria: [],
        maxRetries: 2,
        attempt: 1,
        createdAt: Date.now(),
      };

      const result = runner.formatTaskResult(task, {
        summary: 'Implemented authentication',
        filesChanged: ['src/auth.ts', 'src/middleware.ts'],
      });

      expect(result).toContain('# Task Result: My Task');
      expect(result).toContain('## Summary');
      expect(result).toContain('Implemented authentication');
      expect(result).toContain('## Files Changed');
      expect(result).toContain('src/auth.ts');
      expect(result).toContain('src/middleware.ts');
    });

    it('includes workflow outputs when present', () => {
      const task: SupervisionTask = {
        id: 'task-2',
        projectId: 'proj-1',
        title: 'Tested Task',
        description: 'A tested task',
        source: 'user',
        status: 'reviewing',
        priority: 0,
        dependencies: [],
        dependencyMode: 'all',
        acceptanceCriteria: [],
        maxRetries: 2,
        attempt: 1,
        createdAt: Date.now(),
      };

      const result = runner.formatTaskResult(task, {
        summary: 'Added tests',
        filesChanged: ['src/utils.test.ts'],
        workflowOutputs: [
          { action: 'Run tests', output: '12 passed, 0 failed', success: true },
          { action: 'Run linter', output: 'Error: unused import', success: false },
        ],
      });

      expect(result).toContain('## Workflow Action Results');
      expect(result).toContain('### Run tests (PASSED)');
      expect(result).toContain('12 passed, 0 failed');
      expect(result).toContain('### Run linter (FAILED)');
      expect(result).toContain('Error: unused import');
    });

    it('omits files changed section when no files changed', () => {
      const task: SupervisionTask = {
        id: 'task-3',
        projectId: 'proj-1',
        title: 'No Files Task',
        description: 'No files changed',
        source: 'user',
        status: 'reviewing',
        priority: 0,
        dependencies: [],
        dependencyMode: 'all',
        acceptanceCriteria: [],
        maxRetries: 2,
        attempt: 1,
        createdAt: Date.now(),
      };

      const result = runner.formatTaskResult(task, {
        summary: 'Configuration only',
        filesChanged: [],
      });

      expect(result).toContain('## Summary');
      expect(result).toContain('Configuration only');
      expect(result).not.toContain('## Files Changed');
    });
  });
});
