// server/src/domains/meta-workflow/__tests__/reuse-pool-search.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaWorkflowReusePoolRepository } from '../repositories/meta-workflow-reuse-pool-repository.js';
import { ReusePoolSearchService } from '../reuse-pool-search.js';
import type { PhaseDef } from '@my-claudia/shared/features/meta-workflow';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY);`);
  db.exec(m069.sql);
  return db;
}

const phaseDef: PhaseDef = {
  id: 'p1', name: 'Impl UserService', description: 'Implement UserServiceImpl with JPA',
  phaseType: 'code-implement',
  dependsOn: [], inputs: [],
  outputs: [{ kind: 'commit', description: 'commit' }],
  acceptanceGates: [{ id: 'g', description: 'g', command: 'mvn test', expect: { exitCode: 0 } }],
};

describe('ReusePoolSearchService', () => {
  let db: Database.Database;
  let poolRepo: MetaWorkflowReusePoolRepository;
  let search: ReusePoolSearchService;

  beforeEach(() => {
    db = freshDb();
    poolRepo = new MetaWorkflowReusePoolRepository(db);
    search = new ReusePoolSearchService(poolRepo);
  });

  it('returns empty when pool is empty', () => {
    expect(search.search(phaseDef)).toEqual([]);
  });

  it('returns only matching phaseType', () => {
    poolRepo.create({ kind: 'workflow', entityId: 'a', phaseType: 'code-implement',
                      description: 'JPA repo impl', tags: [], sourceType: 'auto', createdAt: 10 });
    poolRepo.create({ kind: 'workflow', entityId: 'b', phaseType: 'code-refactor',
                      description: 'JPA refactor', tags: [], sourceType: 'auto', createdAt: 20 });
    const results = search.search(phaseDef);
    expect(results).toHaveLength(1);
    expect(results[0].item.entityId).toBe('a');
  });

  it('scores by token-overlap on description', () => {
    poolRepo.create({ kind: 'workflow', entityId: 'a', phaseType: 'code-implement',
                      description: 'Random unrelated text', tags: [], sourceType: 'auto', createdAt: 10 });
    poolRepo.create({ kind: 'workflow', entityId: 'b', phaseType: 'code-implement',
                      description: 'Implement JPA user repository', tags: [], sourceType: 'auto', createdAt: 20 });
    const results = search.search(phaseDef);
    expect(results[0].item.entityId).toBe('b'); // higher token overlap with "Implement UserServiceImpl with JPA"
  });

  it('promoted items rank above auto-generated of equal score', () => {
    poolRepo.create({ kind: 'workflow', entityId: 'auto', phaseType: 'code-implement',
                      description: 'identical text here', tags: [], sourceType: 'auto', createdAt: 10 });
    poolRepo.create({ kind: 'workflow', entityId: 'user', phaseType: 'code-implement',
                      description: 'identical text here', tags: [], sourceType: 'user', createdAt: 5 });
    const samePhase: PhaseDef = { ...phaseDef, description: 'identical text here' };
    const results = search.search(samePhase);
    expect(results[0].item.entityId).toBe('user');
  });

  it('respects kind filter from executeEntity', () => {
    poolRepo.create({ kind: 'workflow', entityId: 'w', phaseType: 'investigation',
                      description: 'invest', tags: [], sourceType: 'auto', createdAt: 10 });
    poolRepo.create({ kind: 'subagent', entityId: 's', phaseType: 'investigation',
                      description: 'invest', tags: [], sourceType: 'auto', createdAt: 20 });
    const invPhase: PhaseDef = { ...phaseDef, phaseType: 'investigation', executeEntity: 'subagent' };
    const results = search.search(invPhase);
    expect(results.every((r) => r.item.kind === 'subagent')).toBe(true);
  });

  it('limits to top 5 by default', () => {
    for (let i = 0; i < 8; i += 1) {
      poolRepo.create({ kind: 'workflow', entityId: `e${i}`, phaseType: 'code-implement',
                        description: 'Implement', tags: [], sourceType: 'auto', createdAt: i });
    }
    const results = search.search(phaseDef);
    expect(results).toHaveLength(5);
  });
});
