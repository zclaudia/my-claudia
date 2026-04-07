import type { ServerMessage } from '@my-claudia/shared/protocol/messages';

export interface WorkflowAiRunPort {
  startVirtualRun(args: {
    clientId: string;
    sessionId: string;
    input: string;
    workingDirectory?: string;
    providerId?: string;
    systemContext?: string;
    onMessage: (msg: ServerMessage) => void;
  }): Promise<void> | void;
}

export interface WorkflowSchedulingPort {
  register(task: {
    id: string;
    name: string;
    description?: string;
    category?: string;
    intervalMs?: number;
  }): void;
  markRunStart(taskId: string): void;
  markRunComplete(taskId: string, durationMs: number, error?: string): void;
}
