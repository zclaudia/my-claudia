/**
 * Supervision domain message handlers.
 */

import type { ServerMessage } from '@my-claudia/shared';
import { useSupervisionStore } from './store';

/**
 * Handle a supervision domain message.
 * Returns true if the message was handled, false otherwise.
 */
export function handleSupervisionMessage(msg: ServerMessage): boolean {
  switch (msg.type) {
    case 'supervision_task_update': {
      const { task, projectId } = msg as any;
      useSupervisionStore.getState().upsertTask(projectId, task);
      return true;
    }

    case 'supervision_agent_update': {
      const { projectId, agent } = msg as any;
      useSupervisionStore.getState().setAgent(projectId, agent);
      return true;
    }

    case 'supervision_checkpoint': {
      const { projectId, summary } = msg as any;
      useSupervisionStore.getState().setCheckpointSummary(projectId, summary);
      return true;
    }

    default:
      return false;
  }
}
