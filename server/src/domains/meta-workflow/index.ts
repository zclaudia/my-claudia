// server/src/domains/meta-workflow/index.ts
/**
 * Meta Workflow domain — public surface.
 *
 * Phase B: aggregates, repositories, synthesizers, validator, gate runner,
 * and phase executor. Subsequent phases will export a register() factory
 * + HTTP routes + the WorkflowRuntime integration (real `runEntity`).
 */
export * from './phase-templates/index.js';
export * from './status-machine.js';
export { MetaWorkflowRunRepository } from './repositories/meta-workflow-run-repository.js';
export { MetaWorkflowPhaseRepository } from './repositories/meta-workflow-phase-repository.js';
export { MetaWorkflowArtifactRepository } from './repositories/meta-workflow-artifact-repository.js';
export { MetaWorkflowRunAggregate } from './run-aggregate.js';
export { MetaWorkflowPhaseAggregate } from './phase-aggregate.js';
export { validatePhasesJson, type ValidationResult } from './phases-json-validator.js';
export { synthesizeWorkflow } from './workflow-synthesizer.js';
export { synthesizeSubagent } from './subagent-synthesizer.js';
export { runGate, runGates, type RunGatesOptions } from './gate-runner.js';
export {
  MetaPhaseExecutor,
  type SynthesizedEntity,
  type RunEntity,
  type RunEntityOutcome,
  type PhaseExecutionResult,
  type MetaPhaseExecutorOptions,
} from './phase-executor.js';
