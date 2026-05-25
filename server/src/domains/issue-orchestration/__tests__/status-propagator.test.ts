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
    expect(deriveSubIssueStatus([mkInst('pending'), mkInst('pending')], 'open')).toBeNull();
  });

  it('any executing → tracked', () => {
    expect(deriveSubIssueStatus([mkInst('pending'), mkInst('executing')], 'open')).toBe('tracked');
  });

  it('any paused → tracked', () => {
    expect(deriveSubIssueStatus([mkInst('paused')], 'tracked')).toBe('tracked');
  });

  it('all terminal mixed (completed + failed) → tracked (awaits human close)', () => {
    expect(deriveSubIssueStatus([mkInst('completed'), mkInst('failed')], 'tracked')).toBe('tracked');
  });

  it('all cancelled → cancelled', () => {
    expect(deriveSubIssueStatus([mkInst('cancelled'), mkInst('cancelled')], 'tracked')).toBe('cancelled');
  });

  it('all completed → tracked (awaits human close)', () => {
    expect(deriveSubIssueStatus([mkInst('completed')], 'tracked')).toBe('tracked');
  });

  it('mixed pending + completed → tracked (touched but not done)', () => {
    expect(deriveSubIssueStatus([mkInst('pending'), mkInst('completed')], 'open')).toBe('tracked');
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

  it('executor start triggers sub_issue → tracked via propagator', async () => {
    const specChangeService = new SpecChangeService({ db, getProjectRoot: () => projectRoot });
    const dispatcher = new EventDispatcher<IssueDomainEvent>();
    const lifecycle = new IssueLifecycle({ db, specChangeService, dispatcher });
    const { issue, specChange } = lifecycle.createSubIssue({ projectId: 'proj-1', type: 'implement', title: 'A' });

    const registry = new ExecutorRegistry();
    registry.register('manual', (inst) => new ManualAdapter(db, inst));
    const execService = new ExecutorService({ db, registry, dispatcher });
    const execRepo = new ExecutorInstanceRepository(db);
    const inst = execRepo.create({ projectId: 'proj-1', specChangeId: specChange.id, type: 'manual' });

    const propagator = new IssueStatusPropagator({ db, dispatcher, lifecycle });
    propagator.install();

    await execService.start(inst.id);
    expect(lifecycle.getIssue(issue.id)!.status).toBe('tracked');
  });

  it('manual markCompleted (single executor) keeps sub_issue at tracked (awaits human close)', async () => {
    const specChangeService = new SpecChangeService({ db, getProjectRoot: () => projectRoot });
    const dispatcher = new EventDispatcher<IssueDomainEvent>();
    const lifecycle = new IssueLifecycle({ db, specChangeService, dispatcher });
    const { issue, specChange } = lifecycle.createSubIssue({ projectId: 'proj-1', type: 'implement', title: 'A' });

    const registry = new ExecutorRegistry();
    registry.register('manual', (inst) => new ManualAdapter(db, inst));
    const execService = new ExecutorService({ db, registry, dispatcher });
    const execRepo = new ExecutorInstanceRepository(db);
    const inst = execRepo.create({ projectId: 'proj-1', specChangeId: specChange.id, type: 'manual' });

    new IssueStatusPropagator({ db, dispatcher, lifecycle }).install();

    await execService.start(inst.id);
    await execService.markCompleted(inst.id);
    expect(lifecycle.getIssue(issue.id)!.status).toBe('tracked');
  });
});
