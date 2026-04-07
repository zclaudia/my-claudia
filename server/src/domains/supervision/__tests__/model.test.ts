import { describe, expect, it } from 'vitest';
import {
  canApproveSetupPhase,
  canPauseAgentPhase,
  canResumeAgentPhase,
  canTickAgentPhase,
  getActiveTaskStatuses,
  getReviewRejectionOutcome,
  holdsTaskWorktree,
  resolvePhaseAfterSetupApproval,
  resolveCreatedTaskStatus,
  shouldActivateAgentForTaskStatus,
  shouldTransitionAgentToActive,
  shouldTransitionAgentToIdle,
} from '../model.js';

describe('supervision model rules', () => {
  it('resolves initial task status from source and trust level', () => {
    expect(resolveCreatedTaskStatus('user', 'low')).toBe('pending');
    expect(resolveCreatedTaskStatus('agent_discovered', 'high')).toBe('pending');
    expect(resolveCreatedTaskStatus('agent_discovered', 'medium')).toBe('proposed');
  });

  it('decides whether agent should activate for a task status', () => {
    expect(shouldActivateAgentForTaskStatus('idle', 'pending')).toBe(true);
    expect(shouldActivateAgentForTaskStatus('idle', 'proposed')).toBe(false);
    expect(shouldActivateAgentForTaskStatus('active', 'pending')).toBe(false);
  });

  it('computes review rejection outcome from retry budget', () => {
    expect(getReviewRejectionOutcome(1, 2)).toEqual({
      nextStatus: 'queued',
      nextAttempt: 2,
    });
    expect(getReviewRejectionOutcome(3, 2)).toEqual({
      nextStatus: 'failed',
      nextAttempt: 4,
    });
  });

  it('defines worktree-holding and active task statuses', () => {
    expect(holdsTaskWorktree('running')).toBe(true);
    expect(holdsTaskWorktree('reviewing')).toBe(true);
    expect(holdsTaskWorktree('queued')).toBe(false);
    expect(getActiveTaskStatuses(true)).toEqual(['pending', 'queued', 'running']);
    expect(getActiveTaskStatuses(false)).toEqual(['pending', 'queued', 'running', 'reviewing']);
  });

  it('defines agent phase transition guards', () => {
    expect(canTickAgentPhase('active')).toBe(true);
    expect(canTickAgentPhase('paused')).toBe(false);
    expect(canPauseAgentPhase('idle')).toBe(true);
    expect(canPauseAgentPhase('archived')).toBe(false);
    expect(canResumeAgentPhase('paused')).toBe(true);
    expect(canResumeAgentPhase('active')).toBe(false);
    expect(canApproveSetupPhase('setup')).toBe(true);
    expect(canApproveSetupPhase('idle')).toBe(false);
    expect(resolvePhaseAfterSetupApproval(true)).toBe('active');
    expect(resolvePhaseAfterSetupApproval(false)).toBe('idle');
    expect(shouldTransitionAgentToIdle('active', 0)).toBe(true);
    expect(shouldTransitionAgentToIdle('active', 1)).toBe(false);
    expect(shouldTransitionAgentToActive('idle')).toBe(true);
    expect(shouldTransitionAgentToActive('paused')).toBe(false);
  });
});
