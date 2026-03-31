import type { StepExecutorPort, StepResult, StepContext } from '../ports/step-executor.js';
import type { WorkflowNodeDef } from '@my-claudia/shared';
import type { PluginStepExecutor } from './plugin-executor.js';

const DEFAULT_STEP_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Composite executor — dispatches to registered executors by step type.
 * Handles per-step timeout wrapping.
 */
export class CompositeStepExecutor implements StepExecutorPort {
  readonly supportedTypes: string[] = [];
  private executors: StepExecutorPort[] = [];
  private pluginExecutor?: PluginStepExecutor;
  private typeIndex = new Map<string, StepExecutorPort>();

  register(executor: StepExecutorPort): void {
    this.executors.push(executor);
    for (const type of executor.supportedTypes) {
      this.typeIndex.set(type, executor);
    }
  }

  registerPlugin(executor: PluginStepExecutor): void {
    this.pluginExecutor = executor;
  }

  private findExecutor(type: string): StepExecutorPort | null {
    const indexed = this.typeIndex.get(type);
    if (indexed) return indexed;
    if (this.pluginExecutor?.supports(type)) return this.pluginExecutor;
    return null;
  }

  async execute(
    node: WorkflowNodeDef,
    config: Record<string, unknown>,
    ctx: StepContext,
  ): Promise<StepResult> {
    const executor = this.findExecutor(node.type);
    if (!executor) {
      return { status: 'failed', output: {}, error: `Unknown step type: ${node.type}` };
    }

    const timeoutMs = node.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;

    return Promise.race([
      executor.execute(node, config, ctx),
      new Promise<StepResult>((_, reject) =>
        setTimeout(() => reject(new Error(`Step timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
  }
}
