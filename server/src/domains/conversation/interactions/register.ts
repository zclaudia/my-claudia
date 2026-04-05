import { sendMessage, broadcastToOtherAuthenticatedClients } from '../ws/broadcast.js';
import { interactionDispatcher } from './interaction-dispatcher.js';
import type { ActiveRun, ConnectedClient } from '../ws/types.js';

export interface InteractionDomainDeps {
  activeRuns: Map<string, ActiveRun>;
  clients: Map<string, ConnectedClient>;
}

export function registerInteractionDomain(deps: InteractionDomainDeps): void {
  const { activeRuns, clients } = deps;

  interactionDispatcher.setSendFunction((sessionId, event) => {
    for (const [, run] of activeRuns) {
      if (run.sessionId === sessionId) {
        sendMessage(run.client.ws, event);
        broadcastToOtherAuthenticatedClients(clients, run.clientId, event);
        return;
      }
    }
    console.warn(`[InteractionDispatcher] No active run for session ${sessionId}`);
  });
}
