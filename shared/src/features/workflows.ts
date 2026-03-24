// Workflow Types

export type WorkflowStatus = 'active' | 'disabled' | 'archived';
export type WorkflowTriggerType = 'manual' | 'cron' | 'interval' | 'event';

export interface WorkflowTrigger {
  type: WorkflowTriggerType;
  cron?: string;
  intervalMinutes?: number;
  event?: string;
  eventFilter?: Record<string, unknown>;
}

export type BuiltinWorkflowStepType =
  | 'git_commit'
  | 'git_merge'
  | 'create_worktree'
  | 'create_pr'
  | 'ai_review'
  | 'ai_prompt'
  | 'shell'
  | 'webhook'
  | 'condition'
  | 'notify'
  | 'wait';

export type WorkflowStepType = BuiltinWorkflowStepType | (string & {});

export interface WorkflowStepTypeMeta {
  type: string;
  name: string;
  description: string;
  category: string;
  icon?: string;
  configSchema?: Record<string, unknown>;
  source: string;
}

export type WorkflowStepOnError = 'abort' | 'skip' | 'retry' | 'route';

// ── Workflow Graph Model ──────────────────────────────────────

export type WorkflowEdgeType = 'success' | 'error' | 'condition_true' | 'condition_false' | 'loop' | 'loop_exhausted';

export interface WorkflowEdgeDef {
  id: string;
  source: string;
  target: string;
  type: WorkflowEdgeType;
  label?: string;
  /** Max iterations for loop edges (default 3) */
  maxIterations?: number;
}

export interface WorkflowNodePosition {
  x: number;
  y: number;
}

export interface WorkflowNodeDef {
  id: string;
  name: string;
  type: WorkflowStepType;
  config: Record<string, unknown>;
  position: WorkflowNodePosition;
  onError?: WorkflowStepOnError;
  retryCount?: number;
  timeoutMs?: number;
  condition?: {
    expression: string;
  };
}

export interface WorkflowDefinition {
  nodes: WorkflowNodeDef[];
  edges: WorkflowEdgeDef[];
  entryNodeId: string;
  triggers: WorkflowTrigger[];
}

export interface Workflow {
  id: string;
  projectId?: string;
  name: string;
  description?: string;
  status: WorkflowStatus;
  definition: WorkflowDefinition;
  templateId?: string;
  createdAt: number;
  updatedAt: number;
}

export type WorkflowRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type WorkflowRunTriggerSource = 'manual' | 'schedule' | 'event';

export interface WorkflowRun {
  id: string;
  workflowId: string;
  projectId?: string;
  status: WorkflowRunStatus;
  triggerSource: WorkflowRunTriggerSource;
  triggerDetail?: string;
  currentStepId?: string;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

export type WorkflowStepRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'waiting';

export interface WorkflowStepRun {
  id: string;
  runId: string;
  stepId: string;
  stepType: WorkflowStepType;
  status: WorkflowStepRunStatus;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  attempt: number;
  sessionId?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: 'git' | 'ci' | 'ai' | 'custom';
  definition: WorkflowDefinition;
}
