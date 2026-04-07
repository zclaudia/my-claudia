import type { ServerMessage } from '@my-claudia/shared/protocol/messages';

export interface SupervisionAiRunPort {
  startVirtualRun(args: {
    clientId: string;
    sessionId: string;
    input: string;
    workingDirectory: string;
    onMessage: (msg: ServerMessage) => void;
  }): Promise<void> | void;
}

export interface SupervisionSchedulingPort {
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
