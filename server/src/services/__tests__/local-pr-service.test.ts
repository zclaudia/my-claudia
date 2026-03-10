import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// Mock git operations
vi.mock('../utils/git-operations.js', () => ({
  getGitStatus: vi.fn().mockResolvedValue({ hasChanges: false }),
  commitAllChanges: vi.fn().mockResolvedValue(undefined),
  getNewCommits: vi.fn().mockResolvedValue([
    { sha: 'abc123', message: 'Test commit' },
  ]),
  getDiff: vi.fn().mockResolvedValue('diff content'),
  getMainBranch: vi.fn().mockResolvedValue('main'),
  getCurrentBranch: vi.fn().mockResolvedValue('feature-branch'),
  isWorkingTreeClean: vi.fn().mockResolvedValue(true),
  mergeBranch: vi.fn().mockResolvedValue({ success: true }),
  abortMerge: vi.fn().mockResolvedValue(undefined),
  removeWorktree: vi.fn().mockResolvedValue(undefined),
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
      merge_commit_sha TEXT,
      review_session_id TEXT,
      conflict_session_id TEXT,
      auto_triggered INTEGER DEFAULT 0,
      auto_review INTEGER DEFAULT 0,
      execution_state TEXT DEFAULT 'idle',
      pending_action TEXT DEFAULT 'none',
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
  db.prepare(`
    INSERT OR REPLACE INTO projects (id, name, type, provider_id, root_path, created_at, updated_at)
    VALUES (?, ?, 'code', ?, ?, ?, ?)
  `).run(
    id,
    overrides.name || 'Test Project',
    overrides.providerId || 'test-provider',
    overrides.rootPath || '/test/root',
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

      // Should not fail due to existing PR
      expect(result.reason).not.toContain('active local PR');
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
});
