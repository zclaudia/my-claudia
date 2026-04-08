import type { WorkflowRunStatus, WorkflowStepRunStatus } from '@my-claudia/shared/features/workflows';

// ── Run transitions ──────────────────────────────────────────────────

const RUN_TRANSITIONS: Record<WorkflowRunStatus, WorkflowRunStatus[]> = {
  pending: ['running', 'cancelled'],
  running: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

// ── Step transitions ─────────────────────────────────────────────────

const STEP_TRANSITIONS: Record<WorkflowStepRunStatus, WorkflowStepRunStatus[]> = {
  pending: ['running', 'waiting', 'skipped'],
  running: ['completed', 'failed', 'skipped'],
  waiting: ['running', 'completed', 'failed', 'skipped'],
  completed: [],
  failed: [],
  skipped: [],
};

// ── Guards ───────────────────────────────────────────────────────────

export function assertRunTransition(from: WorkflowRunStatus, to: WorkflowRunStatus): void {
  if (from === to) return;
  if (!RUN_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Invalid run transition: '${from}' -> '${to}'`);
  }
}

export function assertStepTransition(from: WorkflowStepRunStatus, to: WorkflowStepRunStatus): void {
  if (from === to) return;
  if (!STEP_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Invalid step transition: '${from}' -> '${to}'`);
  }
}

export { RUN_TRANSITIONS, STEP_TRANSITIONS };
