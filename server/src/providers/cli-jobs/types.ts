export interface CliJobInput {
  prompt: string;
  cwd: string;
  cliPath?: string;
  env?: Record<string, string>;
  model?: string;
  systemPrompt?: string;
  timeoutMs?: number;
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
