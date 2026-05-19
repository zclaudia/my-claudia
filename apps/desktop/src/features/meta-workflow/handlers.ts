// apps/desktop/src/features/meta-workflow/handlers.ts
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import { useMetaWorkflowStore } from './store.js';

/**
 * Handle a ServerMessage that may belong to the meta-workflow feature.
 * Returns true if the message was a meta-workflow message (and was handled),
 * false otherwise so other feature handlers can try.
 */
export function handleMetaWorkflowMessage(msg: ServerMessage): boolean {
  switch (msg.type) {
    case 'meta_workflow_run_update':
      useMetaWorkflowStore.getState().upsertRun(msg.run);
      return true;

    case 'meta_workflow_phase_update':
      useMetaWorkflowStore.getState().upsertPhase(msg.runId, msg.phase);
      return true;

    case 'meta_workflow_impact_recommendation':
      useMetaWorkflowStore.getState().recordRecommendation(
        msg.runId,
        msg.phaseId,
        { kind: msg.recommendation.kind, reason: msg.recommendation.reason },
      );
      return true;

    default:
      return false;
  }
}
