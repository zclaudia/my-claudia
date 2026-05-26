import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../../infrastructure/storage/migrations/index.js';
import { BootstrapCandidateRepository } from '../../repositories/bootstrap-candidate-repository.js';

describe('BootstrapCandidateRepository', () => {
  let db: Database.Database;
  let repo: BootstrapCandidateRepository;
  let scanId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run('proj-1', 'P', 'code', 0, 0);
    scanId = 'scan-1';
    db.prepare(
      `INSERT INTO bootstrap_scans (id, project_id, status, started_at, applied_count, pending_count, init_phase)
       VALUES (?, ?, 'running', ?, 0, 0, 'discovering')`
    ).run(scanId, 'proj-1', Date.now());
    repo = new BootstrapCandidateRepository(db);
  });

  it('creates and retrieves a candidate', () => {
    const c = repo.create({
      scanId,
      capability: 'auth',
      title: 'Authentication',
      description: 'User sign-up and login',
      source: 'ai_discovered',
    });
    expect(c.id).toBeTruthy();
    expect(c.phase).toBe('discovered');
    expect(c.selected).toBe(true);
    expect(repo.findById(c.id)?.capability).toBe('auth');
  });

  it('enforces UNIQUE(scan_id, capability)', () => {
    repo.create({ scanId, capability: 'auth', title: 'Auth', description: 'x', source: 'ai_discovered' });
    expect(() =>
      repo.create({ scanId, capability: 'auth', title: 'Auth2', description: 'y', source: 'user_added' })
    ).toThrow(/UNIQUE/);
  });

  it('lists candidates by scan', () => {
    repo.create({ scanId, capability: 'auth', title: 'A', description: 'x', source: 'ai_discovered' });
    repo.create({ scanId, capability: 'billing', title: 'B', description: 'y', source: 'ai_discovered' });
    expect(repo.listByScan(scanId)).toHaveLength(2);
  });

  it('listSelected returns only selected non-excluded candidates', () => {
    const a = repo.create({ scanId, capability: 'a', title: 'A', description: 'x', source: 'ai_discovered' });
    const b = repo.create({ scanId, capability: 'b', title: 'B', description: 'y', source: 'ai_discovered' });
    repo.update(b.id, { selected: false });
    const c = repo.create({ scanId, capability: 'c', title: 'C', description: 'z', source: 'ai_discovered' });
    repo.update(c.id, { phase: 'excluded' });
    const result = repo.listSelected(scanId);
    expect(result.map(x => x.id)).toEqual([a.id]);
  });

  it('updates phase and generation_attempts', () => {
    const c = repo.create({ scanId, capability: 'auth', title: 'A', description: 'x', source: 'ai_discovered' });
    const updated = repo.update(c.id, { phase: 'generating', generation_attempts: 1 });
    expect(updated.phase).toBe('generating');
    expect(updated.generation_attempts).toBe(1);
  });
});
