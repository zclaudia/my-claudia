// Workflow Types

export type WorkflowStatus = 'active' | 'disabled' | 'archived';
export type WorkflowTriggerType = 'manual' | 'cron' | 'interval' | 'once' | 'event';

export interface WorkflowTrigger {
  type: WorkflowTriggerType;
  cron?: string;
  intervalMinutes?: number;
  onceAt?: number;            // epoch ms — for 'once' triggers
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

export interface WorkflowTriggerSourceMeta {
  /** Unique ID: 'builtin/run.completed' or 'pluginId/my-event' */
  id: string;
  name: string;
  description: string;
  /** The event pattern this source emits (supports globs: 'run.*', '**') */
  eventPattern: string;
  category: string;
  icon?: string;
  /** 'builtin' or pluginId */
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

interface LegacyWorkflowCondition {
  expression: string;
  thenSteps?: string[];
  elseSteps?: string[];
}

interface LegacyWorkflowStepDef {
  id: string;
  name: string;
  type: WorkflowStepType;
  config?: Record<string, unknown>;
  onError?: WorkflowStepOnError;
  retryCount?: number;
  timeoutMs?: number;
  condition?: LegacyWorkflowCondition;
}

interface LegacyWorkflowDefinition {
  version?: number;
  steps?: LegacyWorkflowStepDef[];
  triggers?: WorkflowTrigger[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toNodePosition(index: number): WorkflowNodePosition {
  return { x: 300, y: index * 150 };
}

function migrateLegacyWorkflowDefinition(definition: LegacyWorkflowDefinition): WorkflowDefinition {
  const steps = Array.isArray(definition.steps) ? definition.steps : [];
  const triggers = Array.isArray(definition.triggers) ? definition.triggers : [];

  const nodes: WorkflowNodeDef[] = steps.map((step, index) => ({
    id: step.id,
    name: step.name,
    type: step.type,
    config: step.config ?? {},
    position: toNodePosition(index),
    onError: step.onError,
    retryCount: step.retryCount,
    timeoutMs: step.timeoutMs,
    condition: step.condition?.expression ? { expression: step.condition.expression } : undefined,
  }));

  const edges: WorkflowEdgeDef[] = [];

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const nextStep = steps[index + 1];

    if (step.type === 'condition' && step.condition) {
      for (const thenId of step.condition.thenSteps ?? []) {
        edges.push({
          id: `edge_${step.id}_true_${thenId}`,
          source: step.id,
          target: thenId,
          type: 'condition_true',
        });
      }
      for (const elseId of step.condition.elseSteps ?? []) {
        edges.push({
          id: `edge_${step.id}_false_${elseId}`,
          source: step.id,
          target: elseId,
          type: 'condition_false',
        });
      }
      continue;
    }

    if (nextStep) {
      edges.push({
        id: `edge_${step.id}_to_${nextStep.id}`,
        source: step.id,
        target: nextStep.id,
        type: 'success',
      });
    }
  }

  return {
    nodes,
    edges,
    entryNodeId: steps[0]?.id ?? '',
    triggers,
  };
}

export function normalizeWorkflowDefinition(definition: unknown): WorkflowDefinition {
  if (!isRecord(definition)) {
    return { nodes: [], edges: [], entryNodeId: '', triggers: [] };
  }

  if (Array.isArray(definition.nodes) && Array.isArray(definition.edges)) {
    return {
      nodes: definition.nodes as WorkflowNodeDef[],
      edges: definition.edges as WorkflowEdgeDef[],
      entryNodeId: typeof definition.entryNodeId === 'string' ? definition.entryNodeId : '',
      triggers: Array.isArray(definition.triggers) ? definition.triggers as WorkflowTrigger[] : [],
    };
  }

  if (Array.isArray((definition as LegacyWorkflowDefinition).steps)) {
    return migrateLegacyWorkflowDefinition(definition as LegacyWorkflowDefinition);
  }

  return {
    nodes: [],
    edges: [],
    entryNodeId: '',
    triggers: Array.isArray(definition.triggers) ? definition.triggers as WorkflowTrigger[] : [],
  };
}

export type WorkflowSourceType = 'user' | 'plugin' | 'template';
export type WorkflowAuthoringMode = 'simple' | 'graph' | 'event-trigger';

export interface Workflow {
  id: string;
  projectId?: string;
  name: string;
  description?: string;
  status: WorkflowStatus;
  definition: WorkflowDefinition;
  templateId?: string;
  /** Plugin that created/owns this workflow */
  sourcePluginId?: string;
  /** How this workflow was created */
  sourceType?: WorkflowSourceType;
  /** Which editor to use when reopening */
  authoringMode?: WorkflowAuthoringMode;
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
