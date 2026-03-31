import type { StepExecutorPort, StepResult, StepContext } from '../ports/step-executor.js';
import type { WorkflowNodeDef } from '@my-claudia/shared';

export class WebhookStepExecutor implements StepExecutorPort {
  readonly supportedTypes = ['webhook'] as const;

  async execute(
    _node: WorkflowNodeDef,
    config: Record<string, unknown>,
    _ctx: StepContext,
  ): Promise<StepResult> {
    const url = config.url as string;
    if (!url) return { status: 'failed', output: {}, error: 'No URL specified' };

    const method = (config.method as string) ?? 'POST';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(config.headers as Record<string, string> ?? {}),
    };

    const response = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' ? (config.body as string) ?? undefined : undefined,
    });

    const body = await response.text();
    return {
      status: response.ok ? 'completed' : 'failed',
      output: { statusCode: response.status, body: body.slice(0, 2000) },
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  }
}
