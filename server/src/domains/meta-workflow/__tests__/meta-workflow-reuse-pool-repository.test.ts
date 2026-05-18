// server/src/domains/meta-workflow/__tests__/meta-workflow-reuse-pool-repository.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaWorkflowReusePoolRepository } from '../repositories/meta-workflow-reuse-pool-repository.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY);`);
  db.exec(m069.sql);
  return db;
}

describe('MetaWorkflowReusePoolRepository', () => {
  let db: Database.Database;
  let repo: MetaWorkflowReusePoolRepository;

  beforeEach(() => {
    db = freshDb();
    repo = new MetaWorkflowReusePoolRepository(db);
  });

  it('creates a workflow-kind item with tags', () => {
    const item = repo.create({
      kind: 'workflow',
      entityId: 'wf-1',
      phaseType: 'code-implement',
      description: 'Impl service layer',
      tags: ['auto-generated', 'run-abc', 'phase-1'],
      sourceType: 'auto',
      createdAt: Date.now(),
    });
    expect(item.id).toBeTruthy();
    expect(item.kind).toBe('workflow');
    expect(item.tags).toEqual(['auto-generated', 'run-abc', 'phase-1']);
  });

  it('round-trips JSON tags + metadata', () => {
    const item = repo.create({
      kind: 'subagent',
      entityId: 'sub-1',
      phaseType: 'investigation',
      description: 'Investigation template',
      tags: ['auto-generated'],
      sourceType: 'auto',
      metadata: { generatedFromPhaseId: 'p-1', originalRunId: 'r-1', usageCount: 3, successRate: 0.85 },
      createdAt: Date.now(),
    });
    const fetched = repo.findById(item.id);
    expect(fetched?.metadata?.usageCount).toBe(3);
    expect(fetched?.metadata?.successRate).toBe(0.85);
  });

  it('findByPhaseType filters correctly + excludes archived', () => {
    repo.create({ kind: 'workflow', entityId: 'a', phaseType: 'code-implement',
                  tags: [], sourceType: 'auto', createdAt: 10 });
    repo.create({ kind: 'workflow', entityId: 'b', phaseType: 'code-refactor',
                  tags: [], sourceType: 'auto', createdAt: 20 });
    const item = repo.create({ kind: 'workflow', entityId: 'c', phaseType: 'code-implement',
                  tags: [], sourceType: 'user', createdAt: 30 });
    repo.archive(item.id);

    const implItems = repo.findByPhaseType('code-implement');
    expect(implItems.map((i) => i.entityId)).toEqual(['a']);  // 'c' is archived
  });

  it('archive sets archivedAt + excludes from findByPhaseType', () => {
    const item = repo.create({ kind: 'workflow', entityId: 'x', phaseType: 'code-implement',
                  tags: ['auto-generated'], sourceType: 'auto', createdAt: 10 });
    repo.archive(item.id);
    const fetched = repo.findById(item.id);
    expect(fetched?.archivedAt).toBeGreaterThan(0);
    expect(repo.findByPhaseType('code-implement')).toHaveLength(0);
  });

  it('promote flips sourceType auto → user + strips auto-generated tag', () => {
    const item = repo.create({ kind: 'workflow', entityId: 'x', phaseType: 'code-implement',
                  tags: ['auto-generated', 'run-abc', 'custom-tag'],
                  sourceType: 'auto', createdAt: 10 });
    const promoted = repo.promote(item.id, ['user', 'custom-tag', 'jpa']);
    expect(promoted.sourceType).toBe('user');
    expect(promoted.tags).toEqual(['user', 'custom-tag', 'jpa']);
  });

  it('updateMetadata merges with existing metadata', () => {
    const item = repo.create({ kind: 'workflow', entityId: 'x', phaseType: 'code-implement',
                  tags: [], sourceType: 'auto',
                  metadata: { usageCount: 1 },
                  createdAt: 10 });
    repo.updateMetadata(item.id, { usageCount: 2, successRate: 1.0 });
    const fetched = repo.findById(item.id);
    expect(fetched?.metadata).toEqual({ usageCount: 2, successRate: 1.0 });
  });
});
