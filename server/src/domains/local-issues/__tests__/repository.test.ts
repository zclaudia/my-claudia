import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { LocalIssueRepository } from '../repository.js';

describe('LocalIssueRepository G1 extensions', () => {
  let db: Database.Database;
  let repo: LocalIssueRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(
      `INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('proj-1', 'P', 'code', 0, 0);
    repo = new LocalIssueRepository(db);
  });

  it('creates an implement-type sub-issue with a parent', () => {
    const parent = repo.create({ projectId: 'proj-1', title: 'Feature', type: 'feature' });
    const sub = repo.create({
      projectId: 'proj-1',
      title: 'Impl',
      type: 'implement',
      parentIssueId: parent.id,
    });
    expect(sub.type).toBe('implement');
    expect(sub.parentIssueId).toBe(parent.id);
  });

  it('isAnonymous flag round-trips', () => {
    const i = repo.create({ projectId: 'proj-1', title: 'X', isAnonymous: true });
    expect(repo.findById(i.id)!.isAnonymous).toBe(true);
  });

  it('default type is implement', () => {
    const i = repo.create({ projectId: 'proj-1', title: 'X' });
    expect(i.type).toBe('implement');
    expect(i.isAnonymous).toBe(false);
  });
});
