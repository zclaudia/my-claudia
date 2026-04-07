import type { StepExecutorPort, StepResult, StepContext, AIRunnerPort } from '../ports/step-executor.js';
import type { WorkflowNodeDef } from '@my-claudia/shared/features/workflows';

export class AIReviewStepExecutor implements StepExecutorPort {
  readonly supportedTypes = ['ai_review'] as const;

  constructor(private aiRunner: AIRunnerPort) {}

  async execute(
    node: WorkflowNodeDef,
    config: Record<string, unknown>,
    ctx: StepContext,
  ): Promise<StepResult> {
    const providerId = (config.providerId as string) ?? ctx.providerId;
    if (!providerId) return { status: 'failed', output: {}, error: 'No provider configured' };

    const worktreePath = (config.worktreePath as string) ?? ctx.projectRootPath;
    const passMarker = (config.passMarker as string) ?? '[REVIEW_PASSED]';
    const failMarker = (config.failMarker as string) ?? '[REVIEW_FAILED]';

    const reviewPrompt = `You are a code reviewer. Review the changes in this working directory.
Run "git diff HEAD~1" to see the latest changes. Analyze the code for:
1. Bugs and logic errors
2. Security vulnerabilities
3. Code quality issues
4. Missing error handling

If the code is acceptable, include ${passMarker} in your response.
If there are critical issues, include ${failMarker} in your response and list the issues.`;

    try {
      const result = await this.aiRunner.runPrompt({
        projectId: ctx.projectId,
        providerId,
        prompt: reviewPrompt,
        workingDirectory: worktreePath,
        sessionName: `Workflow Review: ${node.name}`,
        timeoutMs: node.timeoutMs ?? 30 * 60 * 1000,
        onSessionCreated: (sessionId) => ctx.setSessionId(sessionId),
      });

      const passed = result.content.includes(passMarker);
      const failed = result.content.includes(failMarker);

      return {
        status: 'completed',
        output: {
          reviewPassed: passed && !failed,
          reviewNotes: result.content.slice(0, 2000),
          sessionId: result.sessionId,
        },
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
