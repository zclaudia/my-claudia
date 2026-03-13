import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import { LocalPRRepository } from '../local-pr.js';

vi.mock('@my-claudia/shared', async () => {
  const actual = await vi.importActual<typeof import('@my-claudia/shared')>('@my-claudia/shared');
  return { ...actual };
});

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
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
      review_session_id TEXT,
      conflict_session_id TEXT,
      review_notes TEXT,
      status_message TEXT,
      auto_triggered INTEGER DEFAULT 0,
      auto_review INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      merged_at INTEGER,
      merged_commit_sha TEXT,
      execution_state TEXT DEFAULT 'idle',
      pending_action TEXT DEFAULT 'none',
      execution_error TEXT
    );
  `);
  return db;
}

describe('LocalPRRepository', () => {
  let db: ReturnType<typeof createTestDb>;
  let repo: LocalPRRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new LocalPRRepository(db);
  });

  afterAll(() => {
    db.close();
  });

  function createPR(overrides: Record<string, any> = {}) {
    return repo.create({
      projectId: 'proj-1',
      worktreePath: '/wt/branch1',
      branchName: 'feature-1',
      baseBranch: 'main',
      title: 'Test PR',
      status: 'open' as any,
      autoTriggered: false,
      autoReview: false,
      executionState: 'idle' as any,
      pendingAction: 'none' as any,
      ...overrides,
    });
  }

  it('creates and retrieves a PR', () => {
    const pr = createPR();
    expect(pr.id).toBeDefined();
    expect(pr.title).toBe('Test PR');
    expect(pr.status).toBe('open');
    expect(pr.autoTriggered).toBe(false);
    expect(pr.executionState).toBe('idle');
  });

  it('findById returns created PR', () => {
    const pr = createPR();
    const found = repo.findById(pr.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(pr.id);
  });

  it('findById returns null for non-existent', () => {
    expect(repo.findById('nonexistent')).toBeNull();
  });

  it('updates PR fields', () => {
    const pr = createPR();
    repo.update(pr.id, { status: 'reviewing' as any, reviewNotes: 'Looks good' });
    const updated = repo.findById(pr.id);
    expect(updated!.status).toBe('reviewing');
    expect(updated!.reviewNotes).toBe('Looks good');
  });

  it('updates all optional fields', () => {
    const pr = createPR();
    repo.update(pr.id, {
      title: 'Updated Title',
      description: 'A description',
      commits: [{ sha: 'abc', message: 'test', author: 'dev', date: 1000 }],
      diffSummary: 'diff here',
      reviewSessionId: 'sess-1',
      conflictSessionId: 'sess-2',
      statusMessage: 'In progress',
      autoReview: true,
      mergedAt: 1234567890,
      mergeCommitSha: 'sha123',
      executionState: 'running' as any,
      pendingAction: 'review' as any,
      executionError: 'some error',
    });
    const updated = repo.findById(pr.id)!;
    expect(updated.title).toBe('Updated Title');
    expect(updated.description).toBe('A description');
    expect(updated.commits).toEqual([{ sha: 'abc', message: 'test', author: 'dev', date: 1000 }]);
    expect(updated.autoReview).toBe(true);
    expect(updated.executionState).toBe('running');
    expect(updated.pendingAction).toBe('review');
    expect(updated.executionError).toBe('some error');
  });

  it('findByProjectId returns PRs for project', () => {
    createPR({ projectId: 'proj-1' });
    createPR({ projectId: 'proj-1', branchName: 'feature-2', worktreePath: '/wt/2' });
    createPR({ projectId: 'proj-2', worktreePath: '/wt/3' });

    const prs = repo.findByProjectId('proj-1');
    expect(prs).toHaveLength(2);
  });

  it('findByStatus returns matching PRs', () => {
    const pr1 = createPR();
    createPR({ worktreePath: '/wt/2' });
    repo.update(pr1.id, { status: 'approved' as any });

    expect(repo.findByStatus('open' as any)).toHaveLength(1);
    expect(repo.findByStatus('approved' as any)).toHaveLength(1);
  });

  it('findPendingReview returns open PRs', () => {
    createPR();
    const pr2 = createPR({ worktreePath: '/wt/2' });
    repo.update(pr2.id, { status: 'reviewing' as any });

    expect(repo.findPendingReview()).toHaveLength(1);
  });

  it('findPendingAutoReview returns open PRs with auto_review', () => {
    createPR({ autoReview: true });
    createPR({ autoReview: false, worktreePath: '/wt/2' });

    expect(repo.findPendingAutoReview()).toHaveLength(1);
  });

  it('findPendingMerge returns approved PRs', () => {
    const pr = createPR();
    repo.update(pr.id, { status: 'approved' as any });

    expect(repo.findPendingMerge()).toHaveLength(1);
  });

  it('findInProgress returns reviewing/merging PRs', () => {
    const pr1 = createPR();
    const pr2 = createPR({ worktreePath: '/wt/2' });
    repo.update(pr1.id, { status: 'reviewing' as any });
    repo.update(pr2.id, { status: 'merging' as any });

    expect(repo.findInProgress()).toHaveLength(2);
  });

  it('findActiveByWorktree returns active PR', () => {
    createPR({ worktreePath: '/wt/active' });
    expect(repo.findActiveByWorktree('/wt/active')).not.toBeNull();
  });

  it('findActiveByWorktree returns null for merged PRs', () => {
    const pr = createPR({ worktreePath: '/wt/merged' });
    repo.update(pr.id, { status: 'merged' as any });
    expect(repo.findActiveByWorktree('/wt/merged')).toBeNull();
  });

  it('findByExecutionState returns matching PRs', () => {
    const pr = createPR();
    repo.update(pr.id, { executionState: 'queued' as any });

    expect(repo.findByExecutionState('queued' as any)).toHaveLength(1);
    expect(repo.findByExecutionState('idle' as any)).toHaveLength(0);
  });

  it('findQueued delegates to findByExecutionState', () => {
    const pr = createPR();
    repo.update(pr.id, { executionState: 'queued' as any });
    expect(repo.findQueued()).toHaveLength(1);
  });

  it('findFailed delegates to findByExecutionState', () => {
    const pr = createPR();
    repo.update(pr.id, { executionState: 'failed' as any });
    expect(repo.findFailed()).toHaveLength(1);
  });

  it('deletes a PR', () => {
    const pr = createPR();
    repo.delete(pr.id);
    expect(repo.findById(pr.id)).toBeNull();
  });

  it('mapRow handles null/undefined fields', () => {
    const pr = createPR();
    const found = repo.findById(pr.id)!;
    expect(found.description).toBeUndefined();
    expect(found.reviewSessionId).toBeUndefined();
    expect(found.mergedAt).toBeUndefined();
    expect(found.mergeCommitSha).toBeUndefined();
    expect(found.executionError).toBeUndefined();
  });
});
