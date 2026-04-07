import type { TaskStatus } from '@my-claudia/shared/features/supervision';

export const TERMINAL_TASK_STATUSES: TaskStatus[] = [
  'completed',
  'integrated',
  'failed',
  'cancelled',
];

const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  proposed: ['pending', 'cancelled'],
  pending: ['queued', 'blocked', 'failed', 'planning'],
  queued: ['running', 'failed', 'blocked', 'pending', 'cancelled'],
  planning: ['queued', 'cancelled'],
  running: ['reviewing', 'completed', 'failed', 'cancelled', 'pending'],
  completed: ['pending'],
  reviewing: ['integrated', 'merge_conflict', 'queued', 'failed'],
  approved: [],
  integrated: ['pending'],
  rejected: [],
  merge_conflict: ['integrated'],
  blocked: ['pending'],
  failed: ['pending'],
  cancelled: ['pending'],
};

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (from === to) return;
  if (!TASK_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Invalid task transition: '${from}' -> '${to}'`);
  }
}

export function assertTaskStatus(taskStatus: TaskStatus, expected: TaskStatus, action: string): void {
  if (taskStatus !== expected) {
    throw new Error(`Cannot ${action} task in status '${taskStatus}'; must be '${expected}'`);
  }
}

export function assertTaskStatusIn(taskStatus: TaskStatus, allowed: TaskStatus[], action: string): void {
  if (!allowed.includes(taskStatus)) {
    throw new Error(`Cannot ${action} task in status '${taskStatus}'`);
  }
}

export function getLiteFailureTransition(
  currentAttempt: number,
  maxRetries: number,
): { nextStatus: 'pending' | 'failed'; nextAttempt: number } {
  const nextAttempt = currentAttempt + 1;
  return nextAttempt > maxRetries + 1
    ? { nextStatus: 'failed', nextAttempt }
    : { nextStatus: 'pending', nextAttempt };
}
