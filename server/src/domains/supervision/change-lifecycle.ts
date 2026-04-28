import type { Database } from 'better-sqlite3';
import type {
  AcceptanceDecision,
  ChangeExecutionPlan,
  DesignGateDecision,
  ExecutionGateDecision,
  ProjectChange,
  SupervisionTask,
  SupervisionLogEvent,
} from '@my-claudia/shared/features/supervision';
import { ProjectChangeRepository } from '../../infrastructure/repositories/project-change.js';
import { ChangeGateReviewRepository } from '../../infrastructure/repositories/change-gate-review.js';
import { ChangeSyncRunRepository } from '../../infrastructure/repositories/change-sync-run.js';
import { SupervisionTaskRepository } from '../../infrastructure/repositories/supervision-task.js';
import type { SupervisionProjectPort } from './ports.js';
import type { ContextManager } from './context-manager.js';
import {
  renderExecutionPlanMarkdown,
  renderTasksMarkdown,
  renderAcceptanceMarkdown,
  renderSyncLogMarkdown,
} from './change-markdown-renderer.js';

export interface ChangeLifecycleDeps {
  db: Database;
  taskRepo: SupervisionTaskRepository;
  projectRepo: SupervisionProjectPort;
  changeRepo: ProjectChangeRepository;
  gateReviewRepo: ChangeGateReviewRepository;
  syncRunRepo: ChangeSyncRunRepository;
  getContextManager: (projectId: string, rootPath: string) => ContextManager;
  log: (projectId: string, event: SupervisionLogEvent, detail?: Record<string, unknown>, taskId?: string) => void;
}

/**
 * Manages the full lifecycle of a ProjectChange:
 * create → design gate → execution gate → acceptance → sync → complete
 */
export class ChangeLifecycle {
  private changeRepo: ProjectChangeRepository;
  private gateReviewRepo: ChangeGateReviewRepository;
  private syncRunRepo: ChangeSyncRunRepository;
  private taskRepo: SupervisionTaskRepository;
  private projectRepo: SupervisionProjectPort;
  private getContextManager: ChangeLifecycleDeps['getContextManager'];
  private log: ChangeLifecycleDeps['log'];

  constructor(deps: ChangeLifecycleDeps) {
    this.changeRepo = deps.changeRepo;
    this.gateReviewRepo = deps.gateReviewRepo;
    this.syncRunRepo = deps.syncRunRepo;
    this.taskRepo = deps.taskRepo;
    this.projectRepo = deps.projectRepo;
    this.getContextManager = deps.getContextManager;
    this.log = deps.log;
  }

  // --- CRUD ---

  createChange(
    projectId: string,
    data: {
      title: string;
      summary: string;
      motivation?: string;
      nonGoals?: string[];
      scope?: string[];
      acceptanceCriteria?: string[];
    },
  ): ProjectChange {
    const project = this.projectRepo.findById(projectId);
    if (!project?.rootPath) {
      throw new Error(`Project ${projectId} has no rootPath`);
    }
    const manager = this.getContextManager(projectId, project.rootPath);
    manager.scaffoldBaseline(project.name);
    const change = this.changeRepo.create({ projectId, ...data });
    manager.scaffoldChangeWorkspace({
      id: change.id,
      title: change.title,
      summary: change.summary,
    });
    this.syncArtifacts(change.id);
    this.log(projectId, 'change_created', { changeId: change.id, title: change.title });
    return change;
  }

  getChanges(projectId: string): ProjectChange[] {
    return this.changeRepo.findByProjectId(projectId);
  }

  getActiveChange(projectId: string): ProjectChange | undefined {
    return this.changeRepo.findActiveByProjectId(projectId);
  }

  getChange(changeId: string): ProjectChange | undefined {
    return this.changeRepo.findById(changeId);
  }

  findChangeForTask(projectId: string, changeId?: string): ProjectChange | undefined {
    return changeId
      ? this.changeRepo.findById(changeId)
      : this.changeRepo.findActiveByProjectId(projectId);
  }

  // --- Execution plan ---

  getExecutionPlan(changeId: string): ChangeExecutionPlan {
    const change = this.changeRepo.findById(changeId);
    if (!change) {
      throw new Error(`Change not found: ${changeId}`);
    }
    return {
      changeId,
      designVersion: 1,
      summary: change.summary,
      automation: {
        strategy: 'serial',
        autoReview: true,
        autoRetry: true,
        autoSyncDraft: true,
      },
      verification: [],
      updatedAt: change.updatedAt,
    };
  }

  // --- Design gate ---

  requestDesignGate(changeId: string, notes?: string): ProjectChange {
    const change = this.requireChange(changeId);
    this.gateReviewRepo.request(changeId, 'design', notes);
    const updated = this.changeRepo.updateStatus(changeId, 'awaiting_design_review');
    this.syncArtifacts(changeId);
    this.log(change.projectId, 'design_gate_requested', { changeId, notes });
    return updated;
  }

  resolveDesignGate(changeId: string, decision: DesignGateDecision, notes?: string): ProjectChange {
    const change = this.requireChange(changeId);
    let updated: ProjectChange;
    if (decision === 'approve_design') {
      updated = this.changeRepo.updateFields(changeId, {
        status: 'planning',
        designApprovedAt: Date.now(),
      });
      this.gateReviewRepo.resolve(changeId, 'design', 'approved', decision, notes);
    } else if (decision === 'revise_design') {
      updated = this.changeRepo.updateStatus(changeId, 'designing');
      this.gateReviewRepo.resolve(changeId, 'design', 'revision_requested', decision, notes);
    } else {
      updated = this.changeRepo.updateStatus(changeId, 'draft');
      this.gateReviewRepo.resolve(changeId, 'design', 'revision_requested', decision, notes);
    }
    this.syncArtifacts(changeId);
    this.log(change.projectId, 'design_gate_resolved', { changeId, decision, notes });
    return updated;
  }

  // --- Execution gate ---

  requestExecutionGate(changeId: string, notes?: string): ProjectChange {
    const change = this.requireChange(changeId);
    this.gateReviewRepo.request(changeId, 'execution', notes);
    const updated = this.changeRepo.updateStatus(changeId, 'awaiting_execution_review');
    this.syncArtifacts(changeId);
    this.log(change.projectId, 'execution_gate_requested', { changeId, notes });
    return updated;
  }

  resolveExecutionGate(changeId: string, decision: ExecutionGateDecision, notes?: string): ProjectChange {
    const change = this.requireChange(changeId);
    let updated: ProjectChange;
    if (decision === 'approve_execution') {
      updated = this.changeRepo.updateFields(changeId, {
        status: 'executing',
        executionApprovedAt: Date.now(),
      });
      this.gateReviewRepo.resolve(changeId, 'execution', 'approved', decision, notes);
    } else if (decision === 'revise_plan') {
      updated = this.changeRepo.updateStatus(changeId, 'planning');
      this.gateReviewRepo.resolve(changeId, 'execution', 'revision_requested', decision, notes);
    } else if (decision === 'revise_design') {
      updated = this.changeRepo.updateStatus(changeId, 'designing');
      this.gateReviewRepo.resolve(changeId, 'execution', 'revision_requested', decision, notes);
    } else {
      updated = this.changeRepo.updateStatus(changeId, 'draft');
      this.gateReviewRepo.resolve(changeId, 'execution', 'revision_requested', decision, notes);
    }
    this.syncArtifacts(changeId);
    this.log(change.projectId, 'execution_gate_resolved', { changeId, decision, notes });
    return updated;
  }

  // --- Acceptance ---

  requestAcceptance(changeId: string, notes?: string): ProjectChange {
    const change = this.requireChange(changeId);
    if (change.status !== 'executing') {
      throw new Error(`Cannot request acceptance when change is in status '${change.status}'`);
    }
    const updated = this.changeRepo.updateStatus(changeId, 'accepting');
    this.syncArtifacts(changeId);
    this.log(change.projectId, 'change_acceptance_requested', { changeId, notes });
    return updated;
  }

  resolveAcceptance(changeId: string, decision: AcceptanceDecision, notes?: string): ProjectChange {
    const change = this.requireChange(changeId);
    if (change.status !== 'accepting') {
      throw new Error(`Cannot resolve acceptance when change is in status '${change.status}'`);
    }
    let updated: ProjectChange;
    if (decision === 'approve_acceptance') {
      updated = this.changeRepo.updateStatus(changeId, 'syncing');
      this.syncRunRepo.create(changeId, notes ?? `Acceptance approved for ${change.title}`);
    } else {
      updated = this.changeRepo.updateStatus(changeId, 'executing');
    }
    this.syncArtifacts(changeId);
    this.log(change.projectId, 'change_acceptance_resolved', { changeId, decision, notes });
    return updated;
  }

  // --- Sync & Complete ---

  requestChangeSync(changeId: string, summary?: string): ProjectChange {
    const change = this.requireChange(changeId);
    if (change.status !== 'accepting') {
      throw new Error(`Cannot request sync when change is in status '${change.status}'`);
    }
    const updated = this.changeRepo.updateStatus(changeId, 'syncing');
    this.syncRunRepo.create(changeId, summary ?? `Sync requested for ${change.title}`);
    this.syncArtifacts(changeId, summary);
    this.log(change.projectId, 'change_sync_requested', { changeId, summary: summary ?? null });
    return updated;
  }

  completeChange(changeId: string, summary?: string): ProjectChange {
    const change = this.requireChange(changeId);
    if (change.status !== 'syncing') {
      throw new Error(`Cannot complete change when status is '${change.status}'`);
    }
    this.syncRunRepo.markApplied(changeId);
    const updated = this.changeRepo.updateFields(changeId, {
      status: 'completed',
      active: false,
      syncApprovedAt: Date.now(),
      completedAt: Date.now(),
    });
    this.syncArtifacts(changeId, summary);
    this.log(change.projectId, 'change_sync_completed', { changeId, summary: summary ?? null });
    return updated;
  }

  // --- Artifact sync ---

  syncArtifacts(changeId: string, syncSummary?: string): void {
    const change = this.changeRepo.findById(changeId);
    if (!change) return;
    const project = this.projectRepo.findById(change.projectId);
    if (!project?.rootPath) return;

    const manager = this.getContextManager(change.projectId, project.rootPath);
    const tasks = this.taskRepo.findByChangeId(change.projectId, change.id);
    const plan = this.getExecutionPlan(changeId);
    const latestSyncRun = this.syncRunRepo.findLatest(changeId);
    const now = new Date().toISOString();

    manager.updateStructuredDocument(`changes/${change.id}/execution.md`, {
      kind: 'execution',
      changeId: change.id,
      status: change.status,
      designVersion: plan.designVersion,
      updatedAt: now,
    }, renderExecutionPlanMarkdown(change, plan, tasks));

    manager.updateStructuredDocument(`changes/${change.id}/tasks.md`, {
      kind: 'tasks',
      changeId: change.id,
      status: tasks.length > 0 ? 'planned' : 'draft',
      updatedAt: now,
      taskCount: tasks.length,
    }, renderTasksMarkdown(change, tasks));

    manager.updateStructuredDocument(`changes/${change.id}/acceptance.md`, {
      kind: 'acceptance',
      changeId: change.id,
      status: change.status === 'completed'
        ? 'passed'
        : change.status === 'syncing'
          ? 'approved'
          : change.status === 'accepting'
            ? 'in_review'
            : (tasks.length > 0 && tasks.every((t) => ['approved', 'integrated'].includes(t.status)) ? 'ready' : 'pending'),
      updatedAt: now,
    }, renderAcceptanceMarkdown(change, tasks));

    manager.updateStructuredDocument(`changes/${change.id}/sync-log.md`, {
      kind: 'sync-log',
      changeId: change.id,
      status: latestSyncRun?.status ?? (change.status === 'completed' ? 'applied' : 'draft'),
      updatedAt: now,
    }, renderSyncLogMarkdown(change, latestSyncRun?.summary ?? syncSummary));
  }

  // --- Helpers ---

  private requireChange(changeId: string): ProjectChange {
    const change = this.changeRepo.findById(changeId);
    if (!change) throw new Error(`Change not found: ${changeId}`);
    return change;
  }
}
