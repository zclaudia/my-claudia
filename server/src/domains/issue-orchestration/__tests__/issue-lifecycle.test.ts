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
import type { IssueDomainEvent } from '../events.js';

describe('IssueLifecycle', () => {
  let db: Database.Database;
  let projectRoot: string;
  let dispatcher: EventDispatcher<IssueDomainEvent>;
  let lifecycle: IssueLifecycle;

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
  });

  afterEach(() => {
    db.close();
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
  });

  it('createParent creates a feature-type issue with no SpecChange', () => {
    const parent = lifecycle.createParent({ projectId: 'proj-1', title: 'Add 2FA' });
    expect(parent.type).toBe('feature');
    expect(parent.status).toBe('open');
    expect(parent.specChangeId).toBeUndefined();
  });

  it('createSubIssue auto-creates a SpecChange and scaffolds files', () => {
    const parent = lifecycle.createParent({ projectId: 'proj-1', title: 'Add 2FA' });
    const { issue, specChange } = lifecycle.createSubIssue({
      projectId: 'proj-1', type: 'implement', title: 'Initial 2FA flow', parentIssueId: parent.id,
    });
    expect(issue.type).toBe('implement');
    expect(issue.parentIssueId).toBe(parent.id);
    expect(issue.specChangeId).toBe(specChange.id);
    expect(specChange.slug).toBe('initial-2fa-flow');
    expect(fs.existsSync(join(projectRoot, 'openspec', 'changes', specChange.slug, 'proposal.md'))).toBe(true);
  });

  it('createSubIssue without parentIssueId creates a standalone sub-issue', () => {
    const { issue, specChange } = lifecycle.createSubIssue({
      projectId: 'proj-1', type: 'bug', title: 'Fix login redirect',
    });
    expect(issue.parentIssueId).toBeUndefined();
    expect(issue.specChangeId).toBe(specChange.id);
  });

  it('createSubIssue rejects when parent is not a feature', () => {
    const sub = lifecycle.createSubIssue({ projectId: 'proj-1', type: 'implement', title: 'A' });
    expect(() => lifecycle.createSubIssue({
      projectId: 'proj-1', type: 'bug', title: 'B', parentIssueId: sub.issue.id,
    })).toThrow(/must be of type 'feature'/);
  });

  it('createSubIssue rejects mismatched projectId', () => {
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('proj-2', 'B', 'code', 0, 0);
    const parent = lifecycle.createParent({ projectId: 'proj-1', title: 'F' });
    expect(() => lifecycle.createSubIssue({
      projectId: 'proj-2', type: 'implement', title: 'X', parentIssueId: parent.id,
    })).toThrow(/different project/);
  });

  it('transitionStatus enforces legal transitions', () => {
    const { issue } = lifecycle.createSubIssue({ projectId: 'proj-1', type: 'implement', title: 'A' });
    lifecycle.transitionStatus(issue.id, 'planning');
    expect(lifecycle.getIssue(issue.id)!.status).toBe('planning');
    // Illegal: planning → reviewing (must go through tasks_ready → executing first)
    expect(() => lifecycle.transitionStatus(issue.id, 'reviewing')).toThrow(/Illegal status transition/);
  });

  it('reviewing can revert to executing if review surfaces issues', () => {
    const { issue } = lifecycle.createSubIssue({ projectId: 'proj-1', type: 'implement', title: 'A' });
    lifecycle.transitionStatus(issue.id, 'planning');
    lifecycle.transitionStatus(issue.id, 'tasks_ready');
    lifecycle.transitionStatus(issue.id, 'executing');
    lifecycle.transitionStatus(issue.id, 'reviewing');
    expect(() => lifecycle.transitionStatus(issue.id, 'executing')).not.toThrow();
  });

  it('closeSubIssue dispatches a sub_issue.status_changed event', () => {
    const { issue } = lifecycle.createSubIssue({ projectId: 'proj-1', type: 'implement', title: 'A' });
    lifecycle.transitionStatus(issue.id, 'planning');
    lifecycle.transitionStatus(issue.id, 'tasks_ready');
    lifecycle.transitionStatus(issue.id, 'executing');
    lifecycle.transitionStatus(issue.id, 'reviewing');
    const events: IssueDomainEvent[] = [];
    dispatcher.on('sub_issue.status_changed', (e) => events.push(e));
    lifecycle.closeSubIssue(issue.id);
    expect(events).toHaveLength(1);
    if (events[0].type === 'sub_issue.status_changed') {
      expect(events[0].prev).toBe('reviewing');
      expect(events[0].next).toBe('closed');
    }
    expect(lifecycle.getIssue(issue.id)!.closedAt).toBeTruthy();
  });

  it('parent feature uses simpler status machine', () => {
    const parent = lifecycle.createParent({ projectId: 'proj-1', title: 'F' });
    lifecycle.transitionStatus(parent.id, 'closed');
    expect(lifecycle.getIssue(parent.id)!.status).toBe('closed');
    expect(() => lifecycle.transitionStatus(parent.id, 'planning')).toThrow(/Illegal/);
  });
});
