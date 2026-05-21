import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { ExecutorInstanceRepository } from '../executor-instance-repository.js';
import { ManualAdapter } from '../adapters/manual-adapter.js';

describe('ManualAdapter', () => {
  let db: Database.Database;
  let repo: ExecutorInstanceRepository;

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
  });

  it('start() transitions to executing and sets startedAt', async () => {
    const e = repo.create({ projectId: 'proj-1', specChangeId: 'sc', type: 'manual' });
    const a = new ManualAdapter(db, e);
    await a.start({});
    expect(a.getStatus()).toBe('executing');
    const persisted = repo.findById(e.id)!;
    expect(persisted.statusSummary).toBe('executing');
    expect(persisted.startedAt).toBeTruthy();
  });

  it('markCompleted() transitions to completed and sets completedAt', async () => {
    const e = repo.create({ projectId: 'proj-1', specChangeId: 'sc', type: 'manual' });
    const a = new ManualAdapter(db, e);
    await a.start({});
    await a.markCompleted();
    expect(a.getStatus()).toBe('completed');
    expect(repo.findById(e.id)!.completedAt).toBeTruthy();
  });

  it('cancel() works from any state', async () => {
    const e = repo.create({ projectId: 'proj-1', specChangeId: 'sc', type: 'manual' });
    const a = new ManualAdapter(db, e);
    await a.cancel();
    expect(a.getStatus()).toBe('cancelled');
  });

  it('pause/resume cycle', async () => {
    const e = repo.create({ projectId: 'proj-1', specChangeId: 'sc', type: 'manual' });
    const a = new ManualAdapter(db, e);
    await a.start({});
    await a.pause();
    expect(a.getStatus()).toBe('paused');
    await a.resume();
    expect(a.getStatus()).toBe('executing');
  });

  it('getProgress returns -1 fraction while executing, 1 when completed', async () => {
    const e = repo.create({ projectId: 'proj-1', specChangeId: 'sc', type: 'manual' });
    const a = new ManualAdapter(db, e);
    await a.start({});
    expect(a.getProgress().fraction).toBe(-1);
    await a.markCompleted();
    expect(a.getProgress().fraction).toBe(1);
  });
});
