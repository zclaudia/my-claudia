import type { StepExecutorPort, StepResult, StepContext } from '../ports/step-executor.js';
import type { WorkflowNodeDef } from '@my-claudia/shared';

export interface PluginStepRegistry {
  has(type: string): boolean;
  execute(type: string, config: Record<string, unknown>, context: {
    projectId?: string;
    projectRootPath?: string;
    providerId?: string;
    stepRunId: string;
    runId: string;
  }): Promise<StepResult>;
}

export class PluginStepExecutor implements StepExecutorPort {
  readonly supportedTypes: string[] = [];

  constructor(private registry: PluginStepRegistry) {}

  get dynamicSupport(): boolean { return true; }

  supports(type: string): boolean {
    return this.registry.has(type);
  }

  async execute(
    node: WorkflowNodeDef,
    config: Record<string, unknown>,
    ctx: StepContext,
  ): Promise<StepResult> {
    return this.registry.execute(node.type, config, {
      projectId: ctx.projectId,
      projectRootPath: ctx.projectRootPath,
      providerId: ctx.providerId,
      stepRunId: ctx.stepRunId,
      runId: ctx.runId,
    });
  }
}
