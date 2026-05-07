import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { LocalIssueService } from '../service.js';

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE local_issues (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT NOT NULL DEFAULT 'medium',
      labels TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      closed_at INTEGER
    );
  `);
  return db;
}

describe('LocalIssueService', () => {
  let db: ReturnType<typeof createTestDb>;
  let broadcast: ReturnType<typeof vi.fn>;
  let onDelete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = createTestDb();
    broadcast = vi.fn();
    onDelete = vi.fn();
  });

  it('createIssue persists and broadcasts an update event', () => {
    const service = new LocalIssueService(db, broadcast);
    const issue = service.createIssue('proj-1', { title: 'Bug', priority: 'high' });

    expect(issue.id).toBeDefined();
    expect(issue.status).toBe('open');
    expect(broadcast).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({ type: 'local_issue_update', issue: expect.objectContaining({ id: issue.id }) }),
    );
  });

  it('issueExists returns true for created issue, false otherwise', () => {
    const service = new LocalIssueService(db, broadcast);
    const issue = service.createIssue('proj-1', { title: 'Bug' });

    expect(service.issueExists(issue.id)).toBe(true);
    expect(service.issueExists('does-not-exist')).toBe(false);
  });

  it('deleteIssue invokes onDelete hook before broadcasting removal', () => {
    const callOrder: string[] = [];
    onDelete.mockImplementation(() => callOrder.push('hook'));
    broadcast.mockImplementation((_pid: string, msg: { type: string }) => {
      if (msg.type === 'local_issue_deleted') callOrder.push('broadcast');
    });
    const service = new LocalIssueService(db, broadcast, { onDelete });

    const issue = service.createIssue('proj-1', { title: 'Bug' });
    service.deleteIssue(issue.id);

    expect(onDelete).toHaveBeenCalledWith(issue.id, 'proj-1');
    expect(callOrder).toEqual(['hook', 'broadcast']);
    expect(service.issueExists(issue.id)).toBe(false);
  });

  it('deleteIssue still removes the row when the hook throws', () => {
    onDelete.mockImplementation(() => {
      throw new Error('cleanup boom');
    });
    const service = new LocalIssueService(db, broadcast, { onDelete });

    const issue = service.createIssue('proj-1', { title: 'Bug' });
    expect(() => service.deleteIssue(issue.id)).not.toThrow();
    expect(service.issueExists(issue.id)).toBe(false);
    expect(broadcast).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({ type: 'local_issue_deleted' }),
    );
  });

  it('deleteIssue is a no-op for unknown ids and skips the hook', () => {
    const service = new LocalIssueService(db, broadcast, { onDelete });
    expect(service.deleteIssue('missing')).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });
});
