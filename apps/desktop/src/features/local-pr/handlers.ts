/**
 * Local PR domain message handlers.
 *
 * Handles WebSocket messages related to the local-pr feature,
 * keeping domain-specific logic co-located with the domain module.
 */

import type { ServerMessage } from '@my-claudia/shared';
import { useLocalPRStore } from './store';

/**
 * Handle a local-pr domain message.
 * Returns true if the message was handled, false otherwise.
 */
export function handleLocalPRMessage(msg: ServerMessage): boolean {
  switch (msg.type) {
    case 'local_pr_update': {
      const { projectId, pr } = msg as any;
      useLocalPRStore.getState().upsertPR(projectId, pr);
      return true;
    }

    case 'local_pr_deleted': {
      const { projectId, prId } = msg as any;
      useLocalPRStore.getState().removePR(projectId, prId);
      return true;
    }

    default:
      return false;
  }
}
