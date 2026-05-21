import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { ExecutorInstanceRepository } from '../executor-instance-repository.js';

describe('ExecutorInstanceRepository', () => {
  let db: Database.Database;
  let repo: ExecutorInstanceRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    // Seed minimal FK targets
    db.prepare(
      `INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('proj-1', 'P', 'code', 0, 0);
    db.prepare(
      `INSERT INTO local_issues
        (id, project_id, title, description, status, priority, labels, created_at, updated_at, type, is_anonymous)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('issue-1', 'proj-1', 'i', null, 'open', 'medium', '[]', 0, 0, 'implement', 0);
    db.prepare(
      `INSERT INTO spec_changes
        (id, project_id, sub_issue_id, slug, title, status, proposal_path, design_path, tasks_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'sc-1',
      'proj-1',
      'issue-1',
      'add-2fa',
      'Add 2FA',
      'drafting',
      'openspec/changes/add-2fa/proposal.md',
      'openspec/changes/add-2fa/design.md',
      'openspec/changes/add-2fa/tasks.md',
      0,
      0,
    );
    repo = new ExecutorInstanceRepository(db);
  });

  it('create + findById round-trip', () => {
    const e = repo.create({
      projectId: 'proj-1',
      specChangeId: 'sc-1',
      type: 'classic',
      underlyingId: 'pc-1',
    });
    expect(e.id).toBeTruthy();
    expect(e.statusSummary).toBe('pending');
    const f = repo.findById(e.id)!;
    expect(f.type).toBe('classic');
    expect(f.underlyingId).toBe('pc-1');
  });

  it('manual executor has null underlyingId', () => {
    const e = repo.create({ projectId: 'proj-1', specChangeId: 'sc-1', type: 'manual' });
    expect(e.underlyingId).toBeUndefined();
  });

  it('update sets fields and bumps updatedAt', () => {
    const e = repo.create({
      projectId: 'proj-1',
      specChangeId: 'sc-1',
      type: 'classic',
      underlyingId: 'pc-1',
    });
    const before = e.updatedAt;
    const updated = repo.update(e.id, { statusSummary: 'executing', startedAt: 9999 });
    expect(updated.statusSummary).toBe('executing');
    expect(updated.startedAt).toBe(9999);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('listBySpecChange returns instances ordered by created_at', () => {
    const a = repo.create({
      projectId: 'proj-1',
      specChangeId: 'sc-1',
      type: 'classic',
      underlyingId: 'a',
    });
    const b = repo.create({
      projectId: 'proj-1',
      specChangeId: 'sc-1',
      type: 'meta-workflow',
      underlyingId: 'b',
    });
    const items = repo.listBySpecChange('sc-1');
    expect(items.map((i) => i.id)).toEqual([a.id, b.id]);
  });

  it('listByProjectAndStatus filters correctly', () => {
    const a = repo.create({
      projectId: 'proj-1',
      specChangeId: 'sc-1',
      type: 'classic',
      underlyingId: 'a',
    });
    repo.update(a.id, { statusSummary: 'completed' });
    const b = repo.create({
      projectId: 'proj-1',
      specChangeId: 'sc-1',
      type: 'classic',
      underlyingId: 'b',
    });
    const pending = repo.listByProjectAndStatus('proj-1', 'pending');
    expect(pending.map((i) => i.id)).toEqual([b.id]);
  });

  it('CHECK constraint rejects invalid type', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO executor_instances
            (id, project_id, spec_change_id, type, status_summary, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('bad', 'proj-1', 'sc-1', 'invalid', 'pending', 0, 0),
    ).toThrow();
  });
});
