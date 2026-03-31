import type { StepExecutorPort, StepResult, StepContext, AIRunnerPort } from '../ports/step-executor.js';
import type { WorkflowNodeDef } from '@my-claudia/shared';

const DEFAULT_STEP_TIMEOUT_MS = 10 * 60 * 1000;

export class AIPromptStepExecutor implements StepExecutorPort {
  readonly supportedTypes = ['ai_prompt'] as const;

  constructor(private aiRunner: AIRunnerPort) {}

  async execute(
    node: WorkflowNodeDef,
    config: Record<string, unknown>,
    ctx: StepContext,
  ): Promise<StepResult> {
    const prompt = config.prompt as string;
    if (!prompt) return { status: 'failed', output: {}, error: 'No prompt specified' };

    const providerId = (config.providerId as string) ?? ctx.providerId;
    if (!providerId) return { status: 'failed', output: {}, error: 'No provider configured' };

    const workingDirectory = (config.workingDirectory as string) ?? ctx.projectRootPath;

    try {
      const result = await this.aiRunner.runPrompt({
        projectId: ctx.projectId,
        providerId,
        prompt,
        workingDirectory,
        sessionName: (config.sessionName as string) ?? `Workflow: ${node.name}`,
        timeoutMs: node.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS,
        onSessionCreated: (sessionId) => ctx.setSessionId(sessionId),
      });

      return {
        status: 'completed',
        output: { sessionId: result.sessionId, result: 'Prompt completed' },
      };
    } catch (err) {
      return {
        status: 'failed',
        output: {},
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
