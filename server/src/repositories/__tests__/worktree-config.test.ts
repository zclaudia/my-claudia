import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { WorktreeConfigRepository } from '../worktree-config.js';

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE worktree_configs (
      project_id TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      auto_create_pr INTEGER DEFAULT 0,
      auto_review INTEGER DEFAULT 0,
      PRIMARY KEY (project_id, worktree_path)
    );
  `);
  return db;
}

describe('WorktreeConfigRepository', () => {
  let db: ReturnType<typeof createTestDb>;
  let repo: WorktreeConfigRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new WorktreeConfigRepository(db);
  });

  afterAll(() => {
    db.close();
  });

  describe('findByProjectId', () => {
    it('returns empty array when no configs exist', () => {
      expect(repo.findByProjectId('p1')).toEqual([]);
    });

    it('returns all configs for a project', () => {
      db.prepare('INSERT INTO worktree_configs VALUES (?, ?, ?, ?)').run('p1', '/wt1', 1, 0);
      db.prepare('INSERT INTO worktree_configs VALUES (?, ?, ?, ?)').run('p1', '/wt2', 0, 1);

      const configs = repo.findByProjectId('p1');
      expect(configs).toHaveLength(2);
      expect(configs[0].projectId).toBe('p1');
      expect(configs[0].worktreePath).toBe('/wt1');
      expect(configs[0].autoCreatePR).toBe(true);
      expect(configs[0].autoReview).toBe(false);
    });

    it('does not return configs for other projects', () => {
      db.prepare('INSERT INTO worktree_configs VALUES (?, ?, ?, ?)').run('p1', '/wt1', 1, 0);
      db.prepare('INSERT INTO worktree_configs VALUES (?, ?, ?, ?)').run('p2', '/wt2', 0, 1);

      expect(repo.findByProjectId('p1')).toHaveLength(1);
    });
  });

  describe('findOne', () => {
    it('returns null when config not found', () => {
      expect(repo.findOne('p1', '/wt1')).toBeNull();
    });

    it('returns matching config', () => {
      db.prepare('INSERT INTO worktree_configs VALUES (?, ?, ?, ?)').run('p1', '/wt1', 1, 1);

      const config = repo.findOne('p1', '/wt1');
      expect(config).not.toBeNull();
      expect(config!.autoCreatePR).toBe(true);
      expect(config!.autoReview).toBe(true);
    });
  });

  describe('upsert', () => {
    it('inserts new config', () => {
      const result = repo.upsert({
        projectId: 'p1',
        worktreePath: '/wt1',
        autoCreatePR: true,
        autoReview: false,
      });

      expect(result.projectId).toBe('p1');
      expect(result.autoCreatePR).toBe(true);
      expect(result.autoReview).toBe(false);
    });

    it('updates existing config', () => {
      repo.upsert({ projectId: 'p1', worktreePath: '/wt1', autoCreatePR: false, autoReview: false });
      const updated = repo.upsert({ projectId: 'p1', worktreePath: '/wt1', autoCreatePR: true, autoReview: true });

      expect(updated.autoCreatePR).toBe(true);
      expect(updated.autoReview).toBe(true);
      expect(repo.findByProjectId('p1')).toHaveLength(1);
    });
  });

  describe('delete', () => {
    it('deletes existing config', () => {
      repo.upsert({ projectId: 'p1', worktreePath: '/wt1', autoCreatePR: true, autoReview: false });
      repo.delete('p1', '/wt1');
      expect(repo.findOne('p1', '/wt1')).toBeNull();
    });

    it('does nothing for non-existent config', () => {
      expect(() => repo.delete('p1', '/wt1')).not.toThrow();
    });
  });
});
