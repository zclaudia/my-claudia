/**
 * AIRunnerPort implementation using the virtual client pattern.
 *
 * Bridges the domain port to the server infrastructure (createVirtualClient, handleRunStart).
 */

import type { Database } from 'better-sqlite3';
import type { ServerMessage, Session } from '@my-claudia/shared';
import type { AIRunnerPort } from '../ports/step-executor.js';
import { SessionRepository } from '../../sessions/repository.js';
import { createVirtualClient, handleRunStart } from '../../../server.js';

export class VirtualClientAIRunner implements AIRunnerPort {
  private sessionRepo: SessionRepository;

  constructor(private db: Database) {
    this.sessionRepo = new SessionRepository(db);
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

      const virtualClient = createVirtualClient(clientId, {
        send: (msg: ServerMessage) => {
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

      handleRunStart(
        virtualClient,
        {
          type: 'run_start',
          clientRequestId: clientId,
          sessionId: session.id,
          input: opts.prompt,
          workingDirectory: opts.workingDirectory,
          providerId: opts.providerId,
        },
        this.db,
      );
    });
  }
}
