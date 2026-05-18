// server/src/domains/meta-workflow/index.ts
/**
 * Meta Workflow domain — public surface.
 *
 * Phase A: types + schema + template stubs.
 * Phase B: aggregates, repositories, synthesizers, validator, executor.
 * Phase C: reuse pool (repo+search+promotion), real run-entity adapters,
 *          MetaWorkflowService orchestrator, HTTP routes, register() factory.
 */
export * from './phase-templates/index.js';
export * from './status-machine.js';

// Repositories
export { MetaWorkflowRunRepository } from './repositories/meta-workflow-run-repository.js';
export { MetaWorkflowPhaseRepository } from './repositories/meta-workflow-phase-repository.js';
export { MetaWorkflowArtifactRepository } from './repositories/meta-workflow-artifact-repository.js';
export { MetaWorkflowReusePoolRepository } from './repositories/meta-workflow-reuse-pool-repository.js';
export { MetaSubagentTemplateRepository } from './repositories/meta-subagent-template-repository.js';

// Aggregates
export { MetaWorkflowRunAggregate } from './run-aggregate.js';
export { MetaWorkflowPhaseAggregate } from './phase-aggregate.js';

// Validator
export { validatePhasesJson, type ValidationResult } from './phases-json-validator.js';

// Synthesizers
export { synthesizeWorkflow } from './workflow-synthesizer.js';
export { synthesizeSubagent } from './subagent-synthesizer.js';

// Gate runner
export { runGate, runGates, type RunGatesOptions } from './gate-runner.js';

// Phase executor
export {
  MetaPhaseExecutor,
  type SynthesizedEntity,
  type RunEntity,
  type RunEntityOutcome,
  type PhaseExecutionResult,
  type MetaPhaseExecutorOptions,
} from './phase-executor.js';

// Reuse pool services
export { ReusePoolSearchService, type ReuseSearchResult } from './reuse-pool-search.js';
export { ReusePoolPromotionService, type PromoteInput } from './reuse-pool-promotion.js';

// Run-entity adapters
export {
  createWorkflowRunEntity,
  type CreateWorkflowRunEntityOptions,
} from './run-entities/workflow-run-entity.js';
export {
  createSubagentRunEntity,
  type CreateSubagentRunEntityOptions,
  type RunVirtualClient,
  type VirtualClientArgs,
  type VirtualClientResult,
} from './run-entities/subagent-run-entity.js';

// Service + routes + register factory
export { MetaWorkflowService, type MetaWorkflowServiceOptions, type CreateRunInput } from './service.js';
export { createMetaWorkflowRoutes } from './routes.js';
export {
  registerMetaWorkflow,
  type RegisterMetaWorkflowOptions,
  type RegisteredMetaWorkflow,
} from './register.js';
