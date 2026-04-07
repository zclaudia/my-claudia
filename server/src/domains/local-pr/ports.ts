import type { ServerMessage } from '@my-claudia/shared/protocol/messages';

export interface LocalPRAiSessionPort {
  startAISession(args: {
    clientId: string;
    sessionId: string;
    input: string;
    workingDirectory?: string;
    providerId?: string;
    onMessage: (msg: ServerMessage) => void;
  }): Promise<void> | void;
}

export interface LocalPRSchedulingPort {
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
