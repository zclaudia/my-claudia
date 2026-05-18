import type {
  MetaWorkflowRunStatus,
  MetaWorkflowPhaseStatus,
} from '@my-claudia/shared/features/meta-workflow';

export const TERMINAL_RUN_STATUSES: MetaWorkflowRunStatus[] = ['completed', 'cancelled'];
export const TERMINAL_PHASE_STATUSES: MetaWorkflowPhaseStatus[] = ['done', 'failed'];

const RUN_TRANSITIONS: Record<MetaWorkflowRunStatus, MetaWorkflowRunStatus[]> = {
  requirement_draft: ['requirement_review', 'cancelled'],
  requirement_review: ['requirement_draft', 'splitting', 'cancelled'],
  splitting: ['executing', 'requirement_draft', 'cancelled'],
  executing: ['reviewing', 'splitting', 'cancelled'],
  reviewing: ['executing', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

const PHASE_TRANSITIONS: Record<MetaWorkflowPhaseStatus, MetaWorkflowPhaseStatus[]> = {
  pending: ['searching_reuse', 'stale'],
  searching_reuse: ['generating', 'ready_to_run', 'failed'],
  generating: ['ready_to_run', 'failed', 'pending'],
  ready_to_run: ['running', 'failed'],
  running: ['verifying_gates', 'failed'],
  verifying_gates: ['done', 'failed'],
  done: ['stale'],
  failed: ['pending'],
  stale: ['pending', 'done'],   // 'done' supports clearStale when upstream re-run produced identical artifact
};

export function assertRunTransition(
  from: MetaWorkflowRunStatus,
  to: MetaWorkflowRunStatus,
): void {
  if (from === to) return;
  if (!RUN_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Invalid run transition: '${from}' -> '${to}'`);
  }
}

export function assertPhaseTransition(
  from: MetaWorkflowPhaseStatus,
  to: MetaWorkflowPhaseStatus,
): void {
  if (from === to) return;
  if (!PHASE_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Invalid phase transition: '${from}' -> '${to}'`);
  }
}

export function assertRunStatusIn(
  status: MetaWorkflowRunStatus,
  allowed: MetaWorkflowRunStatus[],
  action: string,
): void {
  if (!allowed.includes(status)) {
    throw new Error(`Cannot ${action} run in status '${status}'`);
  }
}

export function assertPhaseStatusIn(
  status: MetaWorkflowPhaseStatus,
  allowed: MetaWorkflowPhaseStatus[],
  action: string,
): void {
  if (!allowed.includes(status)) {
    throw new Error(`Cannot ${action} phase in status '${status}'`);
  }
}
