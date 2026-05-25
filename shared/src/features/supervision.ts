// Supervision v2 Types

export type AgentType = 'supervisor';
export type AgentMode = 'full' | 'lite';

export type SupervisionPhase =
  | 'initializing'
  | 'setup'
  | 'active'
  | 'paused'
  | 'idle'
  | 'archived';

export type TrustLevel = 'low' | 'medium' | 'high';

export type ChangeStatus =
  | 'draft'
  | 'designing'
  | 'awaiting_design_review'
  | 'planning'
  | 'awaiting_execution_review'
  | 'executing'
  | 'paused'
  | 'accepting'
  | 'syncing'
  | 'completed'
  | 'cancelled';

export type GateType = 'design' | 'execution';

export type DesignGateDecision =
  | 'approve_design'
  | 'revise_design'
  | 'revise_change';

export type ExecutionGateDecision =
  | 'approve_execution'
  | 'revise_plan'
  | 'revise_design'
  | 'split_change';

export type AcceptanceDecision =
  | 'approve_acceptance'
  | 'revise_execution';

export interface ProjectChange {
  id: string;
  projectId: string;
  title: string;
  slug: string;
  status: ChangeStatus;
  summary: string;
  motivation?: string;
  nonGoals: string[];
  scope: string[];
  acceptanceCriteria: string[];
  baselineVersion?: string;
  active: boolean;
  designApprovedAt?: number;
  executionApprovedAt?: number;
  syncApprovedAt?: number;
  worktreeId?: string;
  localPrId?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface ChangeExecutionPlan {
  changeId: string;
  designVersion: number;
  summary: string;
  phases?: Array<{
    id: string;
    title: string;
    summary: string;
  }>;
  automation: {
    strategy: 'serial' | 'conservative_parallel';
    autoReview: boolean;
    autoRetry: boolean;
    autoSyncDraft: boolean;
  };
  verification: Array<{
    id: string;
    label: string;
    command?: string;
    required: boolean;
  }>;
  updatedAt: number;
}

export interface SupervisorConfig {
  maxConcurrentTasks: number;
  trustLevel: TrustLevel;
  autoDiscoverTasks: boolean;
  maxTotalTasks?: number;
  maxTokenBudget?: number;
}

export interface ProjectAgent {
  type: AgentType;
  mode: AgentMode;
  phase: SupervisionPhase;
  config: SupervisorConfig;
  mainSessionId?: string;
  pausedReason?: 'user' | 'budget' | 'sync_error';
  pausedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export type TaskStatus =
  | 'proposed'
  | 'pending'
  | 'queued'
  | 'planning'
  | 'running'
  | 'completed'
  | 'reviewing'
  | 'approved'
  | 'integrated'
  | 'rejected'
  | 'merge_conflict'
  | 'blocked'
  | 'failed'
  | 'cancelled';

export interface ReviewVerdict {
  approved: boolean;
  notes: string;
  suggestedChanges?: string[];
}

export interface MergeResult {
  success: boolean;
  conflicts?: string[];
}

export interface TaskResult {
  summary: string;
  filesChanged: string[];
  workflowOutputs?: Array<{
    action: string;
    output: string;
    success: boolean;
  }>;
  reviewNotes?: string;
  reviewVerdict?: ReviewVerdict;
  reviewSessionId?: string;
}

export interface SupervisionTask {
  id: string;
  projectId: string;
  /**
   * C3 invariant: every Task belongs to a Change for audit/traceability.
   * Callers that don't pick a Change explicitly get attached to the
   * per-project Ad-hoc Change (slug `ad-hoc-tasks`) by `SupervisorService`.
   */
  changeId: string;
  title: string;
  description: string;
  source: 'user' | 'agent_discovered';
  sessionId?: string;
  status: TaskStatus;
  priority: number;
  dependencies: string[];
  dependencyMode: 'all' | 'any';
  relevantDocIds?: string[];
  taskSpecificContext?: string;
  scope?: string[];
  acceptanceCriteria: string[];
  maxRetries: number;
  attempt: number;
  result?: TaskResult;
  baseCommit?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  // Scheduling (lite mode)
  scheduleCron?: string;
  scheduleNextRun?: number;
  scheduleEnabled?: boolean;
  retryDelayMs?: number;
  changeTaskRef?: string;
  phaseId?: string;
}

export type SupervisionLogEvent =
  | 'change_created'
  | 'change_status_changed'
  | 'design_gate_requested'
  | 'design_gate_resolved'
  | 'execution_gate_requested'
  | 'execution_gate_resolved'
  | 'change_acceptance_requested'
  | 'change_acceptance_resolved'
  | 'change_sync_requested'
  | 'change_sync_completed'
  | 'agent_initialized'
  | 'phase_changed'
  | 'task_created'
  | 'task_status_changed'
  | 'checkpoint_started'
  | 'checkpoint_completed'
  | 'context_updated'
  | 'context_sync_error'
  | 'review_started'
  | 'review_completed'
  | 'review_failed'
  | 'workflow_action_executed'
  | 'worktree_acquired'
  | 'worktree_released'
  | 'merge_started'
  | 'merge_completed'
  | 'merge_conflict'
  | 'budget_paused'
  | 'main_session_rotated'
  | 'state_recovery_completed'
  | 'task_session_opened'
  | 'task_plan_submitted';

export interface SupervisionLog {
  id: string;
  projectId: string;
  taskId?: string;
  event: SupervisionLogEvent;
  detail?: Record<string, unknown>;
  createdAt: number;
}
