/**
 * Permission Decide Step Executor
 *
 * Terminal step in a permission workflow that resolves the pending
 * permission promise via the PermissionBridge.
 */

import type { StepExecutorPort, StepResult, StepContext, PermissionBridgePort } from '../ports/step-executor.js';
import type { WorkflowNodeDef } from '@my-claudia/shared/features/workflows';

export class PermissionDecideStepExecutor implements StepExecutorPort {
  readonly supportedTypes = ['permission_decide'] as const;

  constructor(private permissionBridge: PermissionBridgePort) {}

  async execute(
    _node: WorkflowNodeDef,
    config: Record<string, unknown>,
    ctx: StepContext,
  ): Promise<StepResult> {
    const event = ctx.eventPayload;
    const requestId = event?.requestId as string;
    if (!requestId) {
      return { status: 'failed', output: {}, error: 'No requestId in event payload' };
    }

    // Resolve decision from config or from previous step output
    const rawDecision = ctx.resolveTemplate(config.decision as string ?? 'deny');
    const decision = rawDecision === 'approve' || rawDecision === 'allow' ? 'allow' : 'deny';
    const reason = ctx.resolveTemplate(config.reason as string ?? '');

    const resolved = this.permissionBridge.resolvePermission(requestId, decision, reason || undefined);

    if (!resolved) {
      // Already resolved by user or another mechanism
      return {
        status: 'completed',
        output: {
          resolved: false,
          decision,
          reason: 'Permission already resolved (user decided manually)',
        },
      };
    }

    return {
      status: 'completed',
      output: {
        resolved: true,
        decision,
        reason: reason || `Decided by permission workflow`,
      },
    };
  }
}
