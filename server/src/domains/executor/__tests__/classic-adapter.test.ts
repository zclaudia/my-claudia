import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { ExecutorInstanceRepository } from '../executor-instance-repository.js';
import { ClassicAdapter } from '../adapters/classic-adapter.js';
import type { ChangeLifecycle } from '../../supervision/change-lifecycle.js';
import type { ProjectChange } from '@my-claudia/shared/features/supervision';

function mkChange(over: Partial<ProjectChange> = {}): ProjectChange {
  return {
    id: 'pc-1',
    projectId: 'proj-1',
    title: 't',
    slug: 't',
    status: 'executing',
    summary: '',
    nonGoals: [],
    scope: [],
    acceptanceCriteria: [],
    active: true,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as ProjectChange;
}

describe('ClassicAdapter', () => {
  let db: Database.Database;
  let repo: ExecutorInstanceRepository;
  let lifecycle: ChangeLifecycle;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(
      `INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('proj-1', 'P', 'code', 0, 0);
    db.prepare(
      `INSERT INTO local_issues (id, project_id, title, description, status, priority, labels, created_at, updated_at, type, is_anonymous)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('i', 'proj-1', 't', null, 'open', 'medium', '[]', 0, 0, 'implement', 0);
    db.prepare(
      `INSERT INTO spec_changes (id, project_id, sub_issue_id, slug, title, status, proposal_path, design_path, tasks_path, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('sc', 'proj-1', 'i', 'x', 'X', 'drafting', 'a', 'b', 'c', 0, 0);
    repo = new ExecutorInstanceRepository(db);
    lifecycle = { getChange: vi.fn() } as unknown as ChangeLifecycle;
  });

  it('getStatus maps ChangeStatus → ExecutorStatus correctly', () => {
    const e = repo.create({
      projectId: 'proj-1',
      specChangeId: 'sc',
      type: 'classic',
      underlyingId: 'pc-1',
    });
    (lifecycle.getChange as ReturnType<typeof vi.fn>).mockReturnValue(
      mkChange({ status: 'executing' }),
    );
    const a = new ClassicAdapter(db, lifecycle, e);
    expect(a.getStatus()).toBe('executing');

    (lifecycle.getChange as ReturnType<typeof vi.fn>).mockReturnValue(
      mkChange({ status: 'completed' }),
    );
    expect(a.getStatus()).toBe('completed');

    (lifecycle.getChange as ReturnType<typeof vi.fn>).mockReturnValue(
      mkChange({ status: 'draft' }),
    );
    expect(a.getStatus()).toBe('pending');
  });

  it('start refreshes status from underlying', async () => {
    const e = repo.create({
      projectId: 'proj-1',
      specChangeId: 'sc',
      type: 'classic',
      underlyingId: 'pc-1',
    });
    (lifecycle.getChange as ReturnType<typeof vi.fn>).mockReturnValue(
      mkChange({ status: 'executing' }),
    );
    const a = new ClassicAdapter(db, lifecycle, e);
    await a.start({});
    expect(repo.findById(e.id)!.statusSummary).toBe('executing');
  });

  it('cancel persists cancelled status', async () => {
    const e = repo.create({
      projectId: 'proj-1',
      specChangeId: 'sc',
      type: 'classic',
      underlyingId: 'pc-1',
    });
    const a = new ClassicAdapter(db, lifecycle, e);
    await a.cancel();
    expect(repo.findById(e.id)!.statusSummary).toBe('cancelled');
    expect(repo.findById(e.id)!.completedAt).toBeTruthy();
  });

  it('throws when cancelling without underlyingId', async () => {
    const e = repo.create({ projectId: 'proj-1', specChangeId: 'sc', type: 'classic' });
    const a = new ClassicAdapter(db, lifecycle, e);
    await expect(a.cancel()).rejects.toThrow(/underlyingId/);
  });

  it('returns instance.statusSummary when underlying is missing', () => {
    const e = repo.create({
      projectId: 'proj-1',
      specChangeId: 'sc',
      type: 'classic',
      underlyingId: 'missing',
    });
    (lifecycle.getChange as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const a = new ClassicAdapter(db, lifecycle, e);
    expect(a.getStatus()).toBe('pending'); // fallback to default statusSummary set by repo.create
  });
});
