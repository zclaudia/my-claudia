import type { Database } from 'better-sqlite3';
import type { TaskStatus } from '@my-claudia/shared/features/supervision';
import { SupervisionTaskRepository } from './repositories/supervision-task.js';
import type { SupervisionProjectPort, SupervisionSessionPort } from './ports.js';
import type { SupervisorService } from './supervisor-service.js';
import {
  assertTaskTransition,
  TERMINAL_TASK_STATUSES,
} from './status-machine.js';
import {
  getActiveTaskStatuses,
  holdsTaskWorktree,
} from './model.js';
import { shouldTransitionAgentToIdle } from './model.js';

export interface RecoveryAction {
  type: 'task_requeued' | 'task_failed' | 'worktree_released' | 'session_archived' | 'agent_idle' | 'run_interrupted' | 'recovery_error';
  id: string;
  detail?: string;
}

export interface RecoveryReport {
  actions: RecoveryAction[];
  timestamp: number;
}

export class StateRecovery {
  constructor(
    private db: Database,
    private taskRepo: SupervisionTaskRepository,
    private sessionRepo: SupervisionSessionPort,
    private projectRepo: SupervisionProjectPort,
    private supervisorService: SupervisorService,
    private activeRuns: Map<string, unknown>,
  ) {}

  recover(): RecoveryReport {
    const actions: RecoveryAction[] = [];

    actions.push(...this.safeRecover('recoverInterruptedRuns', () => this.recoverInterruptedRuns()));
    actions.push(...this.safeRecover('recoverStuckTasks', () => this.recoverStuckTasks()));
    actions.push(...this.safeRecover('releaseOrphanedWorktrees', () => this.releaseOrphanedWorktrees()));
    actions.push(...this.safeRecover('archiveOrphanedSessions', () => this.archiveOrphanedSessions()));
    actions.push(...this.safeRecover('fixIdleAgents', () => this.fixIdleAgents()));

    const report: RecoveryReport = {
      actions,
      timestamp: Date.now(),
    };

    if (actions.length > 0) {
      console.log(`[StateRecovery] Recovered ${actions.length} items:`,
        actions.map(a => `${a.type}:${a.id}`).join(', '));
    }

    return report;
  }

  private recoverInterruptedRuns(): RecoveryAction[] {
    const actions: RecoveryAction[] = [];

    const stuck = this.db.prepare(`
      SELECT id, last_run_status FROM sessions
      WHERE last_run_status IN ('running', 'waiting') AND archived_at IS NULL
    `).all() as Array<{ id: string; last_run_status: string }>;

    const now = Date.now();
    for (const s of stuck) {
      this.db.prepare('UPDATE sessions SET last_run_status = ?, updated_at = ? WHERE id = ?')
        .run('interrupted', now, s.id);
      actions.push({
        type: 'run_interrupted',
        id: s.id,
        detail: `Was ${s.last_run_status} when server stopped`,
      });
    }

    return actions;
  }

  private recoverStuckTasks(): RecoveryAction[] {
    const actions: RecoveryAction[] = [];

    const projects = this.projectRepo.findAll();
    for (const project of projects) {
      if (!project.agent) continue;

      const runningTasks = this.taskRepo.findByStatus(project.id, 'running');
      for (const task of runningTasks) {
        // Check if there's an active run for this task
        const clientId = `supervisor_task_${task.id}`;
        if (!this.activeRuns.has(clientId)) {
          // No active run — task is stuck
          const newAttempt = task.attempt + 1;
          const maxRetries = task.maxRetries;

          if (newAttempt > maxRetries + 1) {
            assertTaskTransition(task.status, 'failed');
            this.taskRepo.updateStatus(task.id, 'failed', {
              result: {
                summary: 'Task was stuck in running state and exceeded max retries',
                filesChanged: [],
              },
              attempt: newAttempt,
            });
            actions.push({
              type: 'task_failed',
              id: task.id,
              detail: 'Exceeded max retries after stuck recovery',
            });
          } else {
            assertTaskTransition(task.status, 'pending');
            this.taskRepo.updateStatus(task.id, 'pending', {
              attempt: newAttempt,
            });
            actions.push({
              type: 'task_requeued',
              id: task.id,
              detail: `Returned to pending for retry (attempt ${newAttempt})`,
            });
          }
        }
      }
    }

    return actions;
  }

  private releaseOrphanedWorktrees(): RecoveryAction[] {
    const actions: RecoveryAction[] = [];

    const projects = this.projectRepo.findAll();
    for (const project of projects) {
      if (!this.supervisorService.hasWorktreePool(project.id)) continue;

      const pool = this.supervisorService.getWorktreePoolIfExists(project.id);
      if (!pool) continue;

      const status = pool.getStatus();
      for (const slot of status.inUse) {
        if (slot.taskId) {
          const task = this.taskRepo.findById(slot.taskId);
          // Only running/reviewing tasks should hold a worktree slot.
          // Queued/pending/proposed/terminal tasks must not occupy slots.
          const shouldHoldSlot = task && holdsTaskWorktree(task.status);
          if (!shouldHoldSlot) {
            pool.release(slot.path);
            actions.push({
              type: 'worktree_released',
              id: slot.path,
              detail: `Task ${slot.taskId} is ${task?.status ?? 'deleted'} (slot released as orphaned)`,
            });
          }
        }
      }
    }

    return actions;
  }

  private archiveOrphanedSessions(): RecoveryAction[] {
    const actions: RecoveryAction[] = [];
    const now = Date.now();

    const projects = this.projectRepo.findAll();
    for (const project of projects) {
      if (!project.agent) continue;

      // Find unarchived checkpoint sessions
      const checkpointSessions = this.sessionRepo.findByProjectRole(project.id, 'checkpoint');
      for (const session of checkpointSessions) {
        if (!session.archivedAt) {
          this.sessionRepo.update(session.id, { archivedAt: now });
          actions.push({
            type: 'session_archived',
            id: session.id,
            detail: 'Orphaned checkpoint session',
          });
        }
      }

      // Find unarchived review sessions
      const reviewSessions = this.sessionRepo.findByProjectRole(project.id, 'review');
      for (const session of reviewSessions) {
        if (!session.archivedAt) {
          // Check if the associated task is in a terminal state
          if (session.taskId) {
            const task = this.taskRepo.findById(session.taskId);
            if (task && TERMINAL_TASK_STATUSES.includes(task.status)) {
              this.sessionRepo.update(session.id, { archivedAt: now });
              actions.push({
                type: 'session_archived',
                id: session.id,
                detail: `Orphaned review session for ${task.status} task ${session.taskId}`,
              });
            }
          }
        }
      }
    }

    return actions;
  }

  private fixIdleAgents(): RecoveryAction[] {
    const actions: RecoveryAction[] = [];

    const projects = this.projectRepo.findAll();
    for (const project of projects) {
      if (!project.agent) continue;

      const activeTasks = this.taskRepo.findByStatus(project.id, ...getActiveTaskStatuses(false));

      if (shouldTransitionAgentToIdle(project.agent.phase, activeTasks.length)) {
        const agent = {
          ...project.agent,
          phase: 'idle' as const,
          updatedAt: Date.now(),
        };
        this.projectRepo.update(project.id, { agent });
        actions.push({
          type: 'agent_idle',
          id: project.id,
          detail: 'Agent was active but had no active tasks',
        });
      }
    }

    return actions;
  }

  private safeRecover(
    step: string,
    fn: () => RecoveryAction[],
  ): RecoveryAction[] {
    try {
      return fn();
    } catch (err) {
      return [{
        type: 'recovery_error',
        id: step,
        detail: err instanceof Error ? err.message : String(err),
      }];
    }
  }
}
