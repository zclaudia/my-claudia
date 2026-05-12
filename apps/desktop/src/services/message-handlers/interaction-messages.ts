import type { ServerMessage } from '@my-claudia/shared';
import type { MessageHandlerContext } from './types';
import { useInteractionStore } from '../../stores/interactionStore';
import { useProcessMonitorStore } from '../../stores/processMonitorStore';
import { usePromptRequestStore } from '../../stores/promptRequestStore';

export function handleInteractionMessage(msg: ServerMessage, ctx: MessageHandlerContext): boolean {
  switch (msg.type) {
    case 'interaction_prompt':
      if (msg.source === 'provider_native') {
        usePromptRequestStore.getState().setPendingRequest({
          requestId: msg.interactionId,
          sessionId: msg.sessionId,
          serverId: ctx.serverId,
        });
      }
      useInteractionStore.getState().upsertInteraction(msg);
      return true;

    case 'interaction_approval':
    case 'interaction_todo_update':
    case 'interaction_plan_review':
      useInteractionStore.getState().upsertInteraction(msg);
      return true;

    case 'interaction_resolved':
      usePromptRequestStore.getState().clearRequestById(msg.interactionId);
      useInteractionStore.getState().resolveInteraction(msg.interactionId);
      return true;

    case 'process_cleanup_result':
      useProcessMonitorStore.getState().setCleanupResult(msg);
      return true;

    default:
      return false;
  }
}
