import type { AIReviewCliJobResult, CliJobInput } from './types.js';
import { runKimiReviewJob } from './kimi-review.js';
import { runClaudeReviewJob } from './claude-review.js';
import { runCursorReviewJob } from './cursor-review.js';
import { runOpenCodeReviewJob } from './opencode-review.js';
import { runCodexReviewJob } from './codex-review.js';

export function supportsAIReviewCliJob(providerType: string): boolean {
  return providerType === 'kimi'
    || providerType === 'claude'
    || providerType === 'cursor'
    || providerType === 'opencode'
    || providerType === 'codex';
}

export async function runAIReviewCliJob(
  providerType: string,
  input: CliJobInput,
): Promise<AIReviewCliJobResult> {
  switch (providerType) {
    case 'kimi':
      return await runKimiReviewJob(input);
    case 'claude':
      return await runClaudeReviewJob(input);
    case 'cursor':
      return await runCursorReviewJob(input);
    case 'opencode':
      return await runOpenCodeReviewJob(input);
    case 'codex':
      return await runCodexReviewJob(input);
    default:
      throw new Error(`AI review cli-job is not supported for provider type: ${providerType}`);
  }
}
