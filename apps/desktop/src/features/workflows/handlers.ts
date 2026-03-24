/**
 * Workflow domain message handlers.
 */

import type { ServerMessage } from '@my-claudia/shared';
import { useWorkflowStore } from './store';

/**
 * Handle a workflow domain message.
 * Returns true if the message was handled, false otherwise.
 */
export function handleWorkflowMessage(msg: ServerMessage): boolean {
  switch (msg.type) {
    case 'workflow_update': {
      const { projectId, workflow } = msg as any;
      const store = useWorkflowStore.getState();
      store.upsertWorkflow(projectId ?? '__all__', workflow);
      // Also update __all__ view if it's loaded
      if (projectId) store.upsertWorkflow('__all__', workflow);
      return true;
    }

    case 'workflow_deleted': {
      const { projectId, workflowId } = msg as any;
      const store = useWorkflowStore.getState();
      store.removeWorkflow(projectId ?? '__all__', workflowId);
      if (projectId) store.removeWorkflow('__all__', workflowId);
      return true;
    }

    case 'workflow_run_update': {
      const { projectId, run, stepRuns } = msg as any;
      useWorkflowStore.getState().upsertRun(projectId ?? '__all__', run, stepRuns);
      return true;
    }

    case 'workflow_step_types_changed':
      useWorkflowStore.getState().loadStepTypes();
      return true;

    default:
      return false;
  }
}
