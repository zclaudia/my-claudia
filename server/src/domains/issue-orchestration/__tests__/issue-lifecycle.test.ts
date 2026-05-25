// server/src/domains/issue-orchestration/__tests__/issue-lifecycle.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { SpecChangeService } from '../../openspec/spec-change-service.js';
import { EventDispatcher } from '../../supervision/event-dispatcher.js';
import { IssueLifecycle } from '../issue-lifecycle.js';
import { EpicRepository } from '../../epics/repository.js';
import type { IssueDomainEvent } from '../events.js';

describe('IssueLifecycle', () => {
  let db: Database.Database;
  let projectRoot: string;
  let dispatcher: EventDispatcher<IssueDomainEvent>;
  let lifecycle: IssueLifecycle;
  let epicRepo: EpicRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run('proj-1', 'P', 'code', 0, 0);
    projectRoot = mkdtempSync(join(tmpdir(), 'issue-lc-'));
    const specChangeService = new SpecChangeService({ db, getProjectRoot: () => projectRoot });
    dispatcher = new EventDispatcher<IssueDomainEvent>();
    lifecycle = new IssueLifecycle({ db, specChangeService, dispatcher });
    epicRepo = new EpicRepository(db);
  });

  afterEach(() => {
    db.close();
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
  });

  it('createSubIssue auto-creates a SpecChange and scaffolds files', () => {
    const epic = epicRepo.create({ projectId: 'proj-1', title: 'Add 2FA' });
    const { issue, specChange } = lifecycle.createSubIssue({
      projectId: 'proj-1', type: 'implement', title: 'Initial 2FA flow', epicId: epic.id,
    });
    expect(issue.type).toBe('implement');
    expect(issue.epicId).toBe(epic.id);
    expect(issue.specChangeId).toBe(specChange.id);
    expect(specChange.slug).toBe('initial-2fa-flow');
    expect(fs.existsSync(join(projectRoot, 'openspec', 'changes', specChange.slug, 'proposal.md'))).toBe(true);
  });

  it('createSubIssue without an Epic creates a standalone sub-issue', () => {
    const { issue, specChange } = lifecycle.createSubIssue({
      projectId: 'proj-1', type: 'bug', title: 'Fix login redirect',
    });
    expect(issue.epicId).toBeUndefined();
    expect(issue.specChangeId).toBe(specChange.id);
  });

  it('createSubIssue rejects unknown Epic id', () => {
    expect(() => lifecycle.createSubIssue({
      projectId: 'proj-1', type: 'bug', title: 'B', epicId: 'no-such-epic',
    })).toThrow(/Epic not found/);
  });

  it('createSubIssue rejects Epic from another project', () => {
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('proj-2', 'B', 'code', 0, 0);
    const epic = epicRepo.create({ projectId: 'proj-1', title: 'F' });
    expect(() => lifecycle.createSubIssue({
      projectId: 'proj-2', type: 'implement', title: 'X', epicId: epic.id,
    })).toThrow(/different project/);
  });

  it('transitionStatus enforces legal transitions (collapsed 4-state)', () => {
    const { issue } = lifecycle.createSubIssue({ projectId: 'proj-1', type: 'implement', title: 'A' });
    lifecycle.transitionStatus(issue.id, 'tracked');
    expect(lifecycle.getIssue(issue.id)!.status).toBe('tracked');
    // Illegal: tracked → open (cannot revert to triage)
    expect(() => lifecycle.transitionStatus(issue.id, 'open')).toThrow(/Illegal status transition/);
  });

  it('open can transition directly to closed or cancelled (skip tracked)', () => {
    const a = lifecycle.createSubIssue({ projectId: 'proj-1', type: 'bug', title: 'A' });
    expect(() => lifecycle.transitionStatus(a.issue.id, 'closed')).not.toThrow();
    const b = lifecycle.createSubIssue({ projectId: 'proj-1', type: 'bug', title: 'B' });
    expect(() => lifecycle.transitionStatus(b.issue.id, 'cancelled')).not.toThrow();
  });

  it('closeSubIssue dispatches a sub_issue.status_changed event', () => {
    const { issue } = lifecycle.createSubIssue({ projectId: 'proj-1', type: 'implement', title: 'A' });
    lifecycle.transitionStatus(issue.id, 'tracked');
    const events: IssueDomainEvent[] = [];
    dispatcher.on('sub_issue.status_changed', (e) => events.push(e));
    lifecycle.closeSubIssue(issue.id);
    expect(events).toHaveLength(1);
    if (events[0].type === 'sub_issue.status_changed') {
      expect(events[0].prev).toBe('tracked');
      expect(events[0].next).toBe('closed');
    }
    expect(lifecycle.getIssue(issue.id)!.closedAt).toBeTruthy();
  });

  it('C2 invariant: sub-issue cannot enter tracked without a SpecChange', () => {
    // Construct a sub-issue without a SpecChange backing, bypassing
    // createSubIssue which auto-creates one.
    db.prepare(
      `INSERT INTO local_issues (
        id, project_id, title, status, priority, labels,
        type, is_anonymous, created_at, updated_at
      ) VALUES (?, ?, ?, 'open', 'medium', '[]', 'implement', 0, ?, ?)`,
    ).run('orphan', 'proj-1', 'no-spec', 0, 0);
    expect(() => lifecycle.transitionStatus('orphan', 'tracked'))
      .toThrow(/without a SpecChange/);
    // open → closed/cancelled remain legal even without a SpecChange.
    expect(() => lifecycle.transitionStatus('orphan', 'closed')).not.toThrow();
  });
});
