import type { StepExecutorPort, StepResult, StepContext } from '../ports/step-executor.js';
import type { WorkflowNodeDef } from '@my-claudia/shared';

export class ConditionStepExecutor implements StepExecutorPort {
  readonly supportedTypes = ['condition'] as const;

  async execute(
    node: WorkflowNodeDef,
    _config: Record<string, unknown>,
    ctx: StepContext,
  ): Promise<StepResult> {
    if (!node.condition) {
      return { status: 'failed', output: {}, error: 'No condition defined' };
    }

    const resolved = ctx.resolveTemplate(node.condition.expression);
    const conditionResult = evaluateCondition(resolved);

    return {
      status: 'completed',
      output: { conditionResult },
    };
  }
}

function evaluateCondition(resolved: string): boolean {
  const match = resolved.match(/^(.+?)\s*(==|!=)\s*(.+)$/);
  if (!match) return false;

  const [, left, op, right] = match;
  const l = left.trim();
  const r = right.trim();

  return op === '==' ? l === r : l !== r;
}
