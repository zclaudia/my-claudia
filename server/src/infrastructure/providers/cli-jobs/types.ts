export interface CliJobInput {
  prompt: string;
  cwd: string;
  cliPath?: string;
  env?: Record<string, string>;
  model?: string;
  systemPrompt?: string;
  timeoutMs?: number;
}

export interface CliJobRawResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface CliAdapterPreparedContext {
  [key: string]: unknown;
}

export interface CliProviderAdapter {
  providerType: string;
  resolveBinary(input: CliJobInput): string;
  buildArgs(input: CliJobInput, ctx?: CliAdapterPreparedContext): string[];
  prepare?(input: CliJobInput): Promise<CliAdapterPreparedContext | undefined> | CliAdapterPreparedContext | undefined;
  extractAssistantText(raw: CliJobRawResult, ctx?: CliAdapterPreparedContext): string;
  cleanup?(ctx?: CliAdapterPreparedContext): Promise<void> | void;
}

export interface CliJobResult {
  rawStdout: string;
  rawStderr: string;
  exitCode: number | null;
}

export interface AIReviewCliJobResult extends CliJobResult {
  decision: 'approve' | 'deny' | 'uncertain';
  reasoning: string;
  confidence: number;
}

export class CliJobSpawnError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'CliJobSpawnError';
  }
}

export class CliJobTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliJobTimeoutError';
  }
}

export class CliJobExtractionError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'CliJobExtractionError';
  }
}

export class CliJobParseError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'CliJobParseError';
  }
}
