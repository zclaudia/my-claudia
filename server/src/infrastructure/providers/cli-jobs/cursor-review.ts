import { cursorReviewAdapter } from './adapters/cursor.js';
import { runCliJob } from './runner.js';
import type { AIReviewCliJobResult, CliJobInput } from './types.js';
import { buildCliReviewParseError, parseFinalReviewFromText } from './review-parser.js';

export async function runCursorReviewJob(input: CliJobInput): Promise<AIReviewCliJobResult> {
  return await runCliJob(cursorReviewAdapter, input, (assistantText, raw) => {
    try {
      const parsed = parseFinalReviewFromText(assistantText, 'Cursor review job');
      return {
        ...parsed,
        rawStdout: raw.stdout,
        rawStderr: raw.stderr,
        exitCode: raw.exitCode,
      };
    } catch (error) {
      throw buildCliReviewParseError('Cursor review job', raw.stdout, raw.stderr, error, assistantText);
    }
  });
}
