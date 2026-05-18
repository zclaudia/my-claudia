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

// Client → Server: create a new meta-workflow run
export interface CreateMetaWorkflowRunMessage {
  type: 'create_meta_workflow_run';
  projectId: string;
  title: string;
  description?: string;
  defaultProviderId?: string;
}

// Client → Server: submit requirements.md path
export interface SubmitMetaWorkflowRequirementsMessage {
  type: 'submit_meta_workflow_requirements';
  runId: string;
  requirementsPath: string;
}

// Client → Server: approve or reject requirements
export interface ResolveMetaWorkflowRequirementsMessage {
  type: 'resolve_meta_workflow_requirements';
  runId: string;
  decision: 'approve' | 'reject';
}

// Client → Server: write phases.json into the run (after decomposition AI step)
export interface SetMetaWorkflowPhasesMessage {
  type: 'set_meta_workflow_phases';
  runId: string;
  phasesJson: string;
}

// Client → Server: cancel the entire run
export interface CancelMetaWorkflowRunMessage {
  type: 'cancel_meta_workflow_run';
  runId: string;
}

// Client → Server: trigger execution of one specific phase
export interface RunMetaWorkflowPhaseMessage {
  type: 'run_meta_workflow_phase';
  runId: string;
  phaseId: string;
}
