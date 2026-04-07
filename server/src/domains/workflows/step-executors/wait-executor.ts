import type { StepExecutorPort, StepResult, StepContext, ApprovalPort } from '../ports/step-executor.js';
import type { WorkflowNodeDef } from '@my-claudia/shared/features/workflows';

export class WaitStepExecutor implements StepExecutorPort {
  readonly supportedTypes = ['wait'] as const;

  constructor(private approvalPort: ApprovalPort) {}

  async execute(
    node: WorkflowNodeDef,
    config: Record<string, unknown>,
    ctx: StepContext,
  ): Promise<StepResult> {
    const waitType = config.type as string ?? 'timeout';

    if (waitType === 'timeout') {
      const waitMs = (config.timeoutMs as number) ?? 5000;
      await new Promise(r => setTimeout(r, waitMs));
      return { status: 'completed', output: { waited: true, durationMs: waitMs } };
    }

    const approvalTimeoutMs = node.timeoutMs ?? 3600000;
    const approved = await this.approvalPort.waitForApproval(ctx.stepRunId, approvalTimeoutMs);

    return {
      status: approved ? 'completed' : 'failed',
      output: { approved },
      error: approved ? undefined : 'Approval rejected or timed out',
    };
  }
}
