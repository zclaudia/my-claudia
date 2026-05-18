// server/src/domains/meta-workflow/__tests__/meta-workflow-phase-repository.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaWorkflowPhaseRepository } from '../repositories/meta-workflow-phase-repository.js';

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
  return db;
}

describe('MetaWorkflowPhaseRepository', () => {
  let db: Database.Database;
  let repo: MetaWorkflowPhaseRepository;

  beforeEach(() => {
    db = freshDb();
    repo = new MetaWorkflowPhaseRepository(db);
  });

  it('creates a phase with snapshots', () => {
    const now = Date.now();
    const phase = repo.create({
      runId: 'run-1',
      phaseId: 'p1',
      phaseType: 'code-implement',
      status: 'pending',
      executeEntity: 'workflow',
      attempt: 0,
      maxRetries: 3,
      inputsSnapshot: [{ kind: 'file', source: 'design/requirements.md' }],
      outputsSnapshot: [{ kind: 'commit', description: 'impl' }],
      gatesSnapshot: [{ id: 'compile', description: 'mvn compile', command: 'mvn compile', expect: { exitCode: 0 } }],
      createdAt: now,
    });
    expect(phase.id).toBeTruthy();
    expect(phase.phaseType).toBe('code-implement');
    expect(phase.inputsSnapshot).toHaveLength(1);
    expect(phase.gatesSnapshot?.[0].command).toBe('mvn compile');
  });

  it('findByRun returns phases', () => {
    const now = Date.now();
    repo.create({ runId: 'run-1', phaseId: 'p1', phaseType: 'code-implement', status: 'pending',
                  executeEntity: 'workflow', attempt: 0, maxRetries: 3, createdAt: now });
    repo.create({ runId: 'run-1', phaseId: 'p2', phaseType: 'design-doc', status: 'pending',
                  executeEntity: 'workflow', attempt: 0, maxRetries: 3, createdAt: now + 1 });
    const phases = repo.findByRun('run-1');
    expect(phases).toHaveLength(2);
  });

  it('updates phase status', () => {
    const now = Date.now();
    const created = repo.create({ runId: 'run-1', phaseId: 'p1', phaseType: 'code-implement',
                                  status: 'pending', executeEntity: 'workflow',
                                  attempt: 0, maxRetries: 3, createdAt: now });
    const updated = repo.update(created.id, { status: 'running', attempt: 1, startedAt: now + 10 });
    expect(updated.status).toBe('running');
    expect(updated.attempt).toBe(1);
    expect(updated.startedAt).toBe(now + 10);
  });

  it('stale flag fields round-trip', () => {
    const now = Date.now();
    const phase = repo.create({ runId: 'run-1', phaseId: 'p1', phaseType: 'code-implement',
                                status: 'done', executeEntity: 'workflow',
                                attempt: 1, maxRetries: 3, createdAt: now });
    const updated = repo.update(phase.id, {
      status: 'stale', staleSince: now + 100, staleSourcePhaseId: 'p-upstream',
    });
    expect(updated.status).toBe('stale');
    expect(updated.staleSince).toBe(now + 100);
    expect(updated.staleSourcePhaseId).toBe('p-upstream');
  });

  it('findByRunAndPhaseId returns the unique phase', () => {
    const now = Date.now();
    repo.create({ runId: 'run-1', phaseId: 'p1', phaseType: 'code-implement', status: 'pending',
                  executeEntity: 'workflow', attempt: 0, maxRetries: 3, createdAt: now });
    const phase = repo.findByRunAndPhaseId('run-1', 'p1');
    expect(phase).not.toBeNull();
    expect(phase?.phaseId).toBe('p1');
    expect(repo.findByRunAndPhaseId('run-1', 'missing')).toBeNull();
  });
});
