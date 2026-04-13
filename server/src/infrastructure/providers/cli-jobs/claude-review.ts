import { claudeReviewAdapter } from './adapters/claude.js';
import { runCliJob } from './runner.js';
import type { AIReviewCliJobResult, CliJobInput } from './types.js';
import { buildCliReviewParseError, parseFinalReviewFromText } from './review-parser.js';

export async function runClaudeReviewJob(input: CliJobInput): Promise<AIReviewCliJobResult> {
  return await runCliJob(claudeReviewAdapter, input, (assistantText, raw) => {
    try {
      const parsed = parseFinalReviewFromText(assistantText, 'Claude review job');
      return {
        ...parsed,
        rawStdout: raw.stdout,
        rawStderr: raw.stderr,
        exitCode: raw.exitCode,
      };
    } catch (error) {
      throw buildCliReviewParseError('Claude review job', raw.stdout, raw.stderr, error, assistantText);
    }
  });
}
