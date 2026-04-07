import type {
  PermissionDecisionMessage,
  PromptAnswerMessage,
  InteractionResponseMessage,
  InteractionResolvedMessage,
  PluginPermissionResponseMessage,
  ServerMessage,
} from '@my-claudia/shared';
import type { ConnectedClient, ActiveRun } from '../types.js';
import { handlePermissionDecision, handlePromptAnswer } from '../permission-handler.js';
import { interactionDispatcher } from '../../interactions/interaction-dispatcher.js';
import { permissionManager as pluginPermissionManager } from '../../../plugins/index.js';
import { broadcastRunMessage } from '../broadcast.js';

export function handlePermission(
  message: PermissionDecisionMessage,
  activeRuns: Map<string, ActiveRun>,
  connectedClients: Map<string, ConnectedClient>,
): void {
  handlePermissionDecision(message, activeRuns, connectedClients);
}

export function handlePromptAnswerMessage(
  message: PromptAnswerMessage,
  activeRuns: Map<string, ActiveRun>,
  connectedClients: Map<string, ConnectedClient>,
): void {
  handlePromptAnswer(message, activeRuns, connectedClients);
}

export function handleInteractionResponse(
  message: InteractionResponseMessage,
  activeRuns: Map<string, ActiveRun>,
  clients: Map<string, ConnectedClient>,
): void {
  const resolved = interactionDispatcher.resolve(message.interactionId, message.response);
  if (resolved) {
    for (const [, run] of activeRuns) {
      if (run.sessionId === message.sessionId) {
        const resolvedEvent = {
          type: 'interaction_resolved' as const,
          interactionId: message.interactionId,
          sessionId: message.sessionId,
        };
        broadcastRunMessage(run, resolvedEvent as InteractionResolvedMessage);
        break;
      }
    }
  } else {
    console.warn(`[InteractionResponse] No pending interaction for ${message.interactionId}`);
  }
}

export function handlePluginPermissionResponse(
  message: PluginPermissionResponseMessage,
  broadcastPluginState: () => void,
): void {
  const { pluginId, granted, permanently } = message;
  pluginPermissionManager.respondToRequest(pluginId, granted, permanently);
  broadcastPluginState();
}
