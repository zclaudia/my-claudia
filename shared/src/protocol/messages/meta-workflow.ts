import type { MetaWorkflowRun, MetaWorkflowPhase } from '../../features/meta-workflow.js';

/** Server → Client: a run was created, updated, or completed. */
export interface MetaWorkflowRunUpdateMessage {
  type: 'meta_workflow_run_update';
  projectId: string;
  run: MetaWorkflowRun;
}

/** Server → Client: a phase record changed (status, attempt, snapshot, stale flag, ...). */
export interface MetaWorkflowPhaseUpdateMessage {
  type: 'meta_workflow_phase_update';
  projectId: string;
  runId: string;
  phase: MetaWorkflowPhase;
}
