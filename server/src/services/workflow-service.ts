/**
 * Workflow Service (Facade)
 *
 * Orchestrates the workflow engine, scheduler, and event bridge.
 * Provides CRUD operations and manages lifecycle.
 */

import type { Database } from 'better-sqlite3';
import type {
  Workflow,
  WorkflowRun,
  WorkflowStepRun,
  WorkflowDefinition,
  WorkflowTrigger,
  ServerMessage,
} from '@my-claudia/shared';
import { WorkflowRepository } from '../repositories/workflow.js';
import { WorkflowRunRepository } from '../repositories/workflow-run.js';
import { WorkflowStepRunRepository } from '../repositories/workflow-step-run.js';
import { WorkflowScheduleRepository } from '../repositories/workflow-schedule.js';
import { WorkflowEngine } from './workflow-engine.js';
import { computeNextCronRun } from '../utils/cron.js';
import { pluginEvents } from '../events/index.js';
import { BUILTIN_WORKFLOW_TEMPLATES } from '../workflow-templates.js';

export class WorkflowService {
  private workflowRepo: WorkflowRepository;
  private runRepo: WorkflowRunRepository;
  private stepRunRepo: WorkflowStepRunRepository;
  private scheduleRepo: WorkflowScheduleRepository;
  private engine: WorkflowEngine;
  private eventSubscriptions: Array<() => void> = [];

  constructor(
    private db: Database,
    private broadcastFn: (projectId: string, message: any) => void,
  ) {
    this.workflowRepo = new WorkflowRepository(db);
    this.runRepo = new WorkflowRunRepository(db);
    this.stepRunRepo = new WorkflowStepRunRepository(db);
    this.scheduleRepo = new WorkflowScheduleRepository(db);
    this.engine = new WorkflowEngine(db, broadcastFn);
  }

  // ── Initialization ────────────────────────────────────────────

  initialize(): void {
    this.rebuildEventSubscriptions();
  }

  // ── Workflow CRUD ─────────────────────────────────────────────

  listWorkflows(projectId: string): Workflow[] {
    return this.workflowRepo.findByProject(projectId);
  }

  getWorkflow(workflowId: string): Workflow | null {
    return this.workflowRepo.findById(workflowId);
  }

  createWorkflow(data: {
    projectId: string;
    name: string;
    description?: string;
    definition: WorkflowDefinition;
    templateId?: string;
    status?: 'active' | 'disabled';
  }): Workflow {
    const workflow = this.workflowRepo.create({
      projectId: data.projectId,
      name: data.name,
      description: data.description,
      status: data.status ?? 'active',
      definition: data.definition,
      templateId: data.templateId,
    });

    // Set up schedule if needed
    if (workflow.status === 'active') {
      this.syncSchedule(workflow);
      this.rebuildEventSubscriptions();
    }

    this.broadcastWorkflowUpdate(workflow);
    return workflow;
  }

  updateWorkflow(workflowId: string, data: Partial<Omit<Workflow, 'id' | 'projectId' | 'createdAt'>>): Workflow {
    const workflow = this.workflowRepo.update(workflowId, data);

    // Re-sync schedule
    this.syncSchedule(workflow);
    this.rebuildEventSubscriptions();

    this.broadcastWorkflowUpdate(workflow);
    return workflow;
  }

  deleteWorkflow(workflowId: string, projectId: string): boolean {
    this.scheduleRepo.deleteByWorkflow(workflowId);
    const deleted = this.workflowRepo.delete(workflowId);
    if (deleted) {
      this.rebuildEventSubscriptions();
      this.broadcastFn(projectId, {
        type: 'workflow_deleted',
        projectId,
        workflowId,
      });
    }
    return deleted;
  }

  // ── Template Operations ───────────────────────────────────────

  getTemplates() {
    return BUILTIN_WORKFLOW_TEMPLATES;
  }

  createFromTemplate(projectId: string, templateId: string): Workflow {
    const template = BUILTIN_WORKFLOW_TEMPLATES.find(t => t.id === templateId);
    if (!template) throw new Error(`Template not found: ${templateId}`);

    // Check if already exists — toggle enable/disable
    const existing = this.workflowRepo.findByProjectAndTemplate(projectId, templateId);
    if (existing) {
      const newStatus = existing.status === 'active' ? 'disabled' : 'active';
      return this.updateWorkflow(existing.id, { status: newStatus });
    }

    return this.createWorkflow({
      projectId,
      name: template.name,
      description: template.description,
      definition: template.definition,
      templateId: template.id,
    });
  }

  // ── Trigger & Run ─────────────────────────────────────────────

  async triggerWorkflow(
    workflowId: string,
    triggerSource: 'manual' | 'schedule' | 'event' = 'manual',
    triggerDetail?: string,
  ): Promise<WorkflowRun> {
    const workflow = this.workflowRepo.findById(workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);
    if (workflow.status !== 'active') throw new Error(`Workflow is not active: ${workflowId}`);

    return this.engine.startRun(
      workflowId,
      workflow.projectId,
      workflow.definition,
      triggerSource,
      triggerDetail,
    );
  }

  getRuns(workflowId: string, limit?: number): WorkflowRun[] {
    return this.runRepo.findByWorkflow(workflowId, limit);
  }

  getRun(runId: string): { run: WorkflowRun; stepRuns: WorkflowStepRun[] } | null {
    const run = this.runRepo.findById(runId);
    if (!run) return null;
    const stepRuns = this.stepRunRepo.findByRun(runId);
    return { run, stepRuns };
  }

  cancelRun(runId: string): boolean {
    return this.engine.cancelRun(runId);
  }

  // ── Approval API ──────────────────────────────────────────────

  approveStep(stepRunId: string): boolean {
    return this.engine.approveStep(stepRunId);
  }

  rejectStep(stepRunId: string): boolean {
    return this.engine.rejectStep(stepRunId);
  }

  // ── Scheduler Tick ────────────────────────────────────────────

  async tick(): Promise<void> {
    try {
      const now = Date.now();
      const dueSchedules = this.scheduleRepo.findDue(now);

      for (const schedule of dueSchedules) {
        const workflow = this.workflowRepo.findById(schedule.workflowId);
        if (!workflow || workflow.status !== 'active') continue;

        // Skip if already running
        if (this.engine.isRunning(workflow.id)) continue;

        // Find the trigger config
        const trigger = workflow.definition.triggers[schedule.triggerIndex];
        if (!trigger) continue;

        const triggerDetail = trigger.type === 'cron'
          ? `cron: ${trigger.cron}`
          : `interval: ${trigger.intervalMinutes}min`;

        // Start the run
        try {
          await this.triggerWorkflow(workflow.id, 'schedule', triggerDetail);
        } catch (err) {
          console.error(`[Workflow] Schedule trigger failed for ${workflow.id}:`, err);
        }

        // Compute next run
        const nextRun = this.computeNextRun(trigger);
        this.scheduleRepo.updateNextRun(workflow.id, nextRun);
      }
    } catch (err) {
      console.error('[Workflow] tick error:', err);
    }
  }

  // ── Event Bridge ──────────────────────────────────────────────

  private rebuildEventSubscriptions(): void {
    // Unsubscribe old
    for (const unsub of this.eventSubscriptions) {
      unsub();
    }
    this.eventSubscriptions = [];

    // Find all active workflows with event triggers
    const workflows = this.workflowRepo.findAllActive();
    const eventWorkflows = new Map<string, Workflow[]>();

    for (const wf of workflows) {
      for (const trigger of wf.definition.triggers) {
        if (trigger.type === 'event' && trigger.event) {
          const list = eventWorkflows.get(trigger.event) ?? [];
          list.push(wf);
          eventWorkflows.set(trigger.event, list);
        }
      }
    }

    // Subscribe once per event type
    for (const [event, wfs] of eventWorkflows) {
      const unsub = pluginEvents.on(event, async (data) => {
        for (const wf of wfs) {
          if (wf.status !== 'active') continue;
          if (this.engine.isRunning(wf.id)) continue;

          // Check event filter
          const trigger = wf.definition.triggers.find(
            t => t.type === 'event' && t.event === event
          );
          if (trigger?.eventFilter && !this.matchesFilter(data, trigger.eventFilter)) continue;

          try {
            await this.triggerWorkflow(wf.id, 'event', `event: ${event}`);
          } catch (err) {
            console.error(`[Workflow] Event trigger failed for ${wf.id}:`, err);
          }
        }
      }, 'workflow-engine');

      this.eventSubscriptions.push(unsub);
    }
  }

  private matchesFilter(data: any, filter: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(filter)) {
      if (data[key] !== value) return false;
    }
    return true;
  }

  // ── Schedule Sync ─────────────────────────────────────────────

  private syncSchedule(workflow: Workflow): void {
    if (workflow.status !== 'active') {
      this.scheduleRepo.deleteByWorkflow(workflow.id);
      return;
    }

    // Find first cron/interval trigger
    const triggerIndex = workflow.definition.triggers.findIndex(
      t => t.type === 'cron' || t.type === 'interval'
    );

    if (triggerIndex === -1) {
      this.scheduleRepo.deleteByWorkflow(workflow.id);
      return;
    }

    const trigger = workflow.definition.triggers[triggerIndex];
    const nextRun = this.computeNextRun(trigger);
    this.scheduleRepo.upsert(workflow.id, triggerIndex, nextRun, true);
  }

  private computeNextRun(trigger: WorkflowTrigger): number | null {
    if (trigger.type === 'cron' && trigger.cron) {
      return computeNextCronRun(trigger.cron);
    }
    if (trigger.type === 'interval' && trigger.intervalMinutes) {
      return Date.now() + trigger.intervalMinutes * 60 * 1000;
    }
    return null;
  }

  // ── Broadcast ─────────────────────────────────────────────────

  private broadcastWorkflowUpdate(workflow: Workflow): void {
    this.broadcastFn(workflow.projectId, {
      type: 'workflow_update',
      projectId: workflow.projectId,
      workflow,
    });
  }
}
