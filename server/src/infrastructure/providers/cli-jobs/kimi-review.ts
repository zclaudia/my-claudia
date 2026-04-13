import { kimiReviewAdapter } from './adapters/kimi.js';
import { runCliJob } from './runner.js';
import type { AIReviewCliJobResult, CliJobInput } from './types.js';
import { buildCliReviewParseError, parseFinalReviewFromText } from './review-parser.js';

export async function runKimiReviewJob(input: CliJobInput): Promise<AIReviewCliJobResult> {
  return await runCliJob(kimiReviewAdapter, input, (assistantText, raw) => {
    try {
      const parsed = parseFinalReviewFromText(assistantText, 'Kimi review job');
      return {
        ...parsed,
        rawStdout: raw.stdout,
        rawStderr: raw.stderr,
        exitCode: raw.exitCode,
      };
    } catch (error) {
      throw buildCliReviewParseError('Kimi review job', raw.stdout, raw.stderr, error, assistantText);
    }
  });
}
