import type {
  ProjectAgent,
  SupervisionPhase,
  TaskStatus,
  TrustLevel,
} from '@my-claudia/shared/features/supervision';

export type SupervisionTaskSource = 'user' | 'agent_discovered';

export function resolveCreatedTaskStatus(
  source: SupervisionTaskSource,
  trustLevel: TrustLevel,
): TaskStatus {
  if (source === 'user') {
    return 'pending';
  }

  if (source === 'agent_discovered' && trustLevel === 'high') {
    return 'pending';
  }

  return 'proposed';
}

export function shouldActivateAgentForTaskStatus(
  phase: ProjectAgent['phase'],
  status: TaskStatus,
): boolean {
  return phase === 'idle' && status === 'pending';
}

export function canTickAgentPhase(phase: SupervisionPhase): boolean {
  return phase === 'active' || phase === 'idle';
}

export function canPauseAgentPhase(phase: SupervisionPhase): boolean {
  return phase === 'active' || phase === 'idle';
}

export function canResumeAgentPhase(phase: SupervisionPhase): boolean {
  return phase === 'paused';
}

export function canApproveSetupPhase(phase: SupervisionPhase): boolean {
  return phase === 'setup' || phase === 'initializing';
}

export function resolvePhaseAfterSetupApproval(hasActiveTasks: boolean): SupervisionPhase {
  return hasActiveTasks ? 'active' : 'idle';
}

export function shouldTransitionAgentToIdle(
  phase: SupervisionPhase,
  activeTaskCount: number,
): boolean {
  return phase === 'active' && activeTaskCount === 0;
}

export function shouldTransitionAgentToActive(
  phase: SupervisionPhase,
): boolean {
  return phase === 'idle';
}

export function getReviewRejectionOutcome(
  attempt: number,
  maxRetries: number,
): { nextStatus: 'queued' | 'failed'; nextAttempt: number } {
  const nextAttempt = attempt + 1;
  return nextAttempt > maxRetries + 1
    ? { nextStatus: 'failed', nextAttempt }
    : { nextStatus: 'queued', nextAttempt };
}

export function holdsTaskWorktree(status: TaskStatus): boolean {
  return status === 'running' || status === 'reviewing';
}

export function getActiveTaskStatuses(isLite: boolean): TaskStatus[] {
  return isLite
    ? ['pending', 'queued', 'running']
    : ['pending', 'queued', 'running', 'reviewing'];
}
