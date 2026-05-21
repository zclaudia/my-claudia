// server/src/domains/issue-orchestration/__tests__/status-propagator.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { ExecutorInstanceRepository, ExecutorRegistry, ManualAdapter } from '../../executor/index.js';
import { SpecChangeService } from '../../openspec/spec-change-service.js';
import { EventDispatcher } from '../../supervision/event-dispatcher.js';
import { ExecutorService } from '../executor-service.js';
import { IssueLifecycle } from '../issue-lifecycle.js';
import { IssueStatusPropagator, deriveSubIssueStatus } from '../status-propagator.js';
import type { IssueDomainEvent } from '../events.js';
import type { ExecutorInstance, ExecutorStatus } from '@my-claudia/shared/features/executor';

function mkInst(status: ExecutorStatus): ExecutorInstance {
  return {
    id: Math.random().toString(36).slice(2),
    projectId: 'proj-1',
    specChangeId: 'sc',
    type: 'manual',
    statusSummary: status,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('deriveSubIssueStatus (pure)', () => {
  it('all pending → null (no transition)', () => {
    expect(deriveSubIssueStatus([mkInst('pending'), mkInst('pending')], 'tasks_ready')).toBeNull();
  });

  it('any executing → executing', () => {
    expect(deriveSubIssueStatus([mkInst('pending'), mkInst('executing')], 'tasks_ready')).toBe('executing');
  });

  it('any paused → executing', () => {
    expect(deriveSubIssueStatus([mkInst('paused')], 'executing')).toBe('executing');
  });

  it('all terminal mixed (completed + failed) → reviewing', () => {
    expect(deriveSubIssueStatus([mkInst('completed'), mkInst('failed')], 'executing')).toBe('reviewing');
  });

  it('all cancelled → cancelled', () => {
    expect(deriveSubIssueStatus([mkInst('cancelled'), mkInst('cancelled')], 'executing')).toBe('cancelled');
  });

  it('all completed → reviewing', () => {
    expect(deriveSubIssueStatus([mkInst('completed')], 'executing')).toBe('reviewing');
  });

  it('mixed pending + completed → executing (touched but not done)', () => {
    expect(deriveSubIssueStatus([mkInst('pending'), mkInst('completed')], 'tasks_ready')).toBe('executing');
  });

  it('empty list → null', () => {
    expect(deriveSubIssueStatus([], 'open')).toBeNull();
  });
});

describe('IssueStatusPropagator (integration)', () => {
  let db: Database.Database;
  let projectRoot: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run('proj-1', 'P', 'code', 0, 0);
    projectRoot = mkdtempSync(join(tmpdir(), 'prop-'));
  });

  afterEach(() => {
    db.close();
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
  });

  it('executor start triggers sub_issue → executing via propagator', async () => {
    const specChangeService = new SpecChangeService({ db, getProjectRoot: () => projectRoot });
    const dispatcher = new EventDispatcher<IssueDomainEvent>();
    const lifecycle = new IssueLifecycle({ db, specChangeService, dispatcher });
    const { issue, specChange } = lifecycle.createSubIssue({ projectId: 'proj-1', type: 'implement', title: 'A' });
    lifecycle.transitionStatus(issue.id, 'planning');
    lifecycle.transitionStatus(issue.id, 'tasks_ready');

    const registry = new ExecutorRegistry();
    registry.register('manual', (inst) => new ManualAdapter(db, inst));
    const execService = new ExecutorService({ db, registry, dispatcher });
    const execRepo = new ExecutorInstanceRepository(db);
    const inst = execRepo.create({ projectId: 'proj-1', specChangeId: specChange.id, type: 'manual' });

    const propagator = new IssueStatusPropagator({ db, dispatcher, lifecycle });
    propagator.install();

    await execService.start(inst.id);
    expect(lifecycle.getIssue(issue.id)!.status).toBe('executing');
  });

  it('manual markCompleted (single executor) triggers sub_issue → reviewing', async () => {
    const specChangeService = new SpecChangeService({ db, getProjectRoot: () => projectRoot });
    const dispatcher = new EventDispatcher<IssueDomainEvent>();
    const lifecycle = new IssueLifecycle({ db, specChangeService, dispatcher });
    const { issue, specChange } = lifecycle.createSubIssue({ projectId: 'proj-1', type: 'implement', title: 'A' });
    lifecycle.transitionStatus(issue.id, 'planning');
    lifecycle.transitionStatus(issue.id, 'tasks_ready');

    const registry = new ExecutorRegistry();
    registry.register('manual', (inst) => new ManualAdapter(db, inst));
    const execService = new ExecutorService({ db, registry, dispatcher });
    const execRepo = new ExecutorInstanceRepository(db);
    const inst = execRepo.create({ projectId: 'proj-1', specChangeId: specChange.id, type: 'manual' });

    new IssueStatusPropagator({ db, dispatcher, lifecycle }).install();

    await execService.start(inst.id);
    await execService.markCompleted(inst.id);
    expect(lifecycle.getIssue(issue.id)!.status).toBe('reviewing');
  });
});
