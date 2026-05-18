// server/src/domains/meta-workflow/__tests__/meta-workflow-artifact-repository.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaWorkflowArtifactRepository } from '../repositories/meta-workflow-artifact-repository.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY);`);
  db.exec(m069.sql);
  db.prepare(`INSERT INTO projects (id) VALUES (?)`).run('proj-1');
  db.prepare(
    `INSERT INTO meta_workflow_runs (id, project_id, title, status, reject_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('run-1', 'proj-1', 't', 'executing', 0, 0, 0);
  db.prepare(
    `INSERT INTO meta_workflow_phases (id, run_id, phase_id, phase_type, status, execute_entity, attempt, max_retries, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('phase-rec-1', 'run-1', 'p1', 'code-implement', 'done', 'workflow', 0, 3, 0);
  return db;
}

describe('MetaWorkflowArtifactRepository', () => {
  let db: Database.Database;
  let repo: MetaWorkflowArtifactRepository;

  beforeEach(() => {
    db = freshDb();
    repo = new MetaWorkflowArtifactRepository(db);
  });

  it('creates a versioned artifact', () => {
    const a = repo.create({
      phaseRecordId: 'phase-rec-1',
      version: 1,
      commitSha: 'abc123',
      status: 'active',
      artifactFiles: [{ kind: 'file', path: 'src/Foo.java' }],
      gateResults: [{ gateId: 'compile', passed: true, exitCode: 0 }],
      createdAt: Date.now(),
    });
    expect(a.id).toBeTruthy();
    expect(a.version).toBe(1);
    expect(a.commitSha).toBe('abc123');
    expect(a.gateResults?.[0].passed).toBe(true);
  });

  it('UNIQUE (phase_record_id, version) prevents duplicates', () => {
    const now = Date.now();
    repo.create({ phaseRecordId: 'phase-rec-1', version: 1, status: 'active', createdAt: now });
    expect(() =>
      repo.create({ phaseRecordId: 'phase-rec-1', version: 1, status: 'active', createdAt: now }),
    ).toThrow(/UNIQUE/);
  });

  it('findLatestByPhase returns highest version', () => {
    repo.create({ phaseRecordId: 'phase-rec-1', version: 1, status: 'stale', createdAt: 10 });
    repo.create({ phaseRecordId: 'phase-rec-1', version: 2, status: 'active', createdAt: 20 });
    const latest = repo.findLatestByPhase('phase-rec-1');
    expect(latest?.version).toBe(2);
    expect(latest?.status).toBe('active');
  });

  it('markAllStaleForPhase flips active → stale', () => {
    repo.create({ phaseRecordId: 'phase-rec-1', version: 1, status: 'active', createdAt: 10 });
    repo.markAllStaleForPhase('phase-rec-1');
    const all = repo.findByPhase('phase-rec-1');
    expect(all.every((a) => a.status === 'stale')).toBe(true);
  });
});
