/**
 * Permission Classify Step Executor
 *
 * Classifies an escalated permission request by category and risk indicators.
 * Uses the event payload from a `permission.escalated` trigger.
 */

import type { StepExecutorPort, StepResult, StepContext } from '../ports/step-executor.js';
import type { WorkflowNodeDef } from '@my-claudia/shared/features/workflows';

export class PermissionClassifyStepExecutor implements StepExecutorPort {
  readonly supportedTypes = ['permission_classify'] as const;

  async execute(
    _node: WorkflowNodeDef,
    _config: Record<string, unknown>,
    ctx: StepContext,
  ): Promise<StepResult> {
    const event = ctx.eventPayload;
    if (!event) {
      return { status: 'failed', output: {}, error: 'No event payload — permission_classify requires a permission.escalated trigger' };
    }

    const requestId = event.requestId as string;
    const toolName = event.toolName as string;
    const detail = event.detail as string;
    const category = event.category as string;
    const matchedRule = event.matchedRule as string | undefined;
    const isEscalateAlways = event.isEscalateAlways as boolean;
    const sessionType = event.sessionType as string;
    const aiInitiatedPlanMode = event.aiInitiatedPlanMode as boolean | undefined;

    if (!requestId || !toolName) {
      return { status: 'failed', output: {}, error: 'Missing requestId or toolName in event payload' };
    }

    return {
      status: 'completed',
      output: {
        requestId,
        toolName,
        detail: detail || '',
        category: category || 'shellSafe',
        matchedRule,
        isEscalateAlways: !!isEscalateAlways,
        sessionType: sessionType || 'regular',
        aiInitiatedPlanMode: !!aiInitiatedPlanMode,
      },
    };
  }
}
