import type { CliJobInput, CliJobRawResult, CliProviderAdapter } from '../types.js';

export const openclaudeReviewAdapter: CliProviderAdapter = {
  providerType: 'openclaude',
  resolveBinary(input: CliJobInput): string {
    return input.cliPath || 'openclaude';
  },
  buildArgs(input: CliJobInput): string[] {
    const args = [
      '--print',
      '--output-format',
      'json',
      '--no-session-persistence',
      '--permission-mode',
      'bypassPermissions',
      '--tools',
      '',
    ];

    if (input.model) {
      args.push('--model', input.model);
    }

    if (input.systemPrompt) {
      args.push('--system-prompt', input.systemPrompt);
    }

    args.push(input.prompt);
    return args;
  },
  extractAssistantText(raw: CliJobRawResult): string {
    try {
      const parsedStdout = JSON.parse(raw.stdout) as Record<string, unknown>;
      if (typeof parsedStdout.result === 'string' && parsedStdout.result.length > 0) {
        return parsedStdout.result;
      }
    } catch {
      // Fall back to raw stdout parsing.
    }
    return raw.stdout;
  },
};
