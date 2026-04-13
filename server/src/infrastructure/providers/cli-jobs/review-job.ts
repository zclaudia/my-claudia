import type { AIReviewCliJobResult, CliJobInput } from './types.js';
import { runKimiReviewJob } from './kimi-review.js';
import { runClaudeReviewJob } from './claude-review.js';
import { runCursorReviewJob } from './cursor-review.js';
import { runOpenCodeReviewJob } from './opencode-review.js';
import { runCodexReviewJob } from './codex-review.js';

const REVIEW_JOB_RUNNERS: Record<string, (input: CliJobInput) => Promise<AIReviewCliJobResult>> = {
  kimi: runKimiReviewJob,
  claude: runClaudeReviewJob,
  cursor: runCursorReviewJob,
  opencode: runOpenCodeReviewJob,
  codex: runCodexReviewJob,
};

export function supportsAIReviewCliJob(providerType: string): boolean {
  return providerType in REVIEW_JOB_RUNNERS;
}

export async function runAIReviewCliJob(
  providerType: string,
  input: CliJobInput,
): Promise<AIReviewCliJobResult> {
  const runner = REVIEW_JOB_RUNNERS[providerType];
  if (!runner) {
    throw new Error(`AI review cli-job is not supported for provider type: ${providerType}`);
  }
  return await runner(input);
}
