import type { FallbackPolicy, ToolDefinition, ToolResult } from '../structured-result/types.js';

// ── Task Contract ──────────────────────────────────────────────

export interface OneShotTaskContract<T = unknown> {
  taskType: string;
  /** References a StructuredResultRegistry entry. */
  resultType: string;
  requireStructuredSubmit: boolean;
  maxValidationFailures: number;
  /** Override the registry entry's fallback policy for this specific task type. */
  fallbackPolicyOverride?: FallbackPolicy<T>;
}

// ── Request / Result ───────────────────────────────────────────

export interface OneShotTaskRequest<T = unknown> {
  taskType: string;
  providerType: string;
  prompt: string;
  cwd: string;

  systemPrompt?: string;
  model?: string;
  mode?: string;
  timeoutMs?: number;

  projectId?: string;
  metadata?: Record<string, unknown>;

  /** Only fallbackPolicyOverride and maxValidationFailures may be overridden. */
  contractOverride?: Partial<Pick<OneShotTaskContract<T>, 'fallbackPolicyOverride' | 'maxValidationFailures'>>;
}

export type OneShotStopReason =
  | 'structured_submit'
  | 'fallback'
  | 'timeout'
  | 'provider_error'
  | 'validation_exhausted'
  | 'fallback_fail';

export interface OneShotTaskTelemetry {
  taskType: string;
  providerType: string;
  resultType: string;
  durationMs: number;
  validationFailures: number;
  finalized: boolean;
  usedFallback: boolean;
  toolSubmissionAttempts: number;
  rawExitCode?: number | null;
}

export interface OneShotTaskResult<T = unknown> {
  ok: boolean;
  result?: T;
  rawText?: string;
  usedFallback: boolean;
  stopReason: OneShotStopReason;
  telemetry: OneShotTaskTelemetry;
}

// ── Provider Bridge ────────────────────────────────────────────

export interface ProviderBridgeRequest {
  prompt: string;
  cwd: string;
  systemPrompt?: string;
  model?: string;
  mode?: string;
  timeoutMs?: number;
  finalTool: ToolDefinition;
  /** Only used by interactive bridges; batch bridges ignore this. */
  onToolCall?: (call: ToolCall) => Promise<ToolCallOutcome>;
}

export interface ProviderBridgeResult {
  rawText: string;
  exitCode?: number | null;
  timedOut?: boolean;
  durationMs: number;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallOutcome {
  toolResult: ToolResult;
  finalized?: boolean;
}

// ── Top-level interfaces ───────────────────────────────────────

export interface OneShotTaskRuntime {
  run<T = unknown>(request: OneShotTaskRequest<T>): Promise<OneShotTaskResult<T>>;
}

export interface OneShotTaskProviderBridge {
  readonly providerType: string;
  run(request: ProviderBridgeRequest): Promise<ProviderBridgeResult>;
}

export interface OneShotTaskContractRegistry {
  register<T>(contract: OneShotTaskContract<T>): void;
  get<T = unknown>(taskType: string): OneShotTaskContract<T> | undefined;
  list(): string[];
}
