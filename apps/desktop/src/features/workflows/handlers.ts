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
      useWorkflowStore.getState().upsertWorkflow(projectId, workflow);
      return true;
    }

    case 'workflow_deleted': {
      const { projectId, workflowId } = msg as any;
      useWorkflowStore.getState().removeWorkflow(projectId, workflowId);
      return true;
    }

    case 'workflow_run_update': {
      const { projectId, run, stepRuns } = msg as any;
      useWorkflowStore.getState().upsertRun(projectId, run, stepRuns);
      return true;
    }

    case 'workflow_step_types_changed':
      useWorkflowStore.getState().loadStepTypes();
      return true;

    default:
      return false;
  }
}
