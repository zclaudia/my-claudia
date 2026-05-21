import { describe, it, expect } from 'vitest';
import type { SpecChange, SpecChangeStatus } from '../spec-change.js';
import type { ExecutorInstance, ExecutorStatus, ExecutorType } from '../executor.js';
import type { LocalIssue, LocalIssueType, LocalIssueStatus } from '../local-issue.js';

describe('OpenSpec G1 shared type sanity', () => {
  it('SpecChangeStatus enum covers all designed states', () => {
    const all: SpecChangeStatus[] = ['drafting', 'proposing', 'designing', 'tasks_ready', 'archived', 'cancelled'];
    expect(all.length).toBe(6);
  });

  it('ExecutorStatus enum covers all designed states', () => {
    const all: ExecutorStatus[] = ['pending', 'executing', 'paused', 'completed', 'failed', 'cancelled'];
    expect(all.length).toBe(6);
  });

  it('ExecutorType enum includes the 4 G1 adapter targets', () => {
    const all: ExecutorType[] = ['classic', 'meta-workflow', 'manual', 'superpowers'];
    expect(all).toContain('classic');
    expect(all).toContain('meta-workflow');
    expect(all).toContain('manual');
  });

  it('LocalIssueType discriminator', () => {
    const all: LocalIssueType[] = ['feature', 'implement', 'bug', 'enhancement', 'chore'];
    expect(all.length).toBe(5);
  });

  it('LocalIssueStatus retains legacy in_progress for backward compat', () => {
    const all: LocalIssueStatus[] = ['open', 'planning', 'tasks_ready', 'executing', 'reviewing', 'closed', 'cancelled', 'in_progress'];
    expect(all).toContain('in_progress');
  });

  it('shapes compile', () => {
    const sc: SpecChange = {
      id: 's1', projectId: 'p1', subIssueId: 'i1', slug: 'add-2fa', title: 'Add 2FA',
      status: 'drafting', proposalPath: 'openspec/changes/add-2fa/proposal.md',
      designPath: 'openspec/changes/add-2fa/design.md', tasksPath: 'openspec/changes/add-2fa/tasks.md',
      deltaSpecPaths: [], deltaPendingMerge: false, createdAt: 0, updatedAt: 0,
    };
    expect(sc.slug).toBe('add-2fa');

    const e: ExecutorInstance = {
      id: 'e1', projectId: 'p1', specChangeId: 's1', type: 'classic',
      underlyingId: 'pc-1', statusSummary: 'pending', createdAt: 0, updatedAt: 0,
    };
    expect(e.type).toBe('classic');

    const li: LocalIssue = {
      id: 'i1', projectId: 'p1', title: 'T', status: 'open', priority: 'medium', labels: [],
      type: 'implement', isAnonymous: false, createdAt: 0, updatedAt: 0,
    };
    expect(li.type).toBe('implement');
  });
});
