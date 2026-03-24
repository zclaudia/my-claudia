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

/** @deprecated V1 step definition — use WorkflowNodeDef for new workflows */
export interface WorkflowStepDef {
  id: string;
  name: string;
  type: WorkflowStepType;
  config: Record<string, unknown>;
  onError?: WorkflowStepOnError;
  retryCount?: number;
  timeoutMs?: number;
  condition?: {
    expression: string;
    thenSteps: string[];
    elseSteps: string[];
  };
}

// ── Workflow Graph Model (V2) ─────────────────────────────────

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

/** V1 linear definition (backward compat) */
export interface WorkflowDefinitionV1 {
  version?: 1;
  steps: WorkflowStepDef[];
  triggers: WorkflowTrigger[];
}

/** V2 graph-based definition */
export interface WorkflowDefinitionV2 {
  version: 2;
  nodes: WorkflowNodeDef[];
  edges: WorkflowEdgeDef[];
  entryNodeId: string;
  triggers: WorkflowTrigger[];
}

export type WorkflowDefinition = WorkflowDefinitionV1 | WorkflowDefinitionV2;

export function isV2Definition(def: WorkflowDefinition): def is WorkflowDefinitionV2 {
  return (def as WorkflowDefinitionV2).version === 2;
}

/** Convert V1 linear definition to V2 graph format */
export function migrateV1ToV2(def: WorkflowDefinitionV1): WorkflowDefinitionV2 {
  const nodes: WorkflowNodeDef[] = [];
  const edges: WorkflowEdgeDef[] = [];

  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i];
    nodes.push({
      id: step.id,
      name: step.name,
      type: step.type,
      config: step.config,
      position: { x: 300, y: i * 150 },
      onError: step.onError,
      retryCount: step.retryCount,
      timeoutMs: step.timeoutMs,
      condition: step.condition ? { expression: step.condition.expression } : undefined,
    });
  }

  for (let i = 0; i < def.steps.length - 1; i++) {
    const step = def.steps[i];
    const nextStep = def.steps[i + 1];

    if (step.type === 'condition' && step.condition) {
      // Condition: create true/false edges to referenced steps
      for (const thenId of step.condition.thenSteps) {
        edges.push({
          id: `edge_${step.id}_true_${thenId}`,
          source: step.id,
          target: thenId,
          type: 'condition_true',
        });
      }
      for (const elseId of step.condition.elseSteps) {
        edges.push({
          id: `edge_${step.id}_false_${elseId}`,
          source: step.id,
          target: elseId,
          type: 'condition_false',
        });
      }
    } else {
      // Sequential success edge
      edges.push({
        id: `edge_${step.id}_to_${nextStep.id}`,
        source: step.id,
        target: nextStep.id,
        type: 'success',
      });
    }
  }

  return {
    version: 2,
    nodes,
    edges,
    entryNodeId: def.steps[0]?.id ?? '',
    triggers: def.triggers,
  };
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
