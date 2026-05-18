// server/src/domains/meta-workflow/__tests__/reuse-pool-promotion.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaWorkflowReusePoolRepository } from '../repositories/meta-workflow-reuse-pool-repository.js';
import { MetaSubagentTemplateRepository } from '../repositories/meta-subagent-template-repository.js';
import { ReusePoolPromotionService } from '../reuse-pool-promotion.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY);`);
  db.exec(m069.sql);
  return db;
}

describe('ReusePoolPromotionService', () => {
  let db: Database.Database;
  let poolRepo: MetaWorkflowReusePoolRepository;
  let subagentRepo: MetaSubagentTemplateRepository;
  let promote: ReusePoolPromotionService;

  beforeEach(() => {
    db = freshDb();
    poolRepo = new MetaWorkflowReusePoolRepository(db);
    subagentRepo = new MetaSubagentTemplateRepository(db);
    promote = new ReusePoolPromotionService(poolRepo, subagentRepo);
  });

  it('promotes a workflow-kind item: strips auto tags, flips sourceType, adds user tags', () => {
    const item = poolRepo.create({
      kind: 'workflow', entityId: 'wf-1', phaseType: 'code-implement',
      description: 'old desc',
      tags: ['auto-generated', 'run-abc', 'phase-1', 'keep-me'],
      sourceType: 'auto', createdAt: 10,
    });
    const result = promote.promote(item.id, {
      newTags: ['keep-me', 'jpa-impl'],
      newDescription: 'JPA impl template',
    });
    expect(result.sourceType).toBe('user');
    expect(result.tags.sort()).toEqual(['jpa-impl', 'keep-me']);
    expect(result.description).toBe('JPA impl template');
    expect(result.tags).not.toContain('auto-generated');
    expect(result.tags).not.toContain('run-abc');
  });

  it('also flips subagent template sourceType when kind=subagent', () => {
    const now = Date.now();
    const tmpl = subagentRepo.create({
      systemPrompt: 'investigate',
      allowedTools: ['Read'],
      maxTurns: 30,
      terminationCondition: { kind: 'output-file', target: 'r.md' },
      sourceType: 'auto', createdAt: now, updatedAt: now,
    });
    const item = poolRepo.create({
      kind: 'subagent', entityId: tmpl.id, phaseType: 'investigation',
      description: 'invest', tags: ['auto-generated'], sourceType: 'auto', createdAt: now,
    });
    promote.promote(item.id, { newTags: ['my-investigation'] });

    const refetched = subagentRepo.findById(tmpl.id);
    expect(refetched?.sourceType).toBe('user');
  });

  it('throws on missing pool item', () => {
    expect(() => promote.promote('missing', { newTags: [] })).toThrow(/not found/);
  });

  it('throws when subagent template is missing for a subagent-kind item', () => {
    const item = poolRepo.create({
      kind: 'subagent', entityId: 'orphan-tmpl-id', phaseType: 'investigation',
      tags: [], sourceType: 'auto', createdAt: Date.now(),
    });
    expect(() => promote.promote(item.id, { newTags: [] })).toThrow(/subagent template/);
  });
});
