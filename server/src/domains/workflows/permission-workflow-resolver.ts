import type { Workflow, WorkflowRun } from '@my-claudia/shared/features/workflows';
import type { WorkflowService } from './service.js';
import { WorkflowRepository } from './repository.js';
import { ProjectRepository } from '../projects/repository.js';
import type { Database } from 'better-sqlite3';

export interface ResolvedPermissionWorkflow {
  workflowId: string;
  source: 'project_override' | 'global_override' | 'system_fallback';
  fallbackReason?: string;
  workflow: Workflow;
}

export class PermissionWorkflowResolver {
  private workflowRepo: WorkflowRepository;
  private projectRepo: ProjectRepository;

  constructor(
    private db: Database,
    private workflowService: WorkflowService,
  ) {
    this.workflowRepo = new WorkflowRepository(db);
    this.projectRepo = new ProjectRepository(db);
  }

  private isUsableOverride(workflow: Workflow | null | undefined): workflow is Workflow {
    return !!workflow && workflow.status === 'active' && !workflow.isSystem;
  }

  resolve(projectId?: string): ResolvedPermissionWorkflow {
    if (projectId) {
      const project = this.projectRepo.findById(projectId);
      const projectOverrideId = project?.permissionWorkflowOverrideId;
      if (projectOverrideId) {
        const workflow = this.workflowRepo.findById(projectOverrideId);
        if (this.isUsableOverride(workflow)) {
          return {
            workflowId: workflow.id,
            source: 'project_override' as const,
            workflow,
          };
        }
      }
    }

    const globalConfig = this.db.prepare(
      'SELECT permission_workflow_override_id FROM agent_config WHERE id = 1',
    ).get() as { permission_workflow_override_id?: string | null } | undefined;
    if (globalConfig?.permission_workflow_override_id) {
      const workflow = this.workflowRepo.findById(globalConfig.permission_workflow_override_id);
      if (this.isUsableOverride(workflow)) {
        return {
          workflowId: workflow.id,
          source: 'global_override' as const,
          workflow,
        };
      }
    }

    const workflow = this.workflowService.getSystemPermissionFallback();
    return {
      workflowId: workflow.id,
      source: 'system_fallback',
      ...(projectId && {
        fallbackReason: 'Project/global permission workflow override unavailable',
      }),
      workflow,
    };
  }

  async triggerPermissionEscalation(
    projectId: string | undefined,
    triggerData: {
      eventPayload: Record<string, unknown>;
      triggerContext?: Record<string, unknown>;
    },
  ): Promise<{ resolved: ResolvedPermissionWorkflow; run: WorkflowRun }> {
    const resolved = this.resolve(projectId);
    const run = await this.workflowService.triggerWorkflow(
      resolved.workflowId,
      'event',
      'event: permission.escalated',
      triggerData,
    );
    return { resolved, run };
  }
}
