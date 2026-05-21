import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { SpecChangeRepository } from '../spec-change-repository.js';

describe('SpecChangeRepository', () => {
  let db: Database.Database;
  let repo: SpecChangeRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(
      `INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('proj-1', 'P', 'code', 0, 0);
    db.prepare(
      `INSERT INTO local_issues
        (id, project_id, title, description, status, priority, labels, created_at, updated_at, type, is_anonymous)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('issue-1', 'proj-1', 't', null, 'open', 'medium', '[]', 0, 0, 'implement', 0);
    repo = new SpecChangeRepository(db);
  });

  it('create defaults to drafting with auto-derived paths', () => {
    const sc = repo.create({
      projectId: 'proj-1',
      subIssueId: 'issue-1',
      slug: 'add-2fa',
      title: 'Add 2FA',
    });
    expect(sc.status).toBe('drafting');
    expect(sc.proposalPath).toBe('openspec/changes/add-2fa/proposal.md');
    expect(sc.designPath).toBe('openspec/changes/add-2fa/design.md');
    expect(sc.tasksPath).toBe('openspec/changes/add-2fa/tasks.md');
    expect(sc.deltaSpecPaths).toEqual([]);
    expect(sc.deltaPendingMerge).toBe(false);
  });

  it('update status + deltaPendingMerge + deltaSpecPaths', () => {
    const sc = repo.create({
      projectId: 'proj-1',
      subIssueId: 'issue-1',
      slug: 'x',
      title: 'X',
    });
    const upd = repo.update(sc.id, {
      status: 'tasks_ready',
      deltaSpecPaths: ['openspec/changes/x/specs/auth/spec.md'],
      deltaPendingMerge: true,
    });
    expect(upd.status).toBe('tasks_ready');
    expect(upd.deltaSpecPaths).toEqual(['openspec/changes/x/specs/auth/spec.md']);
    expect(upd.deltaPendingMerge).toBe(true);
  });

  it('findBySubIssue + findBySlug + listByProject', () => {
    const sc = repo.create({
      projectId: 'proj-1',
      subIssueId: 'issue-1',
      slug: 'add-2fa',
      title: 'A',
    });
    expect(repo.findBySubIssue('issue-1')!.id).toBe(sc.id);
    expect(repo.findBySlug('proj-1', 'add-2fa')!.id).toBe(sc.id);
    expect(repo.listByProject('proj-1').map((s) => s.id)).toEqual([sc.id]);
    expect(repo.findBySubIssue('nope')).toBeNull();
  });

  it('archived_at is settable', () => {
    const sc = repo.create({
      projectId: 'proj-1',
      subIssueId: 'issue-1',
      slug: 'x',
      title: 'X',
    });
    const upd = repo.update(sc.id, { status: 'archived', archivedAt: 12345 });
    expect(upd.archivedAt).toBe(12345);
    expect(upd.status).toBe('archived');
  });

  it('CHECK constraint rejects invalid status', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO spec_changes
            (id, project_id, sub_issue_id, slug, title, status,
             proposal_path, design_path, tasks_path, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('bad', 'proj-1', 'issue-1', 'x', 'X', 'invalid', 'p', 'd', 't', 0, 0),
    ).toThrow();
  });
});
