import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../../infrastructure/storage/migrations/index.js';
import { BootstrapScanRepository } from '../../repositories/bootstrap-scan-repository.js';

describe('BootstrapScanRepository', () => {
  let db: Database.Database;
  let repo: BootstrapScanRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(
      `INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('proj-1', 'P', 'code', 0, 0);
    repo = new BootstrapScanRepository(db);
  });

  it('create defaults status to running, started_at to now', () => {
    const s = repo.create({ projectId: 'proj-1' });
    expect(s.status).toBe('running');
    expect(s.startedAt).toBeGreaterThan(0);
    expect(s.appliedCount).toBe(0);
    expect(s.pendingCount).toBe(0);
  });

  it('update transitions status + sets finishedAt + counts', () => {
    const s = repo.create({ projectId: 'proj-1' });
    const upd = repo.update(s.id, {
      status: 'completed',
      finishedAt: 9999,
      appliedCount: 5,
      pendingCount: 0,
    });
    expect(upd.status).toBe('completed');
    expect(upd.finishedAt).toBe(9999);
    expect(upd.appliedCount).toBe(5);
  });

  it('findActiveByProject returns only running or awaiting_review', () => {
    const a = repo.create({ projectId: 'proj-1' });
    repo.update(a.id, { status: 'completed' });
    expect(repo.findActiveByProject('proj-1')).toBeNull();
    const b = repo.create({ projectId: 'proj-1' });
    repo.update(b.id, { status: 'awaiting_review' });
    expect(repo.findActiveByProject('proj-1')!.id).toBe(b.id);
  });

  it('CHECK constraint rejects invalid status', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO bootstrap_scans (id, project_id, status, started_at) VALUES (?, ?, ?, ?)`,
        )
        .run('x', 'proj-1', 'invalid', 0),
    ).toThrow();
  });

  it('listByProject returns all scans newest first', () => {
    const a = repo.create({ projectId: 'proj-1' });
    // Bump `started_at` deterministically so DESC ordering is stable even
    // when the two creates land in the same millisecond on fast hardware.
    db.prepare(`UPDATE bootstrap_scans SET started_at = ? WHERE id = ?`).run(1, a.id);
    const b = repo.create({ projectId: 'proj-1' });
    db.prepare(`UPDATE bootstrap_scans SET started_at = ? WHERE id = ?`).run(2, b.id);
    const items = repo.listByProject('proj-1');
    expect(items.map((i) => i.id)).toEqual([b.id, a.id]);
  });

  describe('init_phase column', () => {
    it('round-trips init_phase through create + update', () => {
      const scan = repo.create({ projectId: 'proj-1' });
      const updated = repo.update(scan.id, { initPhase: 'discovering' });
      expect(updated.initPhase).toBe('discovering');
    });

    it('initPhase is undefined for legacy/rescan scans', () => {
      const scan = repo.create({ projectId: 'proj-1' });
      expect(scan.initPhase).toBeUndefined();
    });
  });
});
