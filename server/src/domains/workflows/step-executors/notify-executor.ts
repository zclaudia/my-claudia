import type { StepExecutorPort, StepResult, StepContext, NotificationPort } from '../ports/step-executor.js';
import type { WorkflowNodeDef } from '@my-claudia/shared';

export class NotifyStepExecutor implements StepExecutorPort {
  readonly supportedTypes = ['notify'] as const;

  constructor(private notificationService?: NotificationPort) {}

  async execute(
    _node: WorkflowNodeDef,
    config: Record<string, unknown>,
    _ctx: StepContext,
  ): Promise<StepResult> {
    const message = config.message as string ?? 'Workflow notification';
    const notifyType = config.type as string ?? 'system';

    if (notifyType === 'webhook' && config.url) {
      const response = await fetch(config.url as string, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      return {
        status: 'completed',
        output: { sent: true, type: 'webhook', statusCode: response.status },
      };
    }

    if (this.notificationService) {
      await this.notificationService.notify({
        type: 'run_completed',
        title: (config.title as string) ?? 'Workflow',
        body: message,
        priority: (config.priority as string) ?? 'default',
        tags: (config.tags as string[]) ?? ['wrench'],
      });
    }

    console.log(`[Workflow] Notification: ${message}`);
    return { status: 'completed', output: { sent: true, type: 'system', message } };
  }
}
