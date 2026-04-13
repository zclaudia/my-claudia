import { codexReviewAdapter } from './adapters/codex.js';
import { runCliJob } from './runner.js';
import type { AIReviewCliJobResult, CliJobInput } from './types.js';
import { buildCliReviewParseError, parseFinalReviewFromText } from './review-parser.js';

export async function runCodexReviewJob(input: CliJobInput): Promise<AIReviewCliJobResult> {
  return await runCliJob(codexReviewAdapter, input, (assistantText, raw) => {
    try {
      const parsed = parseFinalReviewFromText(assistantText, 'Codex review job');
      return {
        ...parsed,
        rawStdout: raw.stdout,
        rawStderr: raw.stderr,
        exitCode: raw.exitCode,
      };
    } catch (error) {
      throw buildCliReviewParseError('Codex review job', raw.stdout, raw.stderr, error, assistantText);
    }
  });
}
