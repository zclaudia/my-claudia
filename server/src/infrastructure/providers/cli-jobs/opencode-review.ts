import { opencodeReviewAdapter } from './adapters/opencode.js';
import { runCliJob } from './runner.js';
import type { AIReviewCliJobResult, CliJobInput } from './types.js';
import { buildCliReviewParseError, parseFinalReviewFromText } from './review-parser.js';

export async function runOpenCodeReviewJob(input: CliJobInput): Promise<AIReviewCliJobResult> {
  return await runCliJob(opencodeReviewAdapter, input, (assistantText, raw) => {
    try {
      const parsed = parseFinalReviewFromText(assistantText, 'OpenCode review job');
      return {
        ...parsed,
        rawStdout: raw.stdout,
        rawStderr: raw.stderr,
        exitCode: raw.exitCode,
      };
    } catch (error) {
      throw buildCliReviewParseError('OpenCode review job', raw.stdout, raw.stderr, error, assistantText);
    }
  });
}
