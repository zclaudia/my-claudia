import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { LocalIssueCommentService } from '../comment-service.js';
import { LocalIssueService } from '../service.js';

type BroadcastFn = (projectId: string, msg: ServerMessage) => void;

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  // local_issues.project_id has a FK to projects(id); seed the row used by the
  // tests below so create() doesn't trip the foreign-key constraint.
  db.prepare(
    `INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  ).run('proj-1', 'P', 'code', 0, 0);
  return db;
}

describe('LocalIssueCommentService', () => {
  let db: ReturnType<typeof createTestDb>;
  let broadcast: ReturnType<typeof vi.fn>;
  let issueService: LocalIssueService;
  let commentService: LocalIssueCommentService;
  let issueId: string;

  beforeEach(() => {
    db = createTestDb();
    broadcast = vi.fn();
    issueService = new LocalIssueService(db, broadcast as unknown as BroadcastFn);
    commentService = new LocalIssueCommentService(db, broadcast as unknown as BroadcastFn);
    const issue = issueService.createIssue('proj-1', { title: 'parent issue' });
    issueId = issue.id;
    broadcast.mockClear();
  });

  it('createComment persists + broadcasts a comment_update event', () => {
    const comment = commentService.createComment(issueId, 'hello world');
    expect(comment.id).toBeDefined();
    expect(comment.body).toBe('hello world');
    expect(comment.issueId).toBe(issueId);
    expect(broadcast).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({
        type: 'local_issue_comment_update',
        issueId,
        comment: expect.objectContaining({ body: 'hello world' }),
      }),
    );
  });

  it('createComment trims and rejects empty bodies', () => {
    expect(() => commentService.createComment(issueId, '   ')).toThrow(/empty/);
    const c = commentService.createComment(issueId, '  spaced  ');
    expect(c.body).toBe('spaced');
  });

  it('createComment rejects when issue does not exist', () => {
    expect(() => commentService.createComment('missing-issue', 'body')).toThrow(/not found/);
  });

  it('listByIssue returns comments in creation order', async () => {
    commentService.createComment(issueId, 'first');
    // small delay to ensure timestamps differ
    await new Promise((r) => setTimeout(r, 2));
    commentService.createComment(issueId, 'second');
    const list = commentService.listByIssue(issueId);
    expect(list.map((c) => c.body)).toEqual(['first', 'second']);
  });

  it('updateComment changes body + bumps updated_at + broadcasts', async () => {
    const created = commentService.createComment(issueId, 'original');
    broadcast.mockClear();
    await new Promise((r) => setTimeout(r, 5));
    const updated = commentService.updateComment(created.id, 'revised');
    expect(updated.body).toBe('revised');
    expect(updated.updatedAt).toBeGreaterThan(created.updatedAt);
    expect(broadcast).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({ type: 'local_issue_comment_update' }),
    );
  });

  it('deleteComment removes + broadcasts comment_deleted', () => {
    const created = commentService.createComment(issueId, 'to delete');
    broadcast.mockClear();
    const result = commentService.deleteComment(created.id);
    expect(result).toEqual({ projectId: 'proj-1', issueId });
    expect(commentService.listByIssue(issueId)).toEqual([]);
    expect(broadcast).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({ type: 'local_issue_comment_deleted', commentId: created.id }),
    );
  });

  it('deleteComment returns null for unknown comment ids', () => {
    expect(commentService.deleteComment('nope')).toBeNull();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('SQLite cascade removes comments when their parent issue is deleted', () => {
    commentService.createComment(issueId, 'a');
    commentService.createComment(issueId, 'b');
    expect(commentService.listByIssue(issueId)).toHaveLength(2);

    issueService.deleteIssue(issueId);
    expect(commentService.listByIssue(issueId)).toEqual([]);
  });
});
