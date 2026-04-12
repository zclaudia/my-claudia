/**
 * Step Executor Port — domain interface for workflow step execution.
 *
 * Implementations live in ../step-executors/ (infrastructure layer).
 * The engine depends only on this interface, never on concrete executors.
 */

import type { WorkflowNodeDef } from '@my-claudia/shared/features/workflows';

export interface StepResult {
  status: 'completed' | 'failed' | 'skipped';
  output: Record<string, unknown>;
  error?: string;
}

export interface StepContext {
  readonly runId: string;
  readonly stepRunId: string;
  readonly projectId?: string;
  readonly projectRootPath?: string;
  readonly providerId?: string;
  readonly results: ReadonlyMap<string, StepResult>;
  readonly eventPayload?: Record<string, unknown>;
  readonly triggerContext?: Record<string, unknown>;
  resolveTemplate(template: string): string;
  setSessionId(sessionId: string): void;
}

export interface StepExecutorPort {
  readonly supportedTypes: readonly string[];
  execute(
    node: WorkflowNodeDef,
    config: Record<string, unknown>,
    ctx: StepContext,
  ): Promise<StepResult>;
}

export interface ApprovalPort {
  waitForApproval(stepRunId: string, timeoutMs: number): Promise<boolean>;
}

export interface AIRunnerPort {
  runPrompt(opts: {
    projectId?: string;
    providerId: string;
    prompt: string;
    workingDirectory?: string;
    sessionName?: string;
    timeoutMs?: number;
    onSessionCreated?: (sessionId: string) => void;
  }): Promise<{ sessionId: string; content: string }>;
}

export interface NotificationPort {
  notify(event: {
    type: string;
    title: string;
    body: string;
    priority?: string;
    tags?: string[];
  }): Promise<void>;
}

// ── Permission Workflow Bridge ─────────────────────────────────

export interface PermissionEscalationContext {
  requestId: string;
  runId: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  detail: string;
  cwd: string;
  category: string;
  matchedRule?: string;
  isEscalateAlways: boolean;
  sessionType: 'regular' | 'background' | 'agent';
  aiInitiatedPlanMode?: boolean;
}

export interface PermissionBridgePort {
  resolvePermission(requestId: string, decision: 'allow' | 'deny', reason?: string): boolean;
  getPermissionContext(requestId: string): PermissionEscalationContext | undefined;
}

export interface AIRiskAnalysisPort {
  evaluate(ctx: {
    toolName: string;
    toolInput: unknown;
    detail: string;
    cwd: string;
    config: {
      confidenceThreshold: number;
      maxAutoApprovalsPerMinute: number;
      analysisProviderId?: string;
    };
  }): Promise<{
    decision: 'approve' | 'deny' | 'uncertain';
    reasoning: string;
    confidence: number;
    metadata?: Record<string, unknown>;
  }>;
}
