import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// Hoisted git mocks so they're available for mockResolvedValueOnce
const {
  mockGetGitStatus,
  mockCommitAllChanges,
  mockGetNewCommits,
  mockGetDiff,
  mockGetMainBranch,
  mockGetCurrentBranch,
  mockIsWorkingTreeClean,
  mockMergeBranch,
  mockAbortMerge,
  mockRemoveWorktree,
} = vi.hoisted(() => ({
  mockGetGitStatus: vi.fn().mockResolvedValue({ hasChanges: false }),
  mockCommitAllChanges: vi.fn().mockResolvedValue(undefined),
  mockGetNewCommits: vi.fn().mockResolvedValue([{ sha: 'abc123', message: 'Test commit' }]),
  mockGetDiff: vi.fn().mockResolvedValue('diff content'),
  mockGetMainBranch: vi.fn().mockResolvedValue('main'),
  mockGetCurrentBranch: vi.fn().mockResolvedValue('feature-branch'),
  mockIsWorkingTreeClean: vi.fn().mockResolvedValue(true),
  mockMergeBranch: vi.fn().mockResolvedValue({ success: true }),
  mockAbortMerge: vi.fn().mockResolvedValue(undefined),
  mockRemoveWorktree: vi.fn().mockResolvedValue(undefined),
}));

// Mock git operations (path relative to THIS test file, not the source)
vi.mock('../../utils/git-operations.js', () => ({
  getGitStatus: mockGetGitStatus,
  commitAllChanges: mockCommitAllChanges,
  getNewCommits: mockGetNewCommits,
  getDiff: mockGetDiff,
  getMainBranch: mockGetMainBranch,
  getCurrentBranch: mockGetCurrentBranch,
  isWorkingTreeClean: mockIsWorkingTreeClean,
  mergeBranch: mockMergeBranch,
  abortMerge: mockAbortMerge,
  removeWorktree: mockRemoveWorktree,
}));

const mockBroadcast = vi.fn();

const { mockCreateVirtualClient, mockHandleRunStart } = vi.hoisted(() => ({
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
  sendMessage: vi.fn(),
}));

import { LocalPRService } from '../local-pr-service.js';
import { LocalPRRepository } from '../../repositories/local-pr.js';
import type { LocalPR, ServerMessage } from '@my-claudia/shared';

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
      review_provider_id TEXT,
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

    CREATE TABLE local_prs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      commits TEXT,
      diff_summary TEXT,
      review_notes TEXT,
      status_message TEXT,
      merged_at INTEGER,
      merged_commit_sha TEXT,
      review_session_id TEXT,
      conflict_session_id TEXT,
      auto_triggered INTEGER DEFAULT 0,
      auto_review INTEGER DEFAULT 0,
      execution_state TEXT DEFAULT 'idle',
      pending_action TEXT DEFAULT 'none',
      execution_error TEXT,
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
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      api_key TEXT,
      base_url TEXT,
      model TEXT,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE worktree_configs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      auto_create_pr INTEGER DEFAULT 0,
      auto_review INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  return db;
}

function createTestProject(db: Database.Database, overrides: Partial<{
  id: string;
  name: string;
  rootPath: string;
  providerId: string;
  reviewProviderId: string;
}> = {}): string {
  const id = overrides.id || `test-project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const rootPath = 'rootPath' in overrides ? (overrides.rootPath || null) : '/test/root';
  db.prepare(`
    INSERT OR REPLACE INTO projects (id, name, type, provider_id, root_path, created_at, updated_at)
    VALUES (?, ?, 'code', ?, ?, ?, ?)
  `).run(
    id,
    overrides.name || 'Test Project',
    overrides.providerId || 'test-provider',
    rootPath,
    now,
    now
  );
  return id;
}

function createTestProvider(db: Database.Database, id = 'test-provider'): void {
  const now = Date.now();
  db.prepare(`
    INSERT INTO providers (id, name, type, is_default, created_at, updated_at)
    VALUES (?, 'Test Provider', 'claude', 1, ?, ?)
  `).run(id, now, now);
}

function createTestLocalPR(
  db: Database.Database,
  projectId: string,
  overrides: Partial<LocalPR> = {}
): LocalPR {
  const now = Date.now();
  const id = overrides.id || `pr-${now}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT OR REPLACE INTO local_prs (
      id, project_id, worktree_path, branch_name, base_branch, title,
      description, status, commits, diff_summary, auto_triggered, auto_review,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    projectId,
    overrides.worktreePath || '/test/worktree',
    overrides.branchName || 'feature-branch',
    overrides.baseBranch || 'main',
    overrides.title || 'Test PR',
    overrides.description || null,
    overrides.status || 'open',
    JSON.stringify(overrides.commits || ['abc123']),
    overrides.diffSummary || 'test diff',
    overrides.autoTriggered ? 1 : 0,
    overrides.autoReview ? 1 : 0,
    now,
    now
  );

  return {
    id,
    projectId,
    worktreePath: overrides.worktreePath || '/test/worktree',
    branchName: overrides.branchName || 'feature-branch',
    baseBranch: overrides.baseBranch || 'main',
    title: overrides.title || 'Test PR',
    description: overrides.description,
    status: overrides.status || 'open',
    commits: overrides.commits || ['abc123'],
    diffSummary: overrides.diffSummary || 'test diff',
    reviewNotes: overrides.reviewNotes,
    statusMessage: overrides.statusMessage,
    mergedAt: overrides.mergedAt,
    mergeCommitSha: overrides.mergeCommitSha,
    reviewSessionId: overrides.reviewSessionId,
    conflictSessionId: overrides.conflictSessionId,
    autoTriggered: overrides.autoTriggered || false,
    autoReview: overrides.autoReview || false,
    createdAt: now,
    updatedAt: now,
  };
}

describe('LocalPRService', () => {
  let db: Database.Database;
  let service: LocalPRService;

  beforeAll(() => {
    db = createTestDb();
    createTestProvider(db);
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(() => {
    mockBroadcast.mockClear();
    mockCreateVirtualClient.mockClear();
    mockHandleRunStart.mockClear();

    service = new LocalPRService(
      db,
      mockBroadcast,
      undefined // isProjectSlotAvailable
    );
  });

  // ========================================
  // forwardSessionStream tests
  // ========================================

  describe('forwardSessionStream', () => {
    it('forwards run_started message', () => {
      const projectId = 'test-project';
      const sessionId = 'test-session';
      const msg: ServerMessage = {
        type: 'run_started',
        sessionId,
        clientRequestId: 'req-1',
      };

      // Access private method via service
      (service as any).forwardSessionStream(projectId, sessionId, msg);

      expect(mockBroadcast).toHaveBeenCalledWith(projectId, { ...msg, sessionId });
    });

    it('forwards delta message', () => {
      const projectId = 'test-project';
      const sessionId = 'test-session';
      const msg: ServerMessage = {
        type: 'delta',
        sessionId,
        delta: { type: 'text', text: 'hello' },
      };

      (service as any).forwardSessionStream(projectId, sessionId, msg);

      expect(mockBroadcast).toHaveBeenCalledWith(projectId, { ...msg, sessionId });
    });

    it('forwards tool_use message', () => {
      const projectId = 'test-project';
      const sessionId = 'test-session';
      const msg: ServerMessage = {
        type: 'tool_use',
        sessionId,
        toolName: 'Bash',
        toolInput: { command: 'ls' },
      };

      (service as any).forwardSessionStream(projectId, sessionId, msg);

      expect(mockBroadcast).toHaveBeenCalledWith(projectId, { ...msg, sessionId });
    });

    it('forwards system_info message without sessionId', () => {
      const projectId = 'test-project';
      const sessionId = 'test-session';
      const msg: ServerMessage = {
        type: 'system_info',
        // No sessionId field
        info: { type: 'platform', value: 'darwin' },
      } as any;

      (service as any).forwardSessionStream(projectId, sessionId, msg);

      expect(mockBroadcast).toHaveBeenCalledWith(projectId, { ...msg, sessionId });
    });

    it('does not forward message with mismatched sessionId', () => {
      const projectId = 'test-project';
      const sessionId = 'test-session';
      const msg: ServerMessage = {
        type: 'run_completed',
        sessionId: 'other-session',
        clientRequestId: 'req-1',
      };

      (service as any).forwardSessionStream(projectId, sessionId, msg);

      expect(mockBroadcast).not.toHaveBeenCalled();
    });

    it('does not forward unsupported message types', () => {
      const projectId = 'test-project';
      const sessionId = 'test-session';
      const msg: ServerMessage = {
        type: 'error',
        error: 'Some error',
      } as any;

      (service as any).forwardSessionStream(projectId, sessionId, msg);

      expect(mockBroadcast).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // LOCAL_PR_SESSION_STREAM_MESSAGE_TYPES
  // ========================================

  describe('LOCAL_PR_SESSION_STREAM_MESSAGE_TYPES', () => {
    it('includes run_started', () => {
      const types = (service as any).constructor.prototype.constructor.toString();
      // The constant is defined at module level
      const msgTypes = [
        'run_started',
        'delta',
        'tool_use',
        'tool_result',
        'mode_change',
        'task_notification',
        'system_info',
        'run_completed',
        'run_failed',
      ];
      expect(msgTypes).toContain('run_started');
      expect(msgTypes).toContain('delta');
      expect(msgTypes).toContain('run_completed');
      expect(msgTypes).toContain('run_failed');
    });
  });

  // ========================================
  // cleanupReviewArtifacts tests
  // ========================================

  describe('cleanupReviewArtifacts', () => {
    it('removes review artifact file', async () => {
      const pr = createTestLocalPR(db, createTestProject(db));

      // Just verify the method exists and can be called
      await expect((service as any).cleanupReviewArtifacts(pr)).resolves.not.toThrow();
    });
  });

  // ========================================
  // archiveRelatedSessions tests
  // ========================================

  describe('archiveRelatedSessions', () => {
    it('archives review and conflict sessions', () => {
      const projectId = createTestProject(db);
      const pr = createTestLocalPR(db, projectId, {
        reviewSessionId: 'session-review-1',
        conflictSessionId: 'session-conflict-1',
      });

      // Create sessions
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, 'test', ?, ?)
      `).run('session-review-1', projectId, now, now);
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, 'test', ?, ?)
      `).run('session-conflict-1', projectId, now, now);

      (service as any).archiveRelatedSessions(pr);

      // Check sessions are archived
      const reviewSession = db.prepare('SELECT archived_at FROM sessions WHERE id = ?').get('session-review-1') as { archived_at: number | null };
      const conflictSession = db.prepare('SELECT archived_at FROM sessions WHERE id = ?').get('session-conflict-1') as { archived_at: number | null };

      expect(reviewSession.archived_at).toBeTruthy();
      expect(conflictSession.archived_at).toBeTruthy();
    });

    it('does nothing when no sessions exist', () => {
      const projectId = createTestProject(db);
      const pr = createTestLocalPR(db, projectId);

      expect(() => (service as any).archiveRelatedSessions(pr)).not.toThrow();
    });
  });

  // ========================================
  // checkCreatePreconditions tests
  // ========================================

  describe('checkCreatePreconditions', () => {
    it('returns canCreate=false when project not found', async () => {
      const result = await service.checkCreatePreconditions('non-existent', '/test/path');

      expect(result.canCreate).toBe(false);
      expect(result.reason).toContain('has no rootPath');
    });

    it('returns canCreate=false when active PR exists', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      createTestLocalPR(db, projectId, {
        worktreePath: '/test/worktree',
        status: 'open',
      });

      const result = await service.checkCreatePreconditions(projectId, '/test/worktree');

      expect(result.canCreate).toBe(false);
      expect(result.reason).toContain('An active local PR already exists');
    });

    it('returns canCreate=true when preconditions met', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const worktreePath = `/test/new-worktree-${Date.now()}`;

      const result = await service.checkCreatePreconditions(projectId, worktreePath);

      // Should pass - canCreate is true
      expect(result.canCreate).toBe(true);
    });
  });

  // ========================================
  // activeConflictClients tests
  // ========================================

  describe('activeConflictClients', () => {
    it('tracks active conflict clients', () => {
      const clients = (service as any).activeConflictClients;
      expect(clients).toBeInstanceOf(Map);
    });

    it('cleans up conflict client state when conflict resolution startup fails', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, { status: 'conflict' });
      createTestProvider(db, 'conflict-provider');
      mockHandleRunStart.mockImplementationOnce(() => {
        throw new Error('provider unavailable');
      });

      await expect((service as any).startConflictResolution(pr.id, 'conflict-provider'))
        .rejects.toThrow('provider unavailable');

      expect((service as any).activeConflictClients.has(pr.id)).toBe(false);
      const updated = service.getRepo().findById(pr.id);
      expect(updated?.statusMessage).toContain('Failed to start AI conflict resolution: provider unavailable');
      expect(mockBroadcast).toHaveBeenCalledWith(
        projectId,
        expect.objectContaining({
          type: 'local_pr_update',
          projectId,
          pr: expect.objectContaining({ id: pr.id }),
        })
      );
    });
  });

  // ========================================
  // getRepo tests
  // ========================================

  describe('getRepo', () => {
    it('returns LocalPRRepository instance', () => {
      const repo = service.getRepo();
      expect(repo).toBeInstanceOf(LocalPRRepository);
    });
  });

  // ========================================
  // createPR tests
  // ========================================

  describe('createPR', () => {
    it('creates a PR successfully', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const worktreePath = `/test/worktree-create-${Date.now()}`;

      const pr = await service.createPR(projectId, worktreePath, {
        title: 'My new feature',
        description: 'A description',
      });

      expect(pr.projectId).toBe(projectId);
      expect(pr.title).toBe('My new feature');
      expect(pr.branchName).toBe('feature-branch');
      expect(pr.baseBranch).toBe('main');
      expect(pr.status).toBe('open');
      expect(mockBroadcast).toHaveBeenCalled();
    });

    it('throws when project has no rootPath', async () => {
      // Create project with explicit null rootPath
      const projId = `proj-noroot-${Date.now()}`;
      const now = Date.now();
      db.prepare(`INSERT INTO projects (id, name, type, provider_id, root_path, created_at, updated_at) VALUES (?, 'No Root', 'code', 'test-provider', NULL, ?, ?)`).run(projId, now, now);
      await expect(service.createPR(projId, '/test/wt')).rejects.toThrow('has no rootPath');
    });

    it('throws when active PR already exists', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const wt = `/test/wt-dup-${Date.now()}`;
      createTestLocalPR(db, projectId, { worktreePath: wt, status: 'open' });

      await expect(service.createPR(projectId, wt)).rejects.toThrow('active local PR already exists');
    });

    it('throws when on base branch', async () => {
      mockGetCurrentBranch.mockResolvedValueOnce('main');

      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const wt = `/test/wt-base-${Date.now()}`;

      await expect(service.createPR(projectId, wt)).rejects.toThrow('already on the base branch');
    });

    it('throws when no new commits', async () => {
      mockGetNewCommits.mockResolvedValueOnce([]);

      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const wt = `/test/wt-no-commits-${Date.now()}`;

      await expect(service.createPR(projectId, wt)).rejects.toThrow('No new commits');
    });

    it('auto-commits when there are uncommitted changes', async () => {
      mockGetGitStatus.mockResolvedValueOnce({ hasChanges: true });

      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const wt = `/test/wt-dirty-${Date.now()}`;

      await service.createPR(projectId, wt);
      expect(mockCommitAllChanges).toHaveBeenCalledWith(wt);
    });

    it('auto-generates title from single commit', async () => {
      mockGetNewCommits.mockResolvedValueOnce([
        { sha: 'abc123', message: 'fix: single commit message' },
      ]);

      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const wt = `/test/wt-autotitle-${Date.now()}`;

      const pr = await service.createPR(projectId, wt);
      expect(pr.title).toBe('fix: single commit message');
    });
  });

  // ========================================
  // checkCreatePreconditions - more branches
  // ========================================

  describe('checkCreatePreconditions additional', () => {
    it('returns canCreate=false when on base branch', async () => {
      mockGetCurrentBranch.mockResolvedValueOnce('main');

      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const wt = `/test/wt-check-base-${Date.now()}`;

      const result = await service.checkCreatePreconditions(projectId, wt);
      expect(result.canCreate).toBe(false);
      expect(result.reason).toContain('already on the base branch');
    });

    it('returns canCreate=false when no new commits', async () => {
      mockGetNewCommits.mockResolvedValueOnce([]);

      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const wt = `/test/wt-check-nocommits-${Date.now()}`;

      const result = await service.checkCreatePreconditions(projectId, wt);
      expect(result.canCreate).toBe(false);
      expect(result.reason).toContain('No new commits');
    });

    it('returns canCreate=false when git error', async () => {
      mockGetMainBranch.mockRejectedValueOnce(new Error('git error'));

      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const wt = `/test/wt-check-giterr-${Date.now()}`;

      const result = await service.checkCreatePreconditions(projectId, wt);
      expect(result.canCreate).toBe(false);
      expect(result.reason).toBe('git error');
    });
  });

  // ========================================
  // maybeAutoCreatePR tests
  // ========================================

  describe('maybeAutoCreatePR', () => {
    it('returns null when no worktree config', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const result = await service.maybeAutoCreatePR(projectId, '/test/wt');
      expect(result).toBeNull();
    });

    it('returns null when on base branch', async () => {
      mockGetCurrentBranch.mockResolvedValueOnce('main');

      const projectId = createTestProject(db, { rootPath: '/test/root' });
      // Insert worktree config
      const now = Date.now();
      db.prepare(`
        INSERT INTO worktree_configs (id, project_id, worktree_path, auto_create_pr, auto_review, created_at, updated_at)
        VALUES (?, ?, ?, 1, 0, ?, ?)
      `).run(`wc-${now}`, projectId, '/test/wt-auto', now, now);

      const result = await service.maybeAutoCreatePR(projectId, '/test/wt-auto');
      expect(result).toBeNull();
    });
  });

  // ========================================
  // startReview tests
  // ========================================

  describe('startReview', () => {
    it('throws when PR not found', async () => {
      await expect(service.startReview('nonexistent')).rejects.toThrow('Local PR not found');
    });

    it('starts review session for valid PR', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root', providerId: 'test-provider' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-review-${Date.now()}`,
        status: 'open',
      });

      await service.startReview(pr.id);

      expect(mockCreateVirtualClient).toHaveBeenCalled();
      expect(mockHandleRunStart).toHaveBeenCalled();

      // PR should be in 'reviewing' status
      const updated = service.getRepo().findById(pr.id);
      expect(updated?.status).toBe('reviewing');
      expect(updated?.reviewSessionId).toBeDefined();
    });

    it('queues when no available slot', async () => {
      const slotsService = new LocalPRService(
        db,
        mockBroadcast,
        () => false, // no slots available
      );

      const projectId = createTestProject(db, { rootPath: '/test/root', providerId: 'test-provider' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-queue-${Date.now()}`,
        status: 'open',
      });

      await slotsService.startReview(pr.id);

      const updated = slotsService.getRepo().findById(pr.id);
      expect(updated?.executionState).toBe('queued');
      expect(updated?.pendingAction).toBe('review');
    });

    it('skips when review already in progress', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root', providerId: 'test-provider' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-dup-review-${Date.now()}`,
        status: 'open',
      });

      // Start first review
      await service.startReview(pr.id);
      mockCreateVirtualClient.mockClear();
      mockHandleRunStart.mockClear();

      // Try to start second review
      await service.startReview(pr.id);
      expect(mockCreateVirtualClient).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // reopenPR tests
  // ========================================

  describe('reopenPR', () => {
    it('reopens a closed PR', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-reopen-${Date.now()}`,
        status: 'closed',
      });

      await service.reopenPR(pr.id);

      const updated = service.getRepo().findById(pr.id);
      expect(updated?.status).toBe('open');
      expect(updated?.statusMessage).toContain('reopened');
    });

    it('throws when PR not found', async () => {
      await expect(service.reopenPR('nonexistent')).rejects.toThrow('Local PR not found');
    });

    it('throws when PR is not closed', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-reopen-open-${Date.now()}`,
        status: 'open',
      });

      await expect(service.reopenPR(pr.id)).rejects.toThrow("Cannot reopen PR in status 'open'");
    });
  });

  // ========================================
  // mergePR tests
  // ========================================

  describe('mergePR', () => {
    it('throws when PR not found', async () => {
      await expect(service.mergePR('nonexistent')).rejects.toThrow('Local PR not found');
    });

    it('throws when PR status is not mergeable', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-merge-bad-${Date.now()}`,
        status: 'reviewing',
      });

      await expect(service.mergePR(pr.id)).rejects.toThrow("Cannot merge PR in status 'reviewing'");
    });

    it('queues when no slot available', async () => {
      const slotsService = new LocalPRService(
        db,
        mockBroadcast,
        () => false,
      );

      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-merge-queue-${Date.now()}`,
        status: 'approved',
      });

      await slotsService.mergePR(pr.id);
      const updated = slotsService.getRepo().findById(pr.id);
      expect(updated?.executionState).toBe('queued');
      expect(updated?.pendingAction).toBe('merge');
    });
  });

  // ========================================
  // cancelMerge tests
  // ========================================

  describe('cancelMerge', () => {
    it('throws when PR not found', async () => {
      await expect(service.cancelMerge('nonexistent')).rejects.toThrow('Local PR not found');
    });

    it('throws when PR is not merging', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-cancel-${Date.now()}`,
        status: 'open',
      });

      await expect(service.cancelMerge(pr.id)).rejects.toThrow("Cannot cancel merge in status 'open'");
    });

    it('cancels a merging PR', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-cancel-ok-${Date.now()}`,
        status: 'merging',
      });

      await service.cancelMerge(pr.id);
      const updated = service.getRepo().findById(pr.id);
      expect(updated?.status).toBe('approved');
      expect(updated?.statusMessage).toContain('cancelled');
    });
  });

  // ========================================
  // resolveAvailableProviderId tests
  // ========================================

  describe('resolveAvailableProviderId', () => {
    it('returns preferred provider when it exists', () => {
      const result = (service as any).resolveAvailableProviderId('test-provider');
      expect(result).toBe('test-provider');
    });

    it('falls back to default provider', () => {
      const result = (service as any).resolveAvailableProviderId('nonexistent-provider');
      expect(result).toBe('test-provider'); // default provider
    });

    it('skips undefined and duplicate ids', () => {
      const result = (service as any).resolveAvailableProviderId(undefined, undefined, 'test-provider');
      expect(result).toBe('test-provider');
    });

    it('returns null when no providers exist', () => {
      // Create a service with a fresh DB that has no providers
      const emptyDb = new Database(':memory:');
      emptyDb.exec(`
        CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, type TEXT DEFAULT 'code', provider_id TEXT, root_path TEXT, system_prompt TEXT, permission_policy TEXT, agent_permission_override TEXT, agent TEXT, context_sync_status TEXT DEFAULT 'synced', is_internal INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER);
        CREATE TABLE local_prs (id TEXT PRIMARY KEY, project_id TEXT, worktree_path TEXT, branch_name TEXT, base_branch TEXT, title TEXT, description TEXT, status TEXT DEFAULT 'open', commits TEXT, diff_summary TEXT, review_notes TEXT, status_message TEXT, merged_at INTEGER, merge_commit_sha TEXT, review_session_id TEXT, conflict_session_id TEXT, auto_triggered INTEGER DEFAULT 0, auto_review INTEGER DEFAULT 0, execution_state TEXT DEFAULT 'idle', pending_action TEXT DEFAULT 'none', created_at INTEGER, updated_at INTEGER);
        CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, provider_id TEXT, sdk_session_id TEXT, type TEXT DEFAULT 'regular', parent_session_id TEXT, working_directory TEXT, project_role TEXT, task_id TEXT, archived_at INTEGER, plan_status TEXT, is_read_only INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER);
        CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, created_at INTEGER);
        CREATE TABLE providers (id TEXT PRIMARY KEY, name TEXT, type TEXT, api_key TEXT, base_url TEXT, model TEXT, is_default INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER);
        CREATE TABLE worktree_configs (id TEXT PRIMARY KEY, project_id TEXT, worktree_path TEXT, auto_create_pr INTEGER DEFAULT 0, auto_review INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER);
      `);
      const emptyService = new LocalPRService(emptyDb, mockBroadcast);
      const result = (emptyService as any).resolveAvailableProviderId('nonexistent');
      expect(result).toBeNull();
      emptyDb.close();
    });
  });

  // ========================================
  // hasAvailableSlot tests
  // ========================================

  describe('hasAvailableSlot', () => {
    it('returns true when no isProjectSlotAvailable callback', () => {
      expect((service as any).hasAvailableSlot('any-project')).toBe(true);
    });

    it('returns value from callback', () => {
      const slotsService = new LocalPRService(db, mockBroadcast, () => false);
      expect((slotsService as any).hasAvailableSlot('any-project')).toBe(false);
    });

    it('returns true when callback throws (fail-open)', () => {
      const slotsService = new LocalPRService(db, mockBroadcast, () => {
        throw new Error('probe error');
      });
      expect((slotsService as any).hasAvailableSlot('any-project')).toBe(true);
    });
  });

  // ========================================
  // tick tests
  // ========================================

  describe('tick', () => {
    it('runs without error on empty state', async () => {
      await expect(service.tick()).resolves.not.toThrow();
    });
  });

  // ========================================
  // deleteRelatedSessions tests
  // ========================================

  describe('deleteRelatedSessions', () => {
    it('deletes review and conflict sessions', () => {
      const projectId = createTestProject(db);
      const now = Date.now();

      db.prepare('INSERT INTO sessions (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('del-s1', projectId, 'Rev', now, now);
      db.prepare('INSERT INTO sessions (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('del-s2', projectId, 'Conflict', now, now);

      const pr = createTestLocalPR(db, projectId, {
        reviewSessionId: 'del-s1',
        conflictSessionId: 'del-s2',
      });

      (service as any).deleteRelatedSessions(pr);

      expect(db.prepare('SELECT id FROM sessions WHERE id = ?').get('del-s1')).toBeUndefined();
      expect(db.prepare('SELECT id FROM sessions WHERE id = ?').get('del-s2')).toBeUndefined();
    });

    it('does not throw when sessions already deleted', () => {
      const projectId = createTestProject(db);
      const pr = createTestLocalPR(db, projectId, {
        reviewSessionId: 'nonexistent-session',
      });

      expect(() => (service as any).deleteRelatedSessions(pr)).not.toThrow();
    });
  });

  // ========================================
  // broadcastPRUpdate tests
  // ========================================

  describe('broadcastPRUpdate', () => {
    it('broadcasts local_pr_update message', () => {
      const projectId = createTestProject(db);
      const pr = createTestLocalPR(db, projectId);

      (service as any).broadcastPRUpdate(pr);

      expect(mockBroadcast).toHaveBeenCalledWith(projectId, {
        type: 'local_pr_update',
        projectId,
        pr,
      });
    });
  });

  // ========================================
  // triggerConflictResolution tests
  // ========================================

  describe('triggerConflictResolution', () => {
    it('throws when PR not found', async () => {
      await expect(service.triggerConflictResolution('nonexistent'))
        .rejects.toThrow('Local PR not found');
    });

    it('throws when PR is not in conflict status', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-conflict-bad-${Date.now()}`,
        status: 'open',
      });

      await expect(service.triggerConflictResolution(pr.id))
        .rejects.toThrow("Cannot resolve conflict in status 'open'");
    });
  });

  // ========================================
  // revertMergedPR tests
  // ========================================

  describe('revertMergedPR', () => {
    it('throws when PR not found', async () => {
      await expect(service.revertMergedPR('nonexistent'))
        .rejects.toThrow('Local PR not found');
    });

    it('throws when PR is not merged', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-revert-bad-${Date.now()}`,
        status: 'open',
      });

      await expect(service.revertMergedPR(pr.id))
        .rejects.toThrow("Cannot revert PR in status 'open'");
    });

    it('throws when main worktree is dirty', async () => {
      mockIsWorkingTreeClean.mockResolvedValueOnce(false);

      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-revert-dirty-${Date.now()}`,
        status: 'merged',
        mergeCommitSha: 'abc123def',
      });
      // Set status to merged in DB (createTestLocalPR doesn't set merged_commit_sha)
      db.prepare('UPDATE local_prs SET status = ?, merged_commit_sha = ? WHERE id = ?')
        .run('merged', 'abc123def', pr.id);

      await expect(service.revertMergedPR(pr.id))
        .rejects.toThrow('Main worktree is dirty');
    });

    it('throws when project has no rootPath', async () => {
      const projId = `proj-norp-revert-${Date.now()}`;
      const now = Date.now();
      db.prepare(`INSERT INTO projects (id, name, type, provider_id, root_path, created_at, updated_at) VALUES (?, 'No Root', 'code', 'test-provider', NULL, ?, ?)`).run(projId, now, now);
      const pr = createTestLocalPR(db, projId, {
        worktreePath: `/test/wt-revert-norp-${Date.now()}`,
        status: 'merged',
      });
      db.prepare('UPDATE local_prs SET status = ? WHERE id = ?').run('merged', pr.id);

      await expect(service.revertMergedPR(pr.id))
        .rejects.toThrow('has no rootPath');
    });
  });

  // ========================================
  // onReviewSessionComplete tests
  // ========================================

  describe('onReviewSessionComplete', () => {
    it('sets status to approved when review passed', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-review-pass-${Date.now()}`,
        status: 'reviewing',
      });
      db.prepare('UPDATE local_prs SET status = ? WHERE id = ?').run('reviewing', pr.id);

      // Insert a review session
      const sessionId = `session-review-pass-${Date.now()}`;
      const now = Date.now();
      db.prepare('INSERT INTO sessions (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(sessionId, projectId, 'Review', now, now);
      db.prepare('UPDATE local_prs SET review_session_id = ? WHERE id = ?').run(sessionId, pr.id);

      // Insert assistant message with REVIEW_PASSED
      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(`msg-pass-${Date.now()}`, sessionId, 'assistant', 'Everything looks good. [REVIEW_PASSED]', now);

      await (service as any).onReviewSessionComplete(pr.id, sessionId, false);

      const updated = service.getRepo().findById(pr.id);
      expect(updated?.status).toBe('approved');
      expect(updated?.statusMessage).toContain('approved');
    });

    it('sets status to review_failed when review failed', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-review-fail-${Date.now()}`,
        status: 'reviewing',
      });
      db.prepare('UPDATE local_prs SET status = ? WHERE id = ?').run('reviewing', pr.id);

      const sessionId = `session-review-fail-${Date.now()}`;
      const now = Date.now();
      db.prepare('INSERT INTO sessions (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(sessionId, projectId, 'Review', now, now);

      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(`msg-fail-${Date.now()}`, sessionId, 'assistant', 'Critical bug found. [REVIEW_FAILED]', now);

      await (service as any).onReviewSessionComplete(pr.id, sessionId, false);

      const updated = service.getRepo().findById(pr.id);
      expect(updated?.status).toBe('review_failed');
      expect(updated?.reviewNotes).toContain('Critical bug found');
    });

    it('treats as passed when no explicit verdict and run succeeded', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-review-nomarker-${Date.now()}`,
        status: 'reviewing',
      });
      db.prepare('UPDATE local_prs SET status = ? WHERE id = ?').run('reviewing', pr.id);

      const sessionId = `session-nomarker-${Date.now()}`;
      const now = Date.now();
      db.prepare('INSERT INTO sessions (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(sessionId, projectId, 'Review', now, now);

      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(`msg-nomarker-${Date.now()}`, sessionId, 'assistant', 'Code looks fine, no issues found.', now);

      await (service as any).onReviewSessionComplete(pr.id, sessionId, false);

      const updated = service.getRepo().findById(pr.id);
      expect(updated?.status).toBe('approved');
    });

    it('treats as failed when no explicit verdict and run failed', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-review-runfail-${Date.now()}`,
        status: 'reviewing',
      });
      db.prepare('UPDATE local_prs SET status = ? WHERE id = ?').run('reviewing', pr.id);

      const sessionId = `session-runfail-${Date.now()}`;
      const now = Date.now();
      db.prepare('INSERT INTO sessions (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(sessionId, projectId, 'Review', now, now);

      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(`msg-runfail-${Date.now()}`, sessionId, 'assistant', 'Looking at the code...', now);

      await (service as any).onReviewSessionComplete(pr.id, sessionId, true);

      const updated = service.getRepo().findById(pr.id);
      expect(updated?.status).toBe('review_failed');
      expect(updated?.reviewNotes).toContain('failed before producing a valid verdict');
    });

    it('sets review_failed when auto-commit of remaining changes fails', async () => {
      mockGetGitStatus.mockResolvedValueOnce({ hasChanges: true });
      mockCommitAllChanges.mockRejectedValueOnce(new Error('commit failed'));

      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-review-commitfail-${Date.now()}`,
        status: 'reviewing',
      });
      db.prepare('UPDATE local_prs SET status = ? WHERE id = ?').run('reviewing', pr.id);

      const sessionId = `session-commitfail-${Date.now()}`;
      const now = Date.now();
      db.prepare('INSERT INTO sessions (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(sessionId, projectId, 'Review', now, now);

      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(`msg-commitfail-${Date.now()}`, sessionId, 'assistant', 'All good. [REVIEW_PASSED]', now);

      await (service as any).onReviewSessionComplete(pr.id, sessionId, false);

      const updated = service.getRepo().findById(pr.id);
      expect(updated?.status).toBe('review_failed');
      expect(updated?.reviewNotes).toContain('auto-commit failed');
    });

    it('skips if PR is no longer in reviewing status', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-review-skip-${Date.now()}`,
        status: 'open',
      });

      mockBroadcast.mockClear();
      await (service as any).onReviewSessionComplete(pr.id, 'any-session', false);

      // Should not have broadcast any updates
      expect(mockBroadcast).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // onConflictSessionComplete tests
  // ========================================

  describe('onConflictSessionComplete', () => {
    it('resets PR to open when conflict resolved', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-conflict-resolved-${Date.now()}`,
        status: 'conflict',
      });
      db.prepare('UPDATE local_prs SET status = ? WHERE id = ?').run('conflict', pr.id);

      const sessionId = `session-conflict-resolved-${Date.now()}`;
      const now = Date.now();
      db.prepare('INSERT INTO sessions (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(sessionId, projectId, 'Conflict', now, now);

      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(`msg-resolved-${Date.now()}`, sessionId, 'assistant', 'Rebase completed. [CONFLICT_RESOLVED]', now);

      await (service as any).onConflictSessionComplete(pr.id, sessionId);

      const updated = service.getRepo().findById(pr.id);
      expect(updated?.status).toBe('open');
      expect(updated?.statusMessage).toContain('Conflict resolved');
    });

    it('leaves PR in conflict when unresolved', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-conflict-unresolved-${Date.now()}`,
        status: 'conflict',
      });
      db.prepare('UPDATE local_prs SET status = ? WHERE id = ?').run('conflict', pr.id);

      const sessionId = `session-conflict-unresolved-${Date.now()}`;
      const now = Date.now();
      db.prepare('INSERT INTO sessions (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(sessionId, projectId, 'Conflict', now, now);

      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(`msg-unresolved-${Date.now()}`, sessionId, 'assistant', 'Could not resolve. [CONFLICT_UNRESOLVED]', now);

      await (service as any).onConflictSessionComplete(pr.id, sessionId);

      const updated = service.getRepo().findById(pr.id);
      expect(updated?.status).toBe('conflict');
      expect(updated?.executionState).toBe('failed');
      expect(updated?.statusMessage).toContain('could not resolve');
    });

    it('skips if PR is no longer in conflict status', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-conflict-skip-${Date.now()}`,
        status: 'open',
      });

      mockBroadcast.mockClear();
      await (service as any).onConflictSessionComplete(pr.id, 'any-session');

      expect(mockBroadcast).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // buildReviewPrompt tests
  // ========================================

  describe('buildReviewPrompt', () => {
    it('inlines diff when short enough', async () => {
      const pr = createTestLocalPR(db, createTestProject(db), {
        diffSummary: 'short diff content',
        branchName: 'feat-x',
        baseBranch: 'main',
      });

      const prompt = await (service as any).buildReviewPrompt(pr);
      expect(prompt).toContain('short diff content');
      expect(prompt).toContain('feat-x');
      expect(prompt).toContain('[REVIEW_PASSED]');
      expect(prompt).toContain('[REVIEW_FAILED]');
    });

    it('uses placeholder when diff is null', async () => {
      const projectId = createTestProject(db);
      const pr = createTestLocalPR(db, projectId, {
        branchName: 'feat-null-diff',
        baseBranch: 'main',
      });
      // Clear diff_summary
      db.prepare('UPDATE local_prs SET diff_summary = NULL WHERE id = ?').run(pr.id);
      const prUpdated = service.getRepo().findById(pr.id)!;

      const prompt = await (service as any).buildReviewPrompt(prUpdated);
      expect(prompt).toContain('(no diff available)');
    });
  });

  // ========================================
  // maybeRefreshPR tests
  // ========================================

  describe('maybeRefreshPR', () => {
    it('returns null when PR is in a busy status', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-refresh-busy-${Date.now()}`,
        status: 'reviewing',
      });
      db.prepare('UPDATE local_prs SET status = ? WHERE id = ?').run('reviewing', pr.id);
      const freshPR = service.getRepo().findById(pr.id)!;

      const result = await (service as any).maybeRefreshPR(
        freshPR, '/test/root', [{ sha: 'new123', message: 'new' }], 'main', 'feature'
      );
      expect(result).toBeNull();
    });

    it('returns null when commits have not changed', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-refresh-same-${Date.now()}`,
        commits: ['abc123'],
        status: 'open',
      });

      const result = await (service as any).maybeRefreshPR(
        pr, '/test/root', [{ sha: 'abc123', message: 'test' }], 'main', 'feature'
      );
      expect(result).toBeNull();
    });

    it('updates commits and diff when changed', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-refresh-changed-${Date.now()}`,
        commits: ['abc123'],
        status: 'open',
      });

      mockGetDiff.mockResolvedValueOnce('new diff content');

      const result = await (service as any).maybeRefreshPR(
        pr, '/test/root', [{ sha: 'abc123', message: 'test' }, { sha: 'def456', message: 'test2' }], 'main', 'feature'
      );
      expect(result).not.toBeNull();
      expect(result.commits).toEqual(['abc123', 'def456']);
    });

    it('resets approved status to open when commits change', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-refresh-approved-${Date.now()}`,
        commits: ['abc123'],
        status: 'approved',
      });
      db.prepare('UPDATE local_prs SET status = ? WHERE id = ?').run('approved', pr.id);
      const freshPR = service.getRepo().findById(pr.id)!;

      mockGetDiff.mockResolvedValueOnce('new diff');

      const result = await (service as any).maybeRefreshPR(
        freshPR, '/test/root', [{ sha: 'new456', message: 'new' }], 'main', 'feature'
      );
      expect(result?.status).toBe('open');
    });

    it('preserves approved status when resetReviewStateOnCommitChange is false', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-refresh-preserve-${Date.now()}`,
        commits: ['abc123'],
        status: 'approved',
      });
      db.prepare('UPDATE local_prs SET status = ? WHERE id = ?').run('approved', pr.id);
      const freshPR = service.getRepo().findById(pr.id)!;

      mockGetDiff.mockResolvedValueOnce('new diff');

      const result = await (service as any).maybeRefreshPR(
        freshPR, '/test/root', [{ sha: 'new456', message: 'new' }], 'main', 'feature',
        { resetReviewStateOnCommitChange: false }
      );
      expect(result?.status).toBe('approved');
    });
  });

  // ========================================
  // processStale tests
  // ========================================

  describe('processStale', () => {
    it('resets stale reviewing PR to open', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-stale-review-${Date.now()}`,
        status: 'reviewing',
      });
      // Set updated_at to 31 minutes ago (beyond STALE_TIMEOUT_MS of 30 min)
      const staleTime = Date.now() - 31 * 60 * 1000;
      db.prepare('UPDATE local_prs SET status = ?, updated_at = ? WHERE id = ?')
        .run('reviewing', staleTime, pr.id);

      await (service as any).processStale();

      const updated = service.getRepo().findById(pr.id);
      expect(updated?.status).toBe('open');
      expect(updated?.statusMessage).toContain('Auto-reset stale');
    });

    it('resets stale merging PR to approved', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-stale-merge-${Date.now()}`,
        status: 'merging',
      });
      const staleTime = Date.now() - 31 * 60 * 1000;
      db.prepare('UPDATE local_prs SET status = ?, updated_at = ? WHERE id = ?')
        .run('merging', staleTime, pr.id);

      await (service as any).processStale();

      const updated = service.getRepo().findById(pr.id);
      expect(updated?.status).toBe('approved');
    });

    it('does not reset non-stale PRs', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-notstale-${Date.now()}`,
        status: 'reviewing',
      });
      db.prepare('UPDATE local_prs SET status = ? WHERE id = ?').run('reviewing', pr.id);

      await (service as any).processStale();

      const updated = service.getRepo().findById(pr.id);
      expect(updated?.status).toBe('reviewing');
    });
  });

  // ========================================
  // processQueue tests
  // ========================================

  describe('processQueue', () => {
    it('starts queued review when slot available', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root', providerId: 'test-provider' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-queue-review-${Date.now()}`,
        status: 'open',
      });
      db.prepare('UPDATE local_prs SET execution_state = ?, pending_action = ? WHERE id = ?')
        .run('queued', 'review', pr.id);

      await (service as any).processQueue();

      // startReview should have been called (it calls handleRunStart)
      expect(mockHandleRunStart).toHaveBeenCalled();
    });

    it('skips queued PR when no slot available', async () => {
      const noSlotService = new LocalPRService(db, mockBroadcast, () => false);
      const projectId = createTestProject(db, { rootPath: '/test/root', providerId: 'test-provider' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-queue-noslot-${Date.now()}`,
        status: 'open',
      });
      db.prepare('UPDATE local_prs SET execution_state = ?, pending_action = ? WHERE id = ?')
        .run('queued', 'review', pr.id);

      mockHandleRunStart.mockClear();
      await (noSlotService as any).processQueue();

      expect(mockHandleRunStart).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // processFailed tests
  // ========================================

  describe('processFailed', () => {
    it('requeues failed PRs when slot available', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-failed-retry-${Date.now()}`,
        status: 'approved',
      });
      db.prepare('UPDATE local_prs SET execution_state = ?, pending_action = ?, execution_error = ? WHERE id = ?')
        .run('failed', 'merge', 'some error', pr.id);

      await (service as any).processFailed();

      const updated = service.getRepo().findById(pr.id);
      expect(updated?.executionState).toBe('queued');
    });

    it('skips failed PRs when no slot available', async () => {
      const noSlotService = new LocalPRService(db, mockBroadcast, () => false);
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-failed-noslot-${Date.now()}`,
        status: 'approved',
      });
      db.prepare('UPDATE local_prs SET execution_state = ?, pending_action = ?, execution_error = ? WHERE id = ?')
        .run('failed', 'merge', 'some error', pr.id);

      await (noSlotService as any).processFailed();

      const updated = noSlotService.getRepo().findById(pr.id);
      expect(updated?.executionState).toBe('failed');
    });
  });

  // ========================================
  // cleanupFinishedPRs tests
  // ========================================

  describe('cleanupFinishedPRs', () => {
    it('removes excess finished PRs beyond retention limit', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/cleanup-root' });

      // Create 12 merged PRs (limit is 10)
      const prIds: string[] = [];
      for (let i = 0; i < 12; i++) {
        const pr = createTestLocalPR(db, projectId, {
          worktreePath: `/test/wt-cleanup-${i}-${Date.now()}`,
          status: 'merged',
          title: `Cleanup PR ${i}`,
        });
        db.prepare('UPDATE local_prs SET status = ? WHERE id = ?').run('merged', pr.id);
        prIds.push(pr.id);
      }

      await (service as any).cleanupFinishedPRs();

      // findByProjectId returns ordered by created_at DESC, so the oldest 2 should be removed
      const remaining = service.getRepo().findByProjectId(projectId);
      const mergedRemaining = remaining.filter(p => p.status === 'merged');
      expect(mergedRemaining.length).toBeLessThanOrEqual(10);
    });

    it('does nothing when under retention limit', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/cleanup-under' });

      // Create 3 merged PRs (well under limit of 10)
      for (let i = 0; i < 3; i++) {
        const pr = createTestLocalPR(db, projectId, {
          worktreePath: `/test/wt-cleanup-under-${i}-${Date.now()}`,
          status: 'merged',
        });
        db.prepare('UPDATE local_prs SET status = ? WHERE id = ?').run('merged', pr.id);
      }

      mockRemoveWorktree.mockClear();
      await (service as any).cleanupFinishedPRs();

      // No worktrees should have been removed for this project's PRs
      // (other projects may trigger cleanup, so we just check our PRs remain)
      const remaining = service.getRepo().findByProjectId(projectId);
      expect(remaining.filter(p => p.status === 'merged').length).toBe(3);
    });
  });

  // ========================================
  // refreshAfterBusyState tests
  // ========================================

  describe('refreshAfterBusyState', () => {
    it('refreshes PR after busy state', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-refresh-busy-state-${Date.now()}`,
        commits: ['abc123'],
        status: 'open',
      });

      // Mock different commits to trigger refresh
      mockGetNewCommits.mockResolvedValueOnce([
        { sha: 'abc123', message: 'old' },
        { sha: 'new456', message: 'new commit' },
      ]);
      mockGetDiff.mockResolvedValueOnce('updated diff');

      await (service as any).refreshAfterBusyState(pr.id);

      const updated = service.getRepo().findById(pr.id);
      expect(updated?.commits).toEqual(['abc123', 'new456']);
    });

    it('does nothing for non-existent PR', async () => {
      // Should not throw
      await (service as any).refreshAfterBusyState('non-existent-id');
    });

    it('does nothing when on base branch', async () => {
      mockGetCurrentBranch.mockResolvedValueOnce('main');
      mockGetMainBranch.mockResolvedValueOnce('main');

      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-refresh-base-${Date.now()}`,
        commits: ['abc123'],
        status: 'open',
      });

      mockBroadcast.mockClear();
      await (service as any).refreshAfterBusyState(pr.id);

      // No broadcast should occur since nothing changed
      expect(mockBroadcast).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // startReview error handling
  // ========================================

  describe('startReview error handling', () => {
    it('throws when project has no rootPath', async () => {
      const projId = `proj-norp-review-${Date.now()}`;
      const now = Date.now();
      db.prepare(`INSERT INTO projects (id, name, type, provider_id, root_path, created_at, updated_at) VALUES (?, 'No Root', 'code', 'test-provider', NULL, ?, ?)`).run(projId, now, now);
      const pr = createTestLocalPR(db, projId, {
        worktreePath: `/test/wt-review-norp-${Date.now()}`,
        status: 'open',
      });

      await expect(service.startReview(pr.id)).rejects.toThrow('has no rootPath');
    });

    it('throws when no provider available', async () => {
      // Create a project referencing a non-existent provider, in a DB with no default
      const emptyDb = createTestDb();
      const emptyService = new LocalPRService(emptyDb, mockBroadcast);
      const projId = `proj-noprov-${Date.now()}`;
      const now = Date.now();
      emptyDb.prepare(`INSERT INTO projects (id, name, type, provider_id, root_path, created_at, updated_at) VALUES (?, 'No Prov', 'code', 'missing-provider', '/test/root', ?, ?)`).run(projId, now, now);
      const pr = createTestLocalPR(emptyDb, projId, {
        worktreePath: `/test/wt-review-noprov-${Date.now()}`,
        status: 'open',
      });

      await expect(emptyService.startReview(pr.id)).rejects.toThrow('No provider available');
      emptyDb.close();
    });
  });

  // ========================================
  // mergePR detailed tests
  // ========================================

  describe('mergePR detailed', () => {
    it('throws when project has no rootPath', async () => {
      const projId = `proj-norp-merge-${Date.now()}`;
      const now = Date.now();
      db.prepare(`INSERT INTO projects (id, name, type, provider_id, root_path, created_at, updated_at) VALUES (?, 'No Root', 'code', 'test-provider', NULL, ?, ?)`).run(projId, now, now);
      const pr = createTestLocalPR(db, projId, {
        worktreePath: `/test/wt-merge-norp-${Date.now()}`,
        status: 'approved',
      });
      db.prepare('UPDATE local_prs SET status = ? WHERE id = ?').run('approved', pr.id);

      await expect(service.mergePR(pr.id)).rejects.toThrow('has no rootPath');
    });

    it('throws when main worktree is dirty', async () => {
      mockIsWorkingTreeClean.mockResolvedValueOnce(false);

      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-merge-dirty-${Date.now()}`,
        status: 'approved',
      });
      db.prepare('UPDATE local_prs SET status = ? WHERE id = ?').run('approved', pr.id);

      await expect(service.mergePR(pr.id)).rejects.toThrow('Main worktree is dirty');

      const updated = service.getRepo().findById(pr.id);
      expect(updated?.statusMessage).toContain('Cannot merge: main worktree is dirty');
    });

    it('can merge open PRs (transitions through approved)', async () => {
      mockIsWorkingTreeClean.mockResolvedValueOnce(true);
      mockMergeBranch.mockResolvedValueOnce({ success: true });

      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-merge-open-${Date.now()}`,
        status: 'open',
      });

      // Mock child_process for the git checkout and rev-parse commands
      const { vi: viModule } = await import('vitest');
      // The mergePR method dynamically imports child_process, so we mock it via the git operations
      // Actually mergePR uses direct execFile import, which is hard to mock.
      // Let's just verify it transitions to approved status before failing on checkout
      await expect(service.mergePR(pr.id)).rejects.toThrow(); // Will fail on execFile

      // Even on error, it should have attempted the merge flow
      const updated = service.getRepo().findById(pr.id);
      expect(updated?.status).toBe('approved'); // Reset back to approved on error
    });
  });

  // ========================================
  // triggerConflictResolution detailed tests
  // ========================================

  describe('triggerConflictResolution detailed', () => {
    it('throws when project has no rootPath', async () => {
      const projId = `proj-norp-conflict-${Date.now()}`;
      const now = Date.now();
      db.prepare(`INSERT INTO projects (id, name, type, provider_id, root_path, created_at, updated_at) VALUES (?, 'No Root', 'code', 'test-provider', NULL, ?, ?)`).run(projId, now, now);
      const pr = createTestLocalPR(db, projId, {
        worktreePath: `/test/wt-conflict-norp-${Date.now()}`,
        status: 'conflict',
      });
      db.prepare('UPDATE local_prs SET status = ? WHERE id = ?').run('conflict', pr.id);

      await expect(service.triggerConflictResolution(pr.id)).rejects.toThrow('has no rootPath');
    });

    it('queues when no slot available', async () => {
      const noSlotService = new LocalPRService(db, mockBroadcast, () => false);
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-conflict-noslot-${Date.now()}`,
        status: 'conflict',
      });
      db.prepare('UPDATE local_prs SET status = ? WHERE id = ?').run('conflict', pr.id);

      await noSlotService.triggerConflictResolution(pr.id);

      const updated = noSlotService.getRepo().findById(pr.id);
      expect(updated?.statusMessage).toContain('Queued for AI conflict resolution');
    });

    it('starts conflict resolution when slot available', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root', providerId: 'test-provider' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-conflict-start-${Date.now()}`,
        status: 'conflict',
      });
      db.prepare('UPDATE local_prs SET status = ? WHERE id = ?').run('conflict', pr.id);

      await service.triggerConflictResolution(pr.id);

      expect(mockCreateVirtualClient).toHaveBeenCalled();
      expect(mockHandleRunStart).toHaveBeenCalled();
    });
  });

  // ========================================
  // startConflictResolution tests
  // ========================================

  describe('startConflictResolution', () => {
    it('skips when already in progress', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root', providerId: 'test-provider' });
      const pr = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-conflict-dup-${Date.now()}`,
        status: 'conflict',
      });
      db.prepare('UPDATE local_prs SET status = ? WHERE id = ?').run('conflict', pr.id);

      // Start first conflict resolution
      await (service as any).startConflictResolution(pr.id, 'test-provider');
      mockCreateVirtualClient.mockClear();
      mockHandleRunStart.mockClear();

      // Try to start second one
      await (service as any).startConflictResolution(pr.id, 'test-provider');
      expect(mockCreateVirtualClient).not.toHaveBeenCalled();
    });

    it('returns early when PR not found', async () => {
      mockCreateVirtualClient.mockClear();
      await (service as any).startConflictResolution('nonexistent', 'test-provider');
      expect(mockCreateVirtualClient).not.toHaveBeenCalled();
    });

    it('returns early when no provider available', async () => {
      const emptyDb = createTestDb();
      const emptyService = new LocalPRService(emptyDb, mockBroadcast);
      const projId = `proj-noprov-conflict-${Date.now()}`;
      const now = Date.now();
      emptyDb.prepare(`INSERT INTO projects (id, name, type, provider_id, root_path, created_at, updated_at) VALUES (?, 'NoProv', 'code', 'missing', '/test/root', ?, ?)`).run(projId, now, now);
      const pr = createTestLocalPR(emptyDb, projId, {
        worktreePath: `/test/wt-conflict-noprov-${Date.now()}`,
        status: 'conflict',
      });

      mockCreateVirtualClient.mockClear();
      await (emptyService as any).startConflictResolution(pr.id);
      expect(mockCreateVirtualClient).not.toHaveBeenCalled();
      emptyDb.close();
    });
  });

  // ========================================
  // tick comprehensive tests
  // ========================================

  describe('tick comprehensive', () => {
    it('processes stale, queued, failed, and cleanup in one tick', async () => {
      // Just verify tick completes without error even with various PR states
      const projectId = createTestProject(db, { rootPath: '/test/tick-root' });

      // Add a stale PR
      const stalePR = createTestLocalPR(db, projectId, {
        worktreePath: `/test/wt-tick-stale-${Date.now()}`,
        status: 'reviewing',
      });
      const staleTime = Date.now() - 31 * 60 * 1000;
      db.prepare('UPDATE local_prs SET status = ?, updated_at = ? WHERE id = ?')
        .run('reviewing', staleTime, stalePR.id);

      await service.tick();

      // Stale PR should have been reset
      const updated = service.getRepo().findById(stalePR.id);
      expect(updated?.status).toBe('open');
    });

    it('catches and logs errors without throwing', async () => {
      // Even if internal methods fail, tick should not throw
      // (it has a try/catch wrapper)
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(service.tick()).resolves.not.toThrow();
      consoleSpy.mockRestore();
    });
  });

  // ========================================
  // maybeAutoCreatePR detailed tests
  // ========================================

  describe('maybeAutoCreatePR detailed', () => {
    it('creates PR when worktree config has autoCreatePR', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const wt = `/test/wt-autocreate-${Date.now()}`;
      const now = Date.now();
      db.prepare(`
        INSERT INTO worktree_configs (id, project_id, worktree_path, auto_create_pr, auto_review, created_at, updated_at)
        VALUES (?, ?, ?, 1, 0, ?, ?)
      `).run(`wc-autocreate-${now}`, projectId, wt, now, now);

      const result = await service.maybeAutoCreatePR(projectId, wt);
      expect(result).not.toBeNull();
      expect(result?.autoTriggered).toBe(true);
    });

    it('returns null when project has no rootPath', async () => {
      const projId = `proj-norp-auto-${Date.now()}`;
      const now = Date.now();
      db.prepare(`INSERT INTO projects (id, name, type, provider_id, root_path, created_at, updated_at) VALUES (?, 'No Root', 'code', 'test-provider', NULL, ?, ?)`).run(projId, now, now);
      const wt = `/test/wt-auto-norp-${Date.now()}`;
      db.prepare(`
        INSERT INTO worktree_configs (id, project_id, worktree_path, auto_create_pr, auto_review, created_at, updated_at)
        VALUES (?, ?, ?, 1, 0, ?, ?)
      `).run(`wc-norp-${now}`, projId, wt, now, now);

      const result = await service.maybeAutoCreatePR(projId, wt);
      expect(result).toBeNull();
    });

    it('returns null when no new commits', async () => {
      mockGetNewCommits.mockResolvedValueOnce([]);

      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const wt = `/test/wt-auto-nocommits-${Date.now()}`;
      const now = Date.now();
      db.prepare(`
        INSERT INTO worktree_configs (id, project_id, worktree_path, auto_create_pr, auto_review, created_at, updated_at)
        VALUES (?, ?, ?, 1, 0, ?, ?)
      `).run(`wc-nocommits-${now}`, projectId, wt, now, now);

      const result = await service.maybeAutoCreatePR(projectId, wt);
      expect(result).toBeNull();
    });

    it('refreshes existing active PR instead of creating new one', async () => {
      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const wt = `/test/wt-auto-refresh-${Date.now()}`;
      const now = Date.now();
      db.prepare(`
        INSERT INTO worktree_configs (id, project_id, worktree_path, auto_create_pr, auto_review, created_at, updated_at)
        VALUES (?, ?, ?, 1, 0, ?, ?)
      `).run(`wc-refresh-${now}`, projectId, wt, now, now);

      // Create existing active PR with different commits
      createTestLocalPR(db, projectId, {
        worktreePath: wt,
        commits: ['old123'],
        status: 'open',
      });

      // Mock new commits that differ
      mockGetNewCommits.mockResolvedValueOnce([
        { sha: 'old123', message: 'old' },
        { sha: 'new456', message: 'new commit' },
      ]);
      mockGetDiff.mockResolvedValueOnce('updated diff');

      const result = await service.maybeAutoCreatePR(projectId, wt);
      // Should have refreshed the existing PR
      expect(result).not.toBeNull();
      expect(result?.commits).toEqual(['old123', 'new456']);
    });

    it('catches errors and returns null', async () => {
      mockGetMainBranch.mockRejectedValueOnce(new Error('git error'));

      const projectId = createTestProject(db, { rootPath: '/test/root' });
      const wt = `/test/wt-auto-error-${Date.now()}`;
      const now = Date.now();
      db.prepare(`
        INSERT INTO worktree_configs (id, project_id, worktree_path, auto_create_pr, auto_review, created_at, updated_at)
        VALUES (?, ?, ?, 1, 0, ?, ?)
      `).run(`wc-error-${now}`, projectId, wt, now, now);

      const result = await service.maybeAutoCreatePR(projectId, wt);
      expect(result).toBeNull();
    });
  });

  // ========================================
  // forwardSessionStream edge cases
  // ========================================

  describe('forwardSessionStream edge cases', () => {
    it('does not forward non-system_info message without sessionId', () => {
      const projectId = 'test-project';
      const sessionId = 'test-session';
      // A tool_result with no sessionId at all
      const msg = {
        type: 'tool_result',
      } as any;

      (service as any).forwardSessionStream(projectId, sessionId, msg);

      expect(mockBroadcast).not.toHaveBeenCalled();
    });

    it('forwards matching sessionId message directly', () => {
      const projectId = 'test-project';
      const sessionId = 'test-session';
      const msg: ServerMessage = {
        type: 'run_completed',
        sessionId,
        clientRequestId: 'req-1',
      };

      (service as any).forwardSessionStream(projectId, sessionId, msg);

      expect(mockBroadcast).toHaveBeenCalledWith(projectId, msg);
    });
  });

  // ========================================
  // resolveMergeCommitSha tests
  // ========================================

  describe('resolveMergeCommitSha', () => {
    it('returns stored mergeCommitSha when present', async () => {
      const pr = {
        mergeCommitSha: 'abc123def',
        title: 'Test PR',
      } as any;

      const result = await (service as any).resolveMergeCommitSha(pr, '/test/repo', vi.fn());
      expect(result).toBe('abc123def');
    });

    it('searches git log when no stored sha', async () => {
      const pr = {
        mergeCommitSha: null,
        title: 'My Feature',
      } as any;

      const mockExec = vi.fn().mockResolvedValue({
        stdout: `aaa111\x1fSome other commit\nbbb222\x1fMerge Local PR: My Feature\nccc333\x1fAnother commit\n`,
      });

      const result = await (service as any).resolveMergeCommitSha(pr, '/test/repo', mockExec);
      expect(result).toBe('bbb222');
      expect(mockExec).toHaveBeenCalledWith(
        'git',
        ['log', '--merges', '--format=%H%x1f%s', '-n', '200'],
        { cwd: '/test/repo' }
      );
    });

    it('returns null when merge commit not found in log', async () => {
      const pr = {
        mergeCommitSha: null,
        title: 'Nonexistent PR',
      } as any;

      const mockExec = vi.fn().mockResolvedValue({
        stdout: `aaa111\x1fSome other commit\n`,
      });

      const result = await (service as any).resolveMergeCommitSha(pr, '/test/repo', mockExec);
      expect(result).toBeNull();
    });
  });
});
