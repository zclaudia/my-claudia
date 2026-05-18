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

// Client → Server: rerun a single phase (clears stale/failed first)
export interface RerunMetaWorkflowPhaseMessage {
  type: 'rerun_meta_workflow_phase';
  runId: string;
  phaseId: string;
}

// Client → Server: clear the stale flag on a phase
export interface IgnoreMetaWorkflowPhaseStaleMessage {
  type: 'ignore_meta_workflow_phase_stale';
  runId: string;
  phaseId: string;
}

// Client → Server: ask for an impact recommendation
export interface EvaluateMetaWorkflowPhaseImpactMessage {
  type: 'evaluate_meta_workflow_phase_impact';
  runId: string;
  phaseId: string;
}

// Client → Server: rerun a phase and all transitive downstreams
export interface CascadeRerunMetaWorkflowPhaseMessage {
  type: 'cascade_rerun_meta_workflow_phase';
  runId: string;
  phaseId: string;
}

// Server → Client: response to impact evaluation
export interface MetaWorkflowImpactRecommendationMessage {
  type: 'meta_workflow_impact_recommendation';
  runId: string;
  phaseId: string;
  recommendation: { kind: 'rerun' | 'ignore' | 'minor-fix'; reason: string };
}
