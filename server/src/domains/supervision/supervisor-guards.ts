import type { Database } from 'better-sqlite3';
import type { ProjectAgent, SupervisionLogEvent } from '@my-claudia/shared/features/supervision';
import type { SupervisionTaskRepository } from '../../infrastructure/repositories/supervision-task.js';
import type { ProjectRepository } from '../projects/repository.js';
import { canPauseAgentPhase } from './model.js';

export interface SupervisorGuardsDeps {
  db: Database;
  taskRepo: SupervisionTaskRepository;
  projectRepo: ProjectRepository;
  broadcastAgentUpdate: (projectId: string, agent: ProjectAgent) => void;
  log: (projectId: string, event: SupervisionLogEvent, detail?: Record<string, unknown>, taskId?: string) => void;
}

export class SupervisorGuards {
  private deps: SupervisorGuardsDeps;

  constructor(deps: SupervisorGuardsDeps) {
    this.deps = deps;
  }

  checkBudgetLimits(projectId: string): boolean {
    const project = this.deps.projectRepo.findById(projectId);
    if (!project?.agent) return false;

    const { maxTotalTasks, maxTokenBudget } = project.agent.config;
    if (maxTotalTasks !== undefined) {
      const totalCount = this.deps.taskRepo.countByProject(projectId);
      if (totalCount >= maxTotalTasks) {
        this.pauseAgent(projectId, 'budget');
        return false;
      }
    }

    if (maxTokenBudget !== undefined) {
      const usage = this.getTokenUsage(projectId);
      if (usage >= maxTokenBudget) {
        this.pauseAgent(projectId, 'budget');
        this.deps.log(projectId, 'budget_paused', {
          reason: 'token_budget_exceeded',
          usage,
          limit: maxTokenBudget,
        });
        return false;
      }
    }

    return true;
  }

  pauseAgent(
    projectId: string,
    reason: 'user' | 'budget' | 'sync_error',
  ): void {
    const project = this.deps.projectRepo.findById(projectId);
    if (!project?.agent) return;
    if (!canPauseAgentPhase(project.agent.phase)) return;

    const agent: ProjectAgent = {
      ...project.agent,
      phase: 'paused',
      pausedReason: reason,
      pausedAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.deps.projectRepo.update(projectId, { agent });
    this.deps.broadcastAgentUpdate(projectId, agent);
    this.deps.log(projectId, 'phase_changed', {
      from: project.agent.phase,
      to: 'paused',
      reason,
    });
  }

  getTokenUsage(projectId: string): number {
    const row = this.deps.db.prepare(`
      SELECT COALESCE(SUM(
        COALESCE(json_extract(metadata, '$.usage.input_tokens'), 0) +
        COALESCE(json_extract(metadata, '$.usage.output_tokens'), 0)
      ), 0) as total
      FROM messages
      WHERE session_id IN (
        SELECT id FROM sessions WHERE project_id = ?
      )
    `).get(projectId) as { total: number };
    return row.total;
  }
}
