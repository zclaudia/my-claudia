/**
 * AI Risk Analysis Step Executor
 *
 * Wraps the existing `evaluateAIReview()` from delegation-evaluator.ts
 * as a workflow step, allowing it to be composed in permission workflows.
 */

import type { StepExecutorPort, StepResult, StepContext, AIRiskAnalysisPort } from '../ports/step-executor.js';
import type { WorkflowNodeDef } from '@my-claudia/shared/features/workflows';

export class AIRiskAnalysisStepExecutor implements StepExecutorPort {
  readonly supportedTypes = ['ai_risk_analysis'] as const;

  constructor(private aiRiskPort: AIRiskAnalysisPort) {}

  async execute(
    _node: WorkflowNodeDef,
    config: Record<string, unknown>,
    ctx: StepContext,
  ): Promise<StepResult> {
    const event = ctx.eventPayload;
    if (!event) {
      return { status: 'failed', output: {}, error: 'No event payload — ai_risk_analysis requires a permission.escalated trigger' };
    }

    const toolName = ctx.resolveTemplate(config.toolName as string ?? '${event.toolName}');
    const detail = ctx.resolveTemplate(config.detail as string ?? '${event.detail}');
    const cwd = (event.cwd as string) || '';
    const toolInput = event.toolInput ?? {};

    const confidenceThreshold = typeof config.confidenceThreshold === 'number'
      ? config.confidenceThreshold
      : 0.7;
    const maxAutoApprovalsPerMinute = typeof config.maxAutoApprovalsPerMinute === 'number'
      ? config.maxAutoApprovalsPerMinute
      : 10;

    try {
      const result = await this.aiRiskPort.evaluate({
        toolName,
        toolInput,
        detail,
        cwd,
        config: {
          confidenceThreshold,
          maxAutoApprovalsPerMinute,
          analysisProviderId: config.analysisProviderId as string | undefined,
        },
      });

      return {
        status: 'completed',
        output: {
          decision: result.decision,
          reasoning: result.reasoning,
          confidence: result.confidence,
          metadata: result.metadata,
          approved: result.decision === 'approve',
        },
      };
    } catch (err) {
      return {
        status: 'failed',
        output: {
          decision: 'uncertain',
          reasoning: err instanceof Error ? err.message : 'Unknown error',
          confidence: 0,
        },
        error: err instanceof Error ? err.message : 'AI risk analysis failed',
      };
    }
  }
}
