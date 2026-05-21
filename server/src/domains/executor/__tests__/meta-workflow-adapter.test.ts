import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { ExecutorInstanceRepository } from '../executor-instance-repository.js';
import { MetaWorkflowAdapter } from '../adapters/meta-workflow-adapter.js';
import type { MetaWorkflowService } from '../../meta-workflow/service.js';

describe('MetaWorkflowAdapter', () => {
  let db: Database.Database;
  let repo: ExecutorInstanceRepository;
  let service: MetaWorkflowService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(
      `INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('proj-1', 'P', 'code', 0, 0);
    db.prepare(
      `INSERT INTO local_issues (id, project_id, title, description, status, priority, labels, created_at, updated_at, type, is_anonymous)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('i', 'proj-1', 't', null, 'open', 'medium', '[]', 0, 0, 'implement', 0);
    db.prepare(
      `INSERT INTO spec_changes (id, project_id, sub_issue_id, slug, title, status, proposal_path, design_path, tasks_path, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('sc', 'proj-1', 'i', 'x', 'X', 'drafting', 'a', 'b', 'c', 0, 0);
    repo = new ExecutorInstanceRepository(db);
    service = {
      getRun: vi.fn(),
      cancelRun: vi.fn(),
      listPhases: vi.fn().mockReturnValue([]),
    } as unknown as MetaWorkflowService;
  });

  it('getStatus maps MetaWorkflowRunStatus → ExecutorStatus correctly', () => {
    const e = repo.create({
      projectId: 'proj-1',
      specChangeId: 'sc',
      type: 'meta-workflow',
      underlyingId: 'r1',
    });
    (service.getRun as ReturnType<typeof vi.fn>).mockReturnValue({ status: 'executing' });
    const a = new MetaWorkflowAdapter(db, service, e);
    expect(a.getStatus()).toBe('executing');

    (service.getRun as ReturnType<typeof vi.fn>).mockReturnValue({ status: 'completed' });
    expect(a.getStatus()).toBe('completed');

    (service.getRun as ReturnType<typeof vi.fn>).mockReturnValue({ status: 'requirement_draft' });
    expect(a.getStatus()).toBe('pending');
  });

  it('getProgress reports done/total phases', () => {
    const e = repo.create({
      projectId: 'proj-1',
      specChangeId: 'sc',
      type: 'meta-workflow',
      underlyingId: 'r1',
    });
    (service.listPhases as ReturnType<typeof vi.fn>).mockReturnValue([
      { status: 'done' },
      { status: 'done' },
      { status: 'pending' },
      { status: 'pending' },
    ]);
    const a = new MetaWorkflowAdapter(db, service, e);
    const p = a.getProgress();
    expect(p.fraction).toBe(0.5);
    expect(p.summary).toContain('2/4');
    expect(p.metadata).toEqual({ phaseCount: 4, doneCount: 2 });
  });

  it('cancel calls service.cancelRun and persists cancelled status', async () => {
    const e = repo.create({
      projectId: 'proj-1',
      specChangeId: 'sc',
      type: 'meta-workflow',
      underlyingId: 'r1',
    });
    (service.getRun as ReturnType<typeof vi.fn>).mockReturnValue({ status: 'cancelled' });
    const a = new MetaWorkflowAdapter(db, service, e);
    await a.cancel();
    expect(service.cancelRun).toHaveBeenCalledWith('r1');
    expect(repo.findById(e.id)!.statusSummary).toBe('cancelled');
    expect(repo.findById(e.id)!.completedAt).toBeTruthy();
  });

  it('throws when cancelling without underlyingId', async () => {
    const e = repo.create({ projectId: 'proj-1', specChangeId: 'sc', type: 'meta-workflow' });
    const a = new MetaWorkflowAdapter(db, service, e);
    await expect(a.cancel()).rejects.toThrow(/underlyingId/);
    expect(service.cancelRun).not.toHaveBeenCalled();
  });
});
