/**
 * AIRunnerPort implementation using the virtual client pattern.
 *
 * Bridges the domain port to the server infrastructure (createVirtualClient, handleRunStart).
 */

import type { Database } from 'better-sqlite3';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import type { Session } from '@my-claudia/shared/core/session';
import type { AIRunnerPort } from '../ports/step-executor.js';
import type { WorkflowAiRunPort } from '../ports/runtime.js';
import { SessionRepository } from '../../sessions/repository.js';

export class VirtualClientAIRunner implements AIRunnerPort {
  private sessionRepo: SessionRepository;
  private aiRunPort: WorkflowAiRunPort;

  constructor(private db: Database, aiRunPort?: WorkflowAiRunPort) {
    this.sessionRepo = new SessionRepository(db);
    this.aiRunPort = aiRunPort ?? {
      startVirtualRun: () => {
        throw new Error('Workflow AI run port not configured');
      },
    };
  }

  async runPrompt(opts: {
    projectId?: string;
    providerId: string;
    prompt: string;
    workingDirectory?: string;
    sessionName?: string;
    timeoutMs?: number;
    onSessionCreated?: (sessionId: string) => void;
  }): Promise<{ sessionId: string; content: string }> {
    const session = this.sessionRepo.create({
      projectId: opts.projectId,
      name: opts.sessionName ?? 'Workflow AI',
      type: 'background',
      projectRole: 'workflow',
      workingDirectory: opts.workingDirectory,
      providerId: opts.providerId,
    } as Omit<Session, 'id' | 'createdAt' | 'updatedAt'>);

    opts.onSessionCreated?.(session.id);

    const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
    const clientId = `workflow_ai_${session.id}_${Date.now()}`;

    return new Promise<{ sessionId: string; content: string }>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`AI prompt timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.aiRunPort.startVirtualRun({
        clientId,
        sessionId: session.id,
        input: opts.prompt,
        workingDirectory: opts.workingDirectory,
        providerId: opts.providerId,
        onMessage: (msg: ServerMessage) => {
          if (settled) return;
          if (msg.type === 'run_completed') {
            settled = true;
            clearTimeout(timeout);
            const messages = this.db.prepare(
              "SELECT content FROM messages WHERE session_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 5"
            ).all(session.id) as { content: string }[];
            const content = messages.map(m => m.content).join('\n');
            resolve({ sessionId: session.id, content });
          } else if (msg.type === 'run_failed') {
            settled = true;
            clearTimeout(timeout);
            const error = (msg as import('@my-claudia/shared').RunFailedMessage).error ?? 'AI prompt failed';
            reject(new Error(error));
          }
        },
      });
    });
  }
}
