import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../../infrastructure/storage/migrations/index.js';
import { BootstrapScanRepository } from '../../repositories/bootstrap-scan-repository.js';
import { BootstrapReviewItemRepository } from '../../repositories/bootstrap-review-item-repository.js';

describe('BootstrapReviewItemRepository', () => {
  let db: Database.Database;
  let scanRepo: BootstrapScanRepository;
  let repo: BootstrapReviewItemRepository;
  let scanId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(
      `INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('proj-1', 'P', 'code', 0, 0);
    scanRepo = new BootstrapScanRepository(db);
    repo = new BootstrapReviewItemRepository(db);
    scanId = scanRepo.create({ projectId: 'proj-1' }).id;
  });

  it('create defaults status to pending', () => {
    const item = repo.create({
      scanId,
      capability: 'auth',
      operation: 'modify',
      payloadJson: '{}',
    });
    expect(item.status).toBe('pending');
    expect(item.operation).toBe('modify');
  });

  it('listPendingByScan filters resolved out', () => {
    const a = repo.create({
      scanId,
      capability: 'auth',
      operation: 'modify',
      payloadJson: '{}',
    });
    const b = repo.create({
      scanId,
      capability: 'auth',
      operation: 'remove',
      payloadJson: '{}',
    });
    // Pin created_at so ordering inside listPendingByScan is deterministic.
    db.prepare(`UPDATE bootstrap_review_items SET created_at = ? WHERE id = ?`).run(1, a.id);
    db.prepare(`UPDATE bootstrap_review_items SET created_at = ? WHERE id = ?`).run(2, b.id);
    repo.update(a.id, { status: 'approved', resolvedAt: Date.now() });
    const pending = repo.listPendingByScan(scanId);
    expect(pending.map((i) => i.id)).toEqual([b.id]);
  });

  it('listByScan returns all in creation order', () => {
    const a = repo.create({
      scanId,
      capability: 'a',
      operation: 'modify',
      payloadJson: '{}',
    });
    const b = repo.create({
      scanId,
      capability: 'b',
      operation: 'remove',
      payloadJson: '{}',
    });
    // Pin created_at so ASC ordering by created_at is stable even when both
    // inserts share a millisecond.
    db.prepare(`UPDATE bootstrap_review_items SET created_at = ? WHERE id = ?`).run(1, a.id);
    db.prepare(`UPDATE bootstrap_review_items SET created_at = ? WHERE id = ?`).run(2, b.id);
    expect(repo.listByScan(scanId).map((i) => i.id)).toEqual([a.id, b.id]);
  });

  it('CHECK rejects invalid operation', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO bootstrap_review_items (id, scan_id, capability, operation, payload_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('x', scanId, 'a', 'invalid', '{}', 'pending', 0),
    ).toThrow();
  });

  it('cascade delete: deleting scan removes items', () => {
    repo.create({
      scanId,
      capability: 'auth',
      operation: 'modify',
      payloadJson: '{}',
    });
    db.prepare(`DELETE FROM bootstrap_scans WHERE id = ?`).run(scanId);
    expect(repo.listByScan(scanId)).toEqual([]);
  });
});
