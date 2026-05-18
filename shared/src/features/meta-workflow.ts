// ────────────────────────────────────────────────────────────────────
// Enums (exported as readonly arrays so they're usable at runtime)
// ────────────────────────────────────────────────────────────────────

export const PHASE_TYPES = [
  'code-implement',
  'code-refactor',
  'code-test-write',
  'design-doc',
  'dep-update',
  'investigation',
] as const;
export type PhaseType = typeof PHASE_TYPES[number];

export const EXECUTE_ENTITIES = ['workflow', 'subagent'] as const;
export type ExecuteEntity = typeof EXECUTE_ENTITIES[number];

export const EXECUTE_PATTERNS = ['single-shot', 'multi-step', 'self-healing'] as const;
export type ExecutePattern = typeof EXECUTE_PATTERNS[number];

export const META_WORKFLOW_RUN_STATUSES = [
  'requirement_draft',
  'requirement_review',
  'splitting',
  'executing',
  'reviewing',
  'completed',
  'cancelled',
] as const;
export type MetaWorkflowRunStatus = typeof META_WORKFLOW_RUN_STATUSES[number];

export const META_WORKFLOW_PHASE_STATUSES = [
  'pending',
  'searching_reuse',
  'generating',
  'ready_to_run',
  'running',
  'verifying_gates',
  'done',
  'failed',
  'stale',
] as const;
export type MetaWorkflowPhaseStatus = typeof META_WORKFLOW_PHASE_STATUSES[number];

export const REUSE_POOL_SOURCE_TYPES = ['auto', 'user'] as const;
export type ReusePoolSourceType = typeof REUSE_POOL_SOURCE_TYPES[number];

// ────────────────────────────────────────────────────────────────────
// PhasesDoc (the source-of-truth for a run's phase graph)
// ────────────────────────────────────────────────────────────────────

export interface PhaseInput {
  kind: 'commit' | 'file';
  /** For commit: 'phases:{phaseId}.commit'. For file: project-relative path. */
  source: string;
  description?: string;
}

export interface PhaseOutput {
  kind: 'commit' | 'file';
  path?: string;       // present when kind === 'file'
  description: string;
}

export interface AcceptanceGate {
  id: string;
  description: string;
  command: string;
  cwd?: string;        // relative to worktree root
  expect: {
    exitCode?: number;           // default 0
    stdoutMatches?: string;      // regex
    stderrMatches?: string;
    fileExists?: string[];
    fileNotExists?: string[];
    durationMaxMs?: number;
  };
}

export interface PhaseExecuteConfig {
  pattern?: ExecutePattern;
  planRequired?: boolean;
  aiReviewBlocking?: boolean;
  maxLoopIterations?: number;
  maxSubagentTurns?: number;
}

export interface PhaseDef {
  id: string;
  name: string;
  description: string;
  phaseType: PhaseType;
  executeEntity?: ExecuteEntity;        // defaults inferred from phaseType
  dependsOn: string[];
  inputs: PhaseInput[];
  outputs: PhaseOutput[];
  acceptanceGates: AcceptanceGate[];
  executeConfig?: PhaseExecuteConfig;
  synthesizerProviderId?: string;
  runtimeProviderId?: string;
  worktreeStrategy?: 'isolated' | 'shared';
  estimatedComplexity?: 'small' | 'medium' | 'large';
}

export interface PhasesDoc {
  version: '1';
  phases: PhaseDef[];
  smokePath: string[];
  metadata: {
    generatedAt: number;
    requirementsPath: string;
  };
}

// ────────────────────────────────────────────────────────────────────
// Runtime records (mirror the SQLite tables in migration 069)
// ────────────────────────────────────────────────────────────────────

export interface MetaWorkflowConfig {
  /** Max times the requirements phase can be rejected before the escape hatch is offered. */
  maxRequirementRejects?: number;
  /** Max simultaneous phases allowed under conservative_parallel automation. */
  maxParallelPhases?: number;
}

export interface MetaWorkflowRun {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: MetaWorkflowRunStatus;
  requirementsPath?: string;
  phasesJson?: string;                  // serialized PhasesDoc
  smokePathRunId?: string;
  rejectCount: number;
  defaultProviderId?: string;
  config?: MetaWorkflowConfig;
  worktreeId?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface MetaWorkflowPhase {
  id: string;
  runId: string;
  phaseId: string;
  phaseType: PhaseType;
  status: MetaWorkflowPhaseStatus;
  executeEntity: ExecuteEntity;
  reusedFromPoolId?: string;
  generatedWorkflowId?: string;
  generatedSubagentId?: string;
  currentRunId?: string;
  worktreePath?: string;
  staleSince?: number;
  staleSourcePhaseId?: string;
  attempt: number;
  maxRetries: number;
  inputsSnapshot?: PhaseInput[];
  outputsSnapshot?: PhaseOutput[];
  gatesSnapshot?: AcceptanceGate[];
  executeConfigSnapshot?: PhaseExecuteConfig;
  synthesizerProviderId?: string;
  runtimeProviderId?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface MetaWorkflowGateResult {
  gateId: string;
  passed: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs?: number;
}

export interface MetaWorkflowArtifact {
  id: string;
  phaseRecordId: string;
  version: number;
  commitSha?: string;
  artifactFiles?: { kind: 'commit' | 'file'; path?: string }[];
  gateResults?: MetaWorkflowGateResult[];
  aiReviewNotesPath?: string;
  status: 'active' | 'stale' | 'archived';
  createdAt: number;
}

export interface ReusablePoolMetadata {
  generatedFromPhaseId?: string;
  originalRunId?: string;
  promotedAt?: number;
  usageCount?: number;
  successRate?: number;
}

export interface ReusablePoolItem {
  id: string;
  kind: ExecuteEntity;
  entityId: string;
  phaseType: PhaseType;
  description?: string;
  tags: string[];
  sourceType: ReusePoolSourceType;
  metadata?: ReusablePoolMetadata;
  createdAt: number;
  archivedAt?: number;
}

export interface MetaSubagentTerminationCondition {
  kind: 'output-file' | 'output-keyword';
  target: string;
}

export interface MetaSubagentTemplate {
  id: string;
  name?: string;
  systemPrompt: string;
  allowedTools: string[];
  maxTurns: number;
  terminationCondition: MetaSubagentTerminationCondition;
  sourceType: ReusePoolSourceType;
  createdAt: number;
  updatedAt: number;
}
