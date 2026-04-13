export interface StructuredResultTypeEntry<T = unknown> {
  resultType: string;
  jsonSchema: Record<string, unknown>;
  fallbackPolicy: FallbackPolicy<T>;
}

export interface StructuredResultSubmission {
  resultType: string;
  payload: Record<string, unknown>;
}

export interface StructuredResultAccepted<T = unknown> {
  accepted: true;
  resultType: string;
  payload: T;
}

export interface StructuredResultRejected {
  accepted: false;
  code: 'unknown_result_type' | 'schema_validation_failed' | 'invalid_payload_type';
  message: string;
  details?: unknown;
}

export type StructuredResultValidationResult<T = unknown> =
  | StructuredResultAccepted<T>
  | StructuredResultRejected;

export interface FallbackPolicy<T = unknown> {
  strategy: 'text_json_parse' | 'mark_uncertain' | 'fail';
  parser?: (text: string) => T;
  createUncertain?: () => T;
}

export interface StructuredResultFallbackOutcome<T = unknown> {
  source: 'fallback_text_json' | 'fallback_uncertain' | 'fallback_fail';
  result?: T;
  error?: string;
}

export interface StructuredResultTelemetry {
  resultType: string;
  acceptedOnAttempt?: number;
  validationFailures: number;
  finalized: boolean;
  fallbackTriggered: boolean;
  fallbackStrategy?: FallbackPolicy['strategy'];
}

export interface StructuredResultRunContext<T = unknown> {
  finalized: boolean;
  acceptedResult?: {
    resultType: string;
    payload: T;
  };
  validationFailures: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  isError: boolean;
  content: string;
}

export interface FinalizationExecutorResult {
  toolResult: ToolResult;
  finalized: boolean;
}

export interface FinalizationSessionPolicy {
  maxValidationFailures: number;
}
