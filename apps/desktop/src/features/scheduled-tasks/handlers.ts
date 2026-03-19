/**
 * Scheduled-tasks domain message handlers.
 */

import type { ServerMessage } from '@my-claudia/shared';
import { useScheduledTaskStore } from './store';

/**
 * Handle a scheduled-task domain message.
 * Returns true if the message was handled, false otherwise.
 */
export function handleScheduledTaskMessage(msg: ServerMessage): boolean {
  switch (msg.type) {
    case 'scheduled_task_update': {
      const { projectId, task } = msg as any;
      useScheduledTaskStore.getState().upsertTask(projectId, task);
      return true;
    }

    case 'scheduled_task_deleted': {
      const { projectId, taskId } = msg as any;
      useScheduledTaskStore.getState().removeTask(projectId, taskId);
      return true;
    }

    default:
      return false;
  }
}
