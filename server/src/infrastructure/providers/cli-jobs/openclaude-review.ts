import { openclaudeReviewAdapter } from './adapters/openclaude.js';
import { runCliJob } from './runner.js';
import type { AIReviewCliJobResult, CliJobInput } from './types.js';
import { buildCliReviewParseError, parseFinalReviewFromText } from './review-parser.js';

export async function runOpenClaudeReviewJob(input: CliJobInput): Promise<AIReviewCliJobResult> {
  const openClaudeInput: CliJobInput = {
    ...input,
    env: {
      ...(input.env || {}),
      CLAUDE_CODE_USE_OPENAI: input.env?.CLAUDE_CODE_USE_OPENAI || '1',
    },
  };

  return await runCliJob(openclaudeReviewAdapter, openClaudeInput, (assistantText, raw) => {
    try {
      const parsed = parseFinalReviewFromText(assistantText, 'OpenClaude review job');
      return {
        ...parsed,
        rawStdout: raw.stdout,
        rawStderr: raw.stderr,
        exitCode: raw.exitCode,
      };
    } catch (error) {
      throw buildCliReviewParseError('OpenClaude review job', raw.stdout, raw.stderr, error, assistantText);
    }
  });
}
