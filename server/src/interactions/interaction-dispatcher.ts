/**
 * Interaction Dispatcher
 *
 * Manages the lifecycle of interaction events that require user responses.
 * - Fire-and-forget: send event to frontend, return immediately (update_todo_list)
 * - Dispatch-and-wait: send event, block until user responds or timeout (ask_user_form)
 *
 * Uses a pending-promise pattern similar to pendingPermissions in server.ts.
 */

import type { ServerMessage } from '@my-claudia/shared';

interface PendingInteraction {
  resolve: (response: Record<string, unknown>) => void;
  timeout: ReturnType<typeof setTimeout>;
  sessionId: string;
}

type SendFunction = (sessionId: string, event: ServerMessage) => void;

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

class InteractionDispatcher {
  private pending = new Map<string, PendingInteraction>();
  private sendFn: SendFunction | null = null;

  /**
   * Set the send function (called during server init to avoid circular imports).
   * The function should look up the active run for the sessionId and send via WS.
   */
  setSendFunction(fn: SendFunction): void {
    this.sendFn = fn;
  }

  /**
   * Send an interaction event and wait for the user's response.
   * Used by transactional tools like ask_user_form.
   */
  async dispatchAndWait(
    interactionId: string,
    sessionId: string,
    event: ServerMessage,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<Record<string, unknown>> {
    if (!this.sendFn) {
      console.warn('[InteractionDispatcher] No send function set, cannot dispatch');
      return { error: 'Interaction dispatcher not initialized' };
    }

    this.sendFn(sessionId, event);

    return new Promise<Record<string, unknown>>((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(interactionId);
        console.log(`[InteractionDispatcher] Interaction ${interactionId} timed out`);
        resolve({ error: 'User did not respond within timeout' });
      }, timeoutMs);

      this.pending.set(interactionId, { resolve, timeout, sessionId });
    });
  }

  /**
   * Send an interaction event without waiting for a response.
   * Used by display tools like update_todo_list.
   */
  dispatchFireAndForget(sessionId: string, event: ServerMessage): void {
    if (!this.sendFn) {
      console.warn('[InteractionDispatcher] No send function set, cannot dispatch');
      return;
    }
    this.sendFn(sessionId, event);
  }

  /**
   * Resolve a pending interaction with the user's response.
   * Called when server receives an 'interaction_response' WS message.
   */
  resolve(interactionId: string, response: Record<string, unknown>): boolean {
    const entry = this.pending.get(interactionId);
    if (!entry) return false;

    clearTimeout(entry.timeout);
    this.pending.delete(interactionId);
    entry.resolve(response);
    console.log(`[InteractionDispatcher] Resolved interaction ${interactionId}`);
    return true;
  }

  /**
   * Cancel all pending interactions for a session (e.g. when run ends).
   */
  cancelBySession(sessionId: string): void {
    for (const [id, entry] of this.pending) {
      if (entry.sessionId === sessionId) {
        clearTimeout(entry.timeout);
        entry.resolve({ error: 'Session ended' });
        this.pending.delete(id);
      }
    }
  }

  /**
   * Check if there are pending interactions for a session.
   */
  hasPending(sessionId: string): boolean {
    for (const entry of this.pending.values()) {
      if (entry.sessionId === sessionId) return true;
    }
    return false;
  }

  /**
   * Get count of pending interactions (for diagnostics).
   */
  get pendingCount(): number {
    return this.pending.size;
  }
}

export const interactionDispatcher = new InteractionDispatcher();
